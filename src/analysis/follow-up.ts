import { z } from 'zod';
import type { AnalysisResult, LanguageAnalysis } from '../types/analysis.js';
import { round } from '../utils/numbers.js';

/** The subset of a previous analysis.json needed to describe what a follow-up changed. */
export const previousRunSchema = z
  .object({
    request: z
      .object({
        period: z.object({ start: z.string(), end: z.string() }).loose(),
        exclusions: z
          .object({
            dateRanges: z.array(z.object({ start: z.string(), end: z.string() })),
            largestSpike: z.boolean(),
          })
          .loose(),
      })
      .loose(),
    languages: z.record(
      z.string(),
      z
        .object({
          metrics: z.object({ percentChange: z.number().nullable() }).loose().nullable(),
          trend: z.object({ direction: z.enum(['up', 'down', 'flat']).nullable() }).loose(),
        })
        .loose(),
    ),
  })
  .loose();

export type PreviousRun = z.infer<typeof previousRunSchema>;

/**
 * Deterministic "before → after" comparison for follow-ups, so agents never subtract
 * percentages themselves.
 */
export function compareWithPrevious(
  previous: PreviousRun,
  previousPath: string,
  current: Record<string, LanguageAnalysis>,
): NonNullable<AnalysisResult['previousRun']> {
  const languages: NonNullable<AnalysisResult['previousRun']>['languages'] = {};
  for (const [code, now] of Object.entries(current)) {
    const before = previous.languages[code];
    if (!before) continue;
    const b = before.metrics?.percentChange ?? null;
    const a = now.metrics?.percentChange ?? null;
    languages[code] = {
      percentChangeBefore: b,
      percentChangeAfter: a,
      differencePercentagePoints: a !== null && b !== null ? round(a - b, 2) : null,
      trendBefore: before.trend.direction,
      trendAfter: now.trend.direction,
    };
  }
  return {
    analysis: previousPath,
    period: { start: previous.request.period.start, end: previous.request.period.end },
    exclusions: previous.request.exclusions,
    languages,
  };
}
