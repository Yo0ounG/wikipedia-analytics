import { analyzeLanguage, type LanguageInput } from '../../src/analysis/index.js';
import type { ArticlePageviews } from '../../src/api/pageviews-client.js';
import type { LanguageAnalysis } from '../../src/types/analysis.js';
import { FIXTURE_END, FIXTURE_START, loadPoints, type PageviewScenario } from './fixtures.js';

/** Test-friendly overrides: a period and raw client output instead of a full TimeSeries. */
export interface FixtureOverrides extends Partial<
  Omit<LanguageInput, 'series' | 'noData' | 'article'>
> {
  start?: string;
  end?: string;
  pageviews?: ArticlePageviews;
}

export function analyzeFixture(
  scenario: PageviewScenario,
  overrides: FixtureOverrides = {},
  language = 'en',
): LanguageAnalysis {
  const { start = FIXTURE_START, end = FIXTURE_END, pageviews, ...rest } = overrides;
  const raw = pageviews ?? { points: loadPoints(scenario), noData: false };
  return analyzeLanguage({
    article: {
      language,
      project: `${language}.wikipedia`,
      dbname: `${language}wiki`,
      title: scenario,
      url: `https://${language}.wikipedia.org/wiki/${scenario}`,
    },
    series: {
      language,
      project: `${language}.wikipedia`,
      qid: 'Q1',
      articleTitle: scenario,
      startDate: start,
      endDate: end,
      access: 'all-access',
      agent: 'user',
      points: raw.points,
    },
    noData: raw.noData,
    projectDaily: loadPoints('project-aggregate'),
    exclusions: [],
    excludeLargestSpike: false,
    missingAsZero: false,
    ...rest,
  });
}
