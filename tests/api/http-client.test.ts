import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';
import {
  ApiError,
  DEFAULT_USER_AGENT,
  HttpClient,
  resolveUserAgent,
} from '../../src/api/http-client.js';
import { MemoryCache } from '../../src/data/cache.js';
import { createLogger, silentLogger } from '../../src/utils/logging.js';
import {
  hangingResponder,
  jsonResponse,
  noSleep,
  sequenceFetch,
  textResponse,
} from '../helpers/fake-fetch.js';

const schema = z.object({ ok: z.boolean() });
const URL_A = 'https://example.org/a';

function client(
  fetch: ReturnType<typeof sequenceFetch>,
  extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {},
) {
  return new HttpClient({
    userAgent: 'test-agent/1.0',
    logger: silentLogger,
    fetch,
    sleep: noSleep,
    ...extra,
  });
}

async function captureError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected rejection');
}

describe('HttpClient', () => {
  it('returns validated JSON on 200 and sends an identifiable User-Agent', async () => {
    const fetch = sequenceFetch(() => jsonResponse({ ok: true }));
    await expect(client(fetch).getJson(URL_A, schema)).resolves.toEqual({ ok: true });
    expect(fetch.headers[0]?.get('user-agent')).toBe('test-agent/1.0');
    expect(fetch.headers[0]?.get('api-user-agent')).toBe('test-agent/1.0');
  });

  it('maps 404 to a non-retryable not_found error', async () => {
    const fetch = sequenceFetch(() => jsonResponse({}, 404));
    const err = await captureError(client(fetch).getJson(URL_A, schema));
    expect(err.kind).toBe('not_found');
    expect(err.retryable).toBe(false);
    expect(fetch.calls).toHaveLength(1);
  });

  it('retries 429 honouring Retry-After and logs a rate-limit warning', async () => {
    const delays: number[] = [];
    const logs: string[] = [];
    const fetch = sequenceFetch(
      () => jsonResponse({}, 429, { 'retry-after': '3' }),
      () => jsonResponse({ ok: true }),
    );
    const http = client(fetch, {
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
      logger: createLogger('warn', (l) => logs.push(l)),
    });
    await expect(http.getJson(URL_A, schema)).resolves.toEqual({ ok: true });
    expect(delays).toEqual([3000]);
    expect(logs.join('\n')).toContain('Wikimedia API rate limit reached; retrying...');
  });

  it('retries 5xx with exponential backoff and gives up after maxRetries', async () => {
    const delays: number[] = [];
    const fetch = sequenceFetch(() => jsonResponse({}, 503));
    const http = client(fetch, {
      maxRetries: 3,
      baseDelayMs: 100,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    const err = await captureError(http.getJson(URL_A, schema));
    expect(err.kind).toBe('http');
    expect(err.status).toBe(503);
    expect(delays).toEqual([100, 200, 400]);
    expect(fetch.calls).toHaveLength(4);
  });

  it('does not retry other 4xx errors', async () => {
    const fetch = sequenceFetch(() => jsonResponse({}, 400));
    const err = await captureError(client(fetch).getJson(URL_A, schema));
    expect(err.kind).toBe('http');
    expect(fetch.calls).toHaveLength(1);
  });

  it('times out hanging requests', async () => {
    const fetch = sequenceFetch(hangingResponder);
    const err = await captureError(
      client(fetch, { timeoutMs: 20, maxRetries: 1 }).getJson(URL_A, schema),
    );
    expect(err.kind).toBe('timeout');
    expect(fetch.calls).toHaveLength(2);
  });

  it('reports network failures as "Unable to reach Wikimedia API."', async () => {
    const fetch = sequenceFetch(() => {
      throw new TypeError('fetch failed');
    });
    const err = await captureError(client(fetch, { maxRetries: 0 }).getJson(URL_A, schema));
    expect(err.kind).toBe('network');
    expect(err.message).toBe('Unable to reach Wikimedia API.');
  });

  it('rejects malformed JSON and schema mismatches', async () => {
    const bad = await captureError(
      client(sequenceFetch(() => textResponse('<html>oops'))).getJson(URL_A, schema),
    );
    expect(bad.kind).toBe('invalid_response');
    const wrong = await captureError(
      client(sequenceFetch(() => jsonResponse({ ok: 'yes' }))).getJson(URL_A, schema),
    );
    expect(wrong.kind).toBe('invalid_response');
    const empty = await captureError(
      client(sequenceFetch(() => textResponse(''))).getJson(URL_A, schema),
    );
    expect(empty.kind).toBe('invalid_response');
  });

  it('caches validated responses and re-validates cached entries', async () => {
    const cache = new MemoryCache();
    const fetch = sequenceFetch(() => jsonResponse({ ok: true }));
    const http = client(fetch, { cache });
    await http.getJson(URL_A, schema, { cacheTtlMs: 1000 });
    await http.getJson(URL_A, schema, { cacheTtlMs: 1000 });
    expect(fetch.calls).toHaveLength(1);
    expect(http.networkRequests).toBe(1);
    // A cached entry that no longer matches the schema is refetched.
    await cache.set('https://example.org/b', { ok: 'corrupt' });
    await http.getJson('https://example.org/b', schema, { cacheTtlMs: 1000 });
    expect(fetch.calls).toHaveLength(2);
  });

  it('de-duplicates concurrent identical requests and limits concurrency', async () => {
    let active = 0;
    let peak = 0;
    const fetch = sequenceFetch(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return jsonResponse({ ok: true });
    });
    const http = client(fetch, { maxConcurrent: 2 });
    await Promise.all([
      http.getJson(URL_A, schema),
      http.getJson(URL_A, schema),
      ...[1, 2, 3, 4].map((i) => http.getJson(`https://example.org/${String(i)}`, schema)),
    ]);
    expect(fetch.calls.filter((c) => c === URL_A)).toHaveLength(1);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('uses WIA_USER_AGENT when set', () => {
    expect(resolveUserAgent({})).toBe(DEFAULT_USER_AGENT);
    expect(resolveUserAgent({ WIA_USER_AGENT: ' my-app/2 (me@example.org) ' })).toBe(
      'my-app/2 (me@example.org)',
    );
  });
});
