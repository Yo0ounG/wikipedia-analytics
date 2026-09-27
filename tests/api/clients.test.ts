import { describe, expect, it } from '@jest/globals';
import { ApiError, HttpClient } from '../../src/api/http-client.js';
import { MediaWikiClient } from '../../src/api/mediawiki-client.js';
import { PageviewsClient } from '../../src/api/pageviews-client.js';
import { WikidataClient } from '../../src/api/wikidata-client.js';
import { silentLogger } from '../../src/utils/logging.js';
import { jsonResponse, noSleep, sequenceFetch, type Responder } from '../helpers/fake-fetch.js';
import { readFixture } from '../helpers/fixtures.js';

function http(...responders: Responder[]) {
  const fetch = sequenceFetch(...responders);
  return {
    fetch,
    http: new HttpClient({
      userAgent: 't',
      logger: silentLogger,
      fetch,
      sleep: noSleep,
      maxRetries: 0,
    }),
  };
}

const EN = { language: 'en', dbname: 'enwiki', host: 'en.wikipedia.org', project: 'en.wikipedia' };

describe('MediaWikiClient', () => {
  it('builds the site matrix from the official API, skipping closed wikis', async () => {
    const { http: h } = http(() => jsonResponse(readFixture('wikipedia/sitematrix.json')));
    const sites = await new MediaWikiClient(h).getWikipediaSites();
    expect(sites.get('pl')).toEqual({
      language: 'pl',
      dbname: 'plwiki',
      host: 'pl.wikipedia.org',
      project: 'pl.wikipedia',
    });
    expect(sites.get('be-tarask')?.dbname).toBe('be_x_oldwiki');
    expect(sites.get('simple')?.project).toBe('simple.wikipedia');
    expect(sites.has('aa')).toBe(false); // closed
  });

  it('retries the site matrix after a failure instead of caching the error', async () => {
    const { http: h, fetch } = http(
      () => jsonResponse({}, 500),
      () => jsonResponse(readFixture('wikipedia/sitematrix.json')),
    );
    const client = new MediaWikiClient(h);
    await expect(client.getWikipediaSites()).rejects.toBeInstanceOf(ApiError);
    await expect(client.getSite('cs')).resolves.toMatchObject({ dbname: 'cswiki' });
    expect(fetch.calls).toHaveLength(2);
  });

  it('rejects an empty site matrix', async () => {
    const { http: h } = http(() => jsonResponse({ sitematrix: { count: 0 } }));
    await expect(new MediaWikiClient(h).getWikipediaSites()).rejects.toThrow(/no Wikipedias/);
  });

  it('parses real title lookups, redirects and missing pages', async () => {
    const { http: h, fetch } = http(
      () => jsonResponse(readFixture('wikipedia/lookup-intermittent-fasting.json')),
      () => jsonResponse(readFixture('wikipedia/lookup-alternate-day-fasting.json')),
      () => jsonResponse(readFixture('wikipedia/lookup-if-diet.json')),
      () => jsonResponse(readFixture('wikipedia/lookup-mercury.json')),
    );
    const c = new MediaWikiClient(h);
    const exact = await c.lookupTitle(EN, 'intermittent fasting');
    expect(exact.page).toMatchObject({
      title: 'Intermittent fasting',
      qid: 'Q1666254',
      isDisambiguation: false,
    });
    expect(exact.redirectedFrom).toBeNull();
    const redirect = await c.lookupTitle(EN, 'Alternate-day fasting');
    expect(redirect.redirectedFrom).toBe('Alternate-day fasting');
    expect(redirect.page?.qid).toBe('Q1666254');
    expect((await c.lookupTitle(EN, 'IF diet')).page).toBeNull();
    expect((await c.lookupTitle(EN, 'Mercury')).page?.isDisambiguation).toBe(true);
    expect(new URL(fetch.calls[0] ?? '').searchParams.get('titles')).toBe('intermittent fasting');
  });

  it('parses real search results ordered by rank and disambiguation links', async () => {
    const { http: h } = http(
      () => jsonResponse(readFixture('wikipedia/search-intermittent-fasting.json')),
      () => jsonResponse(readFixture('wikipedia/links-mercury.json')),
    );
    const c = new MediaWikiClient(h);
    const results = await c.search(EN, 'intermittent fasting');
    expect(results[0]?.title).toBe('Intermittent fasting');
    expect(results.map((r) => r.searchRank)).toEqual(
      [...results.map((r) => r.searchRank)].sort((a, b) => (a ?? 0) - (b ?? 0)),
    );
    const links = await c.disambiguationLinks(EN, 'Mercury');
    expect(links.map((l) => l.qid)).toEqual(expect.arrayContaining(['Q308', 'Q925']));
    expect(links.every((l) => !l.isDisambiguation && l.qid !== null)).toBe(true);
  });

  it('surfaces MediaWiki API errors', async () => {
    const { http: h } = http(() =>
      jsonResponse({ error: { code: 'badvalue', info: 'Bad value' } }),
    );
    await expect(new MediaWikiClient(h).search(EN, 'x')).rejects.toThrow(/Bad value/);
  });
});

