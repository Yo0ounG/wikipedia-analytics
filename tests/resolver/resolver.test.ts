import { describe, expect, it } from '@jest/globals';
import { HttpClient } from '../../src/api/http-client.js';
import { MediaWikiClient, type PageInfo } from '../../src/api/mediawiki-client.js';
import { WikidataClient } from '../../src/api/wikidata-client.js';
import { resolveArticles } from '../../src/resolver/article-resolver.js';
import {
  matchScore,
  rankDisambiguationLinks,
  TopicResolver,
} from '../../src/resolver/topic-resolver.js';
import { ResolverInputError } from '../../src/resolver/types.js';
import { silentLogger } from '../../src/utils/logging.js';
import {
  fakeWikimedia,
  STANDARD_CONFIG,
  type FakeWikimediaConfig,
} from '../helpers/fake-wikimedia.js';
import { noSleep } from '../helpers/fake-fetch.js';

function resolver(config: FakeWikimediaConfig = STANDARD_CONFIG) {
  const fetch = fakeWikimedia(config);
  const http = new HttpClient({
    userAgent: 't',
    logger: silentLogger,
    fetch,
    sleep: noSleep,
    maxRetries: 0,
  });
  const mediawiki = new MediaWikiClient(http);
  return { fetch, resolver: new TopicResolver(mediawiki, new WikidataClient(http)), mediawiki };
}

describe('TopicResolver', () => {
  it('resolves an exact title to one QID and the matching article per language', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({
      query: 'astronomy',
      languages: ['pl', 'cs', 'uk'],
      searchLanguage: 'en',
    });
    expect(res.status).toBe('resolved');
    expect(res.qid).toBe('Q333');
    expect(res.method).toBe('exact_title');
    expect(res.confidence).toBe('high');
    expect(res.label).toBe('astronomy');
    expect(Object.fromEntries(Object.entries(res.articles).map(([k, a]) => [k, a.title]))).toEqual({
      pl: 'Astronomia',
      cs: 'Astronomie',
      uk: 'Астрономія',
    });
    expect(res.articles['uk']?.url).toBe(
      'https://uk.wikipedia.org/wiki/%D0%90%D1%81%D1%82%D1%80%D0%BE%D0%BD%D0%BE%D0%BC%D1%96%D1%8F',
    );
  });

  it('does not reuse the query string across languages: articles come from Wikidata sitelinks', async () => {
    const { resolver: r, fetch } = resolver();
    await r.resolve({ query: 'astronomy', languages: ['pl'], searchLanguage: 'en' });
    expect(fetch.calls.some((c) => c.includes('pl.wikipedia.org'))).toBe(false);
    expect(fetch.calls.some((c) => c.includes('wbgetentities'))).toBe(true);
  });

  it('follows redirects for synonyms (Alternate-day fasting → Intermittent fasting)', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({
      query: 'Alternate-day fasting',
      languages: ['cs'],
      searchLanguage: 'en',
    });
    expect(res.status).toBe('resolved');
    expect(res.method).toBe('redirect');
    expect(res.qid).toBe('Q1666254');
    expect(res.messages[0]).toMatch(/redirects to "Intermittent fasting"/);
  });

  it('accepts a clear search match when no exact title exists', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({
      query: 'fasting intermittent',
      languages: ['cs'],
      searchLanguage: 'en',
    });
    expect(res.status).toBe('resolved');
    expect(res.method).toBe('search_match');
    expect(res.qid).toBe('Q1666254');
    expect(res.confidence).toBe('moderate');
  });

  it('asks for clarification instead of guessing for an unclear synonym', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({ query: 'IF diet', languages: ['cs'], searchLanguage: 'en' });
    expect(res.status).toBe('ambiguous');
    expect(res.qid).toBeNull();
    expect(res.candidates.map((c) => c.qid)).toContain('Q1666254');
    expect(res.articles).toEqual({});
  });

  it('detects ambiguity on disambiguation pages (Mercury) and lists concepts', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({
      query: 'Mercury',
      languages: ['pl', 'cs'],
      searchLanguage: 'en',
    });
    expect(res.status).toBe('ambiguous');
    expect(res.messages[0]).toMatch(/Multiple concepts match this query/);
    expect(res.candidates.map((c) => c.qid)).toEqual(
      expect.arrayContaining(['Q308', 'Q925', 'Q47652']),
    );
    expect(new Set(res.candidates.map((c) => c.qid)).size).toBe(res.candidates.length);
  });

  it('resolves an explicit QID after clarification', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({ qid: 'Q308', languages: ['pl', 'cs'], searchLanguage: 'en' });
    expect(res.status).toBe('resolved');
    expect(res.method).toBe('explicit_qid');
    expect(res.articles['pl']?.title).toBe('Merkury');
  });

  it('reports a missing article without substituting another one (partially resolved)', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({
      query: 'intermittent fasting',
      languages: ['pl', 'cs'],
      searchLanguage: 'en',
    });
    expect(res.status).toBe('partially_resolved');
    expect(Object.keys(res.articles)).toEqual(['cs']);
    expect(res.missingLanguages).toEqual([
      {
        language: 'pl',
        reason: 'no_article',
        message: 'The selected concept (Q1666254) has no Wikipedia article in language "pl".',
      },
    ]);
  });

  it('reports unknown languages and not_found when no requested language has an article', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({ qid: 'Q1666254', languages: ['pl', 'xx'], searchLanguage: 'en' });
    expect(res.status).toBe('not_found');
    expect(res.missingLanguages.map((m) => m.reason)).toEqual(['no_article', 'unknown_language']);
    expect(res.messages.join(' ')).toMatch(/no article in any requested language/);
  });

  it('returns not_found for unknown topics and missing Wikidata items', async () => {
    const { resolver: r } = resolver();
    await expect(
      r.resolve({ query: 'zzqqxx', languages: ['en'], searchLanguage: 'en' }),
    ).resolves.toMatchObject({ status: 'not_found', candidates: [] });
    await expect(
      r.resolve({ qid: 'Q999999', languages: ['en'], searchLanguage: 'en' }),
    ).resolves.toMatchObject({ status: 'not_found' });
  });

  it('keeps the primary topic but lists namesakes when other concepts share the name', async () => {
    const config: FakeWikimediaConfig = {
      ...STANDARD_CONFIG,
      searches: {
        'en.wikipedia.org|astronomy': [
          { title: 'Astronomy', qid: 'Q333' },
          { title: 'Astronomy (album)', qid: 'Q4811469' },
        ],
      },
    };
    const res = await resolver(config).resolver.resolve({
      query: 'astronomy',
      languages: ['pl'],
      searchLanguage: 'en',
    });
    expect(res.status).toBe('resolved');
    expect(res.confidence).toBe('high');
    expect(res.candidates.map((c) => c.qid)).toEqual(['Q4811469']);
    expect(res.messages.join(' ')).toMatch(/share this name/);
  });

  it('searches in the requested language edition', async () => {
    const { resolver: r } = resolver();
    const res = await r.resolve({ query: 'астрономія', languages: ['pl'], searchLanguage: 'uk' });
    expect(res.qid).toBe('Q333');
    expect(res.searchLanguage).toBe('uk');
  });

  it('validates its input', async () => {
    const { resolver: r } = resolver();
    await expect(r.resolve({ languages: ['en'], searchLanguage: 'en' })).rejects.toBeInstanceOf(
      ResolverInputError,
    );
    await expect(
      r.resolve({ query: 'x', languages: ['en'], searchLanguage: 'xx' }),
    ).rejects.toThrow(/Unknown Wikipedia language/);
    await expect(
      r.resolve({ qid: 'Mercury', languages: ['en'], searchLanguage: 'en' }),
    ).rejects.toThrow(/Invalid QID/);
    await expect(
      r.resolve({ query: '   ', languages: ['en'], searchLanguage: 'en' }),
    ).rejects.toThrow(/must not be empty/);
  });
});

