import type { Comparison, LanguageAnalysis } from '../types/analysis.js';
import { SEASONAL_WINDOW_WARNING } from './evidence.js';
import { monthName } from '../utils/dates.js';
import { formatViews, formatSignedPercent } from '../utils/numbers.js';

/**
 * Deterministic finding sentences built only from computed values. The agent and the PDF
 * quote these instead of composing numbers themselves.
 */
export function languageFinding(l: LanguageAnalysis): string {
  const head = `${l.language} — "${l.articleTitle}"`;
  if (l.status === 'no_data' || !l.metrics) {
    return `${head}: no pageviews were recorded in the period; no trend can be assessed.`;
  }
  const m = l.metrics;
  const parts = [
    `${head}: average daily views ${formatViews(m.baseline.averageDailyViews)} → ${formatViews(m.latest.averageDailyViews)} (${formatSignedPercent(m.percentChange)}; ${m.baseline.label} vs ${m.latest.label}).`,
  ];
  const t = l.trend;
  if (t.status === 'ok') {
    const unit = t.granularity ?? 'period';
    parts.push(
      `Trend: ${t.direction ?? 'n/a'} (${formatSignedPercent(t.normalizedSlope, 2)} per ${unit}, R² ${String(t.rSquared ?? 'n/a')}, Spearman ρ ${String(t.spearmanCorrelation ?? 'n/a')}; ${t.confidence ?? 'low'} confidence).`,
    );
  } else {
    parts.push(t.message ?? 'Not enough observations for a reliable long-term trend.');
  }
  const yoy = l.seasonality.yearOverYear;
  const yoyIsBaseline =
    yoy !== null &&
    yoy.previousWindow.start === m.baseline.start &&
    yoy.currentWindow.end === m.latest.end;
  if (yoy?.percentChange != null && !yoyIsBaseline) {
    parts.push(
      `Year-over-year: ${formatSignedPercent(yoy.percentChange)} (${String(yoy.monthsUp)} of ${String(yoy.monthsCompared)} matching months higher).`,
    );
  }
  if (l.seasonality.detected && l.seasonality.peakMonth !== null) {
    parts.push(
      `Seasonal pattern: peaks in ${monthName(l.seasonality.peakMonth)}, lowest in ${monthName(l.seasonality.troughMonth ?? 1)}.`,
    );
  }
  if (l.outliers.influence) parts.push(l.outliers.influence.summary);
  if (l.evidence.warnings.some((w) => w.startsWith(SEASONAL_WINDOW_WARNING))) {
    parts.push(
      'Caution: the compared windows cover different seasons, so this change may be seasonal rather than a real shift.',
    );
  }
  parts.push(`Evidence strength: ${l.evidence.strength}.`);
  return parts.join(' ');
}

export function buildFindings(
  languages: readonly LanguageAnalysis[],
  comparison: Comparison | null,
): string[] {
  return [...languages.map(languageFinding), ...(comparison?.highlights ?? [])];
}

export const LIMITATIONS: readonly string[] = [
  'Pageviews count page loads, not unique users; one person can generate many views.',
  'Wikipedia interest is not market demand, purchase intent, revenue potential or willingness to pay.',
  'News, holidays, school terms, media coverage or links from other sites can cause temporary spikes.',
  'Language editions have very different audience sizes; compare relative growth, not only absolute views.',
  'Article quality, length, renaming and search-engine placement differ between languages and affect views.',
  'Days with zero views are omitted by the API and counted as missing unless --missing-as-zero is set.',
  'Only "user" agent traffic is counted by default; Wikimedia bot filtering is heuristic and imperfect.',
  'Metrics are descriptive; no statistical significance test or forecast is performed.',
];
