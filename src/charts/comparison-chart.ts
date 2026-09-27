import { scaleLinear } from 'd3-scale';
import type { LanguageAnalysis } from '../types/analysis.js';
import { formatViews, formatSignedPercent } from '../utils/numbers.js';
import { ChartDataError, colorFor, COLORS, line, n, svgDocument, text } from './svg.js';

const WIDTH = 760;
const ROW = 46;
const M = { top: 80, left: 150, right: 190, bottom: 20 };

interface Row {
  language: string;
  color: string;
  bars: { label: string; value: number | null; opacity: number }[];
  annotation: string;
}

/**
 * Period comparison chart: per language, % change baseline → latest window and, when there
 * are ≥24 complete months, year-over-year % change of matching months. Absolute averages are
 * printed as text so relative and absolute information are never visually conflated.
 */
export function renderComparisonChart(
  languages: readonly LanguageAnalysis[],
  topicLabel: string,
  order: readonly string[] = languages.map((l) => l.language),
): string {
  const rows: Row[] = languages
    .filter((l) => l.metrics !== null)
    .map((l) => {
      const m = l.metrics;
      const yoyInfo = l.seasonality.yearOverYear;
      // Skip the YoY bar when it is the same comparison as baseline → latest.
      const yoy =
        yoyInfo &&
        m &&
        yoyInfo.previousWindow.start === m.baseline.start &&
        yoyInfo.currentWindow.end === m.latest.end
          ? null
          : yoyInfo;
      return {
        language: l.language,
        color: colorFor(Math.max(0, order.indexOf(l.language))),
        bars: [
          { label: 'baseline → latest', value: m?.percentChange ?? null, opacity: 1 },
          ...(yoy ? [{ label: 'year over year', value: yoy.percentChange, opacity: 0.55 }] : []),
        ],
        annotation: m
          ? `${formatViews(m.baseline.averageDailyViews)} → ${formatViews(m.latest.averageDailyViews)} views/day`
          : '',
      };
    });
  if (rows.length === 0) throw new ChartDataError('No metrics to compare.');

  const values = rows.flatMap((r) => r.bars.flatMap((b) => (b.value === null ? [] : [b.value])));
  const extent = Math.max(10, ...values.map((v) => Math.abs(v)));
  const hasNegative = values.some((v) => v < 0);
  const x0 = M.left;
  const x1 = WIDTH - M.right;
  const x = scaleLinear()
    .domain([hasNegative ? -extent * 1.1 : 0, extent * 1.1])
    .range([x0, x1])
    .nice();
  const zero = x(0);
  const height = M.top + rows.length * ROW + M.bottom;

  const body: string[] = [
    text(20, 20, `Change in average daily views: ${topicLabel}`, { size: 14, weight: 'bold' }),
    text(
      20,
      36,
      'Solid: baseline window → latest window · Light (if shown): last 12 months vs previous 12 matching months',
      { size: 10, fill: COLORS.muted },
    ),
    text(WIDTH - M.right + 12, M.top - 26, 'Average views/day (absolute)', {
      size: 9,
      weight: 'bold',
      fill: COLORS.muted,
    }),
    text(x0, M.top - 26, 'Change in average daily views (%)', {
      size: 9,
      weight: 'bold',
      fill: COLORS.muted,
    }),
  ];
  for (const t of x.ticks(5)) {
    body.push(line(x(t), M.top - 4, x(t), height - M.bottom, COLORS.grid));
    body.push(
      text(x(t), M.top - 8, `${String(t)}%`, { size: 9, anchor: 'middle', fill: COLORS.muted }),
    );
  }
  body.push(line(zero, M.top - 4, zero, height - M.bottom, COLORS.axis, 1));

  rows.forEach((r, i) => {
    const top = M.top + i * ROW;
    body.push(text(20, top + 20, r.language, { size: 12, weight: 'bold', fill: r.color }));
    const barH = r.bars.length > 1 ? 14 : 20;
    r.bars.forEach((b, j) => {
      const by = top + 6 + j * (barH + 3);
      if (b.value === null) {
        body.push(
          text(zero + 4, by + barH - 4, `${b.label}: n/a`, { size: 9, fill: COLORS.muted }),
        );
        return;
      }
      const xa = Math.min(zero, x(b.value));
      const w = Math.max(1, Math.abs(x(b.value) - zero));
      body.push(
        `<rect x="${n(xa)}" y="${n(by)}" width="${n(w)}" height="${String(barH)}" fill="${r.color}" fill-opacity="${String(b.opacity)}"/>`,
      );
      const labelX = b.value >= 0 ? xa + w + 4 : xa - 4;
      body.push(
        text(labelX, by + barH - 4, `${formatSignedPercent(b.value)} ${b.label}`, {
          size: 9,
          anchor: b.value >= 0 ? 'start' : 'end',
        }),
      );
    });
    body.push(text(WIDTH - M.right + 12, top + 20, r.annotation, { size: 10, fill: COLORS.muted }));
  });

  return svgDocument(
    WIDTH,
    height,
    `Change in average daily views: ${topicLabel}`,
    rows
      .map(
        (r) =>
          `${r.language}: ${r.bars.map((b) => `${b.label} ${formatSignedPercent(b.value)}`).join(', ')}`,
      )
      .join('; '),
    body,
  );
}
