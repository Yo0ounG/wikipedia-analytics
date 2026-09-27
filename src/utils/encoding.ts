/** Encoding and input-sanitising helpers for everything that ends up in a URL or a path. */

const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$|^simple$/;
const QID = /^Q[1-9]\d*$/;

export const MAX_LANGUAGES = 12;

export function isValidLanguageCodeSyntax(code: string): boolean {
  return LANGUAGE_CODE.test(code);
}

export function parseLanguageList(value: string): string[] {
  const codes = value
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
  const unique = [...new Set(codes)];
  const invalid = unique.filter((c) => !isValidLanguageCodeSyntax(c));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid language code(s): ${invalid.join(', ')}. Use Wikipedia codes like en, pl, cs, uk.`,
    );
  }
  if (unique.length === 0) throw new Error('At least one language code is required.');
  if (unique.length > MAX_LANGUAGES) {
    throw new Error(`At most ${MAX_LANGUAGES} languages can be analyzed in one run.`);
  }
  return unique;
}

export function isValidQid(value: string): boolean {
  return QID.test(value);
}

/** Wikipedia titles use underscores in URLs; every other reserved char (incl. "/") is percent-encoded. */
export function encodeArticleTitle(title: string): string {
  return encodeURIComponent(title.trim().replaceAll(' ', '_'));
}

export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  return search.toString();
}

function stripDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** Basic Cyrillic → Latin transliteration so non-Latin topic names still give readable slugs. */
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ye',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'yi',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'yu',
  я: 'ya',
  ё: 'yo',
  ы: 'y',
  э: 'e',
  ъ: '',
  ў: 'u',
};

function transliterate(value: string): string {
  return Array.from(value.toLowerCase(), (ch) => CYRILLIC[ch] ?? ch).join('');
}

/** Filesystem-safe ASCII slug. */
export function slugify(value: string, maxLength = 48): string {
  const slug = stripDiacritics(transliterate(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'topic';
}

/** Normalise a title/query for comparison: case, diacritics, punctuation, parentheticals. */
export function normalizeForMatch(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[_\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  const n = normalizeForMatch(value);
  return n.length === 0 ? [] : n.split(' ');
}
