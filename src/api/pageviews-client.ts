import { CACHE_TTL } from '../data/cache.js';
import { aggregateResponseSchema, perArticleResponseSchema } from '../schemas/api.js';
import type { AccessType, AgentType, PageviewPoint } from '../types/pageviews.js';
import { fromWikimediaTimestamp, toCompactDate } from '../utils/dates.js';
import { encodeArticleTitle } from '../utils/encoding.js';
import { ApiError, type HttpClient } from './http-client.js';

export const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews';

export interface PageviewRequest {
  /** Pageviews project, e.g. `pl.wikipedia`. */
  project: string;
  start: string;
  end: string;
  access: AccessType;
  agent: AgentType;
}

export interface ArticlePageviews {
  points: PageviewPoint[];
  /** True when the API returned 404: no views were recorded in the range. */
  noData: boolean;
}

function validateProject(project: string): string {
  if (!/^[a-z0-9-]+\.wikipedia$/.test(project)) {
    throw new Error(`Invalid Wikipedia project "${project}".`);
  }
  return project;
}

/**
 * Client for the Wikimedia Analytics Pageviews API (AQS).
 * Note: the per-article endpoint omits days with zero views, and returns 404 when the
 * whole range has no views. Both are surfaced, never silently filled.
 */
export class PageviewsClient {
  constructor(private readonly http: HttpClient) {}

  async getArticleDaily(req: PageviewRequest & { title: string }): Promise<ArticlePageviews> {
    const url = [
      PAGEVIEWS_API,
      'per-article',
      validateProject(req.project),
      req.access,
      req.agent,
      encodeArticleTitle(req.title),
      'daily',
      toCompactDate(req.start),
      toCompactDate(req.end),
    ].join('/');
    try {
      const body = await this.http.getJson(url, perArticleResponseSchema, {
        cacheTtlMs: CACHE_TTL.pageviews,
      });
      return {
        points: body.items.map((i) => ({
          date: fromWikimediaTimestamp(i.timestamp),
          views: i.views,
        })),
        noData: false,
      };
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'not_found')
        return { points: [], noData: true };
      throw error;
    }
  }

  /** Total daily pageviews of a whole Wikipedia edition (used to normalise per-article views). */
  async getProjectDaily(req: PageviewRequest): Promise<PageviewPoint[]> {
    const url = [
      PAGEVIEWS_API,
      'aggregate',
      validateProject(req.project),
      req.access,
      req.agent,
      'daily',
      `${toCompactDate(req.start)}00`,
      `${toCompactDate(req.end)}00`,
    ].join('/');
    const body = await this.http.getJson(url, aggregateResponseSchema, {
      cacheTtlMs: CACHE_TTL.pageviews,
    });
    return body.items.map((i) => ({ date: fromWikimediaTimestamp(i.timestamp), views: i.views }));
  }
}
