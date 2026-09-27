import { describe, expect, it } from '@jest/globals';
import { compareLanguages } from '../../src/analysis/comparison.js';
import { renderComparisonChart } from '../../src/charts/comparison-chart.js';
import { renderNormalizedChart } from '../../src/charts/normalized-chart.js';
import { ChartDataError, escapeXml, n } from '../../src/charts/svg.js';
import { renderTrendChart } from '../../src/charts/trend-chart.js';
import { analyzeFixture } from '../helpers/analysis.js';
import { FIXTURE_END, FIXTURE_START } from '../helpers/fixtures.js';

const period = { start: FIXTURE_START, end: FIXTURE_END };
const pl = analyzeFixture('steady-growth', {}, 'pl');
const uk = analyzeFixture('strong-spike', {}, 'uk');
const comparison = compareLanguages([pl, uk]);

function isWellFormedSvg(svg: string): boolean {
  return (
    svg.startsWith('<svg') &&
    svg.trimEnd().endsWith('</svg>') &&
    !svg.includes('NaN') &&
    !svg.includes('undefined')
  );
}

describe('trend chart', () => {
  const svg = renderTrendChart([pl, uk], period, 'Test topic');

  it('is well-formed, labelled and accessible', () => {
    expect(isWellFormedSvg(svg)).toBe(true);
    expect(svg).toContain('<title id="chart-title">Daily Wikipedia pageviews: Test topic</title>');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('pl — steady-growth');
    expect(svg).toContain('30-day rolling average');
    expect(svg).toMatch(/Jan 2025/);
  });

  it('annotates off-scale spikes with the exact peak value', () => {
    expect(svg).toMatch(/peak [\d,]+ on 2025-04-1\d \(off scale\)/);
  });

  it('is deterministic', () => {
    expect(renderTrendChart([pl, uk], period, 'Test topic')).toBe(svg);
  });

  it('fails gracefully on empty data', () => {
    const empty = analyzeFixture('flat', { pageviews: { points: [], noData: true } });
    expect(() => renderTrendChart([empty], period, 'x')).toThrow(ChartDataError);
  });
});

describe('normalized chart', () => {
  if (!comparison) throw new Error('comparison expected');
  const svg = renderNormalizedChart(comparison, period, 'Test topic');

  it('shows the baseline=100 reference and the latest-window index per language', () => {
    expect(isWellFormedSvg(svg)).toBe(true);
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('100 = each language');
    const finalPl = Math.round(comparison.normalizedIndex.final['pl'] ?? 0);
    expect(svg).toContain(`pl: ${String(finalPl)} (latest window)`);
    expect(svg).toContain('not absolute popularity');
  });

  it('fails gracefully when no index data exists', () => {
    expect(() =>
      renderNormalizedChart(
        { ...comparison, normalizedIndex: { ...comparison.normalizedIndex, series: {} } },
        period,
        'x',
      ),
    ).toThrow(ChartDataError);
  });
});

describe('comparison chart', () => {
  const svg = renderComparisonChart([pl, uk], 'Test topic');

  it('labels percentage changes and absolute averages separately', () => {
    expect(isWellFormedSvg(svg)).toBe(true);
    expect(svg).toContain('baseline → latest');
    expect(svg).toContain('Average views/day (absolute)');
    expect(svg).toMatch(/\+\d+\.\d% baseline → latest/);
  });

  it('fails gracefully without metrics', () => {
    const empty = analyzeFixture('flat', { pageviews: { points: [], noData: true } });
    expect(() => renderComparisonChart([empty], 'x')).toThrow(ChartDataError);
  });
});

describe('svg helpers', () => {
  it('escapes text and formats numbers deterministically', () => {
    expect(escapeXml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    expect(n(1.23456)).toBe('1.23');
    expect(n(-0.001)).toBe('0');
  });
});
