import { describe, expect, it } from '@jest/globals';
import {
  addDays,
  addMonths,
  DateError,
  daysBetweenInclusive,
  daysInMonth,
  eachDay,
  eachMonth,
  fromWikimediaTimestamp,
  isIsoDate,
  lastDayOfMonth,
  latestAvailableDay,
  monthLabel,
  parsePeriod,
  resolvePeriod,
  validateRange,
  weekStart,
} from '../../src/utils/dates.js';
import {
  encodeArticleTitle,
  isValidLanguageCodeSyntax,
  isValidQid,
  normalizeForMatch,
  parseLanguageList,
  slugify,
  tokenize,
} from '../../src/utils/encoding.js';
import {
  coefficientOfVariation,
  formatInteger,
  formatSignedPercent,
  formatViews,
  mean,
  median,
  medianAbsoluteDeviation,
  percentChange,
  round,
  sign,
  standardDeviation,
} from '../../src/utils/numbers.js';
import { createLogger } from '../../src/utils/logging.js';

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2024-2-1')).toBe(false);
    expect(isIsoDate('2024-13-01')).toBe(false);
  });

  it('does day and month arithmetic in UTC', () => {
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(daysBetweenInclusive('2024-01-01', '2024-12-31')).toBe(366);
    expect(eachDay('2024-02-27', '2024-03-01')).toEqual([
      '2024-02-27',
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
    expect(daysInMonth('2025-02')).toBe(28);
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29');
    expect(addMonths('2024-11', 3)).toBe('2025-02');
    expect(addMonths('2024-01', -1)).toBe('2023-12');
    expect(eachMonth('2024-11-15', '2025-02-02')).toEqual([
      '2024-11',
      '2024-12',
      '2025-01',
      '2025-02',
    ]);
    expect(weekStart('2024-01-07')).toBe('2024-01-01'); // Sunday → Monday
    expect(weekStart('2024-01-01')).toBe('2024-01-01');
    expect(monthLabel('2025-04')).toBe('Apr 2025');
    expect(() => daysInMonth('2025-4')).toThrow(DateError);
  });

  it('parses Wikimedia timestamps', () => {
    expect(fromWikimediaTimestamp('2024013100')).toBe('2024-01-31');
    expect(() => fromWikimediaTimestamp('20240231')).toThrow(DateError);
    expect(() => fromWikimediaTimestamp('2024023100')).toThrow(DateError);
  });

  it('parses relative periods', () => {
    expect(parsePeriod('2y')).toEqual({ amount: 2, unit: 'y' });
    expect(parsePeriod(' 12M ')).toEqual({ amount: 12, unit: 'm' });
    expect(() => parsePeriod('0d')).toThrow(DateError);
    expect(() => parsePeriod('two years')).toThrow(DateError);
    expect(() => parsePeriod('5q')).toThrow(DateError);
  });

  it('resolves month/year periods to whole complete months', () => {
    expect(resolvePeriod({ amount: 2, unit: 'y' }, '2026-09-26')).toEqual({
      start: '2024-09-01',
      end: '2026-08-31',
    });
    expect(resolvePeriod({ amount: 12, unit: 'm' }, '2026-09-26')).toEqual({
      start: '2025-09-01',
      end: '2026-08-31',
    });
    // When the latest available day is a month end, that month counts as complete.
    expect(resolvePeriod({ amount: 1, unit: 'm' }, '2026-09-02')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    });
  });

  it('resolves day/week periods to the latest available day', () => {
    expect(latestAvailableDay('2026-09-26')).toBe('2026-09-24');
    expect(resolvePeriod({ amount: 90, unit: 'd' }, '2026-09-26')).toEqual({
      start: '2026-06-27',
      end: '2026-09-24',
    });
    expect(resolvePeriod({ amount: 2, unit: 'w' }, '2026-09-26')).toEqual({
      start: '2026-09-11',
      end: '2026-09-24',
    });
  });

  it('rejects invalid ranges', () => {
    expect(() => {
      validateRange({ start: '2025-02-01', end: '2025-01-01' }, '2026-01-01');
    }).toThrow(/after end/);
    expect(() => {
      validateRange({ start: '2015-06-30', end: '2016-01-01' }, '2026-01-01');
    }).toThrow(/2015-07-01/);
    expect(() => {
      validateRange({ start: '2025-01-01', end: '2026-01-01' }, '2026-01-02');
    }).toThrow(/latest available/);
    expect(() => {
      validateRange({ start: '2025-01-01', end: '2025-12-31' }, '2026-01-05');
    }).not.toThrow();
  });
});

