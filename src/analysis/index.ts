import {
  groupByMonth,
  groupByWeek,
  usableMonths,
  usableWeeks,
  type UsablePoint,
} from '../data/aggregate.js';
import { applyExclusions, fillMissingAsZero, isExcluded } from '../data/normalize.js';
import { toRanges, validateSeries, type DateRangeValue } from '../data/validate.js';
import type {
  CoreMetrics,
  LanguageAnalysis,
  OutlierAnalysis,
  ProjectNormalized,
  SeasonalityAnalysis,
  TrendAnalysis,
} from '../types/analysis.js';
import type { MonthlyPoint, PageviewPoint, TimeSeries } from '../types/pageviews.js';
import type { ResolvedArticle } from '../types/topic.js';
import { eachDay } from '../utils/dates.js';
import { formatSignedPercent, percentChange, round, sum } from '../utils/numbers.js';
import { assessEvidence } from './evidence.js';
import {
  comparisonWindows,
  computeCoreMetrics,
  MIN_MONTHS_FOR_MONTHLY_WINDOWS,
} from './metrics.js';
import { detectOutliers, largestSpike, OUTLIER_METHOD } from './outliers.js';
import { analyzeSeasonality, seasonallyAdjust } from './seasonality.js';
import { analyzeTrend, insufficientTrend } from './trend.js';

export { compareLanguages } from './comparison.js';
export { assessEvidence, weakest } from './evidence.js';

export interface LanguageInput {
  article: ResolvedArticle;
  /** Canonical daily series for the article over the analysis period. */
  series: TimeSeries;
  /** True when the API had no recorded views for the whole period (HTTP 404). */
  noData: boolean;
  /** Daily views of the whole Wikipedia edition, for share-of-traffic normalisation. */
  projectDaily: PageviewPoint[] | null;
  exclusions: DateRangeValue[];
  excludeLargestSpike: boolean;
  missingAsZero: boolean;
}

interface CoreRun {
  monthly: MonthlyPoint[];
  usable: UsablePoint[];
  seasonality: SeasonalityAnalysis;
  trend: TrendAnalysis;
  metrics: CoreMetrics | null;
}

/**
 * Aggregation → seasonality → trend → metrics for one series. When a recurring seasonal
 * pattern is detected the trend is fitted on seasonally adjusted months, so e.g. a series
 * that starts in its low season is not mistaken for growth. Reused for the outlier re-run.
 */
function runCore(points: readonly PageviewPoint[], start: string, end: string): CoreRun {
  const monthly = groupByMonth(points, start, end);
  const usable = usableMonths(monthly);
  const seasonality = analyzeSeasonality(usable, monthly);
  let trend: TrendAnalysis;
  if (points.length === 0) {
    trend = insufficientTrend(0, null, 'No pageview observations in the period.');
  } else if (usable.length >= MIN_MONTHS_FOR_MONTHLY_WINDOWS) {
    trend = seasonality.detected
      ? analyzeTrend(seasonallyAdjust(usable, seasonality.profile), 'month', true)
      : analyzeTrend(usable, 'month');
  } else {
    trend = analyzeTrend(usableWeeks(groupByWeek(points, start, end)), 'week');
  }
  return {
    monthly,
    usable,
    seasonality,
    trend,
    metrics: computeCoreMetrics(points, usable, trend),
  };
}

const MATERIAL_PP = 10;

