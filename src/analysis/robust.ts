import type { PageviewPoint } from '../types/pageviews.js';
import { median } from '../utils/numbers.js';

/**
 * Centred rolling median over neighbouring observations (by position, ±halfWindow).
 * Robust to single-day spikes, so it is used as the "expected" level for spike detection
 * and short-term volatility.
 */
export function rollingMedian(points: readonly PageviewPoint[], halfWindow = 14): number[] {
  const values = points.map((p) => p.views);
  return values.map((_, i) => {
    const from = Math.max(0, i - halfWindow);
    const to = Math.min(values.length, i + halfWindow + 1);
    return median(values.slice(from, to)) ?? 0;
  });
}
