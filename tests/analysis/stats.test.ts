import { describe, expect, it } from '@jest/globals';
import { linearRegression, pearson, ranks, rSquared, spearman } from '../../src/analysis/stats.js';

describe('statistical primitives (checked against textbook values)', () => {
  it('ordinary least squares', () => {
    const fit = linearRegression([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
    expect(fit.m).toBeCloseTo(0.6, 10);
    expect(fit.b).toBeCloseTo(2.2, 10);
    expect(rSquared([1, 2, 3, 4, 5], [2, 4, 5, 4, 5], fit)).toBeCloseTo(0.6, 10);
    expect(linearRegression([], [])).toEqual({ m: 0, b: 0 });
    expect(linearRegression([1, 1], [2, 3]).m).toBe(0);
    expect(Number.isNaN(rSquared([1, 2], [3, 3], { m: 0, b: 3 }))).toBe(true);
  });

  it('Pearson correlation', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
    expect(pearson([1, 2, 3, 4], [1, 3, 2, 4])).toBeCloseTo(0.8, 12);
    expect(Number.isNaN(pearson([1, 1, 1], [1, 2, 3]))).toBe(true);
    expect(Number.isNaN(pearson([1], [1]))).toBe(true);
  });

  it('ranks with ties and Spearman correlation', () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
    // Monotonic but non-linear: Spearman = 1, Pearson < 1.
    const x = [1, 2, 3, 4, 5];
    const y = [1, 4, 9, 16, 1000];
    expect(spearman(x, y)).toBeCloseTo(1, 12);
    expect(pearson(x, y)).toBeLessThan(0.9);
    // Classic example with a known coefficient: ρ = 1 − 6·Σd²/(n(n²−1)) = 0.8 for Σd² = 4, n = 5.
    expect(spearman([1, 2, 3, 4, 5], [2, 1, 3, 4, 5])).toBeCloseTo(0.9, 12);
    expect(spearman([1, 2, 3, 4, 5], [1, 3, 2, 5, 4])).toBeCloseTo(0.8, 12);
  });
});
