/**
 * The public, machine-readable contract of the tool. Everything the CLI prints or writes is
 * validated against these schemas before it leaves the process. TypeScript types are inferred
 * from them (see `src/types/`), so the schema and the types cannot drift apart.
 */
import { z } from 'zod';
import { ACCESS_TYPES, AGENT_TYPES } from '../types/pageviews.js';

export const SCHEMA_VERSION = '1.0';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const level = z.enum(['low', 'moderate', 'high']);

// ---------------------------------------------------------------- topic resolution

export const topicCandidateSchema = z.object({
  qid: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  language: z.string(),
});

export const resolvedArticleSchema = z.object({
  language: z.string(),
  project: z.string(),
  dbname: z.string(),
  title: z.string(),
  url: z.string(),
});

export const missingLanguageSchema = z.object({
  language: z.string(),
  reason: z.enum(['no_article', 'unknown_language']),
  message: z.string(),
});

export const resolutionStatusSchema = z.enum([
  'resolved',
  'partially_resolved',
  'ambiguous',
  'not_found',
]);

export const topicResolutionSchema = z.object({
  query: z.string().nullable(),
  searchLanguage: z.string(),
  status: resolutionStatusSchema,
  qid: z.string().nullable(),
  label: z.string().nullable(),
  description: z.string().nullable(),
  confidence: level.nullable(),
  method: z.enum(['exact_title', 'redirect', 'search_match', 'explicit_qid']).nullable(),
  matchedTitle: z.string().nullable(),
  /** For `ambiguous`: concepts to choose from. For `resolved`: other concepts sharing the name. */
  candidates: z.array(topicCandidateSchema),
  articles: z.record(z.string(), resolvedArticleSchema),
  missingLanguages: z.array(missingLanguageSchema),
  messages: z.array(z.string()),
});

// ---------------------------------------------------------------- request

export const dateRangeSchema = z.object({ start: isoDate, end: isoDate });

export const analysisRequestSchema = z.object({
  query: z.string().nullable(),
  qid: z.string(),
  searchLanguage: z.string(),
  languages: z.array(z.string()).min(1),
  period: z.object({ spec: z.string().nullable(), start: isoDate, end: isoDate }),
  access: z.enum(ACCESS_TYPES),
  agent: z.enum(AGENT_TYPES),
  exclusions: z.object({
    dateRanges: z.array(dateRangeSchema),
    largestSpike: z.boolean(),
  }),
  missingAsZero: z.boolean(),
});

// ---------------------------------------------------------------- per-language analysis

export const monthlyPointSchema = z.object({
  month,
  views: z.number(),
  reportedDays: z.number().int(),
  expectedDays: z.number().int(),
  averageDailyViews: z.number().nullable(),
  complete: z.boolean(),
});

export const dataQualitySchema = z.object({
  expectedDays: z.number().int(),
  reportedDays: z.number().int(),
  missingDays: z.number().int(),
  excludedDays: z.number().int(),
  completeness: z.number(),
  missingRanges: z.array(dateRangeSchema),
  excludedRanges: z.array(dateRangeSchema),
  issues: z.array(z.string()),
  noViewsRecorded: z.boolean(),
  missingTreatedAsZero: z.boolean(),
});

export const windowSchema = z.object({
  label: z.string(),
  start: isoDate,
  end: isoDate,
  averageDailyViews: z.number(),
});

export const coreMetricsSchema = z.object({
  totalViews: z.number(),
  averageDailyViews: z.number(),
  medianDailyViews: z.number(),
  baseline: windowSchema,
  latest: windowSchema,
  absoluteChange: z.number(),
  percentChange: z.number().nullable(),
  annualizedGrowth: z.object({
    percent: z.number().nullable(),
    method: z.string(),
    note: z.string(),
  }),
  peak: z.object({ date: isoDate, views: z.number() }),
  volatility: z.object({
    /** Raw std/mean of daily views (inflated by trend and weekly cycles; descriptive only). */
    dailyCoefficientOfVariation: z.number().nullable(),
    /** Robust std (1.4826·MAD) of daily relative deviation from a centred 29-day rolling median. */
    shortTermVolatility: z.number().nullable(),
    monthlyCoefficientOfVariation: z.number().nullable(),
    level,
  }),
});

