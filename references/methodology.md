# Methodology

Everything below is implemented deterministically in `src/analysis/` and `src/data/`.
Thresholds are constants in the code; this document lists them so results can be audited.

## 1. Data preparation (`src/data/`)

- **Source:** daily per-article pageviews, `access=all-access`, `agent=user` by default
  (see `wikimedia-api.md`). Edition-wide daily totals are fetched for share-of-traffic metrics.
- **Validation:** observations outside the period, duplicate dates (first kept), negative,
  non-integer or non-finite values are dropped and reported in `data.issues`.
- **Missing days:** the API omits days with zero views. Missing days are **counted, never
  filled**. `data.completeness = reported days / (expected days − excluded days)`.
  `--missing-as-zero` is an explicit opt-in assumption for low-traffic articles.
- **Exclusions:** `--exclude-dates` and `--exclude-largest-spike` remove days from the series;
  they are reported as `excludedRanges` and do not count as missing.

## 2. Aggregation

- **Monthly** (primary layer for long-term interpretation): views, reported days, expected days
  and **average views per reported day**. A month is _usable_ when it lies fully inside the period
  and ≥80% of its days are reported. Averaging per reported day keeps partially reported months
  comparable without imputing values.
- **Weekly** (ISO weeks, Monday start): same rules, used for trends in periods under 6 months.
- **Daily:** kept for spikes, volatility and charts. Charts show a centred 30-day rolling mean
  (null unless ≥50% of the window is reported).

## 3. Core metrics (`metrics.ts`)

| metric                               | definition                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| total / average / median daily views | over reported days                                                                                                                                                                                                                                            |
| baseline, latest                     | average daily views in the first and last window                                                                                                                                                                                                              |
| windows                              | ≥24 usable months → first/last **12** months (whole years, seasonally balanced); ≥6 → first/last 3 months; otherwise first/last N reported days, N = min(28, ⌊n/3⌋)                                                                                           |
| absolute change                      | latest − baseline                                                                                                                                                                                                                                             |
| percent change                       | (latest − baseline) / baseline × 100; `null` if baseline is 0                                                                                                                                                                                                 |
| annualised growth                    | (1 + monthly log-trend rate)^12 − 1, only with ≥12 usable months and trend R² ≥ 0.3; otherwise `null` with a note. Descriptive, not a forecast.                                                                                                               |
| peak                                 | maximum daily views and its date                                                                                                                                                                                                                              |
| volatility                           | `shortTermVolatility` = 1.4826 × MAD of daily relative deviation from a centred 29-day rolling median (robust σ, trend-independent, not dominated by single spikes). Levels: <0.2 low, <0.4 moderate, else high. Raw daily and monthly CVs are also reported. |
| share of edition                     | article views per million views of the whole language edition, overall and in both windows; its % change is compared with the edition's own traffic change                                                                                                    |

## 4. Trend (`trend.ts`, `stats.ts`)

Input: usable monthly averages (≥6), otherwise usable weekly averages (≥8); else
`insufficient_data` ("Not enough observations for a reliable long-term trend").

- **Log-linear OLS:** ln(views + 1) ~ t. `normalizedSlope` = (e^b − 1) × 100 = % change per period.
  `rSquared` is the fit of this model.
- **Linear OLS:** views ~ t. `slope` = change in average daily views per period; `linearRSquared`.
- **Spearman ρ** between time and views: monotonicity, robust to outliers.
- **Direction:** `up` if normalizedSlope > 0.5 %/month (0.2 %/week) **and** ρ ≥ 0.3;
  `down` symmetrically; otherwise `flat`. Both methods must agree.
- **Confidence:** high = n ≥ 12, R² ≥ 0.5, |ρ| ≥ 0.6; moderate = R² ≥ 0.25, |ρ| ≥ 0.4;
  otherwise low. For `flat`: moderate if n ≥ 12 and |ρ| < 0.2.
- **Seasonal adjustment:** when a seasonal pattern is detected (§6), the trend is fitted on
  months divided by their month-of-year index (`seasonallyAdjusted: true`).
- No significance test is performed and none is claimed.

## 5. Outliers (`outliers.ts`)

