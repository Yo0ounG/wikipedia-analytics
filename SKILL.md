---
name: wikipedia-interest-analysis
description: Analyze how interest in a topic changes over time on Wikipedia, across one or more language editions, using official Wikimedia pageview data. Resolves the topic to one Wikidata concept, finds the matching article in each language, and computes trends, growth, spikes, seasonality, cross-language comparison and evidence strength; produces SVG charts and a one-page PDF report. Use when the user asks whether interest in a topic is rising or falling, wants to compare a topic across Wikipedia languages or countries' audiences, asks which topics or language markets to explore next based on Wikipedia interest, or asks for a shareable report on Wikipedia pageviews. Triggers include "Wikipedia interest", "pageviews", "is interest in X growing", "compare X in Polish and Czech Wikipedia", "which languages/audiences should we explore".
license: MIT
compatibility: Requires Node.js 22+ and pnpm (or `npx pnpm@10`), plus network access to *.wikipedia.org, www.wikidata.org, meta.wikimedia.org and wikimedia.org. No API keys.
metadata:
  version: '1.0.0'
  entrypoint: 'pnpm analyze'
---

# Wikipedia interest analysis

The TypeScript tool in this folder is the **only source of numbers**. You orchestrate it,
handle ambiguity, and explain its output. Never compute, estimate or round numbers yourself.

## Setup (once)

Run every command **from this skill's folder**:

```bash
pnpm install          # if pnpm is missing: npx pnpm@10 install
```

## Workflow

1. **Extract parameters** from the request:
   - topic → `--topic "<text>"`. If the topic is written in a non-English language, add
     `--search-lang <code>` for that language (e.g. `--search-lang uk`), or pass the English term.
   - languages → Wikipedia codes: `--languages pl,cs,uk` (Polish=pl, Czech=cs, Ukrainian=uk,
     English=en, German=de, Spanish=es, French=fr, Italian=it, Portuguese=pt, Russian=ru,
     Slovak=sk, Romanian=ro, Hungarian=hu, Turkish=tr, Japanese=ja, Chinese=zh, Arabic=ar).
   - period → `--period 2y` (default), `12m`, `90d`; or `--start YYYY-MM-DD --end YYYY-MM-DD`.
   - If a required piece is missing (no languages at all), ask once; otherwise use defaults.
2. **Run**:
   ```bash
   pnpm analyze --topic "intermittent fasting" --languages pl,cs --period 2y
   ```
   stdout is compact JSON (`--format summary`). Logs go to stderr.
3. **Branch on `status` / exit code**:
   | exit | status                                                    | what to do                                                                                                                                                                                                                                                                                                                                                              |
   | ---- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 0    | `success`                                                 | answer (step 4)                                                                                                                                                                                                                                                                                                                                                         |
   | 0    | `partial`                                                 | answer, and state clearly which languages have **no article** for this concept (`topic.missingLanguages`). Do not substitute a different article. You may offer a broader concept, and re-run only if the user agrees.                                                                                                                                                  |
   | 2    | `needs_clarification`                                     | **End your turn and ask the user `questionForUser`.** Do not run another analysis until the user answers, and never pick a concept yourself, even if one looks obvious and even if you were told to work autonomously. A wrong guess makes every number describe the wrong topic. After the user answers, run `commandAfterUserChoice` with the chosen `options[].qid`. |
   | 3    | `error` (`not_found`, `no_articles`, `insufficient_data`) | explain `error.message` and suggest `error.hint`                                                                                                                                                                                                                                                                                                                        |
   | 4    | `error` (`invalid_input`)                                 | fix the arguments and re-run                                                                                                                                                                                                                                                                                                                                            |
   | 5    | `error` (`network`, `rate_limit`)                         | tell the user the Wikimedia API could not be reached; retry once later                                                                                                                                                                                                                                                                                                  |
