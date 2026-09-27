/**
 * Numerical-hallucination check for evaluation transcripts.
 *
 *   pnpm tsx evals/check-grounding.ts <answer.md> <analysis.json> [more analysis.json …]
 *
 * Extracts every number from the agent's answer and checks that it matches a number in the
 * tool output (any numeric field, or a number inside a generated string), allowing only the
 * rounding a reader would apply (same value at the answer's precision). Dates, years, QIDs
 * and small list ordinals are ignored. Exit code 1 if any number is ungrounded.
 */
import { readFileSync } from 'node:fs';

function collectNumbers(value: unknown, out: Set<number>): void {
  if (typeof value === 'number') out.add(value);
  else if (typeof value === 'string') {
    for (const m of value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g))
      out.add(Number(m[0].replaceAll(',', '')));
  } else if (Array.isArray(value)) for (const v of value) collectNumbers(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
}

function stripIgnored(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ') // ISO dates
    .replace(/\bQ\d+\b/g, ' ') // QIDs
    .replace(/[\w./\\-]*\.(json|pdf|svg|md|ts)\b/g, ' ') // file paths
    .replace(/--[\w-]+ \S+/g, ' ') // CLI flags and their values
    .replace(/`[^`]*`/g, ' '); // inline code
}

const MONTHS = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*$/i;

export function ungroundedNumbers(answer: string, sources: unknown[]): string[] {
  const known = new Set<number>();
  for (const s of sources) collectNumbers(s, known);
  const knownList = [...known];
  const text = stripIgnored(answer);
  const bad: string[] = [];
  for (const m of text.matchAll(/(?<![\w.])-?\d[\d,]*(?:\.\d+)?/g)) {
    // Decimal commas (e.g. Ukrainian "45,5" or "0,794"): one comma followed by 1–2 digits, or a
    // leading zero (which can never start a thousands-separated number).
    const raw = /^-?(\d+,\d{1,2}|0,\d+)$/.test(m[0]) ? m[0].replace(',', '.') : m[0];
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    const value = Math.abs(Number(raw.replaceAll(',', '')));
    if (!Number.isFinite(value)) continue;
    if (value >= 1990 && value <= 2100 && !raw.includes('.')) continue; // years
    if (value <= 12 && !raw.includes('.') && (MONTHS.test(before) || /(^|\n)\s*$/.test(before)))
      continue; // days/ordinals
    if (value === 100 && /index|=\s*$|baseline/i.test(text.slice(m.index - 40, m.index + 20)))
      continue;
    const decimals = raw.includes('.') ? (raw.split('.')[1]?.length ?? 0) : 0;
    const tolerance = 0.5 * 10 ** -decimals + 1e-9;
    const grounded = knownList.some((k) => Math.abs(Math.abs(k) - value) <= tolerance);
    if (!grounded) bad.push(raw);
  }
  return bad;
}

const [answerFile, ...jsonFiles] = process.argv.slice(2);
if (answerFile !== undefined && jsonFiles.length > 0) {
  const answer = readFileSync(answerFile, 'utf8');
  const sources = jsonFiles.map((f) => JSON.parse(readFileSync(f, 'utf8')) as unknown);
  const bad = ungroundedNumbers(answer, sources);
  const total = [...stripIgnored(answer).matchAll(/(?<![\w.])-?\d[\d,]*(?:\.\d+)?/g)].length;
  console.log(
    JSON.stringify({ answer: answerFile, numbersChecked: total, ungrounded: bad }, null, 2),
  );
  process.exitCode = bad.length > 0 ? 1 : 0;
}