- Residual r = ln(v + 1) − ln(m + 1), where m is the centred 29-day rolling median.
- Robust z = (r − median r) / max(1.4826 × MAD(r), 0.05).
- **Spike:** z > 3.5 and v ≥ 1.5 × m and v − m ≥ 20 views. **Dip:** symmetric. Needs ≥28 days.
- Consecutive flagged days form one **event** (start, end, peak, expected, ratio, excess views).
- **Influence:** the core analysis is re-run without spike days. The result reports the change
  and trend direction with and without spikes. It is **material** when the direction or the sign
  of the change flips, or the change moves by ≥ max(10 pp, 25% of |change|). Material influence
  lowers evidence strength. Dips are reported but never removed automatically.

## 6. Seasonality (`seasonality.ts`)

Needs ≥24 consecutive usable months.

1. Remove the long-term trend with a log-linear fit over the run.
2. Split into 12-month blocks aligned to the end; divide each month by its block mean.
3. Month-of-year profile = mean ratio per calendar month (1.0 = average month).
4. **Detected** when amplitude (max − min) ≥ 0.25, the last two years' profiles correlate
   (Pearson ≥ 0.5), and the profile is not monotonic within the year (|ρ| < 0.85). A monotonic
   yearly "sawtooth" indicates a level shift or residual trend, not seasonality.
5. **Year-over-year:** last 12 vs previous 12 months (average per reported day) and the number
   of matching months that rose or fell. This is the seasonality-robust growth measure.

## 7. Cross-language comparison (`comparison.ts`)

- **Absolute:** ranking by average daily views. It reflects the size of each edition's
  audience as much as interest in the topic.
- **Relative growth:** ranking by percent change.
- **Normalised index:** 100 = each language's own baseline-window average; the series is monthly
  (or weekly) average ÷ baseline × 100. The latest-window index equals 100 + percent change,
  so charts, tables and JSON always agree.
- **Share of edition** shows whether a change is topic-specific or edition-wide traffic.
- Differences in growth < 10 percentage points are flagged as not meaningful.
- Comparison evidence = the weakest language's evidence.
- **Rankings** (`comparison.rankings`, highest first): absolute views, relative growth, trend
  per period, share-of-edition change, evidence strength. Agents quote these instead of ranking.
- **Relative to edition** (`projectNormalized.relativeToEdition`): share-of-edition change
  < −5 % → `declined_faster_than_edition`, > +5 % → `outperformed_edition`, otherwise
  `in_line_with_edition`, with a sentence that states article change, edition change and share
  change together.
- **Research candidates** (`comparison.researchCandidates`), for "which audiences next?":
  sorted by (1) evidence at least moderate, (2) relation to the edition (outperformed > in line >
  declined faster), (3) percent change, (4) average daily views. Each candidate carries
  data-derived reasons and cautions (low evidence, spike-driven change, all languages declined).
  It is an order for further research, not a demand estimate.

## 7a. Follow-ups (`follow-up.ts`)

With `--from`, the new result contains `previousRun`: the previous period and exclusions, and per
language `percentChangeBefore`, `percentChangeAfter`, `differencePercentagePoints` and trend
direction before/after. `--from last` reads the path of the most recent run from
`output/last-analysis.txt`.

## 8. Evidence strength (`evidence.ts`)

A rule-based score. It is **not a probability**. Each rule adds a reason or a warning:

| factor                                                                                 | effect                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| completeness ≥ 98%                                                                     | +1 · < 90% → −1 · < 80% caps strength at low                 |
| ≥ 24 complete months                                                                   | +1 · < 12 → −1 · < 6 caps at low                             |
| trend confidence                                                                       | high +2 · moderate +1 · insufficient data −1 and caps at low |
| agreement of baseline→latest change, trend and YoY (when YoY is an independent window) | all agree +1 · opposite directions −1                        |
| high short-term volatility                                                             | −1                                                           |
| material spike influence                                                               | −1 (−2 if the trend does not survive)                        |
| average < 10 views/day                                                                 | −1                                                           |
| seasonality                                                                            | reason when detected; warning if the period is < 12 months   |
| baseline and latest windows cover different calendar months (periods of 6–23 months)   | −1 and caps at moderate; warning suggests `--period 2y`      |

Score ≥ 4 → high, 2–3 → moderate, otherwise low (after caps).

## 9. Numerical integrity

- All numbers come from this code. Summary and PDF copy values; they never recompute them.
- `generate-report` refuses JSON that fails the schema or whose derived values are inconsistent
  (absolute/percent change, index = 100 + percent change).
- Output is deterministic for the same inputs (no randomness; fixed number formatting).