function outlierInfluence(
  points: readonly PageviewPoint[],
  spikeDates: ReadonlySet<string>,
  full: CoreRun,
  start: string,
  end: string,
): OutlierAnalysis['influence'] {
  if (spikeDates.size === 0 || !full.metrics) return null;
  const cleaned = points.filter((p) => !spikeDates.has(p.date));
  const without = runCore(cleaned, start, end);
  const pFull = full.metrics.percentChange;
  const pWithout = without.metrics?.percentChange ?? null;
  const dFull = full.trend.direction;
  const dWithout = without.trend.direction;
  const trendSurvives = dFull === dWithout && Math.sign(pFull ?? 0) === Math.sign(pWithout ?? 0);
  const diff = pFull !== null && pWithout !== null ? Math.abs(pFull - pWithout) : 0;
  const material = !trendSurvives || diff >= Math.max(MATERIAL_PP, 0.25 * Math.abs(pFull ?? 0));
  const days = String(spikeDates.size);
  const summary = material
    ? `Result depends on spikes: change ${formatSignedPercent(pFull)} with outliers vs ${formatSignedPercent(pWithout)} without ${days} spike day(s); trend ${dFull ?? 'n/a'} → ${dWithout ?? 'n/a'}.`
    : `Trend persists after removing ${days} spike day(s): change ${formatSignedPercent(pFull)} with vs ${formatSignedPercent(pWithout)} without; trend ${dFull ?? 'n/a'} in both.`;
  return {
    percentChangeWithOutliers: pFull,
    percentChangeWithoutOutliers: pWithout,
    trendDirectionWithOutliers: dFull,
    trendDirectionWithoutOutliers: dWithout,
    normalizedSlopeWithOutliers: full.trend.normalizedSlope,
    normalizedSlopeWithoutOutliers: without.trend.normalizedSlope,
    trendSurvives,
    material,
    summary,
  };
}

function perMillion(
  article: readonly PageviewPoint[],
  project: ReadonlyMap<string, number>,
  from: string,
  to: string,
): { ratio: number; projectAverage: number } | null {
  let a = 0;
  let p = 0;
  let days = 0;
  for (const point of article) {
    if (point.date < from || point.date > to) continue;
    const total = project.get(point.date);
    if (total === undefined || total <= 0) continue;
    a += point.views;
    p += total;
    days++;
  }
  return p > 0 ? { ratio: (a / p) * 1e6, projectAverage: p / days } : null;
}

function projectNormalized(
  points: readonly PageviewPoint[],
  projectDaily: readonly PageviewPoint[] | null,
  usable: readonly UsablePoint[],
  start: string,
  end: string,
): ProjectNormalized | null {
  if (!projectDaily || projectDaily.length === 0 || points.length === 0) return null;
  const project = new Map(projectDaily.map((p) => [p.date, p.views]));
  const windows = comparisonWindows(points, usable);
  const overall = perMillion(points, project, start, end);
  if (!windows || !overall) return null;
  const base = perMillion(points, project, windows.baseline.start, windows.baseline.end);
  const latest = perMillion(points, project, windows.latest.start, windows.latest.end);
  if (!base || !latest) return null;
  const change = percentChange(base.ratio, latest.ratio);
  const projectChange = percentChange(base.projectAverage, latest.projectAverage);
  return {
    averagePerMillion: round(overall.ratio, 3),
    baselinePerMillion: round(base.ratio, 3),
    latestPerMillion: round(latest.ratio, 3),
    percentChange: change === null ? null : round(change, 2),
    projectPercentChange: projectChange === null ? null : round(projectChange, 2),
    ...editionRelation(
      change,
      projectChange,
      percentChange(windows.baseline.averageDailyViews, windows.latest.averageDailyViews),
    ),
  };
}

/** Share-of-edition change beyond this (±%) counts as moving differently from the edition. */
export const EDITION_RELATION_THRESHOLD = 5;

export function editionRelation(
  shareChange: number | null,
  editionChange: number | null,
  articleChange: number | null,
): Pick<ProjectNormalized, 'relativeToEdition' | 'interpretation'> {
  if (shareChange === null) return { relativeToEdition: null, interpretation: null };
  const facts = `Article views ${formatSignedPercent(articleChange)} vs the whole edition's traffic ${formatSignedPercent(editionChange)}, so the article's share of edition traffic changed ${formatSignedPercent(shareChange)}`;
  if (shareChange < -EDITION_RELATION_THRESHOLD) {
    return {
      relativeToEdition: 'declined_faster_than_edition',
      interpretation: `${facts}: the article did worse than its edition, so part of the change is topic-specific.`,
    };
  }
  if (shareChange > EDITION_RELATION_THRESHOLD) {
    return {
      relativeToEdition: 'outperformed_edition',
      interpretation: `${facts}: the article did better than its edition.`,
    };
  }
  return {
    relativeToEdition: 'in_line_with_edition',
    interpretation: `${facts}: the article moved with its edition, so the change mostly reflects edition-wide traffic, not the topic.`,
  };
}

