import { scaleLinear } from 'd3-scale';
import { line as d3line } from 'd3-shape';
import type { Comparison } from '../types/analysis.js';
import { addDays, daysBetweenInclusive, lastDayOfMonth } from '../utils/dates.js';
import { round } from '../utils/numbers.js';
import {
  ChartDataError,
  colorFor,
  COLORS,
  dateToUtc,
  line,
  svgDocument,
  text,
  timeScale,
  xAxis,
  yAxisWithGrid,
} from './svg.js';

const WIDTH = 760;
const HEIGHT = 330;
const M = { top: 50, left: 58, right: 150, bottom: 34 };

/** Midpoint date of a month (`YYYY-MM`) or week (week-start ISO date). */
function periodDate(period: string, granularity: 'month' | 'week'): string {
  return granularity === 'month' ? `${period}-15` : addDays(period, 3);
}

/**
 * Normalised growth index chart (100 = each language's baseline-window average).
 * Shows relative growth only; absolute audience sizes are deliberately not encoded.
 */
export function renderNormalizedChart(
  comparison: Comparison,
  period: { start: string; end: string },
  topicLabel: string,
  order: readonly string[] = comparison.languages,
): string {
  const { granularity, series, final } = comparison.normalizedIndex;
  const langs = comparison.languages.filter((l) => (series[l] ?? []).some((p) => p.index !== null));
  if (langs.length === 0) throw new ChartDataError('No normalised index data to chart.');

  const all = langs.flatMap((l) =>
    (series[l] ?? []).flatMap((p) => (p.index === null ? [] : [p.index])),
  );
  const lo = Math.min(100, ...all);
  const hi = Math.max(100, ...all);
  const pad = Math.max(5, (hi - lo) * 0.08);
  const x0 = M.left;
  const x1 = WIDTH - M.right;
  const y = scaleLinear()
    .domain([Math.max(0, lo - pad), hi + pad])
    .range([HEIGHT - M.bottom, M.top])
    .nice();
  const firstPeriod = periodDate(
    langs.map((l) => series[l]?.[0]?.period ?? '').sort()[0] ?? period.start,
    granularity,
  );
  const start = firstPeriod < period.start ? firstPeriod : period.start;
  const x = timeScale(start, period.end, x0, x1);

  const body: string[] = [
    text(x0, 20, `Relative growth index: ${topicLabel}`, { size: 14, weight: 'bold' }),
    text(
      x0,
      36,
      `100 = each language's baseline-window average daily views · ${granularity}ly averages · not absolute popularity`,
      { size: 10, fill: COLORS.muted },
    ),
    ...yAxisWithGrid(y, x0, x1, 5, (v) => String(round(v, 0))),
    line(x0, y(100), x1, y(100), COLORS.reference, 1, '4 3'),
  ];

  const labels: { y: number; text: string; color: string }[] = [];
  langs.forEach((lang) => {
    const color = colorFor(Math.max(0, order.indexOf(lang)));
    const points = series[lang] ?? [];
    const path = d3line<{ period: string; index: number | null }>()
      .defined((p) => p.index !== null)
      .x((p) => x(dateToUtc(periodDate(p.period, granularity))))
      .y((p) => y(p.index ?? 100))
      .digits(2)(points);
    body.push(`<path d="${path ?? ''}" fill="none" stroke="${color}" stroke-width="2"/>`);
    const last = [...points].reverse().find((p) => p.index !== null);
    const f = final[lang];
    labels.push({
      y: y(last?.index ?? 100),
      text: `${lang}: ${f === null || f === undefined ? 'n/a' : String(round(f, 0))} (latest window)`,
      color,
    });
  });

  // Keep legend labels from overlapping.
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1];
    const cur = labels[i];
    if (prev && cur && cur.y - prev.y < 13) cur.y = prev.y + 13;
  }
  for (const l of labels)
    body.push(text(x1 + 8, l.y + 3, l.text, { size: 10, weight: 'bold', fill: l.color }));

  const end = granularity === 'month' ? lastDayOfMonth(period.end.slice(0, 7)) : period.end;
  body.push(...xAxis(x, HEIGHT - M.bottom, daysBetweenInclusive(start, end)));
  return svgDocument(
    WIDTH,
    HEIGHT,
    `Relative growth index: ${topicLabel}`,
    `Normalised growth index (baseline = 100) for ${langs.join(', ')}. Latest-window values: ${langs.map((l) => `${l} ${String(final[l] ?? 'n/a')}`).join(', ')}.`,
    body,
  );
}
