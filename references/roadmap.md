# Roadmap: evolving the skill iteratively

Version 1 answers the basic questions: one concept, up to 12 languages, daily data, one report.
This roadmap shows how to extend it towards more complex research and larger data volumes.
Each step keeps the same rule: deterministic code computes the numbers, the agent explains them.

## Iteration 2 — better coverage of one concept

- **Redirect views:** sum the views of all redirects to the target article (MediaWiki
  `prop=redirects`, then one pageview request per redirect). Report them separately and combined.
- **Topic clusters:** analyse a concept together with closely related articles (Wikidata
  `subclass of`/`part of`, or a user-approved list of QIDs) as an aggregate "topic index".
- **Multi-topic comparison:** `pnpm compare --qids Q1,Q2,Q3 --languages …` for "which topic
  next?" questions. It would reuse the per-language analysis and add a topic × language matrix.
- **Country view:** Wikimedia's per-country pageview datasets can complement language
  editions, since language ≠ country, which matters for localisation decisions.

## Iteration 3 — larger volumes

- Use `monthly` granularity for multi-year trends (≈30× fewer data points) and daily data only
  where spikes matter.
- Replace the JSON file cache with a local columnar store (SQLite/DuckDB/Parquet). Keep
  incremental updates: fetch only days not yet stored.
- Batch mode with a job queue that respects rate limits (token bucket, shared across runs), plus
  resumable runs.
- Use Wikimedia's bulk pageview dumps instead of the REST API for hundreds of articles.

## Iteration 4 — stronger statistics

- STL decomposition for seasonality with more than two years of data.
- Change-point detection (e.g. PELT) to date structural shifts such as article renames or
  search-engine changes.
- Bootstrap confidence intervals for growth rates; Mann–Kendall with autocorrelation
  correction, if significance statements are ever needed.
- Detection of bot-like spikes (desktop-only bursts, `all-agents` vs `user` divergence).

## Iteration 5 — decision support

- Combine with other signals (search volume, app-store rankings, surveys) in a separate module.
  Pageviews stay one input and are never labelled as demand.
- Configurable scoring profiles for "which audience next" questions. Weights are chosen by
  the user and shown in the report.
- Multi-page report and a slide/one-pager export per topic.

## Iteration 6 — operations

- Automated evaluation harness: scripted conversations run on a cheap model in CI, with checks
  such as "every number in the answer appears in the JSON".
- Expose the CLI as an MCP server so any agent runtime can call it with typed tools.
- Scheduled monitoring that alerts on new spikes or trend changes for a watch-list of topics.
