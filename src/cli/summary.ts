import { z } from 'zod';
import { analysisResultSchema, comparisonSchema } from '../schemas/output.js';
import type { AnalysisResult, LanguageAnalysis } from '../types/analysis.js';

/**
 * Compact, token-efficient view of an AnalysisResult for agents (especially small models).
 * Every number is copied from the full result; nothing is recomputed here.
 */
export const summarySchema = z.object({
  status: z.enum(['success', 'partial']),
  topic: z.object({
    label: z.string().nullable(),
    qid: z.string(),
    query: z.string().nullable(),
    resolution: z.string(),
    articles: z.record(z.string(), z.string()),
    missingLanguages: z.array(z.string()),
  }),
  period: z.object({ start: z.string(), end: z.string(), completeMonths: z.number() }),
  languages: z.record(
    z.string(),
    z.object({
      status: z.string(),
      averageDailyViews: z.number().nullable(),
      baselineAverageDaily: z.number().nullable(),
      latestAverageDaily: z.number().nullable(),
      percentChange: z.number().nullable(),
      windows: z.string().nullable(),
      trend: z.object({
        direction: z.string().nullable(),
        percentPerPeriod: z.number().nullable(),
        granularity: z.string().nullable(),
        rSquared: z.number().nullable(),
        spearman: z.number().nullable(),
        confidence: z.string().nullable(),
      }),
      annualizedGrowthPercent: z.number().nullable(),
      yearOverYearPercent: z.number().nullable(),
      seasonalPattern: z.boolean(),
      shareOfEditionChangePercent: z.number().nullable(),
      editionTrafficChangePercent: z.number().nullable(),
      /** Quote this instead of interpreting share-of-edition numbers yourself. */
      relativeToEdition: z.string().nullable(),
      outliers: z.object({
        count: z.number(),
        largest: z
          .object({ start: z.string(), end: z.string(), peakViews: z.number(), ratio: z.number() })
          .nullable(),
        influence: z.string().nullable(),
      }),
      completeness: z.number(),
      evidence: z.object({ strength: z.string(), warnings: z.array(z.string()) }),
    }),
  ),
  comparison: z
    .object({
      /** Highest first. Use these instead of comparing numbers yourself. */
      rankings: z.object({
        absoluteViews: z.array(z.string()),
        relativeGrowth: z.array(z.string()),
        trendPerPeriod: z.array(z.string()),
        shareOfEditionChange: z.array(z.string()),
        evidenceStrength: z.array(z.string()),
      }),
      /** Present these, in order, when asked which audiences to research next. */
      researchCandidates: comparisonSchema.shape.researchCandidates,
      researchNote: z.string(),
      growthIndexLatest: z.record(z.string(), z.number().nullable()),
      highlights: z.array(z.string()),
    })
    .nullable(),
  evidence: z.object({
    strength: z.string(),
    reasons: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  findings: z.array(z.string()),
  warnings: z.array(z.string()),
  artifacts: z.object({
    analysis: z.string(),
    report: z.string().nullable(),
    charts: z.array(z.string()),
  }),
  followUp: z.array(z.object({ intent: z.string(), command: z.string() })),
  /** Present after a follow-up (`--from`): before → after per language, computed by the tool. */
  previousRun: analysisResultSchema.shape.previousRun,
  /** What every answer must contain. Small models follow tool-provided checklists reliably. */
  answerChecklist: z.array(z.string()),
});

export type Summary = z.infer<typeof summarySchema>;

export const ANSWER_CHECKLIST: readonly string[] = [
  'Quote numbers exactly as given here; do not compute, rank or compare numbers yourself (use comparison.rankings and highlights).',
  'State the evidence strength and the most important warning.',
  'Name periods by copying `windows`; do not re-derive dates.',
  'Do not explain causes (news, politics, marketing); the data does not show them.',
  'Avoid "significant", "statistical", "market" and "winner".',
  'End with this limitation: "Wikipedia pageviews measure attention to articles, not demand or unique users."',
];

function languageSummary(l: LanguageAnalysis): Summary['languages'][string] {
  const m = l.metrics;
  const largest = [...l.outliers.events]
    .filter((e) => e.kind === 'spike')
    .sort((a, b) => b.excessViews - a.excessViews)[0];
  return {
    status: l.status,
    averageDailyViews: m?.averageDailyViews ?? null,
    baselineAverageDaily: m?.baseline.averageDailyViews ?? null,
    latestAverageDaily: m?.latest.averageDailyViews ?? null,
    percentChange: m?.percentChange ?? null,
    windows: m ? `${m.baseline.label} vs ${m.latest.label}` : null,
    trend: {
      direction: l.trend.direction,
      percentPerPeriod: l.trend.normalizedSlope,
      granularity: l.trend.granularity,
      rSquared: l.trend.rSquared,
      spearman: l.trend.spearmanCorrelation,
      confidence: l.trend.confidence,
    },
    annualizedGrowthPercent: m?.annualizedGrowth.percent ?? null,
    yearOverYearPercent: l.seasonality.yearOverYear?.percentChange ?? null,
    seasonalPattern: l.seasonality.detected,
    shareOfEditionChangePercent: l.projectNormalized?.percentChange ?? null,
    editionTrafficChangePercent: l.projectNormalized?.projectPercentChange ?? null,
    relativeToEdition: l.projectNormalized?.interpretation ?? null,
    outliers: {
      count: l.outliers.count,
      largest: largest
        ? {
            start: largest.start,
            end: largest.end,
            peakViews: largest.peakViews,
            ratio: largest.ratio,
          }
        : null,
      influence: l.outliers.influence?.summary ?? null,
    },
    completeness: l.data.completeness,
    evidence: { strength: l.evidence.strength, warnings: l.evidence.warnings },
  };
}

export function buildSummary(result: AnalysisResult): Summary {
  const c = result.comparison;
  return summarySchema.parse({
    status: result.status,
    topic: {
      label: result.topic.label,
      qid: result.request.qid,
      query: result.request.query,
      resolution: `${result.topic.status} (${result.topic.method ?? 'n/a'}, confidence ${result.topic.confidence ?? 'n/a'})`,
      articles: Object.fromEntries(
        Object.entries(result.topic.articles).map(([k, a]) => [k, a.title]),
      ),
      missingLanguages: result.topic.missingLanguages.map((m) => m.message),
    },
    period: {
      start: result.period.start,
      end: result.period.end,
      completeMonths: result.period.completeMonths,
    },
    languages: Object.fromEntries(
      Object.entries(result.languages).map(([k, l]) => [k, languageSummary(l)]),
    ),
    comparison: c
      ? {
          rankings: c.rankings,
          researchCandidates: c.researchCandidates,
          researchNote: c.researchNote,
          growthIndexLatest: c.normalizedIndex.final,
          highlights: c.highlights,
        }
      : null,
    evidence: result.evidence,
    findings: result.findings,
    warnings: result.warnings,
    artifacts: {
      analysis: result.artifacts.analysis,
      report: result.artifacts.report,
      charts: result.artifacts.charts.map((ch) => ch.path),
    },
    followUp: result.followUp.commands,
    previousRun: result.previousRun,
    answerChecklist: ANSWER_CHECKLIST,
  });
}

export function formatText(result: AnalysisResult): string {
  const lines = [
    `Topic: ${result.topic.label ?? result.request.qid} (${result.request.qid})`,
    `Period: ${result.period.start} to ${result.period.end}`,
    `Evidence strength: ${result.evidence.strength}`,
    '',
    'Findings:',
    ...result.findings.map((f) => `  - ${f}`),
  ];
  if (result.warnings.length > 0)
    lines.push('', 'Warnings:', ...result.warnings.map((w) => `  - ${w}`));
  lines.push('', `Analysis JSON: ${result.artifacts.analysis}`);
  if (result.artifacts.report) lines.push(`PDF report: ${result.artifacts.report}`);
  for (const ch of result.artifacts.charts) lines.push(`Chart (${ch.kind}): ${ch.path}`);
  return lines.join('\n');
}
