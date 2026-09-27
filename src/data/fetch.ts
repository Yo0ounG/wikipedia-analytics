import type { PageviewsClient } from '../api/pageviews-client.js';
import type { AccessType, AgentType, PageviewPoint, TimeSeries } from '../types/pageviews.js';
import type { ResolvedArticle } from '../types/topic.js';
import type { Logger } from '../utils/logging.js';

export interface LanguageData {
  article: ResolvedArticle;
  /** Canonical internal series; raw API objects never leave the API client. */
  series: TimeSeries;
  /** True when the API had no recorded views in the period (HTTP 404). */
  noData: boolean;
  projectDaily: PageviewPoint[] | null;
}

export interface FetchOptions {
  qid: string;
  start: string;
  end: string;
  access: AccessType;
  agent: AgentType;
}

/**
 * Fetch per-article and edition-wide daily pageviews for each resolved article.
 * Concurrency is bounded by the shared HTTP client; the edition totals are optional context,
 * so a failure there is logged and the analysis continues without share-of-traffic metrics.
 */
export async function fetchLanguageData(
  client: PageviewsClient,
  articles: readonly ResolvedArticle[],
  options: FetchOptions,
  logger: Logger,
): Promise<LanguageData[]> {
  const { qid, ...range } = options;
  return Promise.all(
    articles.map(async (article) => {
      const req = { project: article.project, ...range };
      logger.info('fetching pageviews', { language: article.language, title: article.title });
      const [pageviews, projectDaily] = await Promise.all([
        client.getArticleDaily({ ...req, title: article.title }),
        client.getProjectDaily(req).catch((error: unknown) => {
          logger.warn('edition-wide pageviews unavailable; share-of-traffic metrics skipped', {
            project: article.project,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
      ]);
      const series: TimeSeries = {
        language: article.language,
        project: article.project,
        qid,
        articleTitle: article.title,
        startDate: range.start,
        endDate: range.end,
        access: range.access,
        agent: range.agent,
        points: pageviews.points,
      };
      return { article, series, noData: pageviews.noData, projectDaily };
    }),
  );
}
