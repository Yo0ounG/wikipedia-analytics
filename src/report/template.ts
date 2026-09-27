import { analysisResultSchema } from '../schemas/output.js';
import type { AnalysisResult, LanguageAnalysis } from '../types/analysis.js';
import type { ReportChart, ReportContent, ReportMetricRow } from '../types/report.js';
import { formatViews, formatSignedPercent } from '../utils/numbers.js';

export class ReportValidationError extends Error {
  override readonly name = 'ReportValidationError';
}

/** Tolerance for cross-checking derived values (rounding to 2 decimals). */
const EPSILON = 0.02;

/**
 * Refuse to build a report from an analysis that is invalid or internally inconsistent,
 * so a PDF can never present numbers the analysis does not support.
 */
export function validateForReport(input: unknown): AnalysisResult {
  const parsed = analysisResultSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ReportValidationError(
      `Analysis JSON does not match the expected schema (${first ? `${first.path.join('.')}: ${first.message}` : 'unknown issue'}).`,
    );
  }
  const result = parsed.data;
  const analyzed = Object.values(result.languages).filter((l) => l.metrics !== null);
  if (analyzed.length === 0) {
    throw new ReportValidationError('Analysis contains no language with usable pageview data.');
  }
  for (const l of analyzed) {
    const m = l.metrics;
    if (!m) continue;
    const expectedChange = m.latest.averageDailyViews - m.baseline.averageDailyViews;
    if (Math.abs(expectedChange - m.absoluteChange) > EPSILON) {
      throw new ReportValidationError(`Inconsistent absolute change for ${l.language}.`);
    }
    if (m.percentChange !== null && m.baseline.averageDailyViews > 0) {
      const pct = (expectedChange / m.baseline.averageDailyViews) * 100;
      if (Math.abs(pct - m.percentChange) > Math.max(EPSILON, Math.abs(pct) * 1e-3)) {
        throw new ReportValidationError(`Inconsistent percentage change for ${l.language}.`);
      }
    }
    const index = result.comparison?.normalizedIndex.final[l.language];
    if (
      index != null &&
      m.percentChange !== null &&
      Math.abs(index - (100 + m.percentChange)) > EPSILON
    ) {
      throw new ReportValidationError(
        `Normalised index for ${l.language} disagrees with its percentage change.`,
      );
    }
  }
  return result;
}

function trendCell(l: LanguageAnalysis): string {
  const t = l.trend;
  if (t.status !== 'ok') return 'insufficient data';
  return `${t.direction ?? 'n/a'} ${formatSignedPercent(t.normalizedSlope, 1)}/${t.granularity === 'week' ? 'wk' : 'mo'} · ${t.confidence ?? 'low'}`;
}

function metricRow(l: LanguageAnalysis): ReportMetricRow {
  const m = l.metrics;
  return {
    language: l.language,
    article: l.articleTitle,
    averageDaily: m ? formatViews(m.averageDailyViews) : 'n/a',
    baselineToLatest: m
      ? `${formatViews(m.baseline.averageDailyViews)} → ${formatViews(m.latest.averageDailyViews)}`
      : 'n/a',
    change: m ? formatSignedPercent(m.percentChange) : 'n/a',
    yearOverYear: formatSignedPercent(l.seasonality.yearOverYear?.percentChange ?? null),
    trend: trendCell(l),
    evidence: l.evidence.strength,
  };
}

/** Short, PDF-sized finding per language — composed only from values in the analysis. */
function conciseFinding(l: LanguageAnalysis): string {
  const m = l.metrics;
  if (!m) return `${l.language}: no pageviews recorded in the period.`;
  const parts = [
    `${l.language} (${l.articleTitle}): average daily views ${formatViews(m.baseline.averageDailyViews)} → ${formatViews(m.latest.averageDailyViews)} (${formatSignedPercent(m.percentChange)})`,
  ];
  if (l.trend.status === 'ok')
    parts.push(`trend ${l.trend.direction ?? 'n/a'} (${l.trend.confidence ?? 'low'} confidence)`);
  const yoyInfo = l.seasonality.yearOverYear;
  const yoy = yoyInfo?.percentChange;
  const sameWindows =
    yoyInfo?.previousWindow.start === m.baseline.start &&
    yoyInfo.currentWindow.end === m.latest.end;
  if (yoy != null && !sameWindows) parts.push(`year-over-year ${formatSignedPercent(yoy)}`);
  if (l.outliers.influence?.material) parts.push('result sensitive to spikes');
  parts.push(`evidence ${l.evidence.strength}`);
  return `${parts.join('; ')}.`;
}

export function buildReportContent(result: AnalysisResult, charts: ReportChart[]): ReportContent {
  const langs = result.request.languages
    .map((code) => result.languages[code])
    .filter((l): l is LanguageAnalysis => l !== undefined);
  const label = result.topic.label ?? result.topic.query ?? result.request.qid;
  const comparisonHighlights = (result.comparison?.highlights ?? []).slice(0, 2);
  const shares = langs.filter((l) => l.projectNormalized?.percentChange != null);
  const shareLine =
    shares.length > 0
      ? [
          `Share of each edition's total pageviews (baseline → latest): ${shares
            .map(
              (l) =>
                `${l.language} ${formatSignedPercent(l.projectNormalized?.percentChange ?? null)} (edition traffic ${formatSignedPercent(l.projectNormalized?.projectPercentChange ?? null)})`,
            )
            .join(', ')}.`,
        ]
      : [];
  const missing = result.topic.missingLanguages.map((m) => m.message);
  const evidencePoints = [
    ...result.evidence.warnings.slice(0, 3).map((w) => `Warning: ${w}`),
    ...result.evidence.reasons.slice(0, 3),
  ];
  return {
    title: `Wikipedia interest: ${label}`,
    subtitle:
      'Pageview analysis from Wikimedia data. Pageviews measure article attention, not market demand.',
    meta: [
      { label: 'Topic', value: `${label} (Wikidata ${result.request.qid})` },
      {
        label: 'Languages',
        value: langs.map((l) => `${l.language}: ${l.articleTitle}`).join(' · '),
      },
      {
        label: 'Period',
        value: `${result.period.start} to ${result.period.end} (${String(result.period.days)} days, ${String(result.period.completeMonths)} complete months)`,
      },
      {
        label: 'Traffic',
        value: `access=${result.request.access}, agent=${result.request.agent}${result.request.exclusions.dateRanges.length > 0 || result.request.exclusions.largestSpike ? '; exclusions applied (see JSON)' : ''}`,
      },
    ],
    keyFindings: [...langs.map(conciseFinding), ...comparisonHighlights, ...shareLine, ...missing],
    charts,
    metricsTable: langs.map(metricRow),
    evidence: {
      strength: result.evidence.strength,
      points: evidencePoints,
    },
    limitations: result.limitations.slice(0, 5),
    dataSource:
      'Data: Wikimedia Pageviews API, Wikidata, MediaWiki API. Computed by wikipedia-interest-analysis.',
    generatedAt: result.generatedAt,
  };
}
