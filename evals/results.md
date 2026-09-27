# Evaluation results

## How the evaluation was run

- **Model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`), launched as a fresh sub-agent for
  every conversation. It had a shell tool, the skill folder and the harness prompt from
  [`prompts.md`](prompts.md), and no other hints. Follow-ups were sent to the same session.
- **Data:** real Wikimedia APIs, 2026-09-26. Default period `2y` = 2024-09-01 … 2026-08-31.
- **Numerical-hallucination check:** each answer was saved verbatim in
  [`transcripts/`](transcripts/) and checked with
  `pnpm eval:grounding <answer.md> <analysis.json…>`. The checker finds every number in the
  answer and requires a matching value in the tool output at the answer's precision. It
  handles decimal commas and ignores dates, years, QIDs and paths.
- **Rounds:** after each round, the problems found were fixed in the tool or in `SKILL.md`, and
  the affected scenarios were re-run on fresh sessions (R1 … R5). The `analysis.json` files of
  rounds 1–3 are kept in `round1-output/`, `round2-output/` and `round3-output/`.
- **Harness caveat:** the evaluation environment told sub-agents to prefer autonomous work (an
  "auto mode" system instruction). This made the ambiguity test harder than a normal chat, and
  the S4 failure in round 1 came from it.

## Summary

| id  | scenario                            | round 1                                     | final                                                                   | numbers grounded   |
| --- | ----------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| S1  | intermittent fasting, pl + cs       | ✅ missing pl reported, nothing substituted | ✅ R3, with limitation sentence                                         | 22/22 R1, 14/14 R3 |
| S2  | astronomy uk, trust                 | ✅ (wording issue)                          | ✅ R3: windows, evidence, edition-relative sentence, limitation         | 12/12 R1           |
| S3  | → compare pl, cs, uk                | —                                           | ✅ R2, R3: `--from`, rankings, index                                    | chain 91/91 R3     |
| S4  | "Mercury" (ambiguous)               | ❌ **picked Q308 itself**                   | ✅ R2, R3: stops and asks; uses Q308 after "The planet"                 | 15/15 R1, 25/25¹   |
| S5  | → last 12 months                    | —                                           | ✅ R3: same QID/languages, period only; leads with seasonal caveat      | chain 91/91 R3     |
| S6  | → exclude largest spike             | —                                           | ✅ R3: applied to the latest run; before/after from the tool            | chain 91/91 R3     |
| S7  | English language ×4, "who is next?" | ⚠️ invented cause, wrong ranking claim      | ✅ R5: tool-ordered candidates, no causes, no market claims, limitation | 17/17 R1, 21/21 R5 |
| S8  | Ukrainian-language request          | ⚠️ wrong window dates, no limitation        | ✅ R2 (complete); ⚠️ R3 correct but terse                               | 19/19 R2, 6/6 R3   |

¹ In S4-R2 the checker flags "80", "1958" and "1963". They come from the candidate
descriptions in the clarification output ("atomic number 80", "1958–1963"), which were not
passed to the checker. They are not invented.

**No answer in any round contained a fabricated number.** Every number matched the tool output.
The problems were about behaviour and interpretation.

## Per-scenario record

### S1 — intermittent fasting, Polish and Czech

- **Prompt:** "Compare interest in intermittent fasting in Polish and Czech Wikipedia over the
  last two years."
- **Expected:** resolve Q1666254; say that Polish Wikipedia has no article for the concept;
  analyse Czech only; substitute nothing; offer a broader concept only with consent.
- **Observed:** R1 did all of this and offered related topics, but wrote "declined
  significantly". R2 was correct but had no limitation sentence. R3 was correct and included
  the limitation sentence.
- **Problems:** statistical-sounding wording; limitation sentence not always present.
- **Fixes:** wording rules in SKILL.md; `answerChecklist` with the exact limitation sentence in
  the tool output.
- **Final behaviour:** correct, grounded, limitation included (R3).

### S2 — "Is interest in astronomy increasing in Ukrainian Wikipedia? How much can we trust this?"

- **Expected:** Q333 in uk; direction and evidence strength from the tool; seasonality or
  spikes if flagged.
- **Observed:** R1 was correct but said "high statistical confidence". R3 quoted the windows
  exactly, evidence high, and the edition-relative sentence ("lost share 46.4 % … edition
  24.6 %"), and included the limitation sentence.
- **Problems:** wording.
- **Fixes:** wording rule; `relativeToEdition` sentence.
- **Final behaviour:** correct and complete.

### S3 — → "Compare the relative growth of this topic across Polish, Czech and Ukrainian Wikipedia."

- **Expected:** keep Q333 from context; pl, cs, uk; separate absolute and relative.
- **Observed (R2, R3):** used `--from` / `--from last`, the growth index and the rankings,
  and kept absolute audience separate. In R3 it wrote "in Ukraine" (language ≠ country) and
  omitted the limitation sentence.
- **Problems:** in R2 the model ranked and interpreted share numbers itself.
- **Fixes:** `comparison.rankings`, `relativeToEdition`.
- **Final behaviour:** correct numbers and ordering; minor wording issues remain.

### S4 — "How has interest in Mercury changed in German and French Wikipedia over the past year?"

- **Expected:** detect ambiguity and **ask**; after "The planet" use Q308.
- **Observed:** R1 got exit code 2 (`needs_clarification`), then immediately ran `--qid Q308`
  itself. Its debrief said the autonomy instruction "took precedence". R2 and R3 stopped and
  listed 6 and 8 candidates. After "The planet", R2 ran Q308 correctly.
- **Problems:** the clarification output contained one ready-to-run command per candidate,
  which invited picking one.
- **Fixes:** the output now has `agentInstruction` ("STOP. Ask the user…"), a ready
  `questionForUser`, `options` and only a template `commandAfterUserChoice` with
  `<QID chosen by the user>`. SKILL.md says the rule overrides autonomy instructions.
- **Final behaviour:** asks every time (2/2 after the fix).

### S5 — → "Now only compare the last 12 months."

- **Expected:** same QID and languages; only the period changes.
- **Observed:** R2 was technically correct (`--from … --period 12m`) but headlined "Dramatic
  acceleration in decline" (pl −61.1 %). That change compares Sep–Nov with Jun–Aug, school
  season vs summer. R3 led with "12-month evidence strength is MODERATE due to seasonal bias"
  and took before/after deltas from the tool.
- **Problems:** the tool's seasonal-window warning was too weak.
- **Fixes:** mismatched-season windows now cost −1 evidence and cap it at moderate; the finding
  sentence says "may be seasonal rather than a real shift"; the warning suggests `--period 2y`;
  `previousRun` gives before/after per language.
- **Final behaviour:** correct and appropriately cautious.

### S6 — → "Exclude the largest spike from the analysis."

- **Expected:** exclusion passed as a parameter to the latest analysis; report what changed.
- **Observed:** R2 applied it to the older 24-month analysis instead of the 12-month one and
  computed "−3.4 % impact" itself. R3 used `--from last --exclude-largest-spike` on the
  12-month run and quoted `differencePercentagePoints` from the tool.
- **Problems:** tracking paths across turns; no tool-computed before/after.
- **Fixes:** `--from last`; `previousRun`.
- **Final behaviour:** correct (all 91 numbers of the S2–S6 chain are grounded).

### S7 — language-learning app, English language in pl, cs, uk, tr, "which audiences next?"

- **Expected:** Q1860 in 4 languages; PDF; recommendations as research candidates based on
  data, not demand.
- **Observed:** R1 claimed "Czech … steepest monthly decline" (the tool: uk −3.80 vs
  cs −2.09 %/month) and "suggesting geopolitical factors". R2 was better but misread the share
  metric ("24.6 % of this is edition-wide"). R3 gave a sensible order but added "not recommended
  now" and "strongest market signal". R4 followed the tool order and kept go-to-market wording.
  R5 followed the tool order, gave no causes and no market claims, included the limitation and
  the PDF path.
- **Problems:** self-made rankings, invented causes, misread metrics, business framing.
- **Fixes:** `rankings`; rule against causes and market wording; `relativeToEdition` with all
  three quantities in one sentence; `researchCandidates` + `researchNote`.
- **Final behaviour:** ordering and reasons come from the tool (R5). Occasional business
  wording remains possible (see residual issues).

### S8 — Ukrainian-language request (from the assignment)

- **Prompt:** "Ми думаємо додати курс з астрономії до освітнього застосунку. Чи зростає інтерес
  до цієї теми в україномовній Wikipedia, і наскільки цьому зростанню можна довіряти?"
- **Expected:** answer in Ukrainian with the same guardrails as S2.
- **Observed:** R1 stated the windows as "вер 2024 – вер 2025" (the tool: Sep 2024–Aug 2025),
  had no limitation sentence, and the output folder was `topic-Q333`. R2 was complete: exact
  windows, seasonality, share of edition, limitation, causes framed as hypotheses. R3 was
  correct but terse, with no evidence strength and no limitation.
- **Fixes:** "copy `windows` exactly"; checklist; Cyrillic transliteration in folder names
  (`astronomiya-Q333`).
- **Final behaviour:** correct numbers every time; completeness varies between runs.

## Analysis bugs found by the evaluation work

These were found with real data and fixed with tests before the final rounds:

- Disambiguation links arrive alphabetically, so "Mercury (planet)" was missing from the
  first 25. The resolver now fetches up to 200 and ranks them by search relevance
  (`tests/resolver/real-responses.test.ts`).
- Steady growth looked seasonal, and a level shift produced a fake seasonal "sawtooth". Fixed
  with detrending plus a monotonic-profile guard.
- A seasonal series starting in its low season showed a false "up" trend. The trend is now
  fitted on seasonally adjusted data; 24+ month periods use 12-month (seasonally balanced)
  windows.

## Residual issues

- **Business framing (S7).** Haiku sometimes adds go-to-market wording around the tool's
  candidate list. The ordering, numbers and reasons follow the tool; the framing is the
  model's own. A stricter answer template from the tool (roadmap, iteration 6) would remove it.
- **Run-to-run variance.** The same prompt produced a complete answer (S8-R2) and a terse one
  without evidence strength and the limitation sentence (S8-R3, S3-R3). Numbers stay correct;
  completeness on a small model is not guaranteed by instructions alone.
- **Language vs country.** "in Ukraine" for the Ukrainian-language edition appears
  occasionally, despite the rule in `references/interpretation.md`.

## Verification

Run after the last change from a clean install (`node_modules`, `dist`, `coverage` and `.cache`
deleted, then `pnpm install --frozen-lockfile`):

| check                                                                           | result                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm check` (typecheck, lint, format, tests + coverage, build)                 | pass                                                           |
| tests                                                                           | 14 suites, 172 tests, all passing, offline                     |
| coverage                                                                        | statements 96.4%, branches 79.4%, functions 97.1%, lines 98.0% |
| `pnpm smoke` (real Wikimedia API)                                               | 5/5 checks pass                                                |
| real run `analyze --topic astronomy --languages uk,pl,cs --period 2y`           | success; JSON, 3 SVGs, 1-page PDF (`examples/`)                |
| `pnpm consistency` on that run (JSON ↔ SVG ↔ PDF content, index = 100 + change) | 22/22 checks pass                                              |
