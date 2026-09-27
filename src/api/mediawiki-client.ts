import { CACHE_TTL } from '../data/cache.js';
import {
  mediaWikiQueryResponseSchema,
  siteMatrixLanguageEntrySchema,
  siteMatrixResponseSchema,
  type MediaWikiQueryResponse,
} from '../schemas/api.js';
import { buildQuery } from '../utils/encoding.js';
import { ApiError, type HttpClient } from './http-client.js';

/** Internal model of a Wikipedia page as seen by the resolver. */
export interface PageInfo {
  title: string;
  pageId: number;
  qid: string | null;
  description: string | null;
  isDisambiguation: boolean;
  /** Search rank (1-based) when the page came from a search, else null. */
  searchRank: number | null;
}

export interface TitleLookup {
  requestedTitle: string;
  /** Final title after normalisation and redirects; null when the page does not exist. */
  page: PageInfo | null;
  redirectedFrom: string | null;
}

export interface WikipediaSite {
  language: string;
  /** Wikimedia database name, also the Wikidata sitelink key (e.g. `plwiki`, `be_x_oldwiki`). */
  dbname: string;
  /** Host, e.g. `pl.wikipedia.org`. */
  host: string;
  /** Pageviews API project, e.g. `pl.wikipedia`. */
  project: string;
}

const META_API = 'https://meta.wikimedia.org/w/api.php';

function toPageInfo(
  page: NonNullable<NonNullable<MediaWikiQueryResponse['query']>['pages']>[number],
): PageInfo | null {
  if (page.missing === true || page.invalid === true || page.pageid === undefined) return null;
  return {
    title: page.title,
    pageId: page.pageid,
    qid: page.pageprops?.wikibase_item ?? null,
    description: page.description ?? null,
    isDisambiguation: page.pageprops?.disambiguation !== undefined,
    searchRank: page.index ?? null,
  };
}

function assertNoApiError(body: MediaWikiQueryResponse, url: string): void {
  if (body.error) {
    throw new ApiError('invalid_response', `MediaWiki API error: ${body.error.info}`, url);
  }
}

export class MediaWikiClient {
  private siteMatrix: Promise<Map<string, WikipediaSite>> | null = null;

  constructor(private readonly http: HttpClient) {}

  private apiUrl(site: WikipediaSite): string {
    return `https://${site.host}/w/api.php`;
  }

  /**
   * All open Wikipedia language editions, from the official site matrix. Keyed by both the
   * language code and the subdomain so `be-tarask`, `simple`, `no` etc. all resolve.
   */
  async getWikipediaSites(): Promise<Map<string, WikipediaSite>> {
    this.siteMatrix ??= this.loadSiteMatrix().catch((error: unknown) => {
      this.siteMatrix = null;
      throw error;
    });
    return this.siteMatrix;
  }

  private async loadSiteMatrix(): Promise<Map<string, WikipediaSite>> {
    const url = `${META_API}?${buildQuery({
      action: 'sitematrix',
      format: 'json',
      formatversion: 2,
      smtype: 'language',
      smsiteprop: 'url|dbname|code',
      smlangprop: 'code|site',
      smstate: 'all',
    })}`;
    const body = await this.http.getJson(url, siteMatrixResponseSchema, {
      cacheTtlMs: CACHE_TTL.siteMatrix,
    });
    const sites = new Map<string, WikipediaSite>();
    for (const [key, value] of Object.entries(body.sitematrix)) {
      if (key === 'count' || key === 'specials') continue;
      const lang = siteMatrixLanguageEntrySchema.safeParse(value);
      if (!lang.success) continue;
      for (const s of lang.data.site) {
        if (s.code !== 'wiki' || s.closed === true || s.private === true) continue;
        const host = new URL(s.url).host;
        const site: WikipediaSite = {
          language: lang.data.code,
          dbname: s.dbname,
          host,
          project: host.replace(/\.org$/, ''),
        };
        sites.set(lang.data.code, site);
        sites.set(host.split('.')[0] ?? lang.data.code, site);
      }
    }
    if (sites.size === 0) {
      throw new ApiError('invalid_response', 'Wikimedia site matrix contained no Wikipedias.', url);
    }
    return sites;
  }

  async getSite(language: string): Promise<WikipediaSite | null> {
    return (await this.getWikipediaSites()).get(language) ?? null;
  }

  /** Full-text search with page properties (QID, disambiguation flag) and short descriptions. */
  async search(site: WikipediaSite, query: string, limit = 8): Promise<PageInfo[]> {
    const url = `${this.apiUrl(site)}?${buildQuery({
      action: 'query',
      format: 'json',
      formatversion: 2,
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: 0,
      gsrlimit: limit,
      prop: 'pageprops|description',
      ppprop: 'wikibase_item|disambiguation',
      redirects: 1,
    })}`;
    const body = await this.http.getJson(url, mediaWikiQueryResponseSchema, {
      cacheTtlMs: CACHE_TTL.search,
    });
    assertNoApiError(body, url);
    return (body.query?.pages ?? [])
      .filter((p) => p.ns === 0)
      .map(toPageInfo)
      .filter((p): p is PageInfo => p !== null)
      .sort((a, b) => (a.searchRank ?? 0) - (b.searchRank ?? 0));
  }

  /** Exact title lookup following normalisation and redirects. */
  async lookupTitle(site: WikipediaSite, title: string): Promise<TitleLookup> {
    const url = `${this.apiUrl(site)}?${buildQuery({
      action: 'query',
      format: 'json',
      formatversion: 2,
      titles: title,
      prop: 'pageprops|description',
      ppprop: 'wikibase_item|disambiguation',
      redirects: 1,
    })}`;
    const body = await this.http.getJson(url, mediaWikiQueryResponseSchema, {
      cacheTtlMs: CACHE_TTL.pageMetadata,
    });
    assertNoApiError(body, url);
    const page = body.query?.pages?.[0];
    const redirect = body.query?.redirects?.[0];
    return {
      requestedTitle: title,
      page: page && page.ns === 0 ? toPageInfo(page) : null,
      redirectedFrom: redirect ? redirect.from : null,
    };
  }

  /** Articles linked from a disambiguation page: the candidate concepts behind an ambiguous term. */
  async disambiguationLinks(site: WikipediaSite, title: string, limit = 200): Promise<PageInfo[]> {
    const url = `${this.apiUrl(site)}?${buildQuery({
      action: 'query',
      format: 'json',
      formatversion: 2,
      generator: 'links',
      titles: title,
      gplnamespace: 0,
      gpllimit: limit,
      prop: 'pageprops|description',
      ppprop: 'wikibase_item|disambiguation',
      redirects: 1,
    })}`;
    const body = await this.http.getJson(url, mediaWikiQueryResponseSchema, {
      cacheTtlMs: CACHE_TTL.pageMetadata,
    });
    assertNoApiError(body, url);
    return (body.query?.pages ?? [])
      .map(toPageInfo)
      .filter((p): p is PageInfo => p !== null && !p.isDisambiguation && p.qid !== null);
  }
}
