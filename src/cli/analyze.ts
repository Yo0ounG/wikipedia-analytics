import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { previousRunSchema, type PreviousRun } from '../analysis/follow-up.js';
import { runAnalysis, InputError, toErrorResult, type AnalysisParams } from '../pipeline.js';
import { writeArtifacts } from '../report/generate.js';
import { ReportValidationError } from '../report/template.js';
import { analysisRequestSchema, SCHEMA_VERSION } from '../schemas/output.js';
import { analyzeInputSchema, parseInput, type AnalyzeInput } from '../schemas/input.js';
import type { AnalysisRequest } from '../types/analysis.js';
import type { DateRange } from '../utils/dates.js';
import { buildSummary, formatText } from './summary.js';
import { EXIT, exitCodeFor, printJson, type CliContext } from './shared.js';

/** Raw options as commander provides them; validated by `analyzeInputSchema`. */
export type AnalyzeCliOptions = z.input<typeof analyzeInputSchema>;

/** Tells whether an option was given explicitly on the command line (vs. default). */
export type ExplicitCheck = (option: keyof AnalyzeInput) => boolean;

const previousSchema = z.object({ request: analysisRequestSchema }).loose();

/** `--from last` refers to the most recent successful analysis (pointer file in the output root). */
export const LAST_ANALYSIS_ALIASES = ['last', 'latest'] as const;
export const LAST_POINTER_FILE = 'last-analysis.txt';

export function lastPointerPath(outputRoot: string): string {
  return path.join(outputRoot, LAST_POINTER_FILE);
}

async function resolveFromPath(from: string, outputRoot: string): Promise<string> {
  if (!LAST_ANALYSIS_ALIASES.some((a) => a === from)) return from;
  try {
    const pointed = (await readFile(lastPointerPath(outputRoot), 'utf8')).trim();
    if (pointed.length > 0) return pointed;
  } catch {
    // fall through
  }
  throw new InputError('No previous analysis found for "--from last". Run an analysis first.');
}

export interface PreviousAnalysis {
  path: string;
  request: AnalysisRequest;
  run: PreviousRun;
}

export async function loadPrevious(from: string, outputRoot: string): Promise<PreviousAnalysis> {
  const file = await resolveFromPath(from, outputRoot);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new InputError(`Cannot read previous analysis file "${file}".`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new InputError(`Previous analysis file "${file}" is not valid JSON.`);
  }
  const parsed = previousSchema.safeParse(json);
  const run = previousRunSchema.safeParse(json);
  if (!parsed.success || !run.success)
    throw new InputError(`"${file}" is not an analysis.json produced by this tool.`);
  return { path: file.replaceAll('\\', '/'), request: parsed.data.request, run: run.data };
}

function uniqueRanges(ranges: readonly DateRange[]): DateRange[] {
  const seen = new Set<string>();
  return ranges.filter((r) => {
    const key = `${r.start}..${r.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build pipeline parameters. With `--from`, the previous request (topic, QID, languages,
 * period, exclusions) is preserved and only explicitly given options override it.
 */
export function buildParams(
  opts: AnalyzeInput,
  explicit: ExplicitCheck,
  previous: AnalysisRequest | null,
  outputRoot: string,
): AnalysisParams {
  const newTopic = opts.topic !== undefined || opts.qid !== undefined;
  if (!previous && !newTopic) throw new InputError('Provide --topic, --qid or --from.');
  const languages = opts.languages ?? previous?.languages;
  if (languages === undefined) throw new InputError('Provide --languages, e.g. --languages pl,cs.');

  const explicitPeriod = explicit('period') || explicit('start') || explicit('end');
  const period: AnalysisParams['period'] =
    explicitPeriod || !previous
      ? { spec: opts.period, start: opts.start, end: opts.end }
      : {
          spec: previous.period.spec ?? undefined,
          start: previous.period.start,
          end: previous.period.end,
        };

  const keepPrevious = previous !== null && !opts.clearExclusions;
  const exclusions = uniqueRanges([
    ...(keepPrevious ? previous.exclusions.dateRanges : []),
    ...opts.excludeDates,
  ]);

  return {
    query: opts.topic ?? (newTopic ? undefined : (previous?.query ?? undefined)),
    qid: opts.qid ?? (opts.topic !== undefined ? undefined : previous?.qid),
    languages,
    searchLanguage: explicit('searchLang') || !previous ? opts.searchLang : previous.searchLanguage,
    period,
    access: explicit('access') || !previous ? opts.access : previous.access,
    agent: explicit('agent') || !previous ? opts.agent : previous.agent,
    exclusions,
    excludeLargestSpike:
      opts.excludeLargestSpike || (keepPrevious && previous.exclusions.largestSpike),
    missingAsZero:
      explicit('missingAsZero') || !previous ? opts.missingAsZero : previous.missingAsZero,
    outputRoot,
  };
}

export async function analyzeCommand(
  ctx: CliContext,
  rawOptions: unknown,
  explicit: ExplicitCheck,
): Promise<number> {
  let params: AnalysisParams;
  let opts: AnalyzeInput;
  try {
    const parsed = parseInput(analyzeInputSchema, rawOptions);
    if (!parsed.ok) throw new InputError(parsed.message);
    opts = parsed.data;
    const previous = opts.from !== undefined ? await loadPrevious(opts.from, ctx.outputRoot) : null;
    params = {
      ...buildParams(opts, explicit, previous?.request ?? null, ctx.outputRoot),
      previous: previous ? { path: previous.path, run: previous.run } : undefined,
    };
  } catch (error) {
    const result = toErrorResult(error);
    printJson(ctx, result);
    return exitCodeFor(result.error.code);
  }

  const outcome = await runAnalysis(ctx.services, params);
  if (outcome.kind === 'clarification') {
    printJson(ctx, outcome.result);
    return EXIT.needsClarification;
  }
  if (outcome.kind === 'error') {
    printJson(ctx, outcome.result);
    return exitCodeFor(outcome.result.error.code);
  }

  let result;
  try {
    result = await writeArtifacts(outcome.result, {
      directory: outcome.outputDir,
      charts: opts.charts,
      report: opts.report,
    });
  } catch (error) {
    ctx.logger.error('failed to write artifacts', {
      error: error instanceof Error ? error.message : String(error),
    });
    printJson(ctx, {
      schemaVersion: SCHEMA_VERSION,
      status: 'error',
      error: {
        code: 'internal',
        message:
          error instanceof ReportValidationError
            ? `Report not generated: ${error.message}`
            : 'Failed to write analysis artifacts.',
        hint: 'Run with --log-level debug for details.',
      },
    });
    return EXIT.internal;
  }

  try {
    await mkdir(ctx.outputRoot, { recursive: true });
    await writeFile(lastPointerPath(ctx.outputRoot), `${result.artifacts.analysis}\n`, 'utf8');
  } catch (error) {
    ctx.logger.warn('could not record the last analysis', { error: String(error) });
  }

  if (opts.format === 'full') printJson(ctx, result);
  else if (opts.format === 'text') ctx.write(formatText(result));
  else printJson(ctx, buildSummary(result));
  return EXIT.ok;
}