export const trendSchema = z.object({
  status: z.enum(['ok', 'insufficient_data']),
  granularity: z.enum(['month', 'week']).nullable(),
  observations: z.number().int(),
  direction: z.enum(['up', 'down', 'flat']).nullable(),
  /** Linear OLS slope: change in average daily views per period unit. */
  slope: z.number().nullable(),
  /** Log-linear slope expressed as % change per period unit: exp(b) - 1. */
  normalizedSlope: z.number().nullable(),
  rSquared: z.number().nullable(),
  linearRSquared: z.number().nullable(),
  spearmanCorrelation: z.number().nullable(),
  /** True when the fit used seasonally adjusted values (a recurring pattern was detected). */
  seasonallyAdjusted: z.boolean(),
  confidence: level.nullable(),
  message: z.string().nullable(),
});

export const outlierEventSchema = z.object({
  start: isoDate,
  end: isoDate,
  days: z.number().int(),
  peakDate: isoDate,
  peakViews: z.number(),
  expectedViews: z.number(),
  ratio: z.number(),
  excessViews: z.number(),
  kind: z.enum(['spike', 'dip']),
});

export const outlierAnalysisSchema = z.object({
  method: z.string(),
  threshold: z.number(),
  count: z.number().int(),
  events: z.array(outlierEventSchema),
  influence: z
    .object({
      percentChangeWithOutliers: z.number().nullable(),
      percentChangeWithoutOutliers: z.number().nullable(),
      trendDirectionWithOutliers: z.enum(['up', 'down', 'flat']).nullable(),
      trendDirectionWithoutOutliers: z.enum(['up', 'down', 'flat']).nullable(),
      normalizedSlopeWithOutliers: z.number().nullable(),
      normalizedSlopeWithoutOutliers: z.number().nullable(),
      trendSurvives: z.boolean(),
      material: z.boolean(),
      summary: z.string(),
    })
    .nullable(),
});

export const seasonalitySchema = z.object({
  status: z.enum(['ok', 'insufficient_data']),
  monthsUsed: z.number().int(),
  /** Month-of-year index; 1.0 = average month. Keys are "01".."12". */
  profile: z.record(z.string(), z.number()),
  amplitude: z.number().nullable(),
  yearToYearProfileCorrelation: z.number().nullable(),
  detected: z.boolean(),
  peakMonth: z.number().int().nullable(),
  troughMonth: z.number().int().nullable(),
  yearOverYear: z
    .object({
      currentWindow: dateRangeSchema,
      previousWindow: dateRangeSchema,
      currentViews: z.number(),
      previousViews: z.number(),
      percentChange: z.number().nullable(),
      monthsUp: z.number().int(),
      monthsDown: z.number().int(),
      monthsCompared: z.number().int(),
    })
    .nullable(),
  message: z.string().nullable(),
});