/** The `limit` longest ranges, returned in date order (long gaps matter most). */
export function longestRanges(ranges: readonly DateRangeValue[], limit: number): DateRangeValue[] {
  const length = (r: DateRangeValue): number => eachDay(r.start, r.end).length;
  return [...ranges]
    .sort((a, b) => length(b) - length(a) || (a.start < b.start ? -1 : 1))
    .slice(0, limit)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** Full deterministic analysis of one language edition. */
export function analyzeLanguage(input: LanguageInput): LanguageAnalysis {
  const { article, series } = input;
  const start = series.startDate;
  const end = series.endDate;
  const validation = validateSeries(series.points, start, end);
  const exclusions: DateRangeValue[] = input.exclusions
    .map((r) => ({ start: r.start < start ? start : r.start, end: r.end > end ? end : r.end }))
    .filter((r) => r.start <= r.end);

  const prepare = (ranges: readonly DateRangeValue[]): PageviewPoint[] =>
    input.missingAsZero
      ? fillMissingAsZero(validation.points, start, end, ranges)
      : applyExclusions(validation.points, ranges).kept;

  let points = prepare(exclusions);
  if (input.excludeLargestSpike) {
    const spike = largestSpike(detectOutliers(points).events);
    if (spike) {
      exclusions.push({ start: spike.start, end: spike.end });
      points = prepare(exclusions);
    }
  }

  const full = runCore(points, start, end);
  const detection = detectOutliers(points);
  const outliers: OutlierAnalysis = {
    method: OUTLIER_METHOD,
    threshold: detection.threshold,
    count: detection.events.length,
    events: detection.events,
    influence: outlierInfluence(points, detection.spikeDates, full, start, end),
  };
  const seasonality = full.seasonality;

  const excludedDays = eachDay(start, end).filter((d) => isExcluded(d, exclusions)).length;
  const missingDates = validation.missingDates.filter((d) => !isExcluded(d, exclusions));
  const reportedDays = validation.points.filter((p) => !isExcluded(p.date, exclusions)).length;
  const denominator = validation.expectedDays - excludedDays;
  const noData = input.noData || sum(points.map((p) => p.views)) === 0;
  const issues = [...validation.issues];
  if (input.noData) {
    issues.push('The Pageviews API has no recorded views for this article in the period.');
  }

  const data: LanguageAnalysis['data'] = {
    expectedDays: validation.expectedDays,
    reportedDays,
    missingDays: missingDates.length,
    excludedDays,
    completeness: denominator > 0 ? round(reportedDays / denominator, 4) : 0,
    missingRanges: longestRanges(toRanges(missingDates), 20),
    excludedRanges: toRanges(eachDay(start, end).filter((d) => isExcluded(d, exclusions))),
    issues,
    noViewsRecorded: noData,
    missingTreatedAsZero: input.missingAsZero,
  };

  const metrics = noData ? null : full.metrics;
  const evidence = assessEvidence({
    data,
    metrics,
    trend: full.trend,
    outliers,
    seasonality,
    usableMonths: full.usable.length,
  });

  return {
    language: article.language,
    project: article.project,
    articleTitle: article.title,
    articleUrl: article.url,
    status: noData ? 'no_data' : full.trend.status === 'ok' ? 'analyzed' : 'insufficient_data',
    data,
    metrics,
    trend: full.trend,
    seasonality,
    outliers,
    projectNormalized: noData
      ? null
      : projectNormalized(points, input.projectDaily, full.usable, start, end),
    evidence,
    monthly: full.monthly.map((m) => ({
      ...m,
      averageDailyViews: m.averageDailyViews === null ? null : round(m.averageDailyViews, 2),
    })),
    daily: points.map((p) => ({ date: p.date, views: p.views })),
  };
}
