import type { FetchLike } from '../../src/api/http-client.js';

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

export type Responder = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

export interface FakeFetch extends FetchLike {
  calls: string[];
  headers: Headers[];
}

/** Scripted fetch: each call takes the next responder (the last one repeats). */
export function sequenceFetch(...responders: Responder[]): FakeFetch {
  const calls: string[] = [];
  const headers: Headers[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    headers.push(new Headers(init?.headers));
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (!responder) throw new TypeError('no responder');
    return responder(new URL(url), init);
  }) as FakeFetch;
  fn.calls = calls;
  fn.headers = headers;
  return fn;
}

/** Fetch that never resolves until aborted (for timeout tests). */
export const hangingResponder: Responder = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

export const noSleep = (): Promise<void> => Promise.resolve();
