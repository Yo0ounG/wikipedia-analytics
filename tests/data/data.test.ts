import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  calculateRollingAverage,
  groupByMonth,
  groupByWeek,
  usableMonths,
  usableWeeks,
} from '../../src/data/aggregate.js';
import { FileCache, MemoryCache } from '../../src/data/cache.js';
import { applyExclusions, fillMissingAsZero, isExcluded } from '../../src/data/normalize.js';
import { toRanges, validateSeries } from '../../src/data/validate.js';
import { eachDay } from '../../src/utils/dates.js';

const series = (start: string, end: string, value: (i: number) => number) =>
  eachDay(start, end).map((date, i) => ({ date, views: value(i) }));

describe('validateSeries', () => {
  it('passes clean data and computes completeness', () => {
    const v = validateSeries(
      series('2024-01-01', '2024-01-10', () => 5),
      '2024-01-01',
      '2024-01-10',
    );
    expect(v.reportedDays).toBe(10);
    expect(v.completeness).toBe(1);
    expect(v.missingDates).toEqual([]);
    expect(v.issues).toEqual([]);
  });

  it('flags duplicates, negatives, invalid numbers, out-of-range and unsorted input', () => {
    const v = validateSeries(
      [
        { date: '2024-01-03', views: 3 },
        { date: '2024-01-01', views: 1 },
        { date: '2024-01-01', views: 99 },
        { date: '2024-01-02', views: -4 },
        { date: '2024-01-04', views: Number.NaN },
        { date: '2024-01-05', views: 2.5 },
        { date: '2023-12-31', views: 7 },
        { date: 'garbage', views: 1 },
      ],
      '2024-01-01',
      '2024-01-05',
    );
    expect(v.points).toEqual([
      { date: '2024-01-01', views: 1 },
      { date: '2024-01-03', views: 3 },
    ]);
    expect(v.missingDates).toEqual(['2024-01-02', '2024-01-04', '2024-01-05']);
    expect(v.completeness).toBeCloseTo(0.4);
    expect(v.issues.join(' ')).toMatch(/invalid/);
    expect(v.issues.join(' ')).toMatch(/duplicate/);
    expect(v.issues.join(' ')).toMatch(/outside the requested period/);
    expect(v.issues.join(' ')).toMatch(/out of date order/);
  });

  it('collapses dates into ranges', () => {
    expect(toRanges(['2024-01-01', '2024-01-02', '2024-01-05'])).toEqual([
      { start: '2024-01-01', end: '2024-01-02' },
      { start: '2024-01-05', end: '2024-01-05' },
    ]);
  });
});

