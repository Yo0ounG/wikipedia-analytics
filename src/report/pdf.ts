import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import type { ReportContent } from '../types/report.js';

const require = createRequire(import.meta.url);

/** DejaVu Sans covers Latin, Cyrillic and Greek, so non-English article titles render correctly. */
export const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
export const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const PAGE = { width: 595.28, height: 841.89, margin: 36 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const FOOTER_SPACE = 30;
const INK = '#1f2933';
const MUTED = '#52606d';
const ACCENT = '#0072B2';
const RULE = '#d9dee4';

/**
 * Ligatures off: PDFKit writes no Unicode mapping for ligature glyphs, so with ligatures on the
 * text "Traffic" would be copied/searched as "Trafc" (see src/types/pdfkit-features.d.ts).
 */
const NO_LIGATURES = { liga: false, clig: false };

type TextOpts = Omit<PDFKit.Mixins.TextOptions, 'features'>;

function opts(options: TextOpts): PDFKit.Mixins.FeatureToggleTextOptions {
  return { ...options, features: NO_LIGATURES };
}

/** Section titles, also written as PDF bookmarks so the report is navigable and checkable. */
export const REPORT_SECTIONS = [
  'Key findings',
  'Charts',
  'Core metrics',
  'Evidence strength',
  'Limitations',
] as const;

function svgSize(svg: string): { width: number; height: number } {
  const m = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  return { width: Number(m?.[1] ?? 760), height: Number(m?.[2] ?? 300) };
}

class Layout {
  y = PAGE.margin;
  constructor(readonly doc: PDFKit.PDFDocument) {}

  get remaining(): number {
    return PAGE.height - PAGE.margin - FOOTER_SPACE - this.y;
  }

  heading(label: string, suffix = ''): void {
    this.doc.outline.addItem(label);
    this.y += 6;
    this.doc
      .font('Bold')
      .fontSize(10)
      .fillColor(ACCENT)
      .text(
        `${label}${suffix}`.toUpperCase(),
        PAGE.margin,
        this.y,
        opts({
          width: CONTENT_WIDTH,
          characterSpacing: 0.5,
        }),
      );
    this.y = this.doc.y + 3;
  }

  paragraph(value: string, size = 8.5, color = INK, font: 'Regular' | 'Bold' = 'Regular'): void {
    this.doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(
        value,
        PAGE.margin,
        this.y,
        opts({
          width: CONTENT_WIDTH,
          lineGap: 1,
        }),
      );
    this.y = this.doc.y + 2;
  }

  bullets(items: readonly string[], size = 8.5): void {
    for (const item of items) {
      this.doc.font('Regular').fontSize(size).fillColor(INK);
      this.doc.text('•', PAGE.margin, this.y, opts({ width: 10 }));
      this.doc.text(
        item,
        PAGE.margin + 10,
        this.y,
        opts({ width: CONTENT_WIDTH - 10, lineGap: 1 }),
      );
      this.y = this.doc.y + 2;
    }
  }

  heightOfBullets(items: readonly string[], size = 8.5): number {
    this.doc.font('Regular').fontSize(size);
    return items.reduce(
      (h, item) =>
        h + this.doc.heightOfString(item, opts({ width: CONTENT_WIDTH - 10, lineGap: 1 })) + 2,
      0,
    );
  }
}

function drawTable(layout: Layout, content: ReportContent): void {
  const { doc } = layout;
  const cols = [
    { key: 'language', title: 'Lang', width: 34 },
    { key: 'article', title: 'Article', width: 96 },
    { key: 'averageDaily', title: 'Avg/day', width: 52 },
    { key: 'baselineToLatest', title: 'Baseline → latest', width: 82 },
    { key: 'change', title: 'Change', width: 50 },
    { key: 'yearOverYear', title: 'YoY', width: 46 },
    { key: 'trend', title: 'Trend (log-linear)', width: 111 },
    { key: 'evidence', title: 'Evidence', width: 52 },
  ] as const;
  const rowHeight = 13;
  let x = PAGE.margin;
  doc.font('Bold').fontSize(7.5).fillColor(MUTED);
  for (const c of cols) {
    doc.text(
      c.title,
      x + 2,
      layout.y,
      opts({
        width: c.width - 4,
        height: rowHeight - 2,
        ellipsis: true,
      }),
    );
    x += c.width;
  }
  layout.y += rowHeight;
  doc
    .moveTo(PAGE.margin, layout.y - 3)
    .lineTo(PAGE.margin + CONTENT_WIDTH, layout.y - 3)
    .strokeColor(RULE)
    .lineWidth(0.6)
    .stroke();
  for (const row of content.metricsTable) {
    x = PAGE.margin;
    doc.font('Regular').fontSize(7.5).fillColor(INK);
    for (const c of cols) {
      doc.text(
        row[c.key],
        x + 2,
        layout.y,
        opts({
          width: c.width - 4,
          height: rowHeight - 2,
          ellipsis: true,
        }),
      );
      x += c.width;
    }
    layout.y += rowHeight;
  }
  layout.y += 2;
}

/** Render the report content to a one-page A4 PDF buffer. */
export async function renderPdf(content: ReportContent): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    autoFirstPage: true,
    info: {
      Title: content.title,
      Subject: 'Wikipedia pageview interest analysis',
      Keywords: 'Wikipedia, Wikimedia, pageviews, interest analysis',
      Creator: 'wikipedia-interest-analysis',
      Producer: 'wikipedia-interest-analysis (PDFKit)',
      CreationDate: new Date(content.generatedAt),
    },
  });
  doc.registerFont('Regular', FONT_REGULAR);
  doc.registerFont('Bold', FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });

  const layout = new Layout(doc);
  doc
    .font('Bold')
    .fontSize(16)
    .fillColor(INK)
    .text(content.title, PAGE.margin, layout.y, opts({ width: CONTENT_WIDTH }));
  layout.y = doc.y + 1;
  layout.paragraph(content.subtitle, 8.5, MUTED);
  for (const m of content.meta) {
    doc
      .font('Bold')
      .fontSize(8)
      .fillColor(INK)
      .text(`${m.label}: `, PAGE.margin, layout.y, opts({ continued: true }));
    doc.font('Regular').text(m.value, opts({ width: CONTENT_WIDTH }));
    layout.y = doc.y + 1;
  }

  layout.heading(REPORT_SECTIONS[0]);
  layout.bullets(content.keyFindings);

  // Fixed-size sections that follow the charts.
  const tableHeight = 13 * (content.metricsTable.length + 1) + 30;
  const tailHeight =
    tableHeight +
    layout.heightOfBullets(content.evidence.points, 8) +
    layout.heightOfBullets(content.limitations, 7.5) +
    45;

  layout.heading(REPORT_SECTIONS[1]);
  // Share the free height between charts so the report always stays on one page.
  const chartSpace = layout.remaining - tailHeight;
  const fitting = Math.max(1, Math.min(content.charts.length, Math.floor(chartSpace / 110)));
  const perChart = Math.min(320, chartSpace / fitting - 4);
  for (const chart of content.charts.slice(0, fitting)) {
    const size = svgSize(chart.svg);
    let width = CONTENT_WIDTH;
    let height = (size.height / size.width) * width;
    const available = Math.min(perChart, layout.remaining - tailHeight);
    if (available < 90) break; // not enough room: keep the report on one page
    if (height > available) {
      height = available;
      width = (size.width / size.height) * height;
    }
    SVGtoPDF(doc, chart.svg, PAGE.margin, layout.y, {
      width,
      height,
      preserveAspectRatio: 'xMinYMin meet',
      fontCallback: (_family, bold) => (bold ? 'Bold' : 'Regular'),
      warningCallback: () => undefined,
    });
    layout.y += height + 4;
  }

  layout.heading(REPORT_SECTIONS[2]);
  drawTable(layout, content);

  layout.heading(REPORT_SECTIONS[3], `: ${content.evidence.strength}`);
  layout.bullets(content.evidence.points, 8);

  layout.heading(REPORT_SECTIONS[4]);
  layout.bullets(content.limitations, 7.5);

  const footerY = PAGE.height - PAGE.margin - 14;
  doc
    .moveTo(PAGE.margin, footerY - 4)
    .lineTo(PAGE.margin + CONTENT_WIDTH, footerY - 4)
    .strokeColor(RULE)
    .lineWidth(0.6)
    .stroke();
  doc
    .font('Regular')
    .fontSize(7)
    .fillColor(MUTED)
    .text(
      `${content.dataSource} Generated ${content.generatedAt.slice(0, 10)}.`,
      PAGE.margin,
      footerY,
      opts({ width: CONTENT_WIDTH, lineBreak: false, ellipsis: true, height: 10 }),
    );
  doc.end();
  return done;
}

/** Number of pages in a PDFKit-produced buffer. */
export function countPdfPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}
