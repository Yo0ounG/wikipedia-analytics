import type { WikipediaSite } from '../api/mediawiki-client.js';
import type { WikidataItem } from '../api/wikidata-client.js';
import type { MissingLanguage, ResolvedArticle } from './types.js';

export function articleUrl(site: WikipediaSite, title: string): string {
  return `https://${site.host}/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
}

/**
 * Map one Wikidata concept to its article in each requested language using sitelinks.
 * A language without a sitelink is reported as missing; no other article is substituted.
 */
export function resolveArticles(
  item: WikidataItem,
  languages: readonly string[],
  sites: ReadonlyMap<string, WikipediaSite>,
): { articles: Record<string, ResolvedArticle>; missing: MissingLanguage[] } {
  const articles: Record<string, ResolvedArticle> = {};
  const missing: MissingLanguage[] = [];
  for (const language of languages) {
    const site = sites.get(language);
    if (!site) {
      missing.push({
        language,
        reason: 'unknown_language',
        message: `"${language}" is not an active Wikipedia language edition.`,
      });
      continue;
    }
    const title = item.sitelinks[site.dbname];
    if (title === undefined) {
      missing.push({
        language,
        reason: 'no_article',
        message: `The selected concept (${item.qid}) has no Wikipedia article in language "${language}".`,
      });
      continue;
    }
    articles[language] = {
      language,
      project: site.project,
      dbname: site.dbname,
      title,
      url: articleUrl(site, title),
    };
  }
  return { articles, missing };
}
