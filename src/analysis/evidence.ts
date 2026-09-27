import type {
  CoreMetrics,
  DataQuality,
  Evidence,
  EvidenceStrength,
  OutlierAnalysis,
  SeasonalityAnalysis,
  TrendAnalysis,
} from '../types/analysis.js';
import { round, sign } from '../utils/numbers.js';

export interface EvidenceInput {
  data: DataQuality;
  metrics: CoreMetrics | null;
  trend: TrendAnalysis;
  outliers: OutlierAnalysis;
  seasonality: SeasonalityAnalysis;
  /** Number of complete months in the analysed period. */
  usableMonths: number;
}

export const SEASONAL_WINDOW_WARNING =
  'baseline and latest windows cover different calendar months, so part or all of the change may be seasonal';

/** Evidence strength describes how well the data supports the direction of the conclusion. */
export function strengthFromScore(score: number): EvidenceStrength {
  if (score >= 4) return 'high';
  if (score >= 2) return 'moderate';
  return 'low';
}

const RANK: Record<EvidenceStrength, number> = { low: 0, moderate: 1, high: 2 };

export function weakest(levels: readonly EvidenceStrength[]): EvidenceStrength {
  return levels.reduce<EvidenceStrength>((a, b) => (RANK[b] < RANK[a] ? b : a), 'high');
}

function cap(strength: EvidenceStrength, max: EvidenceStrength): EvidenceStrength {
  return RANK[strength] > RANK[max] ? max : strength;
}

const pct = (v: number): string => `${String(round(v * 100, 1))}%`;

/**
 * Deterministic, rule-based evidence assessment. Each factor adds or subtracts points and
 * leaves a human-readable reason or warning. This is not a probability.
 */
