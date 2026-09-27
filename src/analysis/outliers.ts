import type { OutlierEvent } from '../types/analysis.js';
import type { PageviewPoint } from '../types/pageviews.js';
import { addDays } from '../utils/dates.js';
import { median, round } from '../utils/numbers.js';
import { rollingMedian } from './robust.js';

export const OUTLIER_METHOD =
  'Robust z-score (MAD) of log residuals from a centred 29-day rolling median';

export interface OutlierOptions {
  /** Robust z-score threshold. 3.5 is the conventional Iglewicz–Hoaglin cut-off. */
  threshold?: number;
  /** A spike must also be at least this multiple of the local median (dip: at most 1/x). */
  minRatio?: number;
  /** A spike must exceed the local median by at least this many views. */
  minExcess?: number;
  halfWindow?: number;
}

export interface OutlierDetection {
  threshold: number;
  events: OutlierEvent[];
  /** Dates belonging to spike events (dips are reported but never removed). */
  spikeDates: Set<string>;
}

export const MIN_OUTLIER_OBSERVATIONS = 28;
/** Floor for the robust scale so near-constant series do not flag trivial noise. */
const MIN_SCALE = 0.05;

interface Flag {
  date: string;
  views: number;
  expected: number;
  kind: 'spike' | 'dip';
}

function toEvents(flags: Flag[]): OutlierEvent[] {
  const events: OutlierEvent[] = [];
  let group: Flag[] = [];
  const flush = (): void => {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) return;
    const peak = group.reduce((best, f) =>
      first.kind === 'spike' ? (f.views > best.views ? f : best) : f.views < best.views ? f : best,
    );
    events.push({
      start: first.date,
      end: last.date,
      days: group.length,
      peakDate: peak.date,
      peakViews: peak.views,
      expectedViews: round(peak.expected, 1),
      ratio: round(peak.expected > 0 ? peak.views / peak.expected : peak.views, 2),
      excessViews: Math.round(group.reduce((s, f) => s + (f.views - f.expected), 0)),
      kind: first.kind,
    });
    group = [];
  };
  for (const f of flags) {
    const prev = group.at(-1);
    if (prev && (prev.kind !== f.kind || addDays(prev.date, 1) !== f.date)) flush();
    group.push(f);
  }
  flush();
  return events;
}

/**
 * Detect spikes and dips in a daily series. Residuals are computed on a log scale relative to
 * a rolling median, so the method adapts to trends and to articles of any size.
 */
export function detectOutliers(
  points: readonly PageviewPoint[],
  options: OutlierOptions = {},
): OutlierDetection {
  const threshold = options.threshold ?? 3.5;
  const minRatio = options.minRatio ?? 1.5;
  const minExcess = options.minExcess ?? 20;
  if (points.length < MIN_OUTLIER_OBSERVATIONS) {
    return { threshold, events: [], spikeDates: new Set() };
  }
  const expected = rollingMedian(points, options.halfWindow ?? 14);
  const residuals = points.map((p, i) => Math.log(p.views + 1) - Math.log((expected[i] ?? 0) + 1));
  const center = median(residuals) ?? 0;
  const mad = median(residuals.map((r) => Math.abs(r - center))) ?? 0;
  const scale = Math.max(1.4826 * mad, MIN_SCALE);

  const flags: Flag[] = [];
  points.forEach((p, i) => {
    const exp = expected[i] ?? 0;
    const z = ((residuals[i] ?? 0) - center) / scale;
    if (z > threshold && p.views >= minRatio * exp && p.views - exp >= minExcess) {
      flags.push({ date: p.date, views: p.views, expected: exp, kind: 'spike' });
    } else if (z < -threshold && p.views * minRatio <= exp && exp - p.views >= minExcess) {
      flags.push({ date: p.date, views: p.views, expected: exp, kind: 'dip' });
    }
  });
  const events = toEvents(flags);
  const spikeDates = new Set(flags.filter((f) => f.kind === 'spike').map((f) => f.date));
  return { threshold, events, spikeDates };
}

/** The spike event with the largest excess views, if any. */
export function largestSpike(events: readonly OutlierEvent[]): OutlierEvent | null {
  let best: OutlierEvent | null = null;
  for (const e of events) {
    if (e.kind === 'spike' && (best === null || e.excessViews > best.excessViews)) best = e;
  }
  return best;
}
