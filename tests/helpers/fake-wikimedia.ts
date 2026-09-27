/**
 * In-memory fake of the three Wikimedia APIs used by the tool, backed by fixtures.
 * Lets resolver, pipeline and CLI tests run fully offline and deterministically.
 */
import type { FakeFetch } from './fake-fetch.js';
import { jsonResponse } from './fake-fetch.js';
import { loadPoints, readFixture, type PageviewScenario } from './fixtures.js';
import { toCompactDate } from '../../src/utils/dates.js';

interface PageSpec {
  title: string;
  qid?: string;
  description?: string;
  disambiguation?: boolean;
  missing?: boolean;
}

export interface FakeWikimediaConfig {
  /** `${host}|${requested title}` → page (or redirect target). */
  titles?: Record<string, PageSpec & { redirectFrom?: string }>;
  /** `${host}|${query}` → ranked search results. */
  searches?: Record<string, PageSpec[]>;
  /** `${host}|${disambiguation title}` → linked pages. */
  links?: Record<string, PageSpec[]>;
  /** QID → { labels, descriptions, sitelinks: dbname → title }. */
  entities?: Record<
    string,
    {
      labels?: Record<string, string>;
      descriptions?: Record<string, string>;
      sitelinks?: Record<string, string>;
    }
  >;
  /** `${project}|${title}` → scenario fixture, 'notfound' (404) or explicit points. */
  pageviews?: Record<string, PageviewScenario | 'notfound' | { date: string; views: number }[]>;
  /** When false, the aggregate endpoint returns 500. */
  projectViews?: boolean;
}

