import path from 'node:path';
import { resolveUserAgent } from '../api/http-client.js';
import { createServices, type ServiceOptions, type Services } from '../pipeline.js';
import type { ErrorCode } from '../types/analysis.js';
import { createLogger, isLogLevel, type Logger, type LogLevel } from '../utils/logging.js';

export interface GlobalOptions {
  logLevel: string;
  cache: boolean;
}

/** Process exit codes, documented in SKILL.md so agents can branch on them. */
export const EXIT = {
  ok: 0,
  internal: 1,
  needsClarification: 2,
  notFound: 3,
  invalidInput: 4,
  network: 5,
} as const;

export function exitCodeFor(code: ErrorCode): number {
  switch (code) {
    case 'invalid_input':
      return EXIT.invalidInput;
    case 'not_found':
    case 'no_articles':
    case 'insufficient_data':
      return EXIT.notFound;
    case 'network':
    case 'rate_limit':
    case 'api_error':
      return EXIT.network;
    case 'internal':
      return EXIT.internal;
  }
}

export interface CliContext {
  logger: Logger;
  services: Services;
  outputRoot: string;
  write: (text: string) => void;
}

export type ServiceFactory = (options: ServiceOptions) => Services;

export interface CliDeps {
  write?: (text: string) => void;
  env?: NodeJS.ProcessEnv;
  serviceFactory?: ServiceFactory;
  logSink?: (line: string) => void;
}

export function createContext(opts: GlobalOptions, deps: CliDeps = {}): CliContext {
  const env = deps.env ?? process.env;
  const level: LogLevel = isLogLevel(opts.logLevel) ? opts.logLevel : 'warn';
  const logger = createLogger(level, deps.logSink);
  const cacheDir = opts.cache ? (env['WIA_CACHE_DIR'] ?? path.join(process.cwd(), '.cache')) : null;
  const factory = deps.serviceFactory ?? createServices;
  return {
    logger,
    services: factory({ logger, userAgent: resolveUserAgent(env), cacheDir }),
    outputRoot: env['WIA_OUTPUT_DIR'] ?? 'output',
    write: deps.write ?? ((text) => process.stdout.write(`${text}\n`)),
  };
}

export function printJson(ctx: { write: (text: string) => void }, value: unknown): void {
  ctx.write(JSON.stringify(value, null, 2));
}
