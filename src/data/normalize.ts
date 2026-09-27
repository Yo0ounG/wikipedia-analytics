import type { PageviewPoint } from '../types/pageviews.js';
import { eachDay } from '../utils/dates.js';
import type { DateRangeValue } from './validate.js';

export function isExcluded(date: string, ranges: readonly DateRangeValue[]): boolean {
  return ranges.some((r) => date >= r.start && date <= r.end);
}

/** Remove observations inside explicitly excluded date ranges. */
export function applyExclusions(
  points: readonly PageviewPoint[],
  ranges: readonly DateRangeValue[],
): { kept: PageviewPoint[]; excluded: PageviewPoint[] } {
  const kept: PageviewPoint[] = [];
  const excluded: PageviewPoint[] = [];
  for (const p of points) (isExcluded(p.date, ranges) ? excluded : kept).push(p);
  return { kept, excluded };
}

/**
 * Explicit, opt-in treatment of days the API did not report as zero views.
 * The per-article Pageviews API omits zero-view days, so this is often correct for
 * low-traffic articles, but it is an assumption and is only applied when requested.
 */
export function fillMissingAsZero(
  points: readonly PageviewPoint[],
  start: string,
  end: string,
  skip: readonly DateRangeValue[] = [],
): PageviewPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p.views]));
  return eachDay(start, end)
    .filter((d) => !isExcluded(d, skip))
    .map((date) => ({ date, views: byDate.get(date) ?? 0 }));
}