describe('ranking and scoring helpers', () => {
  const page = (title: string, qid: string): PageInfo => ({
    title,
    qid,
    pageId: 1,
    description: null,
    isDisambiguation: false,
    searchRank: null,
  });

  it('scores token overlap and ignores parentheticals', () => {
    expect(matchScore('intermittent fasting', 'Intermittent fasting')).toBe(1);
    expect(matchScore('mercury', 'Mercury (planet)')).toBe(1);
    expect(matchScore('IF diet', 'Macrobiotic diet')).toBeCloseTo(1 / 3);
    expect(matchScore('', 'x')).toBe(0);
  });

  it('ranks disambiguation links by search relevance, then name match', () => {
    const links = [
      page('Freddie Mercury', 'Q1'),
      page('Mercury (element)', 'Q2'),
      page('Mercury (planet)', 'Q3'),
      page('Other', 'Q4'),
    ];
    const ranked = rankDisambiguationLinks(links, [page('Mercury (planet)', 'Q3')], 'Mercury');
    expect(ranked.map((p) => p.qid)).toEqual(['Q3', 'Q2', 'Q1', 'Q4']);
  });
});

describe('resolveArticles', () => {
  const sites = new Map([
    ['pl', { language: 'pl', dbname: 'plwiki', host: 'pl.wikipedia.org', project: 'pl.wikipedia' }],
    [
      'be-tarask',
      {
        language: 'be-tarask',
        dbname: 'be_x_oldwiki',
        host: 'be-tarask.wikipedia.org',
        project: 'be-tarask.wikipedia',
      },
    ],
  ]);

  it('uses dbname-based sitelinks, including non-trivial mappings', () => {
    const { articles, missing } = resolveArticles(
      {
        qid: 'Q1',
        labels: {},
        descriptions: {},
        sitelinks: { be_x_oldwiki: 'Астраномія', plwiki: 'AC/DC' },
      },
      ['be-tarask', 'pl'],
      sites,
    );
    expect(articles['be-tarask']?.title).toBe('Астраномія');
    expect(articles['pl']?.url).toBe('https://pl.wikipedia.org/wiki/AC%2FDC');
    expect(missing).toEqual([]);
  });
});
