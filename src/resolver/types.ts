export type {
  MissingLanguage,
  ResolutionStatus,
  ResolvedArticle,
  TopicCandidate,
  TopicResolution,
} from '../types/topic.js';

import type { TopicCandidate, TopicResolution } from '../types/topic.js';

/** Result of the first resolver stage: which Wikidata concept the query refers to. */
export interface ConceptResolution {
  status: 'resolved' | 'ambiguous' | 'not_found';
  qid: string | null;
  confidence: TopicResolution['confidence'];
  method: TopicResolution['method'];
  matchedTitle: string | null;
  description: string | null;
  candidates: TopicCandidate[];
  messages: string[];
}

export interface ResolveTopicInput {
  /** Free-text query; ignored when `qid` is given. */
  query?: string | undefined;
  /** Explicit Wikidata QID (used for clarifications and follow-ups). */
  qid?: string | undefined;
  languages: string[];
  /** Wikipedia edition used to search for the query text. */
  searchLanguage: string;
}

export class ResolverInputError extends Error {
  override readonly name = 'ResolverInputError';
}
