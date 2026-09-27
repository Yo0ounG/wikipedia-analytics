import type { MediaWikiClient, PageInfo, WikipediaSite } from '../api/mediawiki-client.js';
import type { WikidataClient } from '../api/wikidata-client.js';
import { isValidQid, normalizeForMatch, tokenize } from '../utils/encoding.js';
import { resolveArticles } from './article-resolver.js';
import {
  ResolverInputError,
  type ConceptResolution,
  type ResolveTopicInput,
  type TopicCandidate,
  type TopicResolution,
} from './types.js';

const MAX_CANDIDATES = 8;
/** Minimum token overlap for a non-exact search hit to be accepted without clarification. */
const MIN_MATCH_SCORE = 0.6;
/** A runner-up this close to the best hit makes the query ambiguous. */
const AMBIGUITY_MARGIN = 0.15;

export const MESSAGES = {
  ambiguous: 'Multiple concepts match this query.',
  notFound: 'No Wikipedia article matches this query.',
} as const;

/** Jaccard overlap of normalised tokens (parentheticals ignored). */
export function matchScore(query: string, title: string): number {
  const q = new Set(tokenize(query));
  const t = new Set(tokenize(title));
  if (q.size === 0 || t.size === 0) return 0;
  let inter = 0;
  for (const token of q) if (t.has(token)) inter++;
  return inter / (q.size + t.size - inter);
}

function toCandidate(page: PageInfo, language: string): TopicCandidate | null {
  if (page.qid === null) return null;
  return { qid: page.qid, title: page.title, description: page.description, language };
}

