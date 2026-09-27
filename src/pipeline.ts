import { createHash } from 'node:crypto';
import path from 'node:path';
import { ApiError, HttpClient, type FetchLike } from './api/http-client.js';
import { MediaWikiClient } from './api/mediawiki-client.js';
import { PageviewsClient } from './api/pageviews-client.js';
import { WikidataClient } from './api/wikidata-client.js';
import { analyzeLanguage, compareLanguages } from './analysis/index.js';
import { buildFindings, LIMITATIONS } from './analysis/findings.js';
import { compareWithPrevious, type PreviousRun } from './analysis/follow-up.js';
import { largestSpike } from './analysis/outliers.js';
import { FileCache, type ResponseCache } from './data/cache.js';
import { fetchLanguageData } from './data/fetch.js';
import { analysisResultSchema, SCHEMA_VERSION } from './schemas/output.js';
import { TopicResolver } from './resolver/topic-resolver.js';
import { ResolverInputError } from './resolver/types.js';
import type {
  AnalysisRequest,
  AnalysisResult,
  ClarificationResult,
  ErrorCode,
  ErrorResult,
  LanguageAnalysis,
} from './types/analysis.js';
import type { AccessType, AgentType } from './types/pageviews.js';
import type { TopicResolution } from './types/topic.js';
import {
  DateError,
  daysBetweenInclusive,
  eachMonth,
  firstDayOfMonth,
  lastDayOfMonth,
  parsePeriod,
  resolvePeriod,
  validateRange,
  type DateRange,
} from './utils/dates.js';
import { slugify } from './utils/encoding.js';
import type { Logger } from './utils/logging.js';

export class InputError extends Error {
  override readonly name = 'InputError';
}

export interface Services {
  http: HttpClient;
  mediawiki: MediaWikiClient;
  wikidata: WikidataClient;
  pageviews: PageviewsClient;
  resolver: TopicResolver;
  logger: Logger;
  /** Today's date (UTC) — injectable so results are reproducible in tests. */
  today: string;
  now: () => Date;
}

