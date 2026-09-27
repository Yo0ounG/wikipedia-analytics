import type { MonthlyPoint, PageviewPoint, RollingPoint, WeeklyPoint } from '../types/pageviews.js';
import {
  addDays,
  daysBetweenInclusive,
  daysInMonth,
  eachDay,
  eachMonth,
  firstDayOfMonth,
  lastDayOfMonth,
  monthKey,
  weekStart,
} from '../utils/dates.js';

interface Bucket {
  views: number;
  reportedDays: number;
}

function bucketize(
  points: readonly PageviewPoint[],
  keyOf: (date: string) => string,
): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  for (const p of points) {
    const key = keyOf(p.date);
    const b = buckets.get(key) ?? { views: 0, reportedDays: 0 };
    b.views += p.views;
    b.reportedDays++;
    buckets.set(key, b);
  }
  return buckets;
}

/**
 * Calendar-month aggregation over [start, end]. `expectedDays` counts only the days of the
 * month inside the period; `complete` requires the whole month to be in range and reported.
 */
export function groupByMonth(
  points: readonly PageviewPoint[],
  start: string,
  end: string,
): MonthlyPoint[] {
  const buckets = bucketize(points, monthKey);
  return eachMonth(start, end).map((month) => {
    const from = firstDayOfMonth(month) < start ? start : firstDayOfMonth(month);
    const to = lastDayOfMonth(month) > end ? end : lastDayOfMonth(month);
    const expectedDays = daysBetweenInclusive(from, to);
    const b = buckets.get(month) ?? { views: 0, reportedDays: 0 };
    return {
      month,
      views: b.views,
      reportedDays: b.reportedDays,
      expectedDays,
      averageDailyViews: b.reportedDays > 0 ? b.views / b.reportedDays : null,
      complete: expectedDays === daysInMonth(month) && b.reportedDays === expectedDays,
    };
  });
}

/** ISO-week (Monday-start) aggregation over [start, end]. */
export function groupByWeek(
  points: readonly PageviewPoint[],
  start: string,
  end: string,
): WeeklyPoint[] {
  const buckets = bucketize(points, weekStart);
  const out: WeeklyPoint[] = [];
  for (let ws = weekStart(start); ws <= end; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const from = ws < start ? start : ws;
    const to = we > end ? end : we;
    const expectedDays = daysBetweenInclusive(from, to);
    const b = buckets.get(ws) ?? { views: 0, reportedDays: 0 };
    out.push({
      weekStart: ws,
      views: b.views,
      reportedDays: b.reportedDays,
      expectedDays,
      averageDailyViews: b.reportedDays > 0 ? b.views / b.reportedDays : null,
      complete: expectedDays === 7 && b.reportedDays === 7,
    });
  }
  return out;
}

export interface RollingOptions {
  window?: number;
  /** Minimum share of the window that must be reported for a value to be produced. */
  minCoverage?: number;
  /** `trailing`: window ends on the date; `center`: window is centred on the date. */
  align?: 'trailing' | 'center';
}

/**
 * Rolling mean over calendar days. Gaps are not filled: the mean uses the days that are
 * present, and the value is null unless at least `minCoverage` of a full window is reported.
 */
export function calculateRollingAverage(
  points: readonly PageviewPoint[],
  start: string,
  end: string,
  options: RollingOptions = {},
): RollingPoint[] {
  const window = options.window ?? 30;
  const minCoverage = options.minCoverage ?? 0.5;
  const values = new Map(points.map((p) => [p.date, p.views]));
  const days = eachDay(start, end);
  const trailing: (number | null)[] = [];
  let total = 0;
  let count = 0;
  for (let i = 0; i < days.length; i++) {
    const v = values.get(days[i] ?? '');
    if (v !== undefined) {
      total += v;
      count++;
    }
    if (i >= window) {
      const old = values.get(days[i - window] ?? '');
      if (old !== undefined) {
        total -= old;
        count--;
      }
    }
    const full = i + 1 >= window;
    trailing.push(full && count > 0 && count / window >= minCoverage ? total / count : null);
  }
  // A centred window at day i equals the trailing window ending at i + ⌊window/2⌋.
  const shift = options.align === 'center' ? Math.floor(window / 2) : 0;
  return days.map((date, i) => ({ date, value: trailing[i + shift] ?? null }));
}

/** Minimum share of reported days for a month/week to be used in trend analysis. */
export const MIN_PERIOD_COVERAGE = 0.8;

export interface UsablePoint {
  /** `YYYY-MM` for months, week-start ISO date for weeks. */
  period: string;
  averageDailyViews: number;
}

/**
 * Months that lie fully inside the analysis period and have at least 80% of days reported.
 * Averages per reported day keep partially reported months comparable without imputing.
 */
export function usableMonths(monthly: readonly MonthlyPoint[]): UsablePoint[] {
  return monthly.flatMap((m) =>
    m.averageDailyViews !== null &&
    m.expectedDays === daysInMonth(m.month) &&
    m.reportedDays >= MIN_PERIOD_COVERAGE * m.expectedDays
      ? [{ period: m.month, averageDailyViews: m.averageDailyViews }]
      : [],
  );
}

export function usableWeeks(weekly: readonly WeeklyPoint[]): UsablePoint[] {
  return weekly.flatMap((w) =>
    w.averageDailyViews !== null &&
    w.expectedDays === 7 &&
    w.reportedDays >= MIN_PERIOD_COVERAGE * w.expectedDays
      ? [{ period: w.weekStart, averageDailyViews: w.averageDailyViews }]
      : [],
  );
}