describe('aggregation', () => {
  const points = series('2024-01-15', '2024-03-31', () => 10);

  it('groups by calendar month with coverage information', () => {
    const monthly = groupByMonth(points, '2024-01-15', '2024-03-31');
    expect(monthly.map((m) => m.month)).toEqual(['2024-01', '2024-02', '2024-03']);
    expect(monthly[0]).toMatchObject({
      views: 170,
      reportedDays: 17,
      expectedDays: 17,
      complete: false,
    });
    expect(monthly[1]).toMatchObject({
      views: 290,
      reportedDays: 29,
      expectedDays: 29,
      complete: true,
      averageDailyViews: 10,
    });
    // The partial first month is excluded from trend input.
    expect(usableMonths(monthly).map((u) => u.period)).toEqual(['2024-02', '2024-03']);
  });

  it('uses averages per reported day and does not impute gaps', () => {
    const sparse = series('2024-02-01', '2024-02-29', (i) => (i % 2 === 0 ? 10 : 20)).filter(
      (_, i) => i !== 3,
    );
    const [feb] = groupByMonth(sparse, '2024-02-01', '2024-02-29');
    expect(feb?.reportedDays).toBe(28);
    expect(feb?.views).toBe(sparse.reduce((s, p) => s + p.views, 0));
    expect(feb?.averageDailyViews).toBeCloseTo((feb?.views ?? 0) / 28);
    expect(feb?.complete).toBe(false);
    expect(usableMonths(groupByMonth(sparse, '2024-02-01', '2024-02-29'))).toHaveLength(1);
    // Below 80% coverage a month is not usable.
    const verySparse = sparse.filter((_, i) => i % 3 !== 0);
    expect(usableMonths(groupByMonth(verySparse, '2024-02-01', '2024-02-29'))).toHaveLength(0);
  });

  it('groups by ISO week', () => {
    const weekly = groupByWeek(
      series('2024-01-03', '2024-01-21', () => 1),
      '2024-01-03',
      '2024-01-21',
    );
    expect(weekly.map((w) => [w.weekStart, w.expectedDays, w.complete])).toEqual([
      ['2024-01-01', 5, false],
      ['2024-01-08', 7, true],
      ['2024-01-15', 7, true],
    ]);
    expect(usableWeeks(weekly).map((w) => w.period)).toEqual(['2024-01-08', '2024-01-15']);
  });

  it('computes trailing and centred rolling averages over calendar days', () => {
    const p = series('2024-01-01', '2024-01-10', (i) => i + 1);
    const trailing = calculateRollingAverage(p, '2024-01-01', '2024-01-10', { window: 3 });
    expect(trailing.slice(0, 3).map((r) => r.value)).toEqual([null, null, 2]);
    expect(trailing[9]?.value).toBe(9);
    const centred = calculateRollingAverage(p, '2024-01-01', '2024-01-10', {
      window: 3,
      align: 'center',
    });
    expect(centred[1]?.value).toBe(2);
    expect(centred[9]?.value).toBeNull();
  });

  it('keeps rolling averages null when coverage is too low', () => {
    const p = [{ date: '2024-01-05', views: 100 }];
    const r = calculateRollingAverage(p, '2024-01-01', '2024-01-10', {
      window: 5,
      minCoverage: 0.5,
    });
    expect(r.every((x) => x.value === null)).toBe(true);
  });
});

describe('normalisation', () => {
  it('applies exclusions', () => {
    const p = series('2024-01-01', '2024-01-05', () => 1);
    const ranges = [{ start: '2024-01-02', end: '2024-01-03' }];
    expect(isExcluded('2024-01-03', ranges)).toBe(true);
    const { kept, excluded } = applyExclusions(p, ranges);
    expect(kept.map((x) => x.date)).toEqual(['2024-01-01', '2024-01-04', '2024-01-05']);
    expect(excluded).toHaveLength(2);
  });

  it('fills missing days with zero only when asked, skipping excluded days', () => {
    const filled = fillMissingAsZero(
      [{ date: '2024-01-02', views: 4 }],
      '2024-01-01',
      '2024-01-04',
      [{ start: '2024-01-04', end: '2024-01-04' }],
    );
    expect(filled).toEqual([
      { date: '2024-01-01', views: 0 },
      { date: '2024-01-02', views: 4 },
      { date: '2024-01-03', views: 0 },
    ]);
  });
});

describe('caches', () => {
  it('file cache round-trips, respects TTL and never mixes keys', async () => {
    let now = 1_000;
    const dir = mkdtempSync(path.join(tmpdir(), 'wia-cache-'));
    const cache = new FileCache(dir, () => now);
    const a = 'https://wikimedia.org/.../pl.wikipedia/all-access/user/X/daily/20240101/20241231';
    const b = 'https://wikimedia.org/.../cs.wikipedia/all-access/user/X/daily/20240101/20241231';
    await cache.set(a, { items: [1] });
    expect(await cache.get(a, 10_000)).toEqual({ items: [1] });
    expect(await cache.get(b, 10_000)).toBeUndefined();
    now += 20_000;
    expect(await cache.get(a, 10_000)).toBeUndefined();
  });

  it('memory cache honours TTL', async () => {
    let now = 0;
    const cache = new MemoryCache(() => now);
    await cache.set('k', 1);
    expect(await cache.get('k', 5)).toBe(1);
    now = 10;
    expect(await cache.get('k', 5)).toBeUndefined();
    expect(cache.size).toBe(1);
  });
});