function uniqueCandidates(pages: PageInfo[], language: string, exclude?: string): TopicCandidate[] {
  const seen = new Set<string>(exclude ? [exclude] : []);
  const out: TopicCandidate[] = [];
  for (const page of pages) {
    const c = toCandidate(page, language);
    if (!c || seen.has(c.qid)) continue;
    seen.add(c.qid);
    out.push(c);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * Links on a disambiguation page come back alphabetically. Rank them so the most likely
 * meanings come first: pages that also appear in search results (search ranks by relevance
 * and popularity), then "<term> (qualifier)" titles, then titles containing the term.
 */
export function rankDisambiguationLinks(
  links: readonly PageInfo[],
  searchHits: readonly PageInfo[],
  query: string,
): PageInfo[] {
  const searchRank = new Map(searchHits.map((h, i) => [h.qid, i]));
  const base = normalizeForMatch(query);
  const tier = (p: PageInfo): number => {
    if (searchRank.has(p.qid)) return 0;
    if (normalizeForMatch(p.title) === base) return 1;
    if (tokenize(p.title).some((t) => tokenize(query).includes(t))) return 2;
    return 3;
  };
  return links
    .map((p, i) => ({ p, i, t: tier(p), s: searchRank.get(p.qid) ?? 0 }))
    .sort((a, b) => a.t - b.t || a.s - b.s || a.i - b.i)
    .map((x) => x.p);
}

export class TopicResolver {
  constructor(
    private readonly mediawiki: MediaWikiClient,
    private readonly wikidata: WikidataClient,
  ) {}

  /** Stage 1: map free text to a single Wikidata concept, or report ambiguity. */
  async resolveConcept(query: string, site: WikipediaSite): Promise<ConceptResolution> {
    const trimmed = query.trim();
    if (trimmed.length === 0) throw new ResolverInputError('Topic query must not be empty.');
    const lang = site.language;
    const exact = await this.mediawiki.lookupTitle(site, trimmed);

    if (exact.page?.isDisambiguation === true) {
      const [links, hits] = await Promise.all([
        this.mediawiki.disambiguationLinks(site, exact.page.title),
        this.mediawiki.search(site, trimmed),
      ]);
      const candidates = uniqueCandidates(rankDisambiguationLinks(links, hits, trimmed), lang);
      return {
        status: candidates.length > 0 ? 'ambiguous' : 'not_found',
        qid: null,
        confidence: null,
        method: null,
        matchedTitle: exact.page.title,
        description: null,
        candidates,
        messages: [
          candidates.length > 0
            ? `${MESSAGES.ambiguous} "${exact.page.title}" is a disambiguation page on ${site.host}.`
            : MESSAGES.notFound,
        ],
      };
    }

    const search = await this.mediawiki.search(site, trimmed);

    if (exact.page?.qid) {
      const exactQid = exact.page.qid;
      const base = normalizeForMatch(exact.page.title);
      // Other concepts whose title is the same term with a qualifier, e.g. "Python (programming language)".
      const namesakes = search.filter(
        (p) => !p.isDisambiguation && p.qid !== exactQid && normalizeForMatch(p.title) === base,
      );
      return {
        status: 'resolved',
        qid: exactQid,
        // An exact, non-disambiguation title is Wikipedia's own primary topic for the term.
        confidence: 'high',
        method: exact.redirectedFrom ? 'redirect' : 'exact_title',
        matchedTitle: exact.page.title,
        description: exact.page.description,
        candidates: uniqueCandidates(namesakes, lang, exactQid),
        messages: [
          exact.redirectedFrom
            ? `"${exact.redirectedFrom}" redirects to "${exact.page.title}" on ${site.host}.`
            : `Exact article title match on ${site.host}.`,
          ...(namesakes.length > 0
            ? ['Other concepts share this name (see candidates); the primary topic was used.']
            : []),
        ],
      };
    }

    const disambiguationHit = search.find(
      (p) => p.isDisambiguation && normalizeForMatch(p.title) === normalizeForMatch(trimmed),
    );
    const scored = search
      .filter((p) => !p.isDisambiguation && p.qid !== null)
      .map((p) => ({ page: p, score: matchScore(trimmed, p.title) }));

    if (scored.length === 0) {
      return {
        status: 'not_found',
        qid: null,
        confidence: null,
        method: null,
        matchedTitle: null,
        description: null,
        candidates: [],
        messages: [`${MESSAGES.notFound} (searched ${site.host})`],
      };
    }

    const ranked = [...scored].sort(
      (a, b) => b.score - a.score || (a.page.searchRank ?? 0) - (b.page.searchRank ?? 0),
    );
    const best = ranked[0];
    const runnerUp = ranked[1];
    const clearWinner =
      best !== undefined &&
      best.score >= MIN_MATCH_SCORE &&
      (runnerUp === undefined || best.score - runnerUp.score > AMBIGUITY_MARGIN) &&
      disambiguationHit === undefined;

    if (clearWinner) {
      // Titles that differ from the query only in case/punctuation/diacritics count as exact.
      const sameName = normalizeForMatch(best.page.title) === normalizeForMatch(trimmed);
      return {
        status: 'resolved',
        qid: best.page.qid,
        confidence: sameName ? 'high' : 'moderate',
        method: 'search_match',
        matchedTitle: best.page.title,
        description: best.page.description,
        candidates: uniqueCandidates(
          ranked.slice(1).map((r) => r.page),
          lang,
          best.page.qid ?? undefined,
        ),
        messages: [
          `No exact title match; best search result "${best.page.title}" on ${site.host} was selected.`,
        ],
      };
    }

    return {
      status: 'ambiguous',
      qid: null,
      confidence: null,
      method: null,
      matchedTitle: null,
      description: null,
      candidates: uniqueCandidates(
        scored.map((s) => s.page),
        lang,
      ),
      messages: [
        `${MESSAGES.ambiguous} No article title on ${site.host} matches "${trimmed}" exactly; confirm the intended concept.`,
      ],
    };
  }

  /** Full resolution: concept → Wikidata item → article in each requested language. */
  async resolve(input: ResolveTopicInput): Promise<TopicResolution> {
    const sites = await this.mediawiki.getWikipediaSites();
    const searchSite = sites.get(input.searchLanguage);
    if (!searchSite) {
      throw new ResolverInputError(
        `Unknown Wikipedia language "${input.searchLanguage}" for --search-lang.`,
      );
    }

    let concept: ConceptResolution;
    if (input.qid !== undefined) {
      if (!isValidQid(input.qid)) throw new ResolverInputError(`Invalid QID "${input.qid}".`);
      concept = {
        status: 'resolved',
        qid: input.qid,
        confidence: 'high',
        method: 'explicit_qid',
        matchedTitle: null,
        description: null,
        candidates: [],
        messages: ['Concept given explicitly by Wikidata QID.'],
      };
    } else if (input.query !== undefined) {
      concept = await this.resolveConcept(input.query, searchSite);
    } else {
      throw new ResolverInputError('Provide a topic query or a Wikidata QID.');
    }

    const base: TopicResolution = {
      query: input.query ?? null,
      searchLanguage: searchSite.language,
      status: concept.status,
      qid: concept.qid,
      label: null,
      description: concept.description,
      confidence: concept.confidence,
      method: concept.method,
      matchedTitle: concept.matchedTitle,
      candidates: concept.candidates,
      articles: {},
      missingLanguages: [],
      messages: concept.messages,
    };
    if (concept.status !== 'resolved' || concept.qid === null) return base;

    const knownSites = input.languages
      .map((l) => sites.get(l))
      .filter((s): s is WikipediaSite => s !== undefined);
    const item = await this.wikidata.getItem(concept.qid, {
      sites: [searchSite, ...knownSites].map((s) => s.dbname),
      languages: [...new Set(['en', searchSite.language, ...knownSites.map((s) => s.language)])],
    });
    if (!item) {
      return {
        ...base,
        status: 'not_found',
        messages: [...base.messages, `Wikidata item ${concept.qid} does not exist.`],
      };
    }

    const { articles, missing } = resolveArticles(item, input.languages, sites);
    const label =
      item.labels[searchSite.language] ??
      item.labels['en'] ??
      Object.values(item.labels)[0] ??
      concept.matchedTitle;
    const description =
      concept.description ??
      item.descriptions[searchSite.language] ??
      item.descriptions['en'] ??
      null;
    const found = Object.keys(articles).length;
    const status: TopicResolution['status'] =
      found === 0 ? 'not_found' : missing.length > 0 ? 'partially_resolved' : 'resolved';

    return {
      ...base,
      status,
      label,
      description,
      articles,
      missingLanguages: missing,
      messages: [
        ...base.messages,
        ...missing.map((m) => m.message),
        ...(found === 0 ? ['The concept has no article in any requested language.'] : []),
      ],
    };
  }
}