export function assessEvidence(input: EvidenceInput): Evidence {
  const { data, metrics, trend, outliers, seasonality, usableMonths } = input;
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  let max: EvidenceStrength = 'high';

  // 1. Data completeness
  const present = data.expectedDays - data.excludedDays;
  const completeness = present > 0 ? data.reportedDays / present : 0;
  if (completeness >= 0.98) {
    score += 1;
    reasons.push(`${pct(completeness)} of expected daily observations are present`);
  } else if (completeness >= 0.9) {
    reasons.push(`${pct(completeness)} of expected daily observations are present`);
  } else {
    score -= 1;
    warnings.push(
      `Only ${pct(completeness)} of expected daily observations are present (the API omits zero-view days)`,
    );
    if (completeness < 0.8) max = 'low';
  }

  // 2. Period length
  if (usableMonths >= 24) {
    score += 1;
    reasons.push(`${String(usableMonths)} complete months analysed`);
  } else if (usableMonths >= 12) {
    reasons.push(`${String(usableMonths)} complete months analysed`);
  } else {
    score -= 1;
    warnings.push(
      `Short period (${String(usableMonths)} complete months): long-term trend and seasonality cannot be separated reliably`,
    );
    if (usableMonths < 6) max = cap(max, 'low');
  }

  // 3. Trend consistency
  if (trend.status !== 'ok') {
    score -= 1;
    max = 'low';
    warnings.push(trend.message ?? 'Not enough observations for a reliable long-term trend');
  } else if (trend.confidence === 'high') {
    score += 2;
    reasons.push(
      `consistent ${trend.direction ?? 'flat'} trend (R² ${String(trend.rSquared)}, Spearman ρ ${String(trend.spearmanCorrelation)})`,
    );
  } else if (trend.confidence === 'moderate') {
    score += 1;
    reasons.push(
      `moderately consistent ${trend.direction ?? 'flat'} trend (R² ${String(trend.rSquared)}, Spearman ρ ${String(trend.spearmanCorrelation)})`,
    );
  } else {
    warnings.push(
      `weak or inconsistent trend (R² ${String(trend.rSquared)}, Spearman ρ ${String(trend.spearmanCorrelation)})`,
    );
  }

  // 4. Agreement between methods: baseline→latest change, log-linear trend, year-over-year
  const signs: { name: string; s: -1 | 0 | 1 }[] = [];
  if (metrics?.percentChange != null) {
    signs.push({ name: 'baseline→latest change', s: sign(metrics.percentChange, 5) });
  }
  if (trend.status === 'ok') {
    signs.push({
      name: 'log-linear trend',
      s: trend.direction === 'up' ? 1 : trend.direction === 'down' ? -1 : 0,
    });
  }
  const yoyWindows = seasonality.yearOverYear;
  const yoy = yoyWindows?.percentChange ?? null;
  // When the baseline/latest windows are exactly the YoY windows, YoY is not an independent method.
  const sameWindows =
    metrics !== null &&
    yoyWindows !== null &&
    metrics.baseline.start === yoyWindows.previousWindow.start &&
    metrics.latest.end === yoyWindows.currentWindow.end;
  if (yoy !== null && !sameWindows) signs.push({ name: 'year-over-year change', s: sign(yoy, 5) });
  if (signs.length >= 2) {
    const distinct = new Set(signs.map((x) => x.s));
    if (distinct.size === 1) {
      score += 1;
      reasons.push(`${signs.map((x) => x.name).join(', ')} agree in direction`);
    } else if (distinct.has(1) && distinct.has(-1)) {
      score -= 1;
      warnings.push(
        `methods disagree on direction (${signs.map((x) => `${x.name}: ${x.s > 0 ? 'up' : x.s < 0 ? 'down' : 'flat'}`).join('; ')})`,
      );
    } else {
      reasons.push(
        `methods partly agree (${signs.map((x) => `${x.name}: ${x.s > 0 ? 'up' : x.s < 0 ? 'down' : 'flat'}`).join('; ')})`,
      );
    }
  }

  // 5. Volatility
  if (metrics) {
    const level = metrics.volatility.level;
    if (level === 'high') {
      score -= 1;
      warnings.push(
        `series has high short-term volatility (${String(metrics.volatility.shortTermVolatility)})`,
      );
    } else {
      reasons.push(`series has ${level} short-term volatility`);
    }
  }

  // 6. Outlier influence
  const influence = outliers.influence;
  if (influence) {
    if (influence.material) {
      score -= influence.trendSurvives ? 1 : 2;
      warnings.push(influence.summary);
    } else if (outliers.count > 0) {
      reasons.push(influence.summary);
    }
  }

  // 7. Seasonality
  if (seasonality.status === 'ok' && seasonality.detected) {
    reasons.push(
      'recurring seasonal pattern detected; year-over-year comparison of matching months is the seasonality-robust measure',
    );
  } else if (seasonality.status !== 'ok' && usableMonths < 12) {
    warnings.push('seasonal variation may be mistaken for trend in periods shorter than a year');
  }
  if (metrics && usableMonths < 24 && usableMonths >= 6) {
    const months = (start: string, end: string): string =>
      `${start.slice(5, 7)}-${end.slice(5, 7)}`;
    if (
      months(metrics.baseline.start, metrics.baseline.end) !==
      months(metrics.latest.start, metrics.latest.end)
    ) {
      // Periods of 6–23 months cannot compare matching seasons, so a seasonal topic (e.g. one
      // tied to the school year) can show a large "change" that is only the season.
      score -= 1;
      max = cap(max, 'moderate');
      warnings.push(
        `${SEASONAL_WINDOW_WARNING}; for a seasonally fair comparison use a 24-month period (--period 2y), which compares the last 12 months with the previous 12`,
      );
    }
  }

  // 8. Low volume
  if (metrics && metrics.averageDailyViews < 10) {
    score -= 1;
    warnings.push(
      `low traffic (${String(metrics.averageDailyViews)} average daily views): small absolute changes produce large percentages`,
    );
  }

  return { strength: cap(strengthFromScore(score), max), score, reasons, warnings };
}
