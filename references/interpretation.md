# Interpreting results

Use this when turning the JSON into an answer or a recommendation.

## Allowed vs. not allowed

| say                                                               | do not say                                   |
| ----------------------------------------------------------------- | -------------------------------------------- |
| "interest on Wikipedia", "attention to the article", "readership" | "demand", "market size", "customers want"    |
| "views rose 42% (baseline → latest window)"                       | a percentage the tool did not output         |
| "evidence strength: moderate, because …"                          | "87% confident", "statistically significant" |
| "largest absolute audience" / "fastest relative growth"           | "winner", "best market"                      |
| "the concept has no Polish article"                               | analysing a different Polish article instead |
| "a spike on 2025-04-14 drives most of the growth"                 | ignoring `outliers.influence.material`       |

## Reading the key fields

- `percentChange` compares the baseline and latest windows (`windows` says which). With 24+
  complete months these are full years, so seasonality cancels out.
- `trend.direction` + `confidence` summarise the whole period. If the direction disagrees with
  `percentChange`, say so; the evidence warnings will usually explain why.
- `yearOverYearPercent` compares matching months and is robust to seasonality.
- `shareOfEditionChangePercent` vs. edition traffic: if an article fell 16% while the whole
  edition fell 9%, part of the decline is edition-wide, not topic-specific. Say this when relevant.
- `outliers.influence` is the most important caveat when it says "Result depends on spikes".
- `evidence.strength`: high = consistent, complete, long series; low = treat as a hint only.

## Answer template

1. Direct answer in one sentence, including evidence strength.
2. Per-language numbers (baseline → latest, % change, trend with confidence).
3. Comparison: absolute size vs. relative growth, kept separate.
4. The 1–3 warnings that matter most.
5. One limitation line: Wikipedia pageviews reflect attention, not demand.
6. Artifacts (PDF / charts) and an offer of follow-ups (period, exclusions, more languages).

## "Which audiences / topics should we explore next?"

The data cannot decide investments. It can **prioritise candidates for further research**.
The tool computes this ordering as `comparison.researchCandidates` (with `reasons`, `cautions`
and `researchNote`). Present it as-is. The ordering rules, for reference:

1. relative growth (`percentChange`, `growthIndexLatest`) **with** at least moderate evidence;
2. topic-specific momentum (`shareOfEditionChangePercent` better than edition traffic);
3. absolute audience (`averageDailyViews`), only as a size indicator for the edition;
4. risks: low evidence, spike-driven growth, missing article (itself a signal: no local content
   exists yet, which may be an opportunity or a lack of interest; it is unknown).

Phrase it as: "Based on Wikipedia interest, _X_ and _Y_ are the strongest candidates to research
next because … Validate with market data (search volume, app-store data, surveys) before
investing." Always name the evidence strength behind each candidate.

## Missing languages

When `topic.missingLanguages` is non-empty, state it plainly. You may suggest a broader or
related concept (e.g. "fasting" instead of "intermittent fasting") and run it **only after the
user agrees**. Present it as a different concept, not a substitute measurement.
