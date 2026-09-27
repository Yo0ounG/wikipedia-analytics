import type { z } from 'zod';
import type {
  missingLanguageSchema,
  resolutionStatusSchema,
  resolvedArticleSchema,
  topicCandidateSchema,
  topicResolutionSchema,
} from '../schemas/output.js';

export type TopicCandidate = z.infer<typeof topicCandidateSchema>;
export type ResolvedArticle = z.infer<typeof resolvedArticleSchema>;
export type MissingLanguage = z.infer<typeof missingLanguageSchema>;
export type ResolutionStatus = z.infer<typeof resolutionStatusSchema>;
export type TopicResolution = z.infer<typeof topicResolutionSchema>;
