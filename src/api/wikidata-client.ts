import { CACHE_TTL } from '../data/cache.js';
import { wikidataEntitiesResponseSchema } from '../schemas/api.js';
import { buildQuery, isValidQid } from '../utils/encoding.js';
import { ApiError, type HttpClient } from './http-client.js';

export interface WikidataItem {
  qid: string;
  /** Labels keyed by language code. */
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  /** Article titles keyed by Wikimedia dbname (e.g. `plwiki`). */
  sitelinks: Record<string, string>;
}

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

export class WikidataClient {
  constructor(private readonly http: HttpClient) {}

  /**
   * Fetch one item with labels, descriptions and the requested sitelinks.
   * Returns null when the item does not exist.
   */
  async getItem(
    qid: string,
    options: { sites: string[]; languages: string[] },
  ): Promise<WikidataItem | null> {
    if (!isValidQid(qid)) throw new Error(`Invalid Wikidata QID "${qid}".`);
    const url = `${WIKIDATA_API}?${buildQuery({
      action: 'wbgetentities',
      format: 'json',
      ids: qid,
      props: 'labels|descriptions|sitelinks',
      languages: [...new Set(options.languages)].sort().join('|'),
      sitefilter: [...new Set(options.sites)].sort().join('|'),
      redirects: 'yes',
    })}`;
    const body = await this.http.getJson(url, wikidataEntitiesResponseSchema, {
      cacheTtlMs: CACHE_TTL.wikidata,
    });
    if (body.error) {
      if (body.error.code === 'no-such-entity') return null;
      throw new ApiError('invalid_response', `Wikidata API error: ${body.error.info}`, url);
    }
    const entity = Object.values(body.entities ?? {})[0];
    if (!entity || entity.missing !== undefined) return null;
    const pick = (terms: Record<string, { value: string }> | undefined): Record<string, string> =>
      Object.fromEntries(Object.entries(terms ?? {}).map(([k, v]) => [k, v.value]));
    return {
      qid: entity.id,
      labels: pick(entity.labels),
      descriptions: pick(entity.descriptions),
      sitelinks: Object.fromEntries(
        Object.entries(entity.sitelinks ?? {}).map(([site, link]) => [site, link.title]),
      ),
    };
  }
}
