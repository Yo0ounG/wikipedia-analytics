import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { perArticleResponseSchema } from '../../src/schemas/api.js';
import type { PageviewPoint } from '../../src/types/pageviews.js';
import { fromWikimediaTimestamp } from '../../src/utils/dates.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(ROOT, 'fixtures');

export function readFixture(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, relative), 'utf8'));
}

export type PageviewScenario =
  | 'steady-growth'
  | 'flat'
  | 'declining'
  | 'noisy-growth'
  | 'strong-spike'
  | 'seasonal'
  | 'missing-observations';

/** Fixture period: two full calendar years. */
export const FIXTURE_START = '2024-01-01';
export const FIXTURE_END = '2025-12-31';

export function loadPoints(name: PageviewScenario | 'project-aggregate'): PageviewPoint[] {
  const raw = readFixture(`pageviews/${name}.json`) as {
    items: { timestamp: string; views: number }[];
  };
  if (name !== 'project-aggregate') perArticleResponseSchema.parse(raw);
  return raw.items.map((i) => ({ date: fromWikimediaTimestamp(i.timestamp), views: i.views }));
}
