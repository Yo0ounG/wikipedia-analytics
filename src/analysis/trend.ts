import { linearRegression, rSquared, spearman } from './stats.js';
import type { UsablePoint } from '../data/aggregate.js';
import type { EvidenceStrength, TrendAnalysis, TrendDirection } from '../types/analysis.js';
import { daysBetweenInclusive } from '../utils/dates.js';
import { round } from '../utils/numbers.js';

export type Granularity = 'month' | 'week';

export const MIN_TREND_OBSERVATIONS: Record<Granularity, number> = { month: 6, week: 8 };

/** Minimum |% change per period| (from the log-linear fit) to call a direction. */
export const DIRECTION_THRESHOLD: Record<Granularity, number> = { month: 0.5, week: 0.2 };
/** Minimum |Spearman ρ| in the same direction to call a direction. */
export const MIN_RANK_CORRELATION = 0.3;

function periodIndex(period: string, first: string, granularity: Granularity): number {
  if (granularity === 'week') return Math.round((daysBetweenInclusive(first, period) - 1) / 7);
  const [y0, m0] = first.split('-').map(Number);
  const [y1, m1] = period.split('-').map(Number);
  return ((y1 ?? 0) - (y0 ?? 0)) * 12 + ((m1 ?? 0) - (m0 ?? 0));
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function confidenceFor(
  direction: TrendDirection,
  n: number,
  r2: number | null,
  rho: number | null,
): EvidenceStrength {
  const absRho = Math.abs(rho ?? 0);
  if (direction === 'flat') {
    return n >= 12 && absRho < 0.2 ? 'moderate' : 'low';
  }
  if (n >= 12 && (r2 ?? 0) >= 0.5 && absRho >= 0.6) return 'high';
  if ((r2 ?? 0) >= 0.25 && absRho >= 0.4) return 'moderate';
  return 'low';
}

export function insufficientTrend(
  observations: number,
  granularity: Granularity | null,
  message: string,
): TrendAnalysis {
  return {
    status: 'insufficient_data',
    granularity,
    observations,
    direction: null,
    slope: null,
    normalizedSlope: null,
    rSquared: null,
    linearRSquared: null,
    spearmanCorrelation: null,
    seasonallyAdjusted: false,
    confidence: null,
    message,
  };
}

/**
 * Trend of average daily views per period (month or week).
 *  - log-linear OLS: ln(views + 1) ~ t  → normalizedSlope = (e^b − 1)·100 % per period, R²
 *  - linear OLS on raw values           → slope in views/day per period, linear R²
 *  - Spearman rank correlation with time (monotonicity, robust to outliers)
 * Direction requires the log slope and Spearman ρ to agree. No significance test is performed.
 */
export function analyzeTrend(
  points: readonly UsablePoint[],
  granularity: Granularity,
  seasonallyAdjusted = false,
): TrendAnalysis {
  const n = points.length;
  if (n < MIN_TREND_OBSERVATIONS[granularity]) {
    return insufficientTrend(
      n,
      granularity,
      `Not enough observations for a reliable long-term trend (${String(n)} usable ${granularity}s; need ${String(MIN_TREND_OBSERVATIONS[granularity])}).`,
    );
  }
  const first = points[0]?.period ?? '';
  const x = points.map((p) => periodIndex(p.period, first, granularity));
  const raw = points.map((p) => p.averageDailyViews);
  const logY = raw.map((v) => Math.log(v + 1));

  const logFit = linearRegression(x, logY);
  const linFit = linearRegression(x, raw);
  const constant = raw.every((v) => v === raw[0]);

  const r2 = constant ? null : finiteOrNull(rSquared(x, logY, logFit));
  const linR2 = constant ? null : finiteOrNull(rSquared(x, raw, linFit));
  const rho = constant ? null : finiteOrNull(spearman(x, raw));
  const pctPerPeriod = (Math.exp(logFit.m) - 1) * 100;

  const threshold = DIRECTION_THRESHOLD[granularity];
  let direction: TrendDirection = 'flat';
  if (pctPerPeriod > threshold && (rho ?? 0) >= MIN_RANK_CORRELATION) direction = 'up';
  else if (pctPerPeriod < -threshold && (rho ?? 0) <= -MIN_RANK_CORRELATION) direction = 'down';

  return {
    status: 'ok',
    granularity,
    observations: n,
    direction,
    slope: round(linFit.m, 4),
    normalizedSlope: round(pctPerPeriod, 4),
    rSquared: r2 === null ? null : round(r2, 4),
    linearRSquared: linR2 === null ? null : round(linR2, 4),
    spearmanCorrelation: rho === null ? null : round(rho, 4),
    seasonallyAdjusted,
    confidence: confidenceFor(direction, n, r2, rho),
    message: null,
  };
}
