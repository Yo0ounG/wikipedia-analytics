import type { z } from 'zod';
import type {
  analysisRequestSchema,
  analysisResultSchema,
  clarificationResultSchema,
  comparisonSchema,
  coreMetricsSchema,
  dataQualitySchema,
  errorCodeSchema,
  errorResultSchema,
  evidenceSchema,
  languageAnalysisSchema,
  outlierAnalysisSchema,
  outlierEventSchema,
  projectNormalizedSchema,
  seasonalitySchema,
  trendSchema,
} from '../schemas/output.js';

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
export type DataQuality = z.infer<typeof dataQualitySchema>;
export type CoreMetrics = z.infer<typeof coreMetricsSchema>;
export type TrendAnalysis = z.infer<typeof trendSchema>;
export type TrendDirection = NonNullable<TrendAnalysis['direction']>;
export type OutlierEvent = z.infer<typeof outlierEventSchema>;
export type OutlierAnalysis = z.infer<typeof outlierAnalysisSchema>;
export type SeasonalityAnalysis = z.infer<typeof seasonalitySchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type EvidenceStrength = Evidence['strength'];
export type ProjectNormalized = z.infer<typeof projectNormalizedSchema>;
export type LanguageAnalysis = z.infer<typeof languageAnalysisSchema>;
export type Comparison = z.infer<typeof comparisonSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type ClarificationResult = z.infer<typeof clarificationResultSchema>;
export type ErrorResult = z.infer<typeof errorResultSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
