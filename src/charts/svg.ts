/** Shared primitives for deterministic, dependency-light SVG charts (no DOM required). */
import { scaleUtc, type ScaleLinear, type ScaleTime } from 'd3-scale';
import { formatInteger } from '../utils/numbers.js';
import { monthName } from '../utils/dates.js';

export class ChartDataError extends Error {
  override readonly name = 'ChartDataError';
}

export const FONT = 'DejaVu Sans, Arial, Helvetica, sans-serif';

/** Okabe–Ito palette: distinguishable with common colour-vision deficiencies. */
export const PALETTE = [
  '#0072B2',
  '#D55E00',
  '#009E73',
  '#CC79A7',
  '#E69F00',
  '#56B4E9',
  '#000000',
  '#F0E442',
];

export const COLORS = {
  text: '#1f2933',
  muted: '#52606d',
  grid: '#e4e7eb',
  axis: '#9aa5b1',
  reference: '#7b8794',
} as const;

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? '#0072B2';
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Fixed-precision coordinates keep output byte-for-byte deterministic. */
export function n(value: number): string {
  const r = Math.round(value * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export interface TextOptions {
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  weight?: 'normal' | 'bold';
  fill?: string;
}

export function text(x: number, y: number, content: string, opts: TextOptions = {}): string {
  return `<text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${String(opts.size ?? 11)}" text-anchor="${opts.anchor ?? 'start'}" font-weight="${opts.weight ?? 'normal'}" fill="${opts.fill ?? COLORS.text}">${escapeXml(content)}</text>`;
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width = 1,
  dash?: string,
): string {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${String(width)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

export function svgDocument(
  width: number,
  height: number,
  title: string,
  description: string,
  body: string[],
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}" role="img" aria-labelledby="chart-title chart-desc">`,
    `<title id="chart-title">${escapeXml(title)}</title>`,
    `<desc id="chart-desc">${escapeXml(description)}</desc>`,
    `<rect x="0" y="0" width="${String(width)}" height="${String(height)}" fill="#ffffff"/>`,
    ...body,
    '</svg>',
  ].join('\n');
}

export function dateToUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function timeScale(
  start: string,
  end: string,
  x0: number,
  x1: number,
): ScaleTime<number, number> {
  return scaleUtc()
    .domain([dateToUtc(start), dateToUtc(end)])
    .range([x0, x1]);
}

function tickLabel(d: Date, spanDays: number): string {
  const m = monthName(d.getUTCMonth() + 1);
  if (spanDays <= 120) return `${String(d.getUTCDate())} ${m}`;
  return `${m} ${String(d.getUTCFullYear())}`;
}

export function xAxis(
  scale: ScaleTime<number, number>,
  y: number,
  spanDays: number,
  ticks = 6,
): string[] {
  const [r0, r1] = scale.range();
  const out = [line(r0 ?? 0, y, r1 ?? 0, y, COLORS.axis)];
  for (const t of scale.ticks(ticks)) {
    const x = scale(t);
    out.push(line(x, y, x, y + 4, COLORS.axis));
    out.push(
      text(x, y + 15, tickLabel(t, spanDays), { size: 9, anchor: 'middle', fill: COLORS.muted }),
    );
  }
  return out;
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${String(Math.round(value / 100_000) / 10)}M`;
  if (abs >= 10_000) return `${String(Math.round(value / 100) / 10)}k`;
  return formatInteger(value);
}

export function yAxisWithGrid(
  scale: ScaleLinear<number, number>,
  x0: number,
  x1: number,
  ticks = 4,
  format: (v: number) => string = compactNumber,
): string[] {
  const out: string[] = [];
  for (const t of scale.ticks(ticks)) {
    const y = scale(t);
    out.push(line(x0, y, x1, y, COLORS.grid));
    out.push(text(x0 - 6, y + 3, format(t), { size: 9, anchor: 'end', fill: COLORS.muted }));
  }
  return out;
}
