/**
 * Zod schemas for CLI input. Every command validates its options here before any network or
 * file access, so invalid user or agent input fails fast with a clear, flag-specific message.
 */
import { z } from 'zod';
import { ACCESS_TYPES, AGENT_TYPES } from '../types/pageviews.js';
import { isIsoDate, type DateRange } from '../utils/dates.js';
import { isValidLanguageCodeSyntax, isValidQid, parseLanguageList } from '../utils/encoding.js';

export const OUTPUT_FORMATS = ['summary', 'full', 'text'] as const;

const qid = z.string().refine(isValidQid, 'Expected a Wikidata QID such as Q308.');
const languageCode = z
  .string()
  .refine(isValidLanguageCodeSyntax, 'Expected a Wikipedia language code such as en, pl, uk.');
const isoDate = z.string().refine(isIsoDate, 'Expected a date as YYYY-MM-DD.');
const periodSpec = z
  .string()
  .regex(/^\s*\d{1,3}\s*[dwmy]\s*$/i, 'Use a period such as 90d, 12w, 12m or 2y.');
const topicText = z.string().trim().min(1, 'Topic must not be empty.').max(250);

/** Comma-separated language codes → unique, validated list (max 12). */
export const languageListSchema = z.string().transform((value, ctx): string[] => {
  try {
    return parseLanguageList(value);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid.' });
    return z.NEVER;
  }
});

/** `YYYY-MM-DD` or `YYYY-MM-DD..YYYY-MM-DD`, comma-separated, repeatable. */
export const dateRangesSchema = z.array(z.string()).transform((values, ctx): DateRange[] => {
  const ranges: DateRange[] = [];
  for (const item of values.flatMap((v) => v.split(',')).map((v) => v.trim())) {
    if (item.length === 0) continue;
    const [start = '', end = start] = item.split('..');
    if (!isIsoDate(start) || !isIsoDate(end)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${item}" is not YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD.`,
      });
      return z.NEVER;
    }
    if (start > end) {
      ctx.addIssue({ code: 'custom', message: `"${item}": start is after end.` });
      return z.NEVER;
    }
    ranges.push({ start, end });
  }
  return ranges;
});

export const analyzeInputSchema = z
  .object({
    topic: topicText.optional(),
    qid: qid.optional(),
    from: z.string().min(1).optional(),
    languages: languageListSchema.optional(),
    searchLang: languageCode,
    period: periodSpec.optional(),
    start: isoDate.optional(),
    end: isoDate.optional(),
    excludeDates: dateRangesSchema,
    excludeLargestSpike: z.boolean(),
    clearExclusions: z.boolean(),
    missingAsZero: z.boolean(),
    access: z.enum(ACCESS_TYPES),
    agent: z.enum(AGENT_TYPES),
    charts: z.boolean(),
    report: z.boolean(),
    format: z.enum(OUTPUT_FORMATS),
  })
  .refine((v) => !(v.period !== undefined && (v.start !== undefined || v.end !== undefined)), {
    message: 'Use either --period or --start/--end, not both.',
  })
  .refine((v) => (v.start === undefined) === (v.end === undefined), {
    message: 'Both --start and --end are required for an explicit date range.',
  })
  .refine((v) => v.topic !== undefined || v.qid !== undefined || v.from !== undefined, {
    message: 'Provide --topic, --qid or --from.',
  });

export type AnalyzeInput = z.output<typeof analyzeInputSchema>;

export const resolveInputSchema = z
  .object({
    query: topicText.optional(),
    qid: qid.optional(),
    languages: languageListSchema,
    searchLang: languageCode,
  })
  .refine((v) => v.query !== undefined || v.qid !== undefined, {
    message: 'Provide --query or --qid.',
  });

export type ResolveInput = z.output<typeof resolveInputSchema>;

export const generateReportInputSchema = z.object({
  input: z.string().min(1, 'Provide --input <analysis.json>.'),
  outDir: z.string().min(1).optional(),
});

export type GenerateReportInput = z.output<typeof generateReportInputSchema>;

function flagName(key: PropertyKey | undefined): string {
  if (typeof key !== 'string') return '';
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Parse CLI options, or return a single human-readable message naming the offending flag. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
): { ok: true; data: z.output<S> } | { ok: false; message: string } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const flag = flagName(issue?.path[0]);
  const message = issue?.message ?? 'Invalid input.';
  return { ok: false, message: flag ? `Invalid ${flag}: ${message}` : message };
}