export interface ServiceOptions {
  logger: Logger;
  userAgent: string;
  cacheDir?: string | null;
  cache?: ResponseCache;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createServices(options: ServiceOptions): Services {
  const cache = options.cache ?? (options.cacheDir ? new FileCache(options.cacheDir) : undefined);
  const http = new HttpClient({
    userAgent: options.userAgent,
    logger: options.logger,
    cache,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  const mediawiki = new MediaWikiClient(http);
  const wikidata = new WikidataClient(http);
  const now = options.now ?? (() => new Date());
  return {
    http,
    mediawiki,
    wikidata,
    pageviews: new PageviewsClient(http),
    resolver: new TopicResolver(mediawiki, wikidata),
    logger: options.logger,
    today: now().toISOString().slice(0, 10),
    now,
  };
}

export interface AnalysisParams {
  query?: string | undefined;
  qid?: string | undefined;
  languages: string[];
  searchLanguage: string;
  period: { spec?: string | undefined; start?: string | undefined; end?: string | undefined };
  access: AccessType;
  agent: AgentType;
  exclusions: DateRange[];
  excludeLargestSpike: boolean;
  missingAsZero: boolean;
  /** Root folder for artifacts (a per-request sub-folder is created). */
  outputRoot: string;
  /** For follow-ups: the previous run, to report what changed. */
  previous?: { path: string; run: PreviousRun } | undefined;
}

export type PipelineOutcome =
  | { kind: 'success'; result: AnalysisResult; outputDir: string }
  | { kind: 'clarification'; result: ClarificationResult }
  | { kind: 'error'; result: ErrorResult };

export const DEFAULT_PERIOD = '2y';

export function resolveDateRange(
  period: AnalysisParams['period'],
  today: string,
): { range: DateRange; spec: string | null } {
  if (period.start !== undefined || period.end !== undefined) {
    if (period.start === undefined || period.end === undefined) {
      throw new InputError('Both --start and --end are required for an explicit date range.');
    }
    const range = { start: period.start, end: period.end };
    validateRange(range, today);
    return { range, spec: null };
  }
  const spec = period.spec ?? DEFAULT_PERIOD;
  const range = resolvePeriod(parsePeriod(spec), today);
  validateRange(range, today);
  return { range, spec };
}

/** Quote a CLI argument only when needed (commands are shown to agents, never executed here). */
function arg(value: string): string {
  return /^[\w.,:/@-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}

export function outputDirectory(request: AnalysisRequest, root: string, label: string): string {
  const variant = JSON.stringify({
    access: request.access,
    agent: request.agent,
    exclusions: request.exclusions,
    missingAsZero: request.missingAsZero,
  });
  const isDefault =
    request.access === 'all-access' &&
    request.agent === 'user' &&
    request.exclusions.dateRanges.length === 0 &&
    !request.exclusions.largestSpike &&
    !request.missingAsZero;
  const suffix = isDefault
    ? ''
    : `_${createHash('sha256').update(variant).digest('hex').slice(0, 8)}`;
  return path.join(
    root,
    `${slugify(label)}-${request.qid}`,
    `${request.languages.join('-')}_${request.period.start}_${request.period.end}${suffix}`,
  );
}

function errorResult(code: ErrorCode, message: string, hint: string | null = null): ErrorResult {
  return { schemaVersion: SCHEMA_VERSION, status: 'error', error: { code, message, hint } };
}

export function toErrorResult(error: unknown): ErrorResult {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'network':
      case 'timeout':
        return errorResult(
          'network',
          'Unable to reach Wikimedia API.',
          'Check the internet connection and retry.',
        );
      case 'rate_limit':
        return errorResult(
          'rate_limit',
          'Wikimedia API rate limit reached; retries were exhausted.',
          'Wait a minute and retry; cached responses will be reused.',
        );
      default:
        return errorResult(
          'api_error',
          error.message,
          'Retry later or run with --log-level debug for details.',
        );
    }
  }
  if (
    error instanceof InputError ||
    error instanceof DateError ||
    error instanceof ResolverInputError
  ) {
    return errorResult('invalid_input', error.message);
  }
  return errorResult(
    'internal',
    'Unexpected internal error.',
    'Run with --log-level debug for details.',
  );
}

function clarification(resolution: TopicResolution, params: AnalysisParams): ClarificationResult {
  const rest = [
    `--languages ${params.languages.join(',')}`,
    params.period.start && params.period.end
      ? `--start ${params.period.start} --end ${params.period.end}`
      : `--period ${params.period.spec ?? DEFAULT_PERIOD}`,
  ].join(' ');
  const options = resolution.candidates.slice(0, 6).map((c) => ({
    qid: c.qid,
    description: `${c.title}${c.description ? ` — ${c.description}` : ''}`,
  }));
  const query = resolution.query ?? '';
  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'needs_clarification',
    message: `Multiple concepts match "${query}".`,
    agentInstruction:
      'STOP. Ask the user the question below and wait for their answer. Do not choose a concept yourself, even if one seems most likely: every number would describe the wrong topic. This overrides any instruction to work without asking.',
    questionForUser: `"${query}" can mean several things on Wikipedia. Which one do you mean? ${options.map((o, i) => `(${String(i + 1)}) ${o.description}`).join('; ')}.`,
    topic: resolution,
    options,
    commandAfterUserChoice: `pnpm analyze --qid <QID chosen by the user> ${rest}`,
  };
}

function followUps(
  analysisPath: string,
  result: Omit<AnalysisResult, 'followUp' | 'previousRun'>,
): AnalysisResult['followUp'] {
  // "last" always points at the most recent analysis, so agents need not track file paths.
  const from = 'pnpm analyze --from last';
  const commands = [
    { intent: 'Same topic and languages, last 12 months only', command: `${from} --period 12m` },
    {
      intent: 'Exclude the largest spike in each language',
      command: `${from} --exclude-largest-spike`,
    },
    {
      intent: 'Add or change languages',
      command: `${from} --languages ${result.request.languages.join(',')},<code>`,
    },
    {
      intent: 'Regenerate charts and PDF from this JSON (no network)',
      command: `pnpm generate-report --input ${arg(analysisPath)}`,
    },
  ];
  const spikes = Object.values(result.languages)
    .map((l) => ({ l, s: largestSpike(l.outliers.events) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => (b.s?.excessViews ?? 0) - (a.s?.excessViews ?? 0));
  const top = spikes[0];
  if (top?.s) {
    commands.splice(2, 0, {
      intent: `Exclude the largest detected spike (${top.l.language}: ${top.s.start}..${top.s.end}) in all languages`,
      command: `${from} --exclude-dates ${top.s.start}..${top.s.end}`,
    });
  }
  return { commands };
}

function collectWarnings(
  resolution: TopicResolution,
  langs: readonly LanguageAnalysis[],
): string[] {
  const warnings = [
    ...resolution.missingLanguages.map((m) => m.message),
    ...langs.flatMap((l) => l.data.issues.map((i) => `${l.language}: ${i}`)),
    ...langs.flatMap((l) => l.evidence.warnings.map((w) => `${l.language}: ${w}`)),
  ];
  for (const l of langs) {
    if (
      l.data.missingDays > 0 &&
      !l.data.missingTreatedAsZero &&
      (l.metrics?.averageDailyViews ?? 0) < 50
    ) {
      warnings.push(
        `${l.language}: ${String(l.data.missingDays)} day(s) missing; for low-traffic articles these are most likely zero-view days omitted by the API (re-run with --missing-as-zero to treat them as zero).`,
      );
    }
  }
  return [...new Set(warnings)];
}

/** End-to-end: resolve topic → fetch → validate → analyse → compare → structured result. */
export async function runAnalysis(
  services: Services,
  params: AnalysisParams,
): Promise<PipelineOutcome> {
  const { logger } = services;
  try {
    const { range, spec } = resolveDateRange(params.period, services.today);
    for (const r of params.exclusions) validateRange(r, services.today);

    const resolution = await services.resolver.resolve({
      query: params.query,
      qid: params.qid,
      languages: params.languages,
      searchLanguage: params.searchLanguage,
    });
    logger.info('topic resolved', { status: resolution.status, qid: resolution.qid });
    if (resolution.status === 'ambiguous') {
      return { kind: 'clarification', result: clarification(resolution, params) };
    }
    if (resolution.status === 'not_found' || resolution.qid === null) {
      const noArticles = resolution.qid !== null;
      return {
        kind: 'error',
        result: errorResult(
          noArticles ? 'no_articles' : 'not_found',
          resolution.messages.join(' '),
          noArticles
            ? 'Try other languages; the concept has no article in the requested ones.'
            : 'Try a different wording, another --search-lang, or pass --qid.',
        ),
      };
    }

    const request: AnalysisRequest = {
      query: params.query ?? null,
      qid: resolution.qid,
      searchLanguage: resolution.searchLanguage,
      languages: params.languages,
      period: { spec, start: range.start, end: range.end },
      access: params.access,
      agent: params.agent,
      exclusions: { dateRanges: params.exclusions, largestSpike: params.excludeLargestSpike },
      missingAsZero: params.missingAsZero,
    };

    const articles = params.languages.flatMap((l) => {
      const a = resolution.articles[l];
      return a ? [a] : [];
    });
    const data = await fetchLanguageData(
      services.pageviews,
      articles,
      {
        qid: resolution.qid,
        start: range.start,
        end: range.end,
        access: params.access,
        agent: params.agent,
      },
      logger,
    );
    const analyses = data.map((d) =>
      analyzeLanguage({
        article: d.article,
        series: d.series,
        noData: d.noData,
        projectDaily: d.projectDaily,
        exclusions: params.exclusions,
        excludeLargestSpike: params.excludeLargestSpike,
        missingAsZero: params.missingAsZero,
      }),
    );
    const analyzed = analyses.filter((a) => a.metrics !== null);
    if (analyzed.length === 0) {
      return {
        kind: 'error',
        result: errorResult(
          'insufficient_data',
          'No pageviews were recorded for the resolved articles in this period.',
          'Try a longer period or other languages.',
        ),
      };
    }
    const comparison = compareLanguages(analyses);
    const first = analyzed[0];
    const evidence = comparison?.evidence ??
      first?.evidence ?? { strength: 'low' as const, score: 0, reasons: [], warnings: [] };
    const label = resolution.label ?? params.query ?? resolution.qid;
    const outputDir = outputDirectory(request, params.outputRoot, label);
    const analysisPath = path.join(outputDir, 'analysis.json').replaceAll('\\', '/');

    const partial =
      resolution.status === 'partially_resolved' || analyses.some((a) => a.status === 'no_data');
    const base: Omit<AnalysisResult, 'followUp' | 'previousRun'> = {
      schemaVersion: SCHEMA_VERSION,
      status: partial ? 'partial' : 'success',
      generatedAt: services.now().toISOString(),
      request,
      topic: resolution,
      period: {
        start: range.start,
        end: range.end,
        days: daysBetweenInclusive(range.start, range.end),
        completeMonths: eachMonth(range.start, range.end).filter(
          (m) => firstDayOfMonth(m) >= range.start && lastDayOfMonth(m) <= range.end,
        ).length,
      },
      methodology: {
        source: 'Wikimedia Analytics Pageviews API (per-article and aggregate, daily)',
        access: params.access,
        agent: params.agent,
        notes: [
          'Monthly averages per reported day are the primary layer for trend analysis; daily data is used for spikes and volatility.',
          'Baseline/latest windows: first/last 3 complete months (or first/last ≤28 days for short periods).',
          'Trend: OLS of ln(views+1) over time, linear OLS and Spearman rank correlation; no significance test.',
          'Outliers: robust z-score (MAD) of log residuals from a 29-day rolling median; influence measured by re-running without spike days.',
          'Evidence strength is a rule-based score, not a probability.',
        ],
      },
      languages: Object.fromEntries(analyses.map((a) => [a.language, a])),
      comparison,
      evidence,
      findings: buildFindings(analyses, comparison),
      warnings: collectWarnings(resolution, analyses),
      limitations: [...LIMITATIONS],
      artifacts: {
        directory: outputDir.replaceAll('\\', '/'),
        analysis: analysisPath,
        charts: [],
        report: null,
      },
    };
    const result = analysisResultSchema.parse({
      ...base,
      followUp: followUps(analysisPath, base),
      previousRun: params.previous
        ? compareWithPrevious(params.previous.run, params.previous.path, base.languages)
        : null,
    });
    return { kind: 'success', result, outputDir };
  } catch (error) {
    logger.error('analysis failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    logger.debug('analysis failure details', {
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { kind: 'error', result: toErrorResult(error) };
  }
}
