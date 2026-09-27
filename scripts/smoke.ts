/**
 * Real-API smoke test (needs internet; NOT part of `pnpm test`). Verifies that the Wikimedia
 * APIs are reachable, topic resolution works, pageviews can be retrieved, and that current
 * responses still match the Zod schemas (every client call validates its response).
 *
 *   pnpm smoke
 */
import { resolveUserAgent } from '../src/api/http-client.js';
import { createServices } from '../src/pipeline.js';
import { addDays, latestAvailableDay, todayUtc } from '../src/utils/dates.js';
import { createLogger } from '../src/utils/logging.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<number> {
  const services = createServices({
    logger: createLogger('warn'),
    userAgent: resolveUserAgent(),
    cacheDir: null,
  });
  const checks: Check[] = [];
  const check = async (name: string, fn: () => Promise<string>): Promise<void> => {
    try {
      checks.push({ name, ok: true, detail: await fn() });
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await check('site matrix reachable and parsed', async () => {
    const sites = await services.mediawiki.getWikipediaSites();
    for (const code of ['en', 'pl', 'cs', 'uk']) {
      if (!sites.has(code)) throw new Error(`missing ${code}`);
    }
    return `${String(new Set(sites.values()).size)} Wikipedias`;
  });

  await check('topic resolution: "astronomy" → Q333 in pl, cs, uk', async () => {
    const r = await services.resolver.resolve({
      query: 'astronomy',
      languages: ['pl', 'cs', 'uk'],
      searchLanguage: 'en',
    });
    if (r.qid !== 'Q333' || r.status !== 'resolved')
      throw new Error(`got ${r.status} ${String(r.qid)}`);
    return Object.values(r.articles)
      .map((a) => `${a.language}:${a.title}`)
      .join(', ');
  });

  await check('ambiguity: "Mercury" needs clarification and lists the planet', async () => {
    const r = await services.resolver.resolve({
      query: 'Mercury',
      languages: ['en'],
      searchLanguage: 'en',
    });
    if (r.status !== 'ambiguous') throw new Error(`got ${r.status}`);
    if (!r.candidates.some((c) => c.qid === 'Q308')) throw new Error('Q308 not among candidates');
    return `${String(r.candidates.length)} candidates, first: ${r.candidates[0]?.title ?? '?'}`;
  });

  const end = latestAvailableDay(todayUtc());
  const start = addDays(end, -29);
  await check(`per-article pageviews (uk: Астрономія, ${start}..${end})`, async () => {
    const r = await services.pageviews.getArticleDaily({
      project: 'uk.wikipedia',
      title: 'Астрономія',
      start,
      end,
      access: 'all-access',
      agent: 'user',
    });
    if (r.noData || r.points.length === 0) throw new Error('no data returned');
    return `${String(r.points.length)} days`;
  });

  await check('edition-wide aggregate pageviews (pl.wikipedia)', async () => {
    const p = await services.pageviews.getProjectDaily({
      project: 'pl.wikipedia',
      start,
      end,
      access: 'all-access',
      agent: 'user',
    });
    if (p.length === 0) throw new Error('no data returned');
    return `${String(p.length)} days`;
  });

  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
  console.log(`network requests: ${String(services.http.networkRequests)}`);
  return checks.every((c) => c.ok) ? 0 : 1;
}

process.exitCode = await main();
