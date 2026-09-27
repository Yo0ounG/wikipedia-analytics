/**
 * Regression tests on responses captured from the real en.wikipedia API (fixtures/wikipedia).
 * They pin down behaviour that synthetic fixtures missed, e.g. that disambiguation links arrive
 * alphabetically, which once hid "Mercury (planet)" from the candidate list.
 */
import { describe, expect, it } from '@jest/globals';
import { HttpClient } from '../../src/api/http-client.js';
import { MediaWikiClient } from '../../src/api/mediawiki-client.js';
import { WikidataClient } from '../../src/api/wikidata-client.js';
import { TopicResolver } from '../../src/resolver/topic-resolver.js';
import { silentLogger } from '../../src/utils/logging.js';
import { jsonResponse, noSleep, type FakeFetch } from '../helpers/fake-fetch.js';
import { readFixture } from '../helpers/fixtures.js';

const EN = { language: 'en', dbname: 'enwiki', host: 'en.wikipedia.org', project: 'en.wikipedia' };

/** Route real captured responses by the query parameters that identify them. */
function routedFetch(routes: Record<string, string>): FakeFetch {
  const calls: string[] = [];
  const fn = ((url: string) => {
    calls.push(url);
    const q = new URL(url).searchParams;
    const key =
      q.get('generator') === 'search'
        ? `search:${q.get('gsrsearch') ?? ''}`
        : q.get('generator') === 'links'
          ? `links:${q.get('titles') ?? ''}`
          : `lookup:${q.get('titles') ?? ''}`;
    const fixture = routes[key];
    return Promise.resolve(
      fixture
        ? jsonResponse(readFixture(`wikipedia/${fixture}`))
        : jsonResponse({ batchcomplete: true, query: { pages: [] } }),
    );
  }) as FakeFetch;
  fn.calls = calls;
  fn.headers = [];
  return fn;
}

function resolver(routes: Record<string, string>): TopicResolver {
  const http = new HttpClient({
    userAgent: 't',
    logger: silentLogger,
    fetch: routedFetch(routes),
    sleep: noSleep,
    maxRetries: 0,
  });
  return new TopicResolver(new MediaWikiClient(http), new WikidataClient(http));
}

describe('resolver on real captured responses', () => {
  it('"Mercury": disambiguation → the planet and the element are the first candidates', async () => {
    const r = resolver({
      'lookup:Mercury': 'lookup-mercury.json',
      'links:Mercury': 'links-mercury.json',
      'search:Mercury': 'search-mercury.json',
    });
    const c = await r.resolveConcept('Mercury', EN);
    expect(c.status).toBe('ambiguous');
    const top = c.candidates.slice(0, 3).map((x) => x.title);
    expect(top).toEqual(expect.arrayContaining(['Mercury (planet)', 'Mercury (element)']));
    // Alphabetical order would have started with unrelated entries.
    expect(c.candidates.length).toBeGreaterThanOrEqual(5);
  });

  it('"IF diet": no exact title and no clear search hit → clarification, not a guess', async () => {
    const r = resolver({
      'lookup:IF diet': 'lookup-if-diet.json',
      'search:IF diet': 'search-if-diet.json',
    });
    const c = await r.resolveConcept('IF diet', EN);
    expect(c.status).toBe('ambiguous');
    expect(c.qid).toBeNull();
  });

  it('"Intermittent Fasting" (wrong case, no redirect) → search match with high confidence', async () => {
    const r = resolver({
      'lookup:Intermittent Fasting': 'lookup-intermittent-fasting-capitalized.json',
      'search:Intermittent Fasting': 'search-intermittent-fasting.json',
    });
    const c = await r.resolveConcept('Intermittent Fasting', EN);
    expect(c).toMatchObject({
      status: 'resolved',
      qid: 'Q1666254',
      method: 'search_match',
      confidence: 'high',
    });
  });

  it('"Alternate-day fasting" redirect → the intermittent fasting concept', async () => {
    const r = resolver({
      'lookup:Alternate-day fasting': 'lookup-alternate-day-fasting.json',
      'search:Alternate-day fasting': 'search-intermittent-fasting.json',
    });
    const c = await r.resolveConcept('Alternate-day fasting', EN);
    expect(c).toMatchObject({ status: 'resolved', qid: 'Q1666254', method: 'redirect' });
  });
});
