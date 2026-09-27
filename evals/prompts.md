# Evaluation prompts

Each conversation is run by a fresh agent on a low-cost model (**Claude Haiku 4.5**,
`claude-haiku-4-5-20251001`). The agent gets only this skill's folder and the instruction to
read `SKILL.md`. Follow-ups (→) are sent to the same agent session.

| id  | conversation                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | "Compare interest in intermittent fasting in Polish and Czech Wikipedia over the last two years."                                                                                                                 |
| S2  | "Is interest in astronomy increasing in Ukrainian Wikipedia? How much can we trust this?"                                                                                                                         |
| S3  | → (after S2) "Compare the relative growth of this topic across Polish, Czech and Ukrainian Wikipedia."                                                                                                            |
| S4  | "How has interest in Mercury changed in German and French Wikipedia over the past year?" → after the clarification question: "The planet."                                                                        |
| S5  | → (after S3) "Now only compare the last 12 months."                                                                                                                                                               |
| S6  | → (after S5) "Exclude the largest spike from the analysis."                                                                                                                                                       |
| S7  | "We're building a language-learning app. Compare interest in the English language in Polish, Czech, Ukrainian and Turkish Wikipedia and prepare a short report: which audiences should we research next and why?" |
| S8  | (Ukrainian, from the assignment) "Ми думаємо додати курс з астрономії до освітнього застосунку. Чи зростає інтерес до цієї теми в україномовній Wikipedia, і наскільки цьому зростанню можна довіряти?"           |

## Harness prompt

Sent verbatim. Only the bracketed sentences vary by scenario:

> You are an AI assistant. An Agent Skill is installed at
> `C:\Users\drdim\Desktop\genesis-test\wikipedia-interest-analysis`. Read its SKILL.md and
> follow it to handle the user's request. Run commands from the skill directory (use the Bash
> tool; `pnpm` may not be on PATH — follow SKILL.md's fallback). Reply to the user as you
> normally would; your final message is the reply the user will see.
> [S4 only: If you need information from the user, end your turn with your question.]
> [S2 chain only: The user may send follow-up messages later in this conversation.]
>
> User request: "&lt;prompt&gt;"

Follow-ups were sent as `User follow-up: "<text>"` (in S4: `User reply: "The planet."`).

## Note on S2

The plan's scenario 2 is "Is interest in astronomy increasing in Ukrainian Wikipedia?". The
evaluated prompt adds "How much can we trust this?", as in the assignment's own example, so
the evidence-strength part of the answer is tested too.