describe('WikidataClient', () => {
  it('maps a real entity to labels and sitelinks', async () => {
    const { http: h, fetch } = http(() => jsonResponse(readFixture('wikidata/Q1666254.json')));
    const item = await new WikidataClient(h).getItem('Q1666254', {
      sites: ['plwiki', 'cswiki'],
      languages: ['en'],
    });
    expect(item?.sitelinks['cswiki']).toBe('Přerušovaný půst');
    expect(item?.sitelinks['plwiki']).toBeUndefined();
    expect(item?.labels['en']).toBe('intermittent fasting');
    expect(new URL(fetch.calls[0] ?? '').searchParams.get('sitefilter')).toBe('cswiki|plwiki');
  });

  it('returns null for a missing entity and rejects invalid QIDs', async () => {
    const { http: h } = http(() => jsonResponse({ error: { code: 'no-such-entity', info: 'x' } }));
    const client = new WikidataClient(h);
    await expect(client.getItem('Q999999999', { sites: [], languages: [] })).resolves.toBeNull();
    await expect(client.getItem('Mercury', { sites: [], languages: [] })).rejects.toThrow(
      /Invalid Wikidata QID/,
    );
  });

  it('surfaces other Wikidata errors', async () => {
    const { http: h } = http(() => jsonResponse({ error: { code: 'maxlag', info: 'lagged' } }));
    await expect(new WikidataClient(h).getItem('Q1', { sites: [], languages: [] })).rejects.toThrow(
      /lagged/,
    );
  });
});

describe('PageviewsClient', () => {
  const req = {
    project: 'pl.wikipedia',
    start: '2024-01-01',
    end: '2024-01-02',
    access: 'all-access',
    agent: 'user',
  } as const;

  it('encodes the article and maps items to internal points', async () => {
    const { http: h, fetch } = http(() =>
      jsonResponse({
        items: [
          {
            project: 'pl.wikipedia',
            article: 'AC/DC',
            granularity: 'daily',
            timestamp: '2024010100',
            access: 'all-access',
            agent: 'user',
            views: 5,
          },
        ],
      }),
    );
    const result = await new PageviewsClient(h).getArticleDaily({ ...req, title: 'AC/DC' });
    expect(result).toEqual({ points: [{ date: '2024-01-01', views: 5 }], noData: false });
    expect(fetch.calls[0]).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/pl.wikipedia/all-access/user/AC%2FDC/daily/20240101/20240102',
    );
  });

  it('treats 404 as "no recorded views" and empty item lists as empty', async () => {
    const { http: h } = http(
      () => jsonResponse({ title: 'Not Found' }, 404),
      () => jsonResponse({ items: [] }),
    );
    const c = new PageviewsClient(h);
    await expect(c.getArticleDaily({ ...req, title: 'X' })).resolves.toEqual({
      points: [],
      noData: true,
    });
    await expect(c.getArticleDaily({ ...req, title: 'Y' })).resolves.toEqual({
      points: [],
      noData: false,
    });
  });

  it('propagates server errors and validates projects', async () => {
    const { http: h } = http(() => jsonResponse({}, 500));
    const c = new PageviewsClient(h);
    await expect(c.getArticleDaily({ ...req, title: 'X' })).rejects.toBeInstanceOf(ApiError);
    await expect(
      c.getArticleDaily({ ...req, project: 'pl.wikipedia/../x', title: 'X' }),
    ).rejects.toThrow(/Invalid Wikipedia project/);
  });

  it('rejects malformed timestamps from the API', async () => {
    const { http: h } = http(() =>
      jsonResponse({
        items: [
          {
            project: 'p',
            article: 'a',
            granularity: 'daily',
            timestamp: '2024-01-01',
            access: 'x',
            agent: 'y',
            views: 1,
          },
        ],
      }),
    );
    await expect(
      new PageviewsClient(h).getArticleDaily({ ...req, title: 'X' }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('fetches edition-wide aggregates', async () => {
    const { http: h, fetch } = http(() =>
      jsonResponse({
        items: [
          {
            project: 'pl.wikipedia',
            granularity: 'daily',
            timestamp: '2024010100',
            access: 'all-access',
            agent: 'user',
            views: 1000,
          },
        ],
      }),
    );
    await expect(new PageviewsClient(h).getProjectDaily(req)).resolves.toEqual([
      { date: '2024-01-01', views: 1000 },
    ]);
    expect(fetch.calls[0]).toContain(
      '/aggregate/pl.wikipedia/all-access/user/daily/2024010100/2024010200',
    );
  });
});
