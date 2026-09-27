import type { PageviewPoint } from '../types/pageviews.js';
import { addDays, daysBetweenInclusive, eachDay, isIsoDate } from '../utils/dates.js';

export interface ValidationResult {
  /** Clean points: in range, sorted, unique, finite, non-negative. */
  points: PageviewPoint[];
  expectedDays: number;
  reportedDays: number;
  missingDates: string[];
  completeness: number;
  issues: string[];
}

export interface DateRangeValue {
  start: string;
  end: string;
}

/** Collapse a sorted list of ISO dates into contiguous ranges. */
export function toRanges(dates: readonly string[]): DateRangeValue[] {
  const ranges: DateRangeValue[] = [];
  for (const date of dates) {
    const last = ranges.at(-1);
    if (last && addDays(last.end, 1) === date) last.end = date;
    else ranges.push({ start: date, end: date });
  }
  return ranges;
}

/**
 * Validate a raw daily series against the requested range. Invalid observations are dropped
 * and reported as issues; missing days are counted, never filled.
 */
export function validateSeries(
  raw: readonly PageviewPoint[],
  start: string,
  end: string,
): ValidationResult {
  const issues: string[] = [];
  const byDate = new Map<string, number>();
  let outOfRange = 0;
  let invalid = 0;
  let duplicates = 0;
  let unsorted = false;
  let previous = '';

  for (const point of raw) {
    if (!isIsoDate(point.date)) {
      invalid++;
      continue;
    }
    if (point.date < previous) unsorted = true;
    previous = point.date;
    if (point.date < start || point.date > end) {
      outOfRange++;
      continue;
    }
    if (!Number.isFinite(point.views) || point.views < 0 || !Number.isInteger(point.views)) {
      invalid++;
      continue;
    }
    if (byDate.has(point.date)) {
      duplicates++;
      continue;
    }
    byDate.set(point.date, point.views);
  }

  if (invalid > 0)
    issues.push(
      `${String(invalid)} observation(s) with invalid dates or view counts were dropped.`,
    );
  if (duplicates > 0)
    issues.push(`${String(duplicates)} duplicate date(s) were dropped (first value kept).`);
  if (outOfRange > 0)
    issues.push(`${String(outOfRange)} observation(s) outside the requested period were ignored.`);
  if (unsorted) issues.push('API returned observations out of date order; they were sorted.');

  const expectedDays = daysBetweenInclusive(start, end);
  const points = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, views]) => ({ date, views }));
  const missingDates = eachDay(start, end).filter((d) => !byDate.has(d));

  return {
    points,
    expectedDays,
    reportedDays: points.length,
    missingDates,
    completeness: expectedDays === 0 ? 0 : points.length / expectedDays,
    issues,
  };
}