export const evidenceSchema = z.object({
  strength: level,
  score: z.number(),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const projectNormalizedSchema = z.object({
  averagePerMillion: z.number(),
  baselinePerMillion: z.number(),
  latestPerMillion: z.number(),
  percentChange: z.number().nullable(),
  projectPercentChange: z.number().nullable(),
  /**
   * How the article moved relative to its whole edition, from the change in share:
   * < −5% "declined_faster_than_edition", > +5% "outperformed_edition", else "in_line_with_edition".
   */
  relativeToEdition: z
    .enum(['outperformed_edition', 'in_line_with_edition', 'declined_faster_than_edition'])
    .nullable(),
  /** Deterministic sentence describing the above, safe to quote. */
  interpretation: z.string().nullable(),
});

export const dailyPointSchema = z.object({ date: isoDate, views: z.number() });

export const languageAnalysisSchema = z.object({
  language: z.string(),
  project: z.string(),
  articleTitle: z.string(),
  articleUrl: z.string(),
  status: z.enum(['analyzed', 'insufficient_data', 'no_data']),
  data: dataQualitySchema,
  metrics: coreMetricsSchema.nullable(),
  trend: trendSchema,
  seasonality: seasonalitySchema,
  outliers: outlierAnalysisSchema,
  projectNormalized: projectNormalizedSchema.nullable(),
  evidence: evidenceSchema,
  monthly: z.array(monthlyPointSchema),
  daily: z.array(dailyPointSchema),
});

// ---------------------------------------------------------------- comparison

export const comparisonSchema = z.object({
  languages: z.array(z.string()),
  absolute: z.array(
    z.object({
      language: z.string(),
      averageDailyViews: z.number(),
      totalViews: z.number(),
      rank: z.number().int(),
    }),
  ),
  relativeGrowth: z.array(
    z.object({
      language: z.string(),
      percentChange: z.number().nullable(),
      rank: z.number().int().nullable(),
    }),
  ),
  /**
   * Deterministic orderings, highest value first, so agents never have to rank numbers
   * themselves. Languages without the metric are omitted from that ranking.
   */
  rankings: z.object({
    absoluteViews: z.array(z.string()),
    relativeGrowth: z.array(z.string()),
    trendPerPeriod: z.array(z.string()),
    shareOfEditionChange: z.array(z.string()),
    evidenceStrength: z.array(z.string()),
  }),
  /** Ordered candidates for further research with data-derived reasons (see researchNote). */
  researchCandidates: z.array(
    z.object({
      language: z.string(),
      rank: z.number().int(),
      reasons: z.array(z.string()),
      cautions: z.array(z.string()),
    }),
  ),
  researchNote: z.string(),
  normalizedIndex: z.object({
    base: z.string(),
    granularity: z.enum(['month', 'week']),
    series: z.record(
      z.string(),
      z.array(z.object({ period: z.string(), index: z.number().nullable() })),
    ),
    final: z.record(z.string(), z.number().nullable()),
  }),
  projectShare: z.array(
    z.object({
      language: z.string(),
      averagePerMillion: z.number().nullable(),
      percentChange: z.number().nullable(),
    }),
  ),
  highlights: z.array(z.string()),
  evidence: evidenceSchema,
});

// ---------------------------------------------------------------- full result

export const artifactsSchema = z.object({
  directory: z.string(),
  analysis: z.string(),
  charts: z.array(z.object({ kind: z.string(), path: z.string(), title: z.string() })),
  report: z.string().nullable(),
});

export const analysisResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  status: z.enum(['success', 'partial']),
  generatedAt: z.string(),
  request: analysisRequestSchema,
  topic: topicResolutionSchema,
  period: z.object({
    start: isoDate,
    end: isoDate,
    days: z.number().int(),
    completeMonths: z.number().int(),
  }),
  methodology: z.object({
    source: z.string(),
    access: z.string(),
    agent: z.string(),
    notes: z.array(z.string()),
  }),
  languages: z.record(z.string(), languageAnalysisSchema),
  comparison: comparisonSchema.nullable(),
  evidence: evidenceSchema,
  findings: z.array(z.string()),
  warnings: z.array(z.string()),
  limitations: z.array(z.string()),
  artifacts: artifactsSchema,
  followUp: z.object({ commands: z.array(z.object({ intent: z.string(), command: z.string() })) }),
  /** For follow-ups (`--from`): what changed compared with the previous run, computed here. */
  previousRun: z
    .object({
      analysis: z.string(),
      period: dateRangeSchema,
      exclusions: z.object({ dateRanges: z.array(dateRangeSchema), largestSpike: z.boolean() }),
      languages: z.record(
        z.string(),
        z.object({
          percentChangeBefore: z.number().nullable(),
          percentChangeAfter: z.number().nullable(),
          differencePercentagePoints: z.number().nullable(),
          trendBefore: z.enum(['up', 'down', 'flat']).nullable(),
          trendAfter: z.enum(['up', 'down', 'flat']).nullable(),
        }),
      ),
    })
    .nullable(),
});

// ---------------------------------------------------------------- non-success envelopes

export const clarificationResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  status: z.literal('needs_clarification'),
  message: z.string(),
  /** Explicit instruction for the calling agent: ask, do not choose. */
  agentInstruction: z.string(),
  /** Ready-to-show question listing the candidate concepts. */
  questionForUser: z.string(),
  topic: topicResolutionSchema,
  options: z.array(z.object({ qid: z.string(), description: z.string() })),
  /** Command template to run only after the user has chosen an option. */
  commandAfterUserChoice: z.string(),
});

export const errorCodeSchema = z.enum([
  'invalid_input',
  'not_found',
  'no_articles',
  'network',
  'rate_limit',
  'api_error',
  'insufficient_data',
  'internal',
]);

export const errorResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  status: z.literal('error'),
  error: z.object({ code: errorCodeSchema, message: z.string(), hint: z.string().nullable() }),
});