describe('numbers', () => {
  it('computes basic statistics', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(coefficientOfVariation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(0.4);
    expect(coefficientOfVariation([0, 0])).toBeNull();
    expect(medianAbsoluteDeviation([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });

  it('computes percentage change and refuses a zero base', () => {
    expect(percentChange(100, 142)).toBeCloseTo(42);
    expect(percentChange(200, 100)).toBe(-50);
    expect(percentChange(0, 10)).toBeNull();
  });

  it('rounds and formats deterministically', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(-0.0001, 2)).toBe(0);
    expect(formatInteger(1234567.4)).toBe('1,234,567');
    expect(formatInteger(-1500)).toBe('-1,500');
    expect(formatSignedPercent(41.26)).toBe('+41.3%');
    expect(formatSignedPercent(-3)).toBe('-3.0%');
    expect(formatSignedPercent(null)).toBe('n/a');
    expect(formatViews(3.614)).toBe('3.6');
    expect(formatViews(1234.4)).toBe('1,234');
    expect(sign(0.5, 1)).toBe(0);
    expect(sign(-3)).toBe(-1);
    expect(sign(null)).toBe(0);
  });
});

describe('encoding', () => {
  it('validates and parses language lists', () => {
    expect(parseLanguageList('pl, CS,pl,uk')).toEqual(['pl', 'cs', 'uk']);
    expect(isValidLanguageCodeSyntax('be-tarask')).toBe(true);
    expect(isValidLanguageCodeSyntax('simple')).toBe(true);
    expect(isValidLanguageCodeSyntax('p')).toBe(false);
    expect(isValidLanguageCodeSyntax('pl;rm -rf')).toBe(false);
    expect(() => parseLanguageList('pl,x')).toThrow(/Invalid language/);
    expect(() => parseLanguageList(' , ')).toThrow(/At least one/);
    expect(() =>
      parseLanguageList(
        Array.from({ length: 13 }, (_, i) => `a${String.fromCharCode(97 + i)}`).join(','),
      ),
    ).toThrow(/At most/);
  });

  it('validates QIDs', () => {
    expect(isValidQid('Q308')).toBe(true);
    expect(isValidQid('Q0')).toBe(false);
    expect(isValidQid('q308')).toBe(false);
  });

  it('encodes article titles for REST paths', () => {
    expect(encodeArticleTitle('AC/DC')).toBe('AC%2FDC');
    expect(encodeArticleTitle('Mercury (planet)')).toBe('Mercury_(planet)');
    expect(encodeArticleTitle('Астрономія')).toBe(
      '%D0%90%D1%81%D1%82%D1%80%D0%BE%D0%BD%D0%BE%D0%BC%D1%96%D1%8F',
    );
    expect(encodeArticleTitle('What?#&')).toBe('What%3F%23%26');
  });

  it('normalises for matching and builds slugs', () => {
    expect(normalizeForMatch('Mercury (planet)')).toBe('mercury');
    expect(normalizeForMatch('Přerušovaný  půst!')).toBe('prerusovany pust');
    expect(tokenize('Intermittent-fasting diet')).toEqual(['intermittent', 'fasting', 'diet']);
    expect(tokenize('')).toEqual([]);
    expect(slugify('Інтервальне голодування')).toBe('intervalne-holoduvannya');
    expect(slugify('日本語')).toBe('topic');
    expect(slugify('Přerušovaný půst')).toBe('prerusovany-pust');
  });
});

describe('logging', () => {
  it('filters by level, writes JSON lines and redacts sensitive fields', () => {
    const lines: string[] = [];
    const logger = createLogger('info', (l) => lines.push(l));
    logger.debug('hidden');
    logger.info('shown', { apiToken: 'secret', long: 'x'.repeat(400), n: 1 });
    logger.error('boom');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(first['message']).toBe('shown');
    expect(first['apiToken']).toBeUndefined();
    expect(String(first['long']).length).toBeLessThan(310);
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ level: 'error', message: 'boom' });
  });
});
