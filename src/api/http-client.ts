import type { z } from 'zod';
import type { ResponseCache } from '../data/cache.js';
import type { Logger } from '../utils/logging.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ApiErrorKind =
  'network' | 'timeout' | 'rate_limit' | 'not_found' | 'http' | 'invalid_response';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** Server-provided Retry-After hint, when present. */
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly url: string,
    readonly status?: number,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super(message, options);
    this.retryAfterMs = options?.retryAfterMs;
  }

  get retryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'rate_limit' ||
      (this.kind === 'http' && this.status !== undefined && this.status >= 500)
    );
  }
}

export interface HttpClientOptions {
  userAgent: string;
  logger: Logger;
  fetch?: FetchLike;
  cache?: ResponseCache | undefined;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxConcurrent?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface GetJsonOptions {
  /** Cache TTL. Omit to bypass the cache for this request. */
  cacheTtlMs?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Very small FIFO semaphore so no caller can fire uncontrolled parallel requests. */
class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

function shortUrl(url: string): string {
  return url.length > 200 ? `${url.slice(0, 200)}…` : url;
}

/**
 * Shared HTTP layer for every Wikimedia client: User-Agent, timeout, retries with
 * exponential backoff (honouring Retry-After), 429/5xx handling, a concurrency limit,
 * request de-duplication, optional caching and Zod validation of every response.
 */
export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly semaphore: Semaphore;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private requestCount = 0;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 15_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.semaphore = new Semaphore(options.maxConcurrent ?? 2);
  }

  /** Number of network requests actually sent (cache hits excluded, retries included). */
  get networkRequests(): number {
    return this.requestCount;
  }

  async getJson<S extends z.ZodType>(
    url: string,
    schema: S,
    opts: GetJsonOptions = {},
  ): Promise<z.infer<S>> {
    const { cache, logger } = this.options;
    const useCache = cache !== undefined && opts.cacheTtlMs !== undefined;
    if (useCache) {
      const cached = await cache.get(url, opts.cacheTtlMs ?? 0);
      if (cached !== undefined) {
        const parsed = schema.safeParse(cached);
        if (parsed.success) {
          logger.debug('cache hit', { url: shortUrl(url) });
          return parsed.data;
        }
        logger.debug('cache entry failed validation; refetching', { url: shortUrl(url) });
      }
    }

    // De-duplicate identical concurrent requests.
    let pending = this.inflight.get(url);
    if (!pending) {
      pending = this.semaphore
        .run(() => this.fetchWithRetry(url))
        .finally(() => {
          this.inflight.delete(url);
        });
      this.inflight.set(url, pending);
    }
    const body = await pending;

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      logger.debug('response validation failed', {
        url: shortUrl(url),
        issues: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      throw new ApiError(
        'invalid_response',
        'Wikimedia API returned data in an unexpected format.',
        url,
      );
    }
    if (useCache) {
      try {
        await cache.set(url, body);
      } catch (error) {
        logger.warn('failed to write cache entry', { error: String(error) });
      }
    }
    return parsed.data;
  }

  private async fetchWithRetry(url: string): Promise<unknown> {
    const { logger } = this.options;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchOnce(url);
      } catch (error) {
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError('network', 'Unable to reach Wikimedia API.', url, undefined, {
                cause: error,
              });
        if (!apiError.retryable || attempt >= this.maxRetries) throw apiError;
        const delay = Math.min(
          this.maxDelayMs,
          Math.max(apiError.retryAfterMs ?? 0, this.baseDelayMs * 2 ** attempt),
        );
        logger.warn(
          apiError.kind === 'rate_limit'
            ? 'Wikimedia API rate limit reached; retrying...'
            : 'Wikimedia API request failed; retrying...',
          { kind: apiError.kind, status: apiError.status, delayMs: delay, attempt: attempt + 1 },
        );
        await this.sleep(delay);
      }
    }
  }

  private async fetchOnce(url: string): Promise<unknown> {
    const { logger, userAgent } = this.options;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    this.requestCount++;
    logger.debug('GET', { url: shortUrl(url) });
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          'User-Agent': userAgent,
          'Api-User-Agent': userAgent,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      text = response.ok ? await response.text() : '';
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(
          'timeout',
          `Wikimedia API did not respond within ${String(this.timeoutMs)} ms.`,
          url,
          undefined,
          { cause: error },
        );
      }
      throw new ApiError('network', 'Unable to reach Wikimedia API.', url, undefined, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new ApiError('rate_limit', 'Wikimedia API rate limit reached.', url, 429, {
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1000 }
          : {}),
      });
    }
    if (response.status === 404) {
      throw new ApiError('not_found', 'Resource not found in Wikimedia API.', url, 404);
    }
    if (!response.ok) {
      throw new ApiError(
        'http',
        `Wikimedia API returned HTTP ${String(response.status)}.`,
        url,
        response.status,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      logger.debug('malformed JSON', { url: shortUrl(url), bodyStart: text.slice(0, 120) });
      throw new ApiError(
        'invalid_response',
        'Wikimedia API returned malformed JSON.',
        url,
        response.status,
        { cause: error },
      );
    }
  }
}

/**
 * Wikimedia's User-Agent policy asks for an identifiable agent with contact information.
 * Operators should set WIA_USER_AGENT (e.g. "my-app/1.0 (you@example.com)").
 */
export const DEFAULT_USER_AGENT =
  'wikipedia-interest-analysis/1.0 (Agent Skill for Wikipedia pageview analysis; Node.js)';

export function resolveUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  const custom = env['WIA_USER_AGENT']?.trim();
  return custom !== undefined && custom.length > 0 ? custom : DEFAULT_USER_AGENT;
}
