import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderCharts, type RenderedChart } from '../charts/index.js';
import { analysisResultSchema } from '../schemas/output.js';
import type { AnalysisResult } from '../types/analysis.js';
import type { ReportContent } from '../types/report.js';
import { countPdfPages, renderPdf } from './pdf.js';
import { buildReportContent, validateForReport } from './template.js';

export interface ArtifactOptions {
  directory: string;
  charts: boolean;
  report: boolean;
  /** Path prefix used in the JSON for artifact paths (relative paths keep output portable). */
  displayBase?: string;
}

/** Charts that fit a one-page report, in order of usefulness. */
function reportCharts(charts: readonly RenderedChart[]): RenderedChart[] {
  const byKind = new Map(charts.map((c) => [c.kind, c]));
  const preferred = byKind.has('normalized')
    ? ['normalized', 'comparison']
    : ['trend', 'comparison'];
  return preferred.flatMap((k) => {
    const c = byKind.get(k as RenderedChart['kind']);
    return c ? [c] : [];
  });
}

/**
 * Render a PDF that is guaranteed to be one page: if content overflows, drop charts, then
 * shorten lists, and re-render.
 */
export async function renderOnePagePdf(content: ReportContent): Promise<Buffer> {
  const attempts: ReportContent[] = [
    content,
    { ...content, charts: content.charts.slice(0, 1) },
    {
      ...content,
      charts: content.charts.slice(0, 1),
      keyFindings: content.keyFindings.slice(0, 4),
      limitations: content.limitations.slice(0, 3),
      evidence: { ...content.evidence, points: content.evidence.points.slice(0, 3) },
    },
    {
      ...content,
      charts: [],
      keyFindings: content.keyFindings.slice(0, 4),
      limitations: content.limitations.slice(0, 3),
    },
  ];
  let last: Buffer | null = null;
  for (const attempt of attempts) {
    last = await renderPdf(attempt);
    if (countPdfPages(last) === 1) return last;
  }
  if (!last) throw new Error('PDF rendering produced no output.');
  return last;
}

/**
 * Write analysis.json, SVG charts and the PDF report. Returns the result with its `artifacts`
 * section filled in (and chart warnings appended). The report is only built from a result
 * that passes schema and consistency validation.
 */
export async function writeArtifacts(
  input: unknown,
  options: ArtifactOptions,
): Promise<AnalysisResult> {
  const dir = options.directory;
  const display = (file: string): string =>
    path.join(options.displayBase ?? dir, path.relative(dir, file)).replaceAll('\\', '/');
  await mkdir(dir, { recursive: true });

  const result = validateForReport(input);
  const warnings = [...result.warnings];
  const chartEntries: AnalysisResult['artifacts']['charts'] = [];
  let rendered: RenderedChart[] = [];
  if (options.charts || options.report) {
    const out = renderCharts(result);
    rendered = out.charts;
    warnings.push(...out.warnings);
  }
  if (options.charts) {
    await mkdir(path.join(dir, 'charts'), { recursive: true });
    for (const chart of rendered) {
      const file = path.join(dir, 'charts', chart.fileName);
      await writeFile(file, chart.svg, 'utf8');
      chartEntries.push({ kind: chart.kind, path: display(file), title: chart.title });
    }
  }
  let reportPath: string | null = null;
  if (options.report) {
    const content = buildReportContent(
      result,
      reportCharts(rendered).map((c) => ({ title: c.title, svg: c.svg })),
    );
    const pdf = await renderOnePagePdf(content);
    const file = path.join(dir, 'report.pdf');
    await writeFile(file, pdf);
    reportPath = display(file);
  }
  const analysisFile = path.join(dir, 'analysis.json');
  const final = analysisResultSchema.parse({
    ...result,
    warnings: [...new Set(warnings)],
    artifacts: {
      directory: display(dir),
      analysis: display(analysisFile),
      charts: chartEntries,
      report: reportPath,
    },
  });
  await writeFile(analysisFile, `${JSON.stringify(final, null, 2)}\n`, 'utf8');
  return final;
}
