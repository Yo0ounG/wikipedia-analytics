import { describe, expect, it } from '@jest/globals';
import { compareLanguages, normalizedIndexSeries } from '../../src/analysis/comparison.js';
import {
  assessEvidence,
  SEASONAL_WINDOW_WARNING,
  strengthFromScore,
  weakest,
  type EvidenceInput,
} from '../../src/analysis/evidence.js';
import { buildFindings, languageFinding } from '../../src/analysis/findings.js';
import { editionRelation } from '../../src/analysis/index.js';
import {
  comparisonWindows,
  computeCoreMetrics,
  shortTermVolatility,
  volatilityLevel,
  windowMonths,
} from '../../src/analysis/metrics.js';
import { detectOutliers, largestSpike } from '../../src/analysis/outliers.js';
import { analyzeSeasonality, seasonallyAdjust } from '../../src/analysis/seasonality.js';
import { analyzeTrend, insufficientTrend } from '../../src/analysis/trend.js';
import { groupByMonth, usableMonths } from '../../src/data/aggregate.js';
import type { UsablePoint } from '../../src/data/aggregate.js';
import { addMonths, eachDay } from '../../src/utils/dates.js';
import { analyzeFixture } from '../helpers/analysis.js';

const months = (values: number[], first = '2024-01'): UsablePoint[] =>
  values.map((v, i) => ({ period: addMonths(first, i), averageDailyViews: v }));

describe('trend', () => {
  it('fits a log-linear trend and reports % per period', () => {
    const t = analyzeTrend(months(Array.from({ length: 12 }, (_, i) => 100 * 1.1 ** i)), 'month');
    expect(t.direction).toBe('up');
    expect(t.normalizedSlope).toBeCloseTo(10, 0);
    expect(t.rSquared).toBeCloseTo(1, 3);
    expect(t.spearmanCorrelation).toBe(1);
    expect(t.confidence).toBe('high');
  });

  it('calls a flat direction when methods disagree or the slope is tiny', () => {
    const t = analyzeTrend(
      months([100, 101, 100, 99, 100, 101, 100, 100, 99, 101, 100, 100]),
      'month',
    );
    expect(t.direction).toBe('flat');
  });

  it('handles constant series without NaN', () => {
    const t = analyzeTrend(months(Array(8).fill(50) as number[]), 'month');
    expect(t.direction).toBe('flat');
    expect(t.rSquared).toBeNull();
    expect(t.spearmanCorrelation).toBeNull();
    expect(t.confidence).toBe('low');
  });

  it('handles gaps between months using real time positions', () => {
    const pts = months([1000, 2000, 4000, 8000, 16000, 32000]).filter((_, i) => i !== 2);
    const t = analyzeTrend(
      [
        ...pts,
        { period: '2024-08', averageDailyViews: 128000 },
        { period: '2024-09', averageDailyViews: 256000 },
      ],
      'month',
    );
    expect(t.normalizedSlope).toBeCloseTo(100, 0);
  });

  it('requires a minimum number of observations', () => {
    expect(analyzeTrend(months([1, 2, 3]), 'month').status).toBe('insufficient_data');
    expect(insufficientTrend(0, null, 'x')).toMatchObject({
      direction: null,
      confidence: null,
      message: 'x',
    });
  });

  it('down trends get moderate confidence with weaker fits', () => {
    const vals = [100, 90, 95, 80, 85, 70, 75, 72, 60, 70];
    const t = analyzeTrend(months(vals), 'month');
    expect(t.direction).toBe('down');
    expect(['moderate', 'high']).toContain(t.confidence);
  });
});

describe('outliers', () => {
  const flat = eachDay('2024-01-01', '2024-03-31').map((date, i) => ({
    date,
    views: 100 + (i % 7) * 3,
  }));

  it('detects a spike event with dates, magnitude and excess views', () => {
    const pts = flat.map((p) =>
      p.date === '2024-02-10' || p.date === '2024-02-11' ? { ...p, views: 2000 } : p,
    );
    const d = detectOutliers(pts);
    expect(d.events).toHaveLength(1);
    expect(d.events[0]).toMatchObject({
      start: '2024-02-10',
      end: '2024-02-11',
      days: 2,
      kind: 'spike',
      peakViews: 2000,
    });
    expect(d.events[0]?.ratio).toBeGreaterThan(15);
    expect(d.spikeDates.size).toBe(2);
    expect(largestSpike(d.events)?.start).toBe('2024-02-10');
  });

  it('detects dips but never returns them as removable spikes', () => {
    const pts = flat.map((p) => (p.date === '2024-02-10' ? { ...p, views: 5 } : p));
    const d = detectOutliers(pts);
    expect(d.events[0]?.kind).toBe('dip');
    expect(d.spikeDates.size).toBe(0);
    expect(largestSpike(d.events)).toBeNull();
  });

  it('ignores trivially small absolute changes in low-traffic series', () => {
    const tiny = eachDay('2024-01-01', '2024-03-31').map((date) => ({
      date,
      views: date === '2024-02-01' ? 12 : 2,
    }));
    expect(detectOutliers(tiny).events).toHaveLength(0);
  });

  it('needs enough observations', () => {
    expect(detectOutliers(flat.slice(0, 10)).events).toEqual([]);
  });
});

