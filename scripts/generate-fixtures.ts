/**
 * Generates deterministic Pageviews API fixtures (same JSON shape as the real per-article
 * endpoint) for the analysis tests. Re-run with `pnpm tsx scripts/generate-fixtures.ts`;
 * output is byte-for-byte reproducible thanks to a seeded PRNG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eachDay, toCompactDate } from '../src/utils/dates.js';

const START = '2024-01-01';
const END = '2025-12-31';
const OUT = path.join(import.meta.dirname, '..', 'fixtures', 'pageviews');

/** Mulberry32: tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scenario {
  name: string;
  description: string;
  article: string;
  seed: number;
  /** Expected level for day index i (0-based) and date. */
  level: (i: number, date: string) => number;
  noise: number;
  /** Probability that a day is omitted from the response. */
  omit?: number;
  /** Explicit omitted date ranges. */
  gaps?: [string, string][];
  spikes?: { from: string; to: string; factor: number }[];
}

const monthsSinceStart = (i: number): number => i / 30.4375;
const weekly = (date: string): number => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 0.9 : 1.04;
};

const scenarios: Scenario[] = [
  {
    name: 'steady-growth',
    description: '~3%/month exponential growth, weekly cycle, mild noise',
    article: 'Steady_growth',
    seed: 1,
    level: (i) => 200 * 1.03 ** monthsSinceStart(i),
    noise: 0.06,
  },
  {
    name: 'flat',
    description: 'stable level with noise',
    article: 'Flat_topic',
    seed: 2,
    level: () => 500,
    noise: 0.08,
  },
  {
    name: 'declining',
    description: '~3%/month exponential decline',
    article: 'Declining_topic',
    seed: 3,
    level: (i) => 800 * 0.97 ** monthsSinceStart(i),
    noise: 0.06,
  },
  {
    name: 'noisy-growth',
    description: '~1.5%/month growth hidden in heavy noise',
    article: 'Noisy_growth',
    seed: 4,
    level: (i) => 100 * 1.015 ** monthsSinceStart(i),
    noise: 0.45,
  },
  {
    name: 'strong-spike',
    description: 'flat series with a 5-day ×40 news spike in April 2025',
    article: 'Spiky_topic',
    seed: 5,
    level: () => 300,
    noise: 0.06,
    spikes: [{ from: '2025-04-10', to: '2025-04-14', factor: 40 }],
  },
  {
    name: 'seasonal',
    description: 'no trend, strong annual cycle peaking in September',
    article: 'Seasonal_topic',
    seed: 6,
    level: (_i, date) => {
      const month = Number(date.slice(5, 7));
      return 400 * (1 + 0.45 * Math.cos((2 * Math.PI * (month - 9)) / 12));
    },
    noise: 0.06,
  },
  {
    name: 'missing-observations',
    description: 'low-traffic article: 15% random days omitted plus a 10-day gap',
    article: 'Sparse_topic',
    seed: 7,
    level: () => 20,
    noise: 0.2,
    omit: 0.15,
    gaps: [['2024-06-01', '2024-06-10']],
  },
];

mkdirSync(OUT, { recursive: true });
for (const s of scenarios) {
  const rand = prng(s.seed);
  const items = eachDay(START, END).flatMap((date, i) => {
    const r1 = rand();
    const r2 = rand();
    const inGap = (s.gaps ?? []).some(([a, b]) => date >= a && date <= b);
    if (inGap || r1 < (s.omit ?? 0)) return [];
    const spike = (s.spikes ?? []).find((sp) => date >= sp.from && date <= sp.to);
    const noisy = s.level(i, date) * weekly(date) * (1 + s.noise * (2 * r2 - 1));
    const views = Math.max(0, Math.round(noisy * (spike ? spike.factor : 1)));
    return [
      {
        project: 'en.wikipedia',
        article: s.article,
        granularity: 'daily',
        timestamp: `${toCompactDate(date)}00`,
        access: 'all-access',
        agent: 'user',
        views,
      },
    ];
  });
  writeFileSync(path.join(OUT, `${s.name}.json`), `${JSON.stringify({ items })}\n`);
  console.log(`${s.name}: ${String(items.length)} days — ${s.description}`);
}

const projectItems = eachDay(START, END).map((date, i) => ({
  project: 'en.wikipedia',
  access: 'all-access',
  agent: 'user',
  granularity: 'daily',
  timestamp: `${toCompactDate(date)}00`,
  views: Math.round(250_000_000 * (1 - 0.0002 * i)),
}));
writeFileSync(
  path.join(OUT, 'project-aggregate.json'),
  `${JSON.stringify({ items: projectItems })}\n`,
);
console.log('project-aggregate: edition totals, slow decline');
