/**
 * UTC-only calendar helpers. All dates in the application are ISO `YYYY-MM-DD` strings
 * interpreted as UTC calendar days, so no local-timezone drift can occur.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** First day for which Wikimedia publishes per-article pageviews (Pageviews API). */
export const PAGEVIEWS_DATA_START = '2015-07-01';

export class DateError extends Error {
  override readonly name = 'DateError';
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function parseIsoDate(value: string): Date {
  if (!isIsoDate(value)) throw new DateError(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  return new Date(`${value}T00:00:00Z`);
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return formatIsoDate(new Date(parseIsoDate(date).getTime() + days * DAY_MS));
}

/** Inclusive number of calendar days between two ISO dates. */
export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / DAY_MS) + 1;
}

/** Every ISO date from start to end, inclusive. */
export function eachDay(start: string, end: string): string[] {
  const n = daysBetweenInclusive(start, end);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(start, i));
  return out;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

function splitMonth(month: string): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m?.[1] || !m[2]) throw new DateError(`Invalid month "${month}". Expected YYYY-MM.`);
  return [Number(m[1]), Number(m[2])];
}

export function daysInMonth(month: string): number {
  const [y, m] = splitMonth(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function firstDayOfMonth(month: string): string {
  return `${month}-01`;
}

export function lastDayOfMonth(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/** Shift a `YYYY-MM` month key by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = splitMonth(month);
  return formatIsoDate(new Date(Date.UTC(y, m - 1 + delta, 1))).slice(0, 7);
}

/** Every `YYYY-MM` month overlapping the inclusive date range. */
export function eachMonth(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = monthKey(start);
  const last = monthKey(end);
  while (cur <= last) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/** ISO-8601 week start (Monday) for a date. */
export function weekStart(date: string): string {
  const dow = (parseIsoDate(date).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function monthName(monthNumber: number): string {
  return MONTH_NAMES[monthNumber - 1] ?? '?';
}

export function monthLabel(month: string): string {
  const [y, m] = splitMonth(month);
  return `${monthName(m)} ${y}`;
}

export function toCompactDate(date: string): string {
  return date.replaceAll('-', '');
}

/** Parse Wikimedia `YYYYMMDDHH` timestamps into an ISO date. */
export function fromWikimediaTimestamp(ts: string): string {
  const iso = /^\d{10}$/.test(ts) ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : '';
  if (!isIsoDate(iso)) throw new DateError(`Invalid Wikimedia timestamp "${ts}"`);
  return iso;
}

export type PeriodUnit = 'd' | 'w' | 'm' | 'y';

export interface PeriodSpec {
  amount: number;
  unit: PeriodUnit;
}

function isPeriodUnit(value: string): value is PeriodUnit {
  return value === 'd' || value === 'w' || value === 'm' || value === 'y';
}

export function parsePeriod(value: string): PeriodSpec {
  const m = /^(\d{1,3})\s*([a-z])$/i.exec(value.trim());
  const unit = m?.[2]?.toLowerCase() ?? '';
  const amount = Number(m?.[1] ?? 0);
  if (!isPeriodUnit(unit) || amount <= 0) {
    throw new DateError(`Invalid period "${value}". Use forms like 90d, 8w, 12m or 2y.`);
  }
  return { amount, unit };
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Latest day that is safe to request. Wikimedia usually publishes a day's data within
 * ~24h; two days of lag avoids requesting a day that is not loaded yet.
 */
export function latestAvailableDay(today: string): string {
  return addDays(today, -2);
}

/**
 * Resolve a relative period into an absolute date range.
 * - `m`/`y` periods end at the last complete calendar month so monthly aggregates are whole.
 * - `d`/`w` periods end at the latest available day.
 */
export function resolvePeriod(spec: PeriodSpec, today: string): DateRange {
  const latest = latestAvailableDay(today);
  if (spec.unit === 'd' || spec.unit === 'w') {
    const days = spec.unit === 'd' ? spec.amount : spec.amount * 7;
    return { start: addDays(latest, -(days - 1)), end: latest };
  }
  const latestMonth = monthKey(latest);
  const lastCompleteMonth =
    lastDayOfMonth(latestMonth) === latest ? latestMonth : addMonths(latestMonth, -1);
  const months = spec.unit === 'm' ? spec.amount : spec.amount * 12;
  return {
    start: firstDayOfMonth(addMonths(lastCompleteMonth, -(months - 1))),
    end: lastDayOfMonth(lastCompleteMonth),
  };
}

export function validateRange(range: DateRange, today: string): void {
  parseIsoDate(range.start);
  parseIsoDate(range.end);
  if (range.start > range.end) {
    throw new DateError(`Start date ${range.start} is after end date ${range.end}.`);
  }
  if (range.start < PAGEVIEWS_DATA_START) {
    throw new DateError(
      `Start date ${range.start} is before ${PAGEVIEWS_DATA_START}, the first day of Wikimedia pageview data.`,
    );
  }
  const latest = latestAvailableDay(today);
  if (range.end > latest) {
    throw new DateError(`End date ${range.end} is after the latest available day (${latest}).`);
  }
}

export function todayUtc(now: Date = new Date()): string {
  return formatIsoDate(now);
}
