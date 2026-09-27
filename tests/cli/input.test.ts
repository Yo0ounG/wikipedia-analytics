import { describe, expect, it } from '@jest/globals';
import {
  analyzeInputSchema,
  dateRangesSchema,
  generateReportInputSchema,
  languageListSchema,
  parseInput,
  resolveInputSchema,
} from '../../src/schemas/input.js';

const base = {
  searchLang: 'en',
  excludeDates: [],
  excludeLargestSpike: false,
  clearExclusions: false,
  missingAsZero: false,
  access: 'all-access',
  agent: 'user',
  charts: true,
  report: true,
  format: 'summary',
};

describe('CLI input schemas', () => {
  it('accepts a valid analyze request and normalises values', () => {
    const r = parseInput(analyzeInputSchema, {
      ...base,
      topic: '  intermittent fasting ',
      languages: 'PL, cs,pl',
      period: '2y',
      excludeDates: ['2025-04-10..2025-04-14,2025-05-01'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.topic).toBe('intermittent fasting');
    expect(r.data.languages).toEqual(['pl', 'cs']);
    expect(r.data.excludeDates).toEqual([
      { start: '2025-04-10', end: '2025-04-14' },
      { start: '2025-05-01', end: '2025-05-01' },
    ]);
  });

  it('names the offending flag in error messages', () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...base, topic: 'x', qid: 'Mercury' }, /^Invalid --qid: Expected a Wikidata QID/],
      [{ ...base, topic: 'x', searchLang: 'e n' }, /^Invalid --search-lang/],
      [{ ...base, topic: 'x', period: 'forever' }, /^Invalid --period/],
      [{ ...base, topic: 'x', start: '2025-02-30', end: '2025-03-01' }, /^Invalid --start/],
      [{ ...base, topic: 'x', access: 'tv' }, /^Invalid --access/],
      [{ ...base, topic: 'x', format: 'xml' }, /^Invalid --format/],
      [
        { ...base, topic: 'x', languages: 'pl;rm -rf' },
        /^Invalid --languages: Invalid language code/,
      ],
      [{ ...base, topic: '   ' }, /^Invalid --topic: Topic must not be empty/],
      [{ ...base, topic: 'x', excludeDates: ['2025-04-14..2025-04-10'] }, /start is after end/],
    ];
    for (const [value, pattern] of cases) {
      const r = parseInput(analyzeInputSchema, value);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(pattern);
    }
  });

  it('enforces cross-field rules', () => {
    const none = parseInput(analyzeInputSchema, base);
    expect(none).toEqual({ ok: false, message: 'Provide --topic, --qid or --from.' });
    const both = parseInput(analyzeInputSchema, {
      ...base,
      qid: 'Q1',
      period: '1y',
      start: '2025-01-01',
      end: '2025-02-01',
    });
    expect(both.ok ? '' : both.message).toMatch(/either --period or --start\/--end/);
    const half = parseInput(analyzeInputSchema, { ...base, qid: 'Q1', start: '2025-01-01' });
    expect(half.ok ? '' : half.message).toMatch(/Both --start and --end/);
  });

  it('validates the other commands', () => {
    expect(parseInput(resolveInputSchema, { languages: 'en', searchLang: 'en' })).toEqual({
      ok: false,
      message: 'Provide --query or --qid.',
    });
    expect(
      parseInput(resolveInputSchema, { query: 'Mercury', languages: 'de,fr', searchLang: 'en' }).ok,
    ).toBe(true);
    expect(parseInput(generateReportInputSchema, { input: '' }).ok).toBe(false);
    expect(languageListSchema.safeParse('en').success).toBe(true);
    expect(dateRangesSchema.safeParse(['bad']).success).toBe(false);
  });
});
