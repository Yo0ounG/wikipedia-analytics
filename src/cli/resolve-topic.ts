import type { z } from 'zod';
import { InputError, toErrorResult } from '../pipeline.js';
import { SCHEMA_VERSION } from '../schemas/output.js';
import { parseInput, resolveInputSchema } from '../schemas/input.js';
import { EXIT, exitCodeFor, printJson, type CliContext } from './shared.js';

/** Raw options as commander provides them; validated by `resolveInputSchema`. */
export type ResolveCliOptions = z.input<typeof resolveInputSchema>;

/** Resolve a topic to a Wikidata concept and per-language articles, without fetching pageviews. */
export async function resolveTopicCommand(ctx: CliContext, rawOptions: unknown): Promise<number> {
  try {
    const parsed = parseInput(resolveInputSchema, rawOptions);
    if (!parsed.ok) throw new InputError(parsed.message);
    const { query, qid, languages, searchLang } = parsed.data;
    const resolution = await ctx.services.resolver.resolve({
      query,
      qid,
      languages,
      searchLanguage: searchLang,
    });
    printJson(ctx, { schemaVersion: SCHEMA_VERSION, status: 'ok', topic: resolution });
    if (resolution.status === 'ambiguous') return EXIT.needsClarification;
    if (resolution.status === 'not_found') return EXIT.notFound;
    return EXIT.ok;
  } catch (error) {
    ctx.logger.debug('resolve-topic failed', {
      error: error instanceof Error ? error.stack : String(error),
    });
    const result = toErrorResult(error);
    printJson(ctx, result);
    return exitCodeFor(result.error.code);
  }
}