4. **Answer** in the user's language, using only values from the JSON:
   - Lead with the direct answer (e.g. "Interest declined in both…") and the **evidence strength**.
   - Per language: `baselineAverageDaily → latestAverageDaily`, `percentChange`, trend
     `direction` + `confidence`. Name the periods by copying `windows` exactly (translated if
     needed); do not re-derive dates. Quote the `findings` sentences if unsure how to phrase.
   - For comparisons, use `comparison.rankings` (highest first) and `comparison.highlights`.
     **Never rank or compare values yourself.** Keep absolute popularity
     (`rankings.absoluteViews`) separate from relative growth (`rankings.relativeGrowth`,
     `growthIndexLatest`, 100 = baseline).
   - Mention the key `evidence.warnings` (spikes, short period, low traffic, seasonality). If a
     warning says the windows cover different calendar months, say the change may be seasonal
     and do not present it as an acceleration or collapse.
   - For share-of-edition, quote `relativeToEdition` rather than interpreting the numbers.
   - Follow `answerChecklist` in the output. It ends with the limitation sentence to include.
   - Give the PDF path (`artifacts.report`) and chart paths when a report was requested.

## Follow-up requests

Every run saves an analysis.json. For follow-ups, use **`--from last`** (the most recent run)
and pass only what changes. Topic, QID, languages, period and exclusions are kept. Use a
specific `--from <analysis.json>` path only when the user refers to an earlier analysis.

| user says                                  | command                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Now only the last 12 months"              | `pnpm analyze --from last --period 12m`                                                                                                                  |
| "Exclude the largest spike"                | `pnpm analyze --from last --exclude-largest-spike`                                                                                                       |
| "Exclude the April 2025 spike"             | find that event in `languages.<code>.outliers.largest` (or the full JSON `outliers.events`) and pass its dates: `--exclude-dates 2025-04-14..2025-04-15` |
| "Add German"                               | `pnpm analyze --from last --languages pl,cs,de`                                                                                                          |
| "Undo the exclusions"                      | `pnpm analyze --from last --clear-exclusions`                                                                                                            |
| "I meant the planet" (after clarification) | `pnpm analyze --qid Q308 --languages … --period …`                                                                                                       |
| "Make the PDF again"                       | `pnpm generate-report --input <analysis.json>`                                                                                                           |

After a follow-up, `previousRun.languages.<code>` gives `percentChangeBefore`,
`percentChangeAfter` and `differencePercentagePoints`. Use them to say what changed; never
subtract numbers yourself. `followUp` lists ready-made commands.

## Rules (must follow)

- Never calculate numerical metrics manually. Every number you state must appear in the tool output.
- Never invent missing data or estimate values for missing days or languages.
- Never infer market demand, purchase intent or revenue from pageviews. Say "interest on Wikipedia" or "attention".
- Never silently resolve ambiguous concepts; ask the user when `status` is `needs_clarification`.
- Use the TypeScript analysis output as the source of truth, even if it contradicts your expectations.
- Clearly distinguish absolute pageviews from normalised (relative) growth.
- Report meaningful limitations and warnings. Avoid the words "significant(ly)" and
  "statistical confidence"; say "large decline" and "high confidence (trend fit)" instead.
- Do not explain _why_ interest changed (news, geopolitics, marketing…). The data does not show
  causes. If the user asks, offer hypotheses and label them clearly as unverified.
- Do not call a language a "winner" or an edition's audience a "market".
- When asked which audiences/languages to explore next, present `comparison.researchCandidates`
  **in the given order**, with their `reasons` and `cautions`, and state `researchNote`. Do not
  add criteria, causes or market claims of your own, and do not rule a language out. See
  `references/interpretation.md`.

## Output fields (summary)

`topic.{label,qid,articles,missingLanguages}` · `period` · `languages.<code>.{averageDailyViews,
baselineAverageDaily, latestAverageDaily, percentChange, windows, trend, annualizedGrowthPercent,
yearOverYearPercent, seasonalPattern, shareOfEditionChangePercent, editionTrafficChangePercent,
relativeToEdition, outliers, completeness, evidence}` · `comparison.{rankings, growthIndexLatest,
highlights, researchCandidates, researchNote}` · `evidence` · `findings` · `warnings` · `artifacts` · `followUp` · `previousRun` ·
`answerChecklist`. Use `--format full` only if you need daily/monthly data.

## More detail (read only when needed)

- `references/methodology.md` — how every metric, trend, outlier and evidence rule is computed
- `references/interpretation.md` — how to phrase conclusions and recommendations; wording to avoid
- `references/wikimedia-api.md` — data source, access/agent types, what a pageview is and is not
- `references/roadmap.md` — how to extend the skill for larger or more complex research
