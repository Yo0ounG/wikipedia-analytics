# wikipedia-interest-analysis

An [Agent Skill](https://agentskills.io/specification) plus a TypeScript CLI that shows how
interest in a topic changes on Wikipedia across language editions. It uses official Wikimedia
pageview data and produces a structured JSON result, SVG charts and a one-page PDF report.

It is built for questions such as:

- "Compare interest in intermittent fasting in Polish and Czech Wikipedia over the last two years."
- "Is interest in astronomy growing in Ukrainian Wikipedia, and how much can we trust that?"
- "Compare interest in the English language across our target language editions. Which audiences
  should we research next?"

> Wikipedia pageviews measure **attention to Wikipedia articles**. They are not unique users,
> market demand, purchase intent or willingness to pay. The tool and the skill say so explicitly.

## What this tool does

1. **Resolves the concept, not the string.** MediaWiki search and title lookup (with redirects)
   find the concept's Wikidata QID. Wikidata sitelinks then give the right article in every
   requested language (`astronomy` → Q333 → `Astronomia`, `Astronomie`, `Астрономія`).
   Disambiguation pages and unclear matches return `needs_clarification` with candidates.
   Missing articles are reported, never substituted.
2. **Fetches daily pageviews** for each article and the edition-wide totals, with retries, a
   rate limit, caching and Zod validation.
3. **Analyses deterministically:** validation and completeness; monthly, weekly and daily
   aggregation; baseline vs latest windows; log-linear and linear trends; Spearman ρ; robust
   spike detection and spike influence; seasonality and year-over-year change; share of edition
   traffic; a normalised growth index (100 = baseline); and a rule-based evidence strength.
4. **Produces artifacts:** `analysis.json` (schema-validated), three SVG charts and a
   one-page PDF.
5. **Supports follow-ups:** `--from analysis.json` keeps the topic, QID, languages, period and
   exclusions, and changes only what you pass.

## Architecture

```
User ─► AI agent ─► SKILL.md ─► CLI (src/cli)
                                 │
                 ┌───────────────┴───────────────────────────────────────────────┐
                 │ resolver/   topic → QID (MediaWiki) → sitelinks (Wikidata)    │
                 │ api/        HttpClient (UA, timeout, retry/backoff, 429/5xx,  │
                 │             concurrency=2, de-dup, cache) + 3 typed clients   │
                 │ data/       fetch → validate → normalise/exclude → aggregate  │
                 │ analysis/   metrics · trend · outliers · seasonality ·        │
                 │             comparison · evidence · findings                  │
                 │ charts/     deterministic SVG (d3-scale / d3-shape)           │
                 │ report/     validation → content model → PDFKit one-pager     │
                 │ schemas/    Zod: API shapes, CLI input, public output contract│
                 └───────────────┬───────────────────────────────────────────────┘
                                 ▼
             JSON on stdout + output/<topic>-<QID>/<langs>_<start>_<end>/…
                                 ▼
                 AI agent explains the numbers (never computes them)
```

- External responses are validated at the boundary (`schemas/api.ts`) and mapped to internal
  models. Raw API shapes never leave `api/`.
- The output contract (`schemas/output.ts`) is the single source of types (`z.infer`). Every
  result is validated before it is printed or written.
- `pipeline.ts` wires everything together and is used by both the CLI and the E2E tests.

```
wikipedia-interest-analysis/
├── SKILL.md              agent instructions (concise)
├── references/           methodology, API notes, interpretation guide, roadmap
├── src/                  api/ resolver/ data/ analysis/ charts/ report/ schemas/ types/ utils/ cli/
├── tests/                unit, API, resolver, analysis, chart, PDF, CLI/E2E (offline)
├── fixtures/             captured real API responses + deterministic synthetic pageview series
├── scripts/              smoke.ts (real API), generate-fixtures.ts
├── evals/                prompts, expected behaviour, results, transcripts, grounding checker
├── examples/             a real generated analysis (JSON, SVG charts, one-page PDF)
└── output/               generated artifacts (git-ignored)
```

## Requirements

- Node.js **22+**
- pnpm 10 (`corepack enable`, or run it without installing via `npx pnpm@10 …`)
- Internet access to Wikimedia for real analyses. Tests run offline.
- No API keys. Optionally set `WIA_USER_AGENT="your-app/1.0 (you@example.org)"` to identify
  yourself to Wikimedia, as their User-Agent policy asks.

## Installation

```bash
pnpm install
```

Dependencies are pinned in `pnpm-lock.yaml`. No compiled binaries are committed. The CLI runs
the TypeScript sources through `tsx`, so no build step is needed to use the skill.

## Build

```bash
pnpm build        # tsup → dist/cli.js (optional; `node dist/cli.js …`)
```

## Test

```bash
pnpm test             # offline, deterministic (fake Wikimedia APIs + fixtures)
pnpm test:coverage    # with coverage thresholds
pnpm smoke            # real Wikimedia API smoke test (needs internet)
pnpm consistency <output dir>   # JSON ↔ SVG ↔ PDF numeric cross-check of one analysis
pnpm eval:grounding <answer.md> <analysis.json>   # every number in an answer must be in the JSON
```

## Typecheck

```bash
pnpm typecheck
```

## Lint

```bash
pnpm lint             # ESLint (typescript-eslint strict-type-checked)
pnpm format:check     # Prettier
```

## Full verification

Step-by-step manual verification guide with three use cases (in Ukrainian):
[`VERIFICATION.md`](VERIFICATION.md).

```bash
pnpm check            # typecheck + lint + format:check + test:coverage + build
```

## Usage

```bash
# Analyse (compact JSON summary on stdout; artifacts under output/)
pnpm analyze --topic "intermittent fasting" --languages pl,cs --period 2y
pnpm analyze --topic astronomy --languages uk,pl,cs --period 2y --format text
pnpm analyze --topic "астрономія" --search-lang uk --languages uk
pnpm analyze --qid Q308 --languages de,fr --start 2025-01-01 --end 2025-12-31

# Resolve only (no pageviews)
pnpm resolve-topic --query Mercury --languages de,fr

# Follow-ups reuse the previous analysis
pnpm analyze --from last --period 12m                 # "last" = the most recent analysis
pnpm analyze --from last --exclude-largest-spike
pnpm analyze --from last --exclude-dates 2025-04-14..2025-04-15
pnpm analyze --from output/astronomy-Q333/uk-pl-cs_2024-09-01_2026-08-31/analysis.json --languages pl,cs,de

# Re-render charts + PDF offline from JSON
pnpm generate-report --input <analysis.json>
```

Main options: `--languages`, `--period` (`90d`, `12w`, `12m`, `2y`) or `--start/--end`,
`--search-lang`, `--exclude-dates`, `--exclude-largest-spike`, `--clear-exclusions`,
`--missing-as-zero`, `--access`, `--agent`, `--no-charts`, `--no-report`,
`--format summary|full|text`, and the global `--log-level`, `--no-cache`.

Exit codes: `0` success/partial, `2` needs clarification, `3` not found / no articles /
insufficient data, `4` invalid input, `5` network or rate limit, `1` internal error.

### Real example (run on 2026-09-26)

`pnpm analyze --topic astronomy --languages uk,pl,cs --period 2y` (Sep 2024 – Aug 2026, 12-month windows):

| lang | article    | avg/day baseline → latest | change | trend                     | evidence |
| ---- | ---------- | ------------------------- | ------ | ------------------------- | -------- |
| uk   | Астрономія | 45.5 → 18.4               | −59.6% | down, −6.5%/mo (high)¹    | high     |
| pl   | Astronomia | 56.1 → 47.1               | −16.1% | down, −3.3%/mo (moderate) | high     |
| cs   | Astronomie | 25.4 → 17.0               | −33.3% | down, −3.7%/mo (high)     | high     |

The share of all pl.wikipedia views changed −8.0% while the edition's traffic changed −8.8%.
So the Polish decline is mostly edition-wide, not specific to the topic. In the Ukrainian
edition, the topic's share fell −46.4% against −24.6% for the edition.

¹ The Ukrainian series has a detected seasonal pattern (peak in September), so its trend is
fitted on seasonally adjusted months.

The generated JSON, charts and one-page PDF for this run are in
[`examples/astronomy-uk-pl-cs/`](examples/astronomy-uk-pl-cs/).

## Agent Skill usage

Place the folder where your agent loads skills (e.g. `.claude/skills/wikipedia-interest-analysis`)
and run `pnpm install` once. `SKILL.md` tells the agent to:

- map the request to CLI flags and run `pnpm analyze`;
- branch on `status` and the exit code, and **ask** the user when a topic is ambiguous;
- quote numbers only from the JSON (`findings` sentences are ready to quote);
- keep absolute popularity separate from relative growth, and state the evidence strength and
  the main warnings;
- handle follow-ups with `--from <analysis.json>` and change only what the user changed.

Detailed rules live in `references/` and are loaded only when needed (progressive disclosure).
The summary output is compact so small, cheap models can use the skill reliably (see
[Evaluation](#evaluation)).

## Methodology

See [`references/methodology.md`](references/methodology.md) for every formula and threshold.
In short:

- **Pageviews:** daily per-article views, `all-access`, `agent=user` (human traffic after
  Wikimedia's bot filtering). Days missing from the API are counted, never interpolated.
- **Aggregation:** calendar months (average per reported day; usable if ≥80% reported) are the
  primary layer. ISO weeks are used for short periods, and daily data for spikes and volatility.
- **Change:** baseline vs latest window. With ≥24 complete months these are whole years, so
  seasonality cancels out. Otherwise 3-month or 28-day windows are used, with warnings.
- **Normalisation:** index 100 = each language's baseline average, so languages of very
  different size can be compared by relative growth. Share of edition traffic separates
  topic-specific change from edition-wide change.
- **Trend:** OLS on ln(views+1) (percent per month, R²), linear OLS and Spearman ρ. A direction
  is called only when these agree. The trend is fitted on seasonally adjusted data when
  seasonality is detected. No significance claims.
- **Outliers:** robust z-score (MAD) of log residuals from a 29-day rolling median. The
  analysis is re-run without spikes to test whether the conclusion survives.
- **Seasonality:** detrended month-of-year profile over ≥24 months, checked for consistency
  between years and rejected when monotonic (level shift). Year-over-year change of matching
  months is also reported.
- **Evidence strength:** a transparent points system (completeness, length, trend consistency,
  method agreement, volatility, spike influence, seasonality, traffic volume). It is **not a
  probability**.

## Limitations

- Pageviews ≠ unique users; one reader can create many views.
- Wikipedia interest ≠ market demand, purchase intent, revenue or willingness to pay.
- External events (news, holidays, school terms, viral links) cause spikes; they are detected,
  but their cause is unknown.
- Language editions have very different audiences; absolute views mostly reflect edition size.
  A language is not a country.
- Article quality, length, naming and search-engine placement differ between languages.
- Missing or incomplete data: the API omits zero-view days. Low-traffic articles therefore show
  gaps; `--missing-as-zero` is an explicit opt-in assumption.
- Bot filtering (`agent=user`) is heuristic; undetected automated traffic can remain.
- Views arriving through redirect titles are not included (see roadmap).
- Wikimedia overall traffic has been declining in many editions; check the share-of-edition
  metrics before reading a decline as topic-specific.
- Periods shorter than 24 months compare different seasons (e.g. autumn vs summer). The tool
  flags this and lowers evidence strength; use `--period 2y` for a seasonally fair comparison.
- In the PDF, report text is written without ligatures so it copies and searches correctly.
  Labels inside the embedded charts are drawn by svg-to-pdfkit and may still use ligatures
  ("ff", "fi"); every chart number is also in the metrics table and in `analysis.json`.

## Cache behaviour

- Location: `.cache/` in the skill folder (override with `WIA_CACHE_DIR`; disable per run with
  `--no-cache`).
- What is cached: every validated Wikimedia response — site matrix, title lookups, searches,
  disambiguation links (i.e. topic resolution), Wikidata items and pageview series.
- Keys: SHA-256 of the full request URL. The URL contains project, article, access, agent,
  granularity and both dates, so one language or date range can never be served for another.
- TTLs: 30 days for pageviews and the site matrix; 7 days for search, page metadata and
  Wikidata. Entries are re-validated with Zod when read; an invalid entry is re-fetched.
- Writes are atomic (temp file + rename); a failed cache write only logs a warning.

## Evaluation

The full workflow was tested with **Claude Haiku 4.5** as the agent model, across 8
conversations: multilingual comparison, trust question, ambiguity, follow-ups, exclusions, a
business "which audience next" report, and a Ukrainian-language request. Prompts, expected
behaviour, observed behaviour, problems found and the fixes are in
[`evals/results.md`](evals/results.md). `evals/check-grounding.ts` checks automatically that
every number in an answer appears in the tool output.

## How AI-generated work was verified

The project was built with an AI coding assistant. Its output was not trusted by default:

- **Statistics against known truth.** Seven synthetic fixtures (`scripts/generate-fixtures.ts`,
  seeded PRNG) encode known behaviour: ~3 %/month growth, flat, decline, noise, a 5-day ×40
  spike, a September-peaking season and 15 % missing days. `tests/analysis/scenarios.test.ts`
  requires the analysis to recover each one. This caught three real bugs: trends mistaken for
  seasonality, a level shift mistaken for seasonality, and a seasonal series shown as a false
  "up" trend.
- **Statistical primitives against textbook values** (`tests/analysis/stats.test.ts`: OLS, R²,
  Pearson, Spearman with ties).
- **Real API responses as fixtures.** Captured responses exposed that disambiguation links
  arrive alphabetically, which had hidden "Mercury (planet)" from the candidates
  (`tests/resolver/real-responses.test.ts`).
- **Mutation checks of key tests.** For example, re-enabling PDF ligatures must make the PDF text
  test fail. It does.
- **Real-world runs inspected by hand.** The generated PDFs and charts were opened and read, and
  `pnpm consistency` cross-checks JSON ↔ SVG ↔ PDF numbers.
- **Cheap-model evaluation with automatic grounding.** Every number in every Haiku answer was
  checked against the JSON (`pnpm eval:grounding`); see [`evals/results.md`](evals/results.md).

## Coverage

`pnpm test:coverage` enforces thresholds (global ≥90% statements/lines, ≥75% branches;
analysis, resolver and API layers ≥93–95% lines). See the last run in
[`evals/results.md`](evals/results.md#verification).

## Extending

[`references/roadmap.md`](references/roadmap.md) describes how to extend the skill
step by step: redirects and topic clusters, multi-topic comparison, country-level data, larger
volumes with a columnar store, stronger statistics, and automated cheap-model evaluation in CI.

## License

MIT
