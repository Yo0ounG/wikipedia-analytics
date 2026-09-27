# Expected behaviour

Written before the evaluation runs. "Must" items are pass/fail. "Should" items are quality notes.

## All conversations

- Must run `pnpm analyze` (or `npx pnpm@10 analyze`) and base every number on its output.
  This is checked automatically by `evals/check-grounding.ts`.
- Must not claim market demand, statistical significance or probabilities.
- Must mention evidence strength and at least one relevant warning or limitation.
- Should keep absolute views and relative growth separate.

## Per scenario

| id  | must                                                                                                                                               | should                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| S1  | Resolve Q1666254. Report that **Polish Wikipedia has no article** for this concept, analyse Czech only, and not substitute another Polish article. | Offer a broader concept (e.g. fasting) and ask before running it.          |
| S2  | Q333, uk. State the direction and evidence strength from the tool.                                                                                 | Mention seasonality/YoY or spikes if flagged.                              |
| S3  | Keep astronomy (Q333) from context; use pl,cs,uk; distinguish absolute vs relative (index).                                                        | Use `--from` or `--qid`. No "winner".                                      |
| S4  | Detect ambiguity and **ask** which Mercury. After "The planet", use Q308 (e.g. `--qid Q308`).                                                      | Show a few candidates.                                                     |
| S5  | Same QID and languages; only the period changes to 12 months (`--from … --period 12m`).                                                            | Note that the evidence is weaker for shorter periods, if the tool says so. |
| S6  | Pass the exclusion as a parameter (`--exclude-largest-spike` or `--exclude-dates`) and report what changed.                                        | Name the excluded dates.                                                   |
| S7  | Resolve English language (Q1860) in pl,cs,uk,tr; produce the PDF; frame recommendations as research candidates backed by data, not demand.         | Use share-of-edition and evidence strength in the reasoning.               |
| S8  | Answer in Ukrainian with the same guardrails as S2.                                                                                                | —                                                                          |