describe('seasonality', () => {
  it('reports insufficient data under 24 consecutive months', () => {
    const s = analyzeSeasonality(months(Array(18).fill(10) as number[]), []);
    expect(s.status).toBe('insufficient_data');
    expect(s.message).toMatch(/24 consecutive complete months/);
  });

  it('adjusts values by the month-of-year profile', () => {
    const adjusted = seasonallyAdjust(months([200, 50]), { '01': 2, '02': 0.5 });
    expect(adjusted.map((a) => a.averageDailyViews)).toEqual([100, 100]);
  });

  it('computes year-over-year comparison of matching months', () => {
    const vals = [...new Array<number>(12).fill(100), ...new Array<number>(12).fill(150)];
    const pts = months(vals);
    const monthly = groupByMonth(
      pts.flatMap((p) =>
        eachDay(`${p.period}-01`, `${p.period}-28`).map((date) => ({
          date,
          views: p.averageDailyViews,
        })),
      ),
      '2024-01-01',
      '2025-12-28',
    );
    const s = analyzeSeasonality(pts, monthly);
    expect(s.yearOverYear?.percentChange).toBe(50);
    expect(s.yearOverYear?.monthsUp).toBe(12);
    expect(s.detected).toBe(false);
  });
});

describe('metrics', () => {
  it('chooses window sizes by period length', () => {
    expect(windowMonths(30)).toBe(12);
    expect(windowMonths(12)).toBe(3);
  });

  it('returns null for empty data and computes daily windows for short series', () => {
    expect(comparisonWindows([], [])).toBeNull();
    const pts = eachDay('2024-01-01', '2024-01-30').map((date, i) => ({
      date,
      views: i < 10 ? 10 : 20,
    }));
    const w = comparisonWindows(pts, []);
    expect(w?.baseline.averageDailyViews).toBe(10);
    expect(w?.latest.averageDailyViews).toBe(20);
    const m = computeCoreMetrics(pts, [], analyzeTrend([], 'week'));
    expect(m?.percentChange).toBe(100);
    expect(m?.absoluteChange).toBe(10);
    expect(m?.peak).toEqual({ date: '2024-01-11', views: 20 });
    expect(m?.totalViews).toBe(500);
    expect(m?.medianDailyViews).toBe(20);
  });

  it('classifies volatility robustly', () => {
    expect(volatilityLevel(null)).toBe('low');
    expect(volatilityLevel(0.3)).toBe('moderate');
    expect(volatilityLevel(0.6)).toBe('high');
    expect(shortTermVolatility([{ date: '2024-01-01', views: 1 }])).toBeNull();
  });

  it('uses 12-month windows for 24+ months so the change is seasonally balanced', () => {
    const a = analyzeFixture('seasonal');
    expect(a.metrics?.baseline.label).toMatch(/first 12 complete months/);
    expect(a.metrics?.baseline.start).toBe('2024-01-01');
    expect(a.metrics?.latest.end).toBe('2025-12-31');
    expect(usableMonths(a.monthly)).toHaveLength(24);
  });
});

