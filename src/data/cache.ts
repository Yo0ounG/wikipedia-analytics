import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * Response cache. Keys are full request URLs, which contain every request parameter
 * (project, article, access, agent, granularity, dates), so different requests can never
 * collide. Values are the raw JSON bodies; they are re-validated by the caller on every read.
 */
export interface ResponseCache {
  get(key: string, maxAgeMs: number): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const entrySchema = z.object({
  key: z.string(),
  storedAt: z.number(),
  value: z.unknown(),
});

export class FileCache implements ResponseCache {
  constructor(
    private readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {}

  static hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private fileFor(key: string): string {
    const hash = FileCache.hashKey(key);
    return path.join(this.directory, hash.slice(0, 2), `${hash}.json`);
  }

  async get(key: string, maxAgeMs: number): Promise<unknown> {
    let raw: string;
    try {
      raw = await readFile(this.fileFor(key), 'utf8');
    } catch {
      return undefined;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const parsed = entrySchema.safeParse(json);
    if (!parsed.success || parsed.data.key !== key) return undefined;
    if (this.now() - parsed.data.storedAt > maxAgeMs) return undefined;
    return parsed.data.value;
  }

  async set(key: string, value: unknown): Promise<void> {
    const file = this.fileFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${String(process.pid)}.tmp`;
    await writeFile(tmp, JSON.stringify({ key, storedAt: this.now(), value }), 'utf8');
    await rename(tmp, file);
  }
}

export class MemoryCache implements ResponseCache {
  private readonly entries = new Map<string, { storedAt: number; value: unknown }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string, maxAgeMs: number): Promise<unknown> {
    const e = this.entries.get(key);
    if (!e || this.now() - e.storedAt > maxAgeMs) return Promise.resolve(undefined);
    return Promise.resolve(e.value);
  }

  set(key: string, value: unknown): Promise<void> {
    this.entries.set(key, { storedAt: this.now(), value });
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** TTLs by kind of data. Historical pageviews are effectively immutable once published. */
export const CACHE_TTL = {
  siteMatrix: 30 * DAY_MS,
  search: 7 * DAY_MS,
  pageMetadata: 7 * DAY_MS,
  wikidata: 7 * DAY_MS,
  pageviews: 30 * DAY_MS,
} as const;
