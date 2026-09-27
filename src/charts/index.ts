import type { AnalysisResult, LanguageAnalysis } from '../types/analysis.js';
import { renderComparisonChart } from './comparison-chart.js';
import { renderNormalizedChart } from './normalized-chart.js';
import { ChartDataError } from './svg.js';
import { renderTrendChart } from './trend-chart.js';

export { ChartDataError } from './svg.js';

export type ChartKind = 'trend' | 'normalized' | 'comparison';

export interface RenderedChart {
  kind: ChartKind;
  title: string;
  fileName: string;
  svg: string;
}

/**
 * Render every applicable chart from an analysis result. Charts whose data is unavailable
 * (e.g. the normalised chart for a single language) are skipped and reported as warnings.
 */
export function renderCharts(result: AnalysisResult): {
  charts: RenderedChart[];
  warnings: string[];
} {
  const order = result.request.languages;
  const langs = order
    .map((l) => result.languages[l])
    .filter((l): l is LanguageAnalysis => l !== undefined);
  const label = result.topic.label ?? result.topic.query ?? result.request.qid;
  const charts: RenderedChart[] = [];
  const warnings: string[] = [];
  const attempt = (kind: ChartKind, title: string, render: () => string): void => {
    try {
      charts.push({ kind, title, fileName: `${kind}.svg`, svg: render() });
    } catch (error) {
      if (!(error instanceof ChartDataError)) throw error;
      warnings.push(`${title} chart skipped: ${error.message}`);
    }
  };
  const comparison = result.comparison;
  if (comparison) {
    attempt('normalized', 'Relative growth index', () =>
      renderNormalizedChart(comparison, result.period, label, order),
    );
  }
  attempt('comparison', 'Change in average daily views', () =>
    renderComparisonChart(langs, label, order),
  );
  attempt('trend', 'Daily pageviews', () => renderTrendChart(langs, result.period, label, order));
  return { charts, warnings };
}
