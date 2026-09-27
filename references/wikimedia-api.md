# Wikimedia data sources

All endpoints are official, public and need no API key. Every response is validated with Zod
(`src/schemas/api.ts`) before it is mapped to internal models.

## Endpoints used

| purpose                                                 | endpoint                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Wikipedia language editions (codes, db names, hosts)    | `meta.wikimedia.org/w/api.php?action=sitematrix`                                                                           |
| exact title / redirect lookup, QID, disambiguation flag | `{lang}.wikipedia.org/w/api.php?action=query&titles=…&prop=pageprops\|description&redirects=1`                             |
| search                                                  | `…&generator=search&gsrsearch=…`                                                                                           |
| meanings listed on a disambiguation page                | `…&generator=links&titles=<disambiguation page>`                                                                           |
| concept → article per language                          | `www.wikidata.org/w/api.php?action=wbgetentities&ids=Q…&props=sitelinks\|labels\|descriptions`                             |
| per-article daily views                                 | `wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/{access}/{agent}/{article}/daily/{YYYYMMDD}/{YYYYMMDD}` |
| edition-wide daily views                                | `wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/{project}/{access}/{agent}/daily/{start}/{end}`                     |

Documentation: <https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html>,
<https://www.mediawiki.org/wiki/API:Main_page>, <https://www.wikidata.org/wiki/Wikidata:Data_access>.

## Access and agent types

- **access = `all-access`** (default): desktop + mobile web + mobile app combined. The CLI also
  accepts `desktop`, `mobile-web` and `mobile-app`.
- **agent = `user`** (default): traffic Wikimedia classifies as human, after removing identified
  spiders and traffic its heuristics flag as automated. `all-agents` includes them. The
  interest analysis uses `user` because bots do not express human interest.

## What a pageview is

A pageview is one successful request for an article's content, counted by Wikimedia's
pageview definition. Counts are per article title, per day (UTC), per language edition.

## What a pageview is not

- Not a unique visitor or user: one person can generate many views, and no user identifiers exist.
- Not engagement: reading time, scroll depth and satisfaction are unknown.
- Not market demand, purchase intent, revenue potential or willingness to pay.
- Not a country measure: a language edition's readers live in many countries, and one country
  reads several editions.

## Data limitations

- Per-article data starts on **2015-07-01**. Data for a day usually appears within ~24 h; the
  tool never requests days newer than today − 2 days.
- **Days with zero views are omitted** from responses; a range with no views returns HTTP 404.
  Both cases are reported (missing days / `no_data`), never silently filled.
- Views of **redirect titles** are counted under the redirect, not the target article. Only the
  target article's own views are analysed (see `roadmap.md`).
- Bot filtering is heuristic: undetected automated traffic can inflate counts or cause spikes.
- Article renames, merges and splits change which title collects the views.

## Rate limits and etiquette

- An identifiable `User-Agent` / `Api-User-Agent` is sent. Set `WIA_USER_AGENT`
  (e.g. `my-app/1.0 (contact@example.org)`) to include your contact details, as Wikimedia's
  policy asks.
- At most **2 concurrent requests**. Identical in-flight requests are de-duplicated.
- HTTP 429 and 5xx responses are retried with exponential backoff (500 ms × 2^attempt, max 15 s,
  up to 4 retries). `Retry-After` is honoured.
- Filesystem cache (`.cache/`, or `WIA_CACHE_DIR`): each key is the full request URL, so project,
  article, access, agent, granularity and dates are all part of it. TTLs are 30 days for
  pageviews and the site matrix, and 7 days for search, page metadata and Wikidata. Disable with
  `--no-cache`.
