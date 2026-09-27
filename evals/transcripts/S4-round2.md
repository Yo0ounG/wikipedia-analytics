**Turn 1 (agent):**

The analysis requires clarification about which "Mercury" the user is asking about. Multiple Wikipedia articles match this term:

1. Mercury (planet) — First planet from the Sun (Q308)
2. Mercury (element) — Chemical element with atomic number 80 (Hg) (Q925)
3. Mercury Records — American record label (Q165745)
4. Project Mercury — Initial American crewed spaceflight program (1958–1963) (Q52162)
5. Mercury Prize — UK music award (Q501876)
6. Mercury (mythology) — Roman god of trade, merchants and travel (Q1150)

Please ask the user which Mercury they mean. Once they provide their answer, I can re-run the analysis with the correct topic ID using: `npx pnpm@10 analyze --qid <QID> --languages de,fr --period 12m`

**User:** "The planet."

**Turn 2 (agent):**

Analysis complete. Interest in Mercury (the planet) declined in both German and French Wikipedia over the past year:

- German Wikipedia: 30.5% decline (423 → 294 daily views), trend down 3.70% per month
- French Wikipedia: 33.1% decline (321 → 215 daily views), trend down 3.58% per month
- Both declines are statistically moderate confidence
- German shows slightly smaller decline than French (2.7 percentage point difference)
- Trends persist after removing largest spikes
- Evidence strength: moderate (seasonal variation possible)
- Report and charts available in output/mercury-Q308/de-fr_2025-09-01_2026-08-31/