describe('evidence', () => {
  const base = analyzeFixture('steady-growth');
  const input: EvidenceInput = {
    data: base.data,
    metrics: base.metrics,
    trend: base.trend,
    outliers: base.outliers,
    seasonality: base.seasonality,
    usableMonths: 24,
  };

  it('maps scores to strengths and finds the weakest level', () => {
    expect(strengthFromScore(5)).toBe('high');
    expect(strengthFromScore(2)).toBe('moderate');
    expect(strengthFromScore(-1)).toBe('low');
    expect(weakest(['high', 'low', 'moderate'])).toBe('low');
    expect(weakest([])).toBe('high');
  });

  it('gives reasons that cite the data', () => {
    const e = assessEvidence(input);
    expect(e.strength).toBe('high');
    expect(e.reasons.join(' ')).toMatch(/100% of expected daily observations/);
    expect(e.reasons.join(' ')).toMatch(/24 complete months/);
  });

  it('caps strength when completeness is poor', () => {
    const e = assessEvidence({
      ...input,
      data: { ...input.data, reportedDays: Math.round(input.data.expectedDays * 0.7) },
    });
    expect(e.strength).toBe('low');
  });

  it('penalises method disagreement and low traffic', () => {
    const e = assessEvidence({
      ...input,
      metrics: input.metrics
        ? { ...input.metrics, percentChange: -20, averageDailyViews: 5 }
        : null,
    });
    expect(e.warnings.join(' ')).toMatch(/methods disagree/);
    expect(e.warnings.join(' ')).toMatch(/low traffic/);
    expect(e.score).toBeLessThan(assessEvidence(input).score);
  });

  it('notes moderate completeness without penalty and partial method agreement', () => {
    const e = assessEvidence({
      ...input,
      data: { ...input.data, reportedDays: Math.round(input.data.expectedDays * 0.95) },
      metrics: input.metrics ? { ...input.metrics, percentChange: 1 } : null,
    });
    expect(e.reasons.join(' ')).toMatch(/9\d\.\d% of expected/);
    expect(e.warnings.join(' ')).not.toMatch(/expected daily observations/);
    expect(e.reasons.join(' ')).toMatch(/methods partly agree/);
  });

  it('penalises high volatility and spike-dependent results', () => {
    const m = input.metrics;
    if (!m) throw new Error('metrics expected');
    const volatile = assessEvidence({
      ...input,
      metrics: { ...m, volatility: { ...m.volatility, level: 'high', shortTermVolatility: 0.9 } },
    });
    expect(volatile.warnings.join(' ')).toMatch(/high short-term volatility/);
    const influence = {
      percentChangeWithOutliers: 40,
      percentChangeWithoutOutliers: 20,
      trendDirectionWithOutliers: 'up' as const,
      trendDirectionWithoutOutliers: 'up' as const,
      normalizedSlopeWithOutliers: 2,
      normalizedSlopeWithoutOutliers: 1,
      trendSurvives: true,
      material: true,
      summary: 'Result depends on spikes: test',
    };
    const survives = assessEvidence({
      ...input,
      outliers: { ...input.outliers, count: 1, influence },
    });
    const flips = assessEvidence({
      ...input,
      outliers: { ...input.outliers, count: 1, influence: { ...influence, trendSurvives: false } },
    });
    expect(survives.score - flips.score).toBe(1);
    expect(survives.warnings).toContain('Result depends on spikes: test');
    const harmless = assessEvidence({
      ...input,
      outliers: {
        ...input.outliers,
        count: 2,
        influence: { ...influence, material: false, summary: 'Trend persists' },
      },
    });
    expect(harmless.reasons).toContain('Trend persists');
  });

  it('never outputs probabilities', () => {
    const e = assessEvidence(input);
    expect(JSON.stringify(e)).not.toMatch(/probab|% confiden/i);
  });
});

describe('comparison', () => {
  const pl = analyzeFixture('steady-growth', {}, 'pl');
  const cs = analyzeFixture('flat', {}, 'cs');
  const uk = analyzeFixture('declining', {}, 'uk');

  it('needs at least two analysed languages', () => {
    expect(compareLanguages([pl])).toBeNull();
  });

  it('separates absolute popularity from relative growth', () => {
    const c = compareLanguages([pl, cs, uk]);
    expect(c?.absolute.map((a) => a.language)).toEqual(['uk', 'cs', 'pl']);
    expect(c?.relativeGrowth.map((r) => r.language)).toEqual(['pl', 'cs', 'uk']);
    expect(c?.highlights.join(' ')).toMatch(/rank the languages differently/);
    expect(c?.highlights.join(' ')).not.toMatch(/winner/i);
  });

  it('provides deterministic rankings so agents never rank numbers themselves', () => {
    const c = compareLanguages([pl, cs, uk]);
    expect(c?.rankings.absoluteViews).toEqual(['uk', 'cs', 'pl']);
    expect(c?.rankings.relativeGrowth).toEqual(['pl', 'cs', 'uk']);
    expect(c?.rankings.trendPerPeriod).toEqual(['pl', 'cs', 'uk']);
    expect(c?.rankings.shareOfEditionChange[0]).toBe('pl');
    expect(c?.rankings.evidenceStrength).toHaveLength(3);
    expect(c?.highlights.join(' ')).toMatch(
      /Trend per month \(log-linear\): strongest pl .* weakest uk/,
    );
  });

  it('normalised index starts at the baseline (=100) and matches percent change', () => {
    const c = compareLanguages([pl, cs]);
    expect(c?.normalizedIndex.final['pl']).toBeCloseTo(100 + (pl.metrics?.percentChange ?? 0), 2);
    const first12 = (c?.normalizedIndex.series['pl'] ?? []).slice(0, 12).map((p) => p.index ?? 0);
    expect(first12.reduce((s, v) => s + v, 0) / 12).toBeCloseTo(100, 0);
    expect(
      normalizedIndexSeries([{ period: '2024-01', averageDailyViews: 5 }], 0)[0]?.index,
    ).toBeNull();
  });

  it('uses the weakest language evidence and describes declines honestly', () => {
    const spike = analyzeFixture('strong-spike', {}, 'cs');
    const c = compareLanguages([pl, spike]);
    expect(c?.evidence.strength).toBe('low');
    const declining = compareLanguages([uk, analyzeFixture('declining', {}, 'cs')]);
    expect(declining?.highlights.join(' ')).toMatch(/Smallest decline/);
    expect(declining?.highlights.join(' ')).toMatch(/small/);
  });

  it('lists languages without data in warnings', () => {
    const nodata = analyzeFixture('flat', { pageviews: { points: [], noData: true } }, 'de');
    const c = compareLanguages([pl, cs, nodata]);
    expect(c?.languages).toEqual(['pl', 'cs']);
    expect(c?.relativeGrowth.every((r) => r.language !== 'de')).toBe(true);
    expect(c?.evidence.warnings.join(' ')).toMatch(/not compared.*de/);
  });
});

