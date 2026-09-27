/**
 * Small, fully typed statistical primitives (OLS, R², Pearson, Spearman). Implemented locally
 * instead of pulling a library whose type declarations do not resolve under NodeNext.
 * All functions return NaN only where the statistic is mathematically undefined.
 */

export interface LinearFit {
  /** Slope. */
  m: number;
  /** Intercept. */
  b: number;
}

/** Ordinary least squares fit of y = m·x + b. */
export function linearRegression(x: readonly number[], y: readonly number[]): LinearFit {
  const n = Math.min(x.length, y.length);
  if (n === 0) return { m: 0, b: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i] ?? 0;
    sy += y[i] ?? 0;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    sxy += dx * ((y[i] ?? 0) - my);
    sxx += dx * dx;
  }
  const m = sxx === 0 ? 0 : sxy / sxx;
  return { m, b: my - m * mx };
}

/** Coefficient of determination of a fit; NaN when y has no variance. */
export function rSquared(x: readonly number[], y: readonly number[], fit: LinearFit): number {
  const n = Math.min(x.length, y.length);
  let my = 0;
  for (let i = 0; i < n; i++) my += y[i] ?? 0;
  my /= n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yi = y[i] ?? 0;
    const pred = fit.b + fit.m * (x[i] ?? 0);
    ssRes += (yi - pred) ** 2;
    ssTot += (yi - my) ** 2;
  }
  return ssTot === 0 ? Number.NaN : 1 - ssRes / ssTot;
}

/** Pearson correlation; NaN when either series is constant. */
export function pearson(x: readonly number[], y: readonly number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return Number.NaN;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i] ?? 0;
    my += y[i] ?? 0;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? Number.NaN : sxy / Math.sqrt(sxx * syy);
}

/** Ranks (1-based) with ties receiving their average rank. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1]?.v === order[k]?.v) j++;
    const avg = (k + j) / 2 + 1;
    for (let t = k; t <= j; t++) {
      const idx = order[t]?.i;
      if (idx !== undefined) out[idx] = avg;
    }
    k = j + 1;
  }
  return out;
}

/** Spearman rank correlation (Pearson on tie-averaged ranks). */
export function spearman(x: readonly number[], y: readonly number[]): number {
  return pearson(ranks(x), ranks(y));
}
