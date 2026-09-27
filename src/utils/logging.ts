/** Minimal structured logger. Writes JSON lines to stderr so stdout stays machine-readable. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export type LogSink = (line: string) => void;

const MAX_FIELD_LENGTH = 300;
const SENSITIVE_KEY = /token|secret|password|authorization|cookie|api[-_]?key/i;

function sanitize(fields: LogFields | undefined): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (SENSITIVE_KEY.test(k)) continue;
    out[k] =
      typeof v === 'string' && v.length > MAX_FIELD_LENGTH ? `${v.slice(0, MAX_FIELD_LENGTH)}…` : v;
  }
  return out;
}

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(ORDER, value);
}

export function createLogger(
  level: LogLevel = 'warn',
  sink: LogSink = (line) => process.stderr.write(`${line}\n`),
): Logger {
  const emit = (lvl: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields): void => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink(
      JSON.stringify({ level: lvl, time: new Date().toISOString(), message, ...sanitize(fields) }),
    );
  };
  return {
    debug: (m, f) => {
      emit('debug', m, f);
    },
    info: (m, f) => {
      emit('info', m, f);
    },
    warn: (m, f) => {
      emit('warn', m, f);
    },
    error: (m, f) => {
      emit('error', m, f);
    },
  };
}

export const silentLogger: Logger = createLogger('silent', () => undefined);