function page(spec: PageSpec, index?: number): Record<string, unknown> {
  if (spec.missing) return { ns: 0, title: spec.title, missing: true };
  const pageprops: Record<string, string> = {};
  if (spec.qid) pageprops['wikibase_item'] = spec.qid;
  if (spec.disambiguation) pageprops['disambiguation'] = '';
  return {
    pageid: Math.abs(
      Array.from(spec.title, (c) => c.charCodeAt(0)).reduce((h, c) => (h * 31 + c) | 0, 7),
    ),
    ns: 0,
    title: spec.title,
    ...(index !== undefined ? { index } : {}),
    pageprops,
    ...(spec.description ? { description: spec.description } : {}),
  };
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function compactToIso(c: string): string {
  return `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
}

export function fakeWikimedia(config: FakeWikimediaConfig): FakeFetch {
  const calls: string[] = [];
  const fn = (async (raw: string) => {
    await Promise.resolve();
    calls.push(raw);
    const url = new URL(raw);
    const q = url.searchParams;

    if (url.host === 'meta.wikimedia.org' && q.get('action') === 'sitematrix') {
      return jsonResponse(readFixture('wikipedia/sitematrix.json'));
    }

    if (url.host === 'www.wikidata.org' && q.get('action') === 'wbgetentities') {
      const qid = q.get('ids') ?? '';
      const e = config.entities?.[qid];
      if (!e) {
        return jsonResponse({
          error: { code: 'no-such-entity', info: `Could not find an entity with the ID "${qid}".` },
        });
      }
      const sites = (q.get('sitefilter') ?? '').split('|');
      const sitelinks = Object.fromEntries(
        Object.entries(e.sitelinks ?? {})
          .filter(([site]) => sites.includes(site))
          .map(([site, title]) => [site, { site, title, badges: [] }]),
      );
      const terms = (m: Record<string, string> | undefined): Record<string, unknown> =>
        Object.fromEntries(
          Object.entries(m ?? {}).map(([language, value]) => [language, { language, value }]),
        );
      return jsonResponse({
        entities: {
          [qid]: {
            type: 'item',
            id: qid,
            labels: terms(e.labels),
            descriptions: terms(e.descriptions),
            sitelinks,
          },
        },
        success: 1,
      });
    }

    if (url.pathname === '/w/api.php' && q.get('action') === 'query') {
      const host = url.host;
      if (q.get('generator') === 'search') {
        const results = config.searches?.[`${host}|${q.get('gsrsearch') ?? ''}`] ?? [];
        return jsonResponse({
          batchcomplete: true,
          query: { pages: results.map((r, i) => page(r, i + 1)) },
        });
      }
      if (q.get('generator') === 'links') {
        const results = config.links?.[`${host}|${q.get('titles') ?? ''}`] ?? [];
        return jsonResponse({ batchcomplete: true, query: { pages: results.map((r) => page(r)) } });
      }
      const title = q.get('titles') ?? '';
      const spec = config.titles?.[`${host}|${title}`];
      if (!spec)
        return jsonResponse({
          batchcomplete: true,
          query: { pages: [{ ns: 0, title, missing: true }] },
        });
      return jsonResponse({
        batchcomplete: true,
        query: {
          ...(spec.redirectFrom
            ? { redirects: [{ from: spec.redirectFrom, to: spec.title }] }
            : {}),
          pages: [page(spec)],
        },
      });
    }

    if (
      url.host === 'wikimedia.org' &&
      url.pathname.startsWith('/api/rest_v1/metrics/pageviews/')
    ) {
      const parts = url.pathname.split('/').slice(5); // after /api/rest_v1/metrics/pageviews
      const kind = parts[0];
      if (kind === 'aggregate') {
        if (config.projectViews === false) return jsonResponse({ title: 'error' }, 500);
        const [, project, access, agent, , startTs, endTs] = parts;
        const start = compactToIso(startTs ?? '');
        const end = compactToIso(endTs ?? '');
        const items = loadPoints('project-aggregate')
          .filter((p) => inRange(p.date, start, end))
          .map((p) => ({
            project,
            access,
            agent,
            granularity: 'daily',
            timestamp: `${toCompactDate(p.date)}00`,
            views: p.views,
          }));
        return jsonResponse({ items });
      }
      const [, project, access, agent, article, , startC, endC] = parts;
      const title = decodeURIComponent(article ?? '').replaceAll('_', ' ');
      const source = config.pageviews?.[`${project ?? ''}|${title}`];
      const start = compactToIso(startC ?? '');
      const end = compactToIso(endC ?? '');
      if (source === undefined || source === 'notfound') {
        return jsonResponse({ title: 'Not Found', status: 404, detail: 'no data' }, 404);
      }
      const points = typeof source === 'string' ? loadPoints(source) : source;
      const items = points
        .filter((p) => inRange(p.date, start, end))
        .map((p) => ({
          project,
          article: title,
          granularity: 'daily',
          timestamp: `${toCompactDate(p.date)}00`,
          access,
          agent,
          views: p.views,
        }));
      return jsonResponse({ items });
    }

    throw new TypeError(`fake-wikimedia: unexpected request ${raw}`);
  }) as FakeFetch;
  fn.calls = calls;
  fn.headers = [];
  return fn;
}

/** A realistic configuration used by several resolver, pipeline and CLI tests. */
export const STANDARD_CONFIG: FakeWikimediaConfig = {
  titles: {
    'en.wikipedia.org|intermittent fasting': {
      title: 'Intermittent fasting',
      qid: 'Q1666254',
      description: 'Various systems to schedule meals',
    },
    'en.wikipedia.org|Alternate-day fasting': {
      title: 'Intermittent fasting',
      qid: 'Q1666254',
      description: 'Various systems to schedule meals',
      redirectFrom: 'Alternate-day fasting',
    },
    'en.wikipedia.org|Mercury': {
      title: 'Mercury',
      qid: 'Q48397',
      disambiguation: true,
      description: 'Topics referred to by the same term',
    },
    'en.wikipedia.org|astronomy': {
      title: 'Astronomy',
      qid: 'Q333',
      description: 'Scientific study of celestial objects',
    },
    'uk.wikipedia.org|астрономія': { title: 'Астрономія', qid: 'Q333' },
  },
  searches: {
    'en.wikipedia.org|intermittent fasting': [
      {
        title: 'Intermittent fasting',
        qid: 'Q1666254',
        description: 'Various systems to schedule meals',
      },
      { title: 'Fasting', qid: 'Q124425' },
    ],
    'en.wikipedia.org|fasting intermittent': [
      {
        title: 'Intermittent fasting',
        qid: 'Q1666254',
        description: 'Various systems to schedule meals',
      },
      { title: 'Fasting', qid: 'Q124425' },
    ],
    'en.wikipedia.org|IF diet': [
      { title: 'Diet', qid: 'Q16281224', disambiguation: true },
      { title: 'Macrobiotic diet', qid: 'Q1163963' },
      { title: 'Intermittent fasting', qid: 'Q1666254' },
    ],
    'en.wikipedia.org|astronomy': [
      { title: 'Astronomy', qid: 'Q333' },
      { title: 'Astronomy (magazine)', qid: 'Q1571282' },
    ],
    'en.wikipedia.org|zzqqxx': [],
  },
  links: {
    'en.wikipedia.org|Mercury': [
      { title: 'Mercury (planet)', qid: 'Q308', description: 'First planet from the Sun' },
      {
        title: 'Mercury (element)',
        qid: 'Q925',
        description: 'Chemical element with atomic number 80',
      },
      { title: 'Mercury (mythology)', qid: 'Q47652', description: 'Roman god' },
      { title: 'Freddie Mercury', qid: 'Q15869' },
    ],
  },
  entities: {
    Q1666254: {
      labels: { en: 'intermittent fasting', cs: 'přerušovaný půst', uk: 'інтервальне голодування' },
      sitelinks: {
        enwiki: 'Intermittent fasting',
        cswiki: 'Přerušovaný půst',
        ukwiki: 'Інтервальне голодування',
      },
    },
    Q333: {
      labels: { en: 'astronomy', pl: 'astronomia', cs: 'astronomie', uk: 'астрономія' },
      sitelinks: {
        enwiki: 'Astronomy',
        plwiki: 'Astronomia',
        cswiki: 'Astronomie',
        ukwiki: 'Астрономія',
      },
    },
    Q308: {
      labels: { en: 'Mercury' },
      sitelinks: { enwiki: 'Mercury (planet)', plwiki: 'Merkury', cswiki: 'Merkur' },
    },
  },
  pageviews: {
    'pl.wikipedia|Astronomia': 'steady-growth',
    'cs.wikipedia|Astronomie': 'noisy-growth',
    'uk.wikipedia|Астрономія': 'strong-spike',
    'en.wikipedia|Astronomy': 'seasonal',
    'cs.wikipedia|Přerušovaný půst': 'declining',
    'uk.wikipedia|Інтервальне голодування': 'missing-observations',
    'pl.wikipedia|Merkury': 'flat',
    'cs.wikipedia|Merkur': 'flat',
  },
};

/** Fixed clock: fixtures cover 2024–2025, so "today" is early January 2026. */
export const FIXED_NOW = new Date('2026-01-05T12:00:00Z');
