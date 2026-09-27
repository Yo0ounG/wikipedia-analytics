import type { UsablePoint } from '../data/aggregate.js';
import type { CoreMetrics, EvidenceStrength, TrendAnalysis } from '../types/analysis.js';
import type { PageviewPoint } from '../types/pageviews.js';
import { firstDayOfMonth, lastDayOfMonth, monthLabel } from '../utils/dates.js';
import {
  coefficientOfVariation,
  median,
  percentChange,
  round,
  medianAbsoluteDeviation,
  sum,
} from '../utils/numbers.js';
import { rollingMedian } from './robust.js';

export const WINDOW_MONTHS = 3;
export const MIN_MONTHS_FOR_MONTHLY_WINDOWS = 6;
export const MAX_DAILY_WINDOW = 28;
export const MIN_MONTHS_FOR_ANNUALIZATION = 12;
export const MIN_R2_FOR_ANNUALIZATION = 0.3;

export interface ComparisonWindow {
  label: string;
  start: string;
  end: string;
  /** Dates included in the window (reported days only). */
  dates: Set<string>;
  averageDailyViews: number;
}

function averageOver(points: readonly PageviewPoint[]): number {
  return points.length === 0 ? 0 : sum(points.map((p) => p.views)) / points.length;
}

/** With this many complete months, windows are whole years and therefore seasonally balanced. */
export const MIN_MONTHS_FOR_YEAR_WINDOWS = 24;

export function windowMonths(usableCount: number): number {
  return usableCount >= MIN_MONTHS_FOR_YEAR_WINDOWS ? 12 : WINDOW_MONTHS;
}

/**
 * Baseline and latest windows (averages per reported day):
 *  - ≥24 complete months: first and last 12 complete months (full years, seasonally balanced);
 *  - ≥6 complete months: first and last 3 complete months;
 *  - otherwise: first and last N reported days (N = min(28, ⌊n/3⌋)).
 */
export function comparisonWindows(
  points: readonly PageviewPoint[],
  usable: readonly UsablePoint[],
): { baseline: ComparisonWindow; latest: ComparisonWindow } | null {
  if (points.length === 0) return null;
  if (usable.length >= MIN_MONTHS_FOR_MONTHLY_WINDOWS) {
    const size = windowMonths(usable.length);
    const build = (months: readonly UsablePoint[], which: string): ComparisonWindow => {
      const start = firstDayOfMonth(months[0]?.period ?? '');
      const end = lastDayOfMonth(months.at(-1)?.period ?? '');
      const inWindow = points.filter((p) => p.date >= start && p.date <= end);
      return {
        label: `${which} ${String(months.length)} complete months (${monthLabel(months[0]?.period ?? '')}–${monthLabel(months.at(-1)?.period ?? '')})`,
        start,
        end,
        dates: new Set(inWindow.map((p) => p.date)),
        averageDailyViews: averageOver(inWindow),
      };
    };
    return {
      baseline: build(usable.slice(0, size), 'first'),
      latest: build(usable.slice(-size), 'last'),
    };
  }
  const n = Math.max(1, Math.min(MAX_DAILY_WINDOW, Math.floor(points.length / 3)));
  const build = (slice: readonly PageviewPoint[], which: string): ComparisonWindow => ({
    label: `${which} ${String(slice.length)} reported days`,
    start: slice[0]?.date ?? '',
    end: slice.at(-1)?.date ?? '',
    dates: new Set(slice.map((p) => p.date)),
    averageDailyViews: averageOver(slice),
  });
  return { baseline: build(points.slice(0, n), 'first'), latest: build(points.slice(-n), 'last') };
}

export function volatilityLevel(shortTerm: number | null): EvidenceStrength {
  if (shortTerm === null || shortTerm < 0.2) return 'low';
  return shortTerm < 0.4 ? 'moderate' : 'high';
}

/**
 * Robust short-term volatility: 1.4826 × MAD of the daily relative deviation from a centred
 * 29-day rolling median (a robust standard-deviation estimate). Independent of the trend and
 * not dominated by isolated spikes, which are assessed separately by outlier detection.
 */
export function shortTermVolatility(points: readonly PageviewPoint[]): number | null {
  if (points.length < 14) return null;
  const expected = rollingMedian(points);
  const deviations = points.flatMap((p, i) => {
    const e = expected[i] ?? 0;
    return e > 0 ? [p.views / e - 1] : [];
  });
  const mad = medianAbsoluteDeviation(deviations);
  return mad === null ? null : 1.4826 * mad;
}

function annualized(usableCount: number, trend: TrendAnalysis): CoreMetrics['annualizedGrowth'] {
  const method =
    'Trend-implied annual rate from the log-linear monthly fit: (1 + monthly rate)^12 − 1';
  if (usableCount < MIN_MONTHS_FOR_ANNUALIZATION) {
    return {
      percent: null,
      method,
      note: `Not annualized: fewer than ${String(MIN_MONTHS_FOR_ANNUALIZATION)} complete months.`,
    };
  }
  if (trend.status !== 'ok' || trend.granularity !== 'month' || trend.normalizedSlope === null) {
    return { percent: null, method, note: 'Not annualized: no monthly trend available.' };
  }
  if ((trend.rSquared ?? 0) < MIN_R2_FOR_ANNUALIZATION) {
    return {
      percent: null,
      method,
      note: `Not annualized: trend fit too weak (R² ${String(trend.rSquared ?? 0)} < ${String(MIN_R2_FOR_ANNUALIZATION)}).`,
    };
  }
  const rate = (1 + trend.normalizedSlope / 100) ** 12 - 1;
  return {
    percent: round(rate * 100, 2),
    method,
    note: 'Descriptive rate for the analysed period, not a forecast.',
  };
}

export function computeCoreMetrics(
  points: readonly PageviewPoint[],
  usable: readonly UsablePoint[],
  trend: TrendAnalysis,
): CoreMetrics | null {
  const windows = comparisonWindows(points, usable);
  if (!windows) return null;
  const views = points.map((p) => p.views);
  const total = sum(views);
  const peak = points.reduce((best, p) => (p.views > best.views ? p : best));
  const change = windows.latest.averageDailyViews - windows.baseline.averageDailyViews;
  const pct = percentChange(windows.baseline.averageDailyViews, windows.latest.averageDailyViews);
  const shortTerm = shortTermVolatility(points);
  const dailyCv = coefficientOfVariation(views);
  const monthlyCv = coefficientOfVariation(usable.map((u) => u.averageDailyViews));
  const toWindow = (w: ComparisonWindow): CoreMetrics['baseline'] => ({
    label: w.label,
    start: w.start,
    end: w.end,
    averageDailyViews: round(w.averageDailyViews, 2),
  });
  return {
    totalViews: total,
    averageDailyViews: round(total / points.length, 2),
    medianDailyViews: round(median(views) ?? 0, 2),
    baseline: toWindow(windows.baseline),
    latest: toWindow(windows.latest),
    absoluteChange: round(change, 2),
    percentChange: pct === null ? null : round(pct, 2),
    annualizedGrowth: annualized(usable.length, trend),
    peak: { date: peak.date, views: peak.views },
    volatility: {
      dailyCoefficientOfVariation: dailyCv === null ? null : round(dailyCv, 4),
      shortTermVolatility: shortTerm === null ? null : round(shortTerm, 4),
      monthlyCoefficientOfVariation: monthlyCv === null ? null : round(monthlyCv, 4),
      level: volatilityLevel(shortTerm),
    },
  };
}
