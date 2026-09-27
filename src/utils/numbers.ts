/** Small deterministic numeric helpers. They return `null` instead of NaN/Infinity. */

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  const r = Math.round((value + Math.sign(value) * Number.EPSILON) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : sum(values) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + hi) / 2 : hi;
}

/** Population standard deviation. */
export function standardDeviation(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null) return null;
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / values.length);
}

/** Coefficient of variation (std / mean); null when the mean is zero or data is empty. */
export function coefficientOfVariation(values: readonly number[]): number | null {
  const m = mean(values);
  const sd = standardDeviation(values);
  if (m === null || sd === null || m === 0) return null;
  return sd / m;
}

/** Relative change in percent. Null when the base is zero (the change is undefined). */
export function percentChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / from) * 100;
}

export function medianAbsoluteDeviation(values: readonly number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

export function sign(value: number | null, deadZone = 0): -1 | 0 | 1 {
  if (value === null || Math.abs(value) <= deadZone) return 0;
  return value > 0 ? 1 : -1;
}

export function formatInteger(value: number): string {
  const rounded = Math.round(value);
  const digits = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rounded < 0 ? `-${digits}` : digits;
}

export function formatSignedPercent(value: number | null, digits = 1): string {
  if (value === null) return 'n/a';
  const r = round(value, digits);
  return `${r > 0 ? '+' : ''}${r.toFixed(digits)}%`;
}

/** View counts: integers with thousands separators; one decimal below 100 so small values stay informative. */
export function formatViews(value: number): string {
  if (Math.abs(value) >= 100) return formatInteger(value);
  return round(value, 1).toFixed(1);
}
