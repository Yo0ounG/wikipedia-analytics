import { linearRegression, pearson, spearman } from './stats.js';
import type { UsablePoint } from '../data/aggregate.js';
import type { SeasonalityAnalysis } from '../types/analysis.js';
import type { MonthlyPoint } from '../types/pageviews.js';
import { addMonths, firstDayOfMonth, lastDayOfMonth } from '../utils/dates.js';
import { mean, percentChange, round } from '../utils/numbers.js';

export const MIN_SEASONALITY_MONTHS = 24;
/** Month-of-year index range (max − min) above which a pattern counts as seasonal. */
export const SEASONAL_AMPLITUDE_THRESHOLD = 0.25;
/** Required agreement between consecutive years' monthly profiles. */
export const SEASONAL_CONSISTENCY_THRESHOLD = 0.5;

/** Latest run of consecutive usable months. */
function latestConsecutiveRun(points: readonly UsablePoint[]): UsablePoint[] {
  const run: UsablePoint[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (!p) break;
    const next = run[0];
    if (next && addMonths(p.period, 1) !== next.period) break;
    run.unshift(p);
  }
  return run;
}

/** Rank correlation above which a within-year profile counts as monotonic (not cyclical). */
export const MONOTONIC_PROFILE_RHO = 0.85;

/**
 * Remove the long-term trend: divide each month by a log-linear fit over the whole run.
 * Without this, steady growth looks like a recurring "seasonal" ramp inside every year.
 */
function detrend(run: readonly UsablePoint[]): number[] {
  const logs = run.map((p) => Math.log(p.averageDailyViews + 1));
  const fit = linearRegression(
    logs.map((_, i) => i),
    logs,
  );
  return run.map((p, i) => (p.averageDailyViews + 1) / Math.exp(fit.b + fit.m * i));
}

function ratioProfile(block: readonly number[]): number[] {
  const m = mean(block) ?? 0;
  return block.map((v) => (m > 0 ? v / m : 1));
}

function emptySeasonality(monthsUsed: number, message: string): SeasonalityAnalysis {
  return {
    status: 'insufficient_data',
    monthsUsed,
    profile: {},
    amplitude: null,
    yearToYearProfileCorrelation: null,
    detected: false,
    peakMonth: null,
    troughMonth: null,
    yearOverYear: null,
    message,
  };
}

function yearOverYear(
  run: readonly UsablePoint[],
  monthly: readonly MonthlyPoint[],
): NonNullable<SeasonalityAnalysis['yearOverYear']> {
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  const current = run.slice(-12);
  const previous = run.slice(-24, -12);
  const totals = (block: readonly UsablePoint[]): { views: number; days: number } =>
    block.reduce(
      (acc, p) => {
        const m = byMonth.get(p.period);
        return { views: acc.views + (m?.views ?? 0), days: acc.days + (m?.reportedDays ?? 0) };
      },
      { views: 0, days: 0 },
    );
  const cur = totals(current);
  const prev = totals(previous);
  let up = 0;
  let down = 0;
  current.forEach((p, i) => {
    const before = previous[i];
    if (!before) return;
    if (p.averageDailyViews > before.averageDailyViews) up++;
    else if (p.averageDailyViews < before.averageDailyViews) down++;
  });
  const range = (block: readonly UsablePoint[]): { start: string; end: string } => ({
    start: firstDayOfMonth(block[0]?.period ?? ''),
    end: lastDayOfMonth(block.at(-1)?.period ?? ''),
  });
  const avgChange =
    prev.days > 0 && cur.days > 0
      ? percentChange(prev.views / prev.days, cur.views / cur.days)
      : null;
  return {
    currentWindow: range(current),
    previousWindow: range(previous),
    currentViews: cur.views,
    previousViews: prev.views,
    percentChange: avgChange === null ? null : round(avgChange, 2),
    monthsUp: up,
    monthsDown: down,
    monthsCompared: Math.min(current.length, previous.length),
  };
}

/**
 * Practical seasonality check on complete months:
 *  - split the latest 24+ consecutive months into 12-month blocks (aligned to the end),
 *  - month-of-year profile = each month's average relative to its block mean, averaged,
 *  - consistency = correlation between the last two blocks' profiles,
 *  - year-over-year comparison of matching months (robust to seasonality by construction).
 */
export function analyzeSeasonality(
  usable: readonly UsablePoint[],
  monthly: readonly MonthlyPoint[],
): SeasonalityAnalysis {
  const run = latestConsecutiveRun(usable);
  if (run.length < MIN_SEASONALITY_MONTHS) {
    return emptySeasonality(
      run.length,
      `At least ${String(MIN_SEASONALITY_MONTHS)} consecutive complete months are needed to separate seasonality from trend (have ${String(run.length)}).`,
    );
  }
  const blockCount = Math.floor(run.length / 12);
  const used = run.slice(-blockCount * 12);
  const detrended = detrend(used);
  const blocks = Array.from({ length: blockCount }, (_, b) => detrended.slice(b * 12, b * 12 + 12));
  const profiles = blocks.map(ratioProfile);

  const profile: Record<string, number> = {};
  for (let i = 0; i < 12; i++) {
    const calendarMonth = (used[i]?.period ?? '').slice(5, 7);
    profile[calendarMonth] = round(mean(profiles.map((p) => p[i] ?? 1)) ?? 1, 3);
  }
  const entries = Object.entries(profile).sort(([a], [b]) => (a < b ? -1 : 1));
  const values = entries.map(([, v]) => v);
  const amplitude = Math.max(...values) - Math.min(...values);
  const lastTwo = profiles.slice(-2);
  const corrRaw = lastTwo.length === 2 ? pearson(lastTwo[0] ?? [], lastTwo[1] ?? []) : Number.NaN;
  const correlation = Number.isFinite(corrRaw) ? round(corrRaw, 3) : null;
  // A genuine seasonal cycle rises and falls within the year. A profile that is monotonic in
  // time order (a "sawtooth" repeating every year) is the signature of a level shift or a trend
  // the global fit could not remove, so it is not reported as seasonality.
  const timeOrdered = Array.from(
    { length: 12 },
    (_, i) => mean(profiles.map((p) => p[i] ?? 1)) ?? 1,
  );
  const monotonicRho = spearman(
    timeOrdered.map((_, i) => i),
    timeOrdered,
  );
  const monotonic =
    Number.isFinite(monotonicRho) && Math.abs(monotonicRho) >= MONOTONIC_PROFILE_RHO;
  const detected =
    amplitude >= SEASONAL_AMPLITUDE_THRESHOLD &&
    correlation !== null &&
    correlation >= SEASONAL_CONSISTENCY_THRESHOLD &&
    !monotonic;
  const peak = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const trough = entries.reduce((a, b) => (b[1] < a[1] ? b : a));

  return {
    status: 'ok',
    monthsUsed: used.length,
    profile,
    amplitude: round(amplitude, 3),
    yearToYearProfileCorrelation: correlation,
    detected,
    peakMonth: Number(peak[0]),
    troughMonth: Number(trough[0]),
    yearOverYear: yearOverYear(run, monthly),
    message: null,
  };
}

/** Divide each month by its month-of-year index so recurring seasonal swings do not bias the trend. */
export function seasonallyAdjust(
  points: readonly UsablePoint[],
  profile: Readonly<Record<string, number>>,
): UsablePoint[] {
  return points.map((p) => {
    const index = profile[p.period.slice(5, 7)] ?? 1;
    return {
      period: p.period,
      averageDailyViews: index > 0 ? p.averageDailyViews / index : p.averageDailyViews,
    };
  });
}
