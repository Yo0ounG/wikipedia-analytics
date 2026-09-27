import { scaleLinear } from 'd3-scale';
import { line as d3line } from 'd3-shape';
import { calculateRollingAverage } from '../data/aggregate.js';
import type { LanguageAnalysis } from '../types/analysis.js';
import { daysBetweenInclusive } from '../utils/dates.js';
import { formatInteger } from '../utils/numbers.js';
import {
  ChartDataError,
  colorFor,
  COLORS,
  dateToUtc,
  n,
  svgDocument,
  text,
  timeScale,
  xAxis,
  yAxisWithGrid,
} from './svg.js';

const WIDTH = 760;
const PANEL_HEIGHT = 150;
const MARGIN = { top: 44, left: 58, right: 20, bottom: 26 };
const ROLLING_WINDOW = 30;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

/**
 * Small-multiple trend chart: one panel per language with daily views (thin) and a trailing
 * 30-day rolling average (bold). Each panel has its own y-scale because editions differ in
 * size; extreme spikes are clipped at the 99.5th percentile and annotated with their value.
 */
export function renderTrendChart(
  languages: readonly LanguageAnalysis[],
  period: { start: string; end: string },
  topicLabel: string,
  order: readonly string[] = languages.map((l) => l.language),
): string {
  const panels = languages.filter((l) => l.daily.length > 0);
  if (panels.length === 0) throw new ChartDataError('No daily pageview data to chart.');
  const height = MARGIN.top + panels.length * (PANEL_HEIGHT + MARGIN.bottom) + 10;
  const x0 = MARGIN.left;
  const x1 = WIDTH - MARGIN.right;
  const x = timeScale(period.start, period.end, x0, x1);
  const spanDays = daysBetweenInclusive(period.start, period.end);
  const body: string[] = [
    text(x0, 20, `Daily Wikipedia pageviews: ${topicLabel}`, { size: 14, weight: 'bold' }),
    text(
      x0,
      36,
      `Thin line: daily views · Bold line: centred ${String(ROLLING_WINDOW)}-day rolling average · Separate y-axis per language`,
      { size: 10, fill: COLORS.muted },
    ),
  ];

  panels.forEach((l, i) => {
    const top = MARGIN.top + i * (PANEL_HEIGHT + MARGIN.bottom) + 16;
    const bottom = top + PANEL_HEIGHT - 16;
    const values = l.daily.map((p) => p.views);
    const sorted = [...values].sort((a, b) => a - b);
    const rolling = calculateRollingAverage(l.daily, period.start, period.end, {
      window: ROLLING_WINDOW,
      align: 'center',
    });
    const maxRolling = Math.max(0, ...rolling.map((r) => r.value ?? 0));
    const cap = Math.max(quantile(sorted, 0.995), maxRolling, 1) * 1.1;
    const y = scaleLinear().domain([0, cap]).range([bottom, top]).nice();
    const yMax = y.domain()[1] ?? cap;
    const color = colorFor(Math.max(0, order.indexOf(l.language)));
    const dailyPath = d3line<{ date: string; views: number }>()
      .x((p) => x(dateToUtc(p.date)))
      .y((p) => y(Math.min(p.views, yMax)))
      .defined(
        (p, idx, arr) =>
          idx === 0 || daysBetweenInclusive(arr[idx - 1]?.date ?? p.date, p.date) <= 2,
      )
      .digits(2)(l.daily);
    const rollingPath = d3line<{ date: string; value: number | null }>()
      .defined((r) => r.value !== null)
      .x((r) => x(dateToUtc(r.date)))
      .y((r) => y(r.value ?? 0))
      .digits(2)(rolling);

    body.push(
      text(x0, top - 6, `${l.language} — ${l.articleTitle}`, {
        size: 11,
        weight: 'bold',
        fill: color,
      }),
    );
    body.push(...yAxisWithGrid(y, x0, x1));
    body.push(
      `<path d="${dailyPath ?? ''}" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="0.8"/>`,
    );
    body.push(`<path d="${rollingPath ?? ''}" fill="none" stroke="${color}" stroke-width="2"/>`);
    const peak = l.metrics?.peak;
    if (peak && peak.views > yMax) {
      const px = x(dateToUtc(peak.date));
      body.push(`<circle cx="${n(px)}" cy="${n(top)}" r="2.5" fill="${color}"/>`);
      body.push(
        text(
          Math.min(px + 5, x1 - 150),
          top + 10,
          `peak ${formatInteger(peak.views)} on ${peak.date} (off scale)`,
          { size: 9, fill: COLORS.muted },
        ),
      );
    }
    body.push(...xAxis(x, bottom, spanDays));
  });

  return svgDocument(
    WIDTH,
    height,
    `Daily Wikipedia pageviews: ${topicLabel}`,
    `Daily pageviews and ${String(ROLLING_WINDOW)}-day rolling average for ${panels.map((p) => p.language).join(', ')}, ${period.start} to ${period.end}.`,
    body,
  );
}