describe('findings', () => {
  it('builds deterministic sentences only from computed values', () => {
    const a = analyzeFixture('steady-growth', {}, 'pl');
    const f = languageFinding(a);
    expect(f).toContain('pl — "steady-growth"');
    expect(f).toContain(`Evidence strength: ${a.evidence.strength}`);
    expect(
      languageFinding(analyzeFixture('flat', { pageviews: { points: [], noData: true } })),
    ).toMatch(/no pageviews/);
    expect(buildFindings([a], null)).toHaveLength(1);
  });

  it('mentions seasonality and year-over-year when informative', () => {
    const s = languageFinding(
      analyzeFixture('seasonal', { start: '2024-01-01', end: '2025-12-31' }),
    );
    expect(s).toMatch(/Seasonal pattern: peaks in Sep/);
    const short = languageFinding(
      analyzeFixture('flat', { start: '2025-12-20', end: '2025-12-31' }),
    );
    expect(short).toMatch(/Not enough observations/);
  });
});

describe('edition-relative interpretation', () => {
  it('classifies share-of-edition change with a quotable sentence', () => {
    const faster = editionRelation(-14.6, -24.6, -35.6);
    expect(faster.relativeToEdition).toBe('declined_faster_than_edition');
    // All three quantities appear together so the sentence cannot be misread.
    expect(faster.interpretation).toBe(
      "Article views -35.6% vs the whole edition's traffic -24.6%, so the article's share of edition traffic changed -14.6%: the article did worse than its edition, so part of the change is topic-specific.",
    );
    expect(editionRelation(8, -3, 4.8).relativeToEdition).toBe('outperformed_edition');
    expect(editionRelation(-0.2, -16.3, -16.5).interpretation).toMatch(
      /moved with its edition, so the change mostly reflects edition-wide traffic/,
    );
    expect(editionRelation(null, null, null)).toEqual({
      relativeToEdition: null,
      interpretation: null,
    });
  });
});

describe('seasonally mismatched windows', () => {
  it('lower and cap evidence, and the finding carries a caution', () => {
    const a = analyzeFixture('seasonal', { start: '2025-01-01', end: '2025-12-31' });
    expect(a.evidence.warnings.some((w) => w.startsWith(SEASONAL_WINDOW_WARNING))).toBe(true);
    expect(a.evidence.warnings.join(' ')).toMatch(/--period 2y/);
    expect(a.evidence.strength).not.toBe('high');
    expect(languageFinding(a)).toMatch(/may be seasonal rather than a real shift/);
  });
});

describe('research candidates', () => {
  it('orders candidates deterministically with data-derived reasons and cautions', () => {
    const growing = analyzeFixture('steady-growth', {}, 'pl');
    const flat = analyzeFixture('flat', {}, 'cs');
    const spiky = analyzeFixture('strong-spike', {}, 'uk');
    const c = compareLanguages([spiky, flat, growing]);
    const order = c?.researchCandidates.map((r) => r.language);
    // Low-evidence (spike-driven) growth ranks last despite its large percentage.
    expect(order).toEqual(['pl', 'cs', 'uk']);
    expect(c?.researchCandidates[0]?.reasons.join(' ')).toMatch(
      /relative change \+\d+\.\d% \(rank 2 of 3\)/,
    );
    expect(c?.researchCandidates[2]?.cautions.join(' ')).toMatch(/low evidence/);
    expect(c?.researchCandidates[2]?.cautions.join(' ')).toMatch(/depends on spikes/);
    expect(c?.researchNote).toMatch(/does not measure demand/);
    expect(JSON.stringify(c?.researchCandidates)).not.toMatch(/market|winner/i);
  });

  it('flags when every language declined', () => {
    const c = compareLanguages([
      analyzeFixture('declining', {}, 'pl'),
      analyzeFixture('declining', {}, 'cs'),
    ]);
    expect(c?.researchCandidates[0]?.cautions.join(' ')).toMatch(/all compared languages declined/);
  });
});
