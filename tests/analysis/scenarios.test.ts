/**
 * Behavioural tests: each deterministic fixture encodes a known ground truth, and the
 * analysis must recover it (direction, spikes, seasonality, evidence).
 */
import { describe, expect, it } from '@jest/globals';
import { analyzeFixture } from '../helpers/analysis.js';

describe('analysis on fixture scenarios', () => {
  it('steady growth: up, high confidence, high evidence, no false seasonality', () => {
    const a = analyzeFixture('steady-growth');
    expect(a.status).toBe('analyzed');
    expect(a.trend.direction).toBe('up');
    expect(a.trend.confidence).toBe('high');
    // Generated at ~3%/month; the log-linear fit recovers it.
    expect(a.trend.normalizedSlope).toBeGreaterThan(2.7);
    expect(a.trend.normalizedSlope).toBeLessThan(3.3);
    expect(a.trend.rSquared).toBeGreaterThan(0.95);
    expect(a.seasonality.detected).toBe(false);
    expect(a.trend.seasonallyAdjusted).toBe(false);
    expect(a.metrics?.percentChange).toBeGreaterThan(30);
    expect(a.metrics?.annualizedGrowth.percent).toBeGreaterThan(35);
    expect(a.evidence.strength).toBe('high');
    expect(a.outliers.count).toBe(0);
  });

  it('flat: no direction, small change, no annualised growth claim', () => {
    const a = analyzeFixture('flat');
    expect(a.trend.direction).toBe('flat');
    expect(Math.abs(a.metrics?.percentChange ?? 99)).toBeLessThan(3);
    expect(a.metrics?.annualizedGrowth.percent).toBeNull();
    expect(a.metrics?.annualizedGrowth.note).toMatch(/too weak/);
    expect(a.metrics?.volatility.level).toBe('low');
  });

  it('declining: down with high confidence', () => {
    const a = analyzeFixture('declining');
    expect(a.trend.direction).toBe('down');
    expect(a.trend.confidence).toBe('high');
    expect(a.metrics?.percentChange).toBeLessThan(-25);
    expect(a.seasonality.yearOverYear?.monthsDown).toBe(12);
  });

  it('noisy growth: still up, but with visible volatility', () => {
    const a = analyzeFixture('noisy-growth');
    expect(a.trend.direction).toBe('up');
    expect(a.metrics?.volatility.level).not.toBe('low');
    expect(a.trend.rSquared).toBeLessThan(a.trend.linearRSquared === null ? 1 : 0.95);
  });

  it('strong spike: detected, dated, and shown to drive the apparent growth', () => {
    const a = analyzeFixture('strong-spike');
    expect(a.outliers.count).toBeGreaterThanOrEqual(1);
    const spike = a.outliers.events.find((e) => e.kind === 'spike');
    expect(spike?.start).toBe('2025-04-10');
    expect(spike?.end).toBe('2025-04-14');
    expect(spike?.ratio).toBeGreaterThan(20);
    const inf = a.outliers.influence;
    expect(inf?.percentChangeWithOutliers).toBeGreaterThan(40);
    expect(Math.abs(inf?.percentChangeWithoutOutliers ?? 99)).toBeLessThan(5);
    expect(inf?.material).toBe(true);
    expect(inf?.summary).toMatch(/Result depends on spikes/);
    expect(a.evidence.strength).toBe('low');
    expect(a.evidence.warnings.join(' ')).toMatch(/depends on spikes/);
  });

  it('strong spike: excluding the largest spike removes the artificial growth', () => {
    const a = analyzeFixture('strong-spike', { excludeLargestSpike: true });
    expect(a.data.excludedRanges).toEqual([{ start: '2025-04-10', end: '2025-04-14' }]);
    expect(a.data.excludedDays).toBe(5);
    expect(Math.abs(a.metrics?.percentChange ?? 99)).toBeLessThan(5);
    expect(a.daily.some((d) => d.date === '2025-04-12')).toBe(false);
  });

  it('explicit date exclusions are honoured and reported, not counted as missing', () => {
    const a = analyzeFixture('strong-spike', {
      exclusions: [{ start: '2025-04-01', end: '2025-04-30' }],
    });
    expect(a.data.excludedDays).toBe(30);
    expect(a.data.missingDays).toBe(0);
    expect(a.data.completeness).toBe(1);
    expect(a.monthly.find((m) => m.month === '2025-04')?.reportedDays).toBe(0);
  });

  it('seasonal: pattern detected, trend fitted on adjusted data and not mistaken for growth', () => {
    const a = analyzeFixture('seasonal');
    expect(a.seasonality.detected).toBe(true);
    expect(a.seasonality.peakMonth).toBe(9);
    expect(a.seasonality.troughMonth).toBe(3);
    expect(a.seasonality.yearToYearProfileCorrelation).toBeGreaterThan(0.9);
    expect(a.trend.seasonallyAdjusted).toBe(true);
    expect(a.trend.direction).toBe('flat');
    expect(Math.abs(a.seasonality.yearOverYear?.percentChange ?? 99)).toBeLessThan(3);
    expect(a.evidence.reasons.join(' ')).toMatch(/seasonal pattern detected/);
  });

  it('missing observations: completeness measured, gaps preserved, never interpolated', () => {
    const a = analyzeFixture('missing-observations');
    expect(a.data.completeness).toBeLessThan(0.9);
    expect(a.data.missingRanges.some((r) => r.start <= '2024-06-01' && r.end >= '2024-06-10')).toBe(
      true,
    );
    expect(a.daily).toHaveLength(a.data.reportedDays);
    expect(a.evidence.strength).toBe('low');
    expect(a.evidence.warnings.join(' ')).toMatch(/expected daily observations/);
  });

  it('missing observations: --missing-as-zero is explicit and changes averages', () => {
    const base = analyzeFixture('missing-observations');
    const zero = analyzeFixture('missing-observations', { missingAsZero: true });
    expect(zero.data.missingTreatedAsZero).toBe(true);
    expect(zero.daily).toHaveLength(731);
    expect(zero.metrics?.averageDailyViews).toBeLessThan(base.metrics?.averageDailyViews ?? 0);
    // Completeness still reflects what the API reported.
    expect(zero.data.completeness).toBe(base.data.completeness);
  });

  it('no data: 404 from the API yields no metrics and low evidence', () => {
    const a = analyzeFixture('flat', { pageviews: { points: [], noData: true } });
    expect(a.status).toBe('no_data');
    expect(a.metrics).toBeNull();
    expect(a.projectNormalized).toBeNull();
    expect(a.data.issues.join(' ')).toMatch(/no recorded views/);
    expect(a.evidence.strength).toBe('low');
  });

  it('short periods use weekly trend and daily windows, with warnings', () => {
    const a = analyzeFixture('steady-growth', { start: '2025-10-01', end: '2025-12-31' });
    expect(a.trend.granularity).toBe('week');
    expect(a.metrics?.baseline.label).toMatch(/reported days/);
    expect(a.metrics?.annualizedGrowth.percent).toBeNull();
    expect(a.seasonality.status).toBe('insufficient_data');
    expect(a.evidence.warnings.join(' ')).toMatch(/Short period/);
  });

  it('very short periods report insufficient data for a trend', () => {
    const a = analyzeFixture('flat', { start: '2025-12-20', end: '2025-12-31' });
    expect(a.status).toBe('insufficient_data');
    expect(a.trend.status).toBe('insufficient_data');
    expect(a.trend.message).toMatch(/Not enough observations for a reliable long-term trend/);
    expect(a.evidence.strength).toBe('low');
  });

  it('12–23 month periods use 3-month windows and warn about seasonal mismatch', () => {
    const a = analyzeFixture('seasonal', { start: '2025-01-01', end: '2025-12-31' });
    expect(a.metrics?.baseline.label).toMatch(/first 3 complete months/);
    expect(a.evidence.warnings.join(' ')).toMatch(/different calendar months/);
  });

  it('share of edition traffic is computed against the project aggregate', () => {
    const a = analyzeFixture('flat');
    expect(a.projectNormalized?.averagePerMillion).toBeGreaterThan(0);
    // The project fixture declines slowly, so a flat article gains share.
    expect(a.projectNormalized?.projectPercentChange).toBeLessThan(0);
    expect(a.projectNormalized?.percentChange).toBeGreaterThan(a.metrics?.percentChange ?? 0);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(analyzeFixture('noisy-growth'))).toBe(
      JSON.stringify(analyzeFixture('noisy-growth')),
    );
  });
});
