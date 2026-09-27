/**
 * Minimal text extractor for PDFKit output (Type0 fonts, Identity-H, ToUnicode CMaps).
 * It decodes the text exactly as a PDF viewer would copy it, so tests can assert on the real
 * report text instead of only on the content model.
 */
import { inflateSync } from 'node:zlib';

interface PdfObject {
  dict: string;
  stream: Buffer | null;
}

function readObjects(pdf: Buffer): Map<string, PdfObject> {
  const src = pdf.toString('latin1');
  const objects = new Map<string, PdfObject>();
  for (const m of src.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
    const id = m[1] ?? '';
    const body = m[2] ?? '';
    const sm = /^([\s\S]*?)stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
    if (!sm) {
      objects.set(id, { dict: body, stream: null });
      continue;
    }
    const raw = Buffer.from(sm[2] ?? '', 'latin1');
    const dict = sm[1] ?? '';
    objects.set(id, { dict, stream: dict.includes('/FlateDecode') ? inflateSync(raw) : raw });
  }
  return objects;
}

function parseCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const range of cmap.matchAll(/<([0-9a-fA-F]+)> <([0-9a-fA-F]+)> \[([^\]]*)\]/g)) {
    const start = parseInt(range[1] ?? '0', 16);
    const entries = [...(range[3] ?? '').matchAll(/<([0-9a-fA-F ]*)>/g)];
    entries.forEach((e, i) => {
      const codes = (e[1] ?? '').split(/\s+/).filter((c) => c.length > 0);
      map.set(start + i, String.fromCharCode(...codes.map((c) => parseInt(c, 16))));
    });
  }
  return map;
}

/** All text drawn in the PDF, one line per text-showing operator. */
export function extractPdfText(pdf: Buffer): string {
  const objects = readObjects(pdf);
  const fontObject = new Map<string, string>();
  for (const o of objects.values()) {
    const res = /\/Font\s*<<([\s\S]*?)>>/.exec(o.dict);
    for (const f of (res?.[1] ?? '').matchAll(/\/(F\d+)\s+(\d+) 0 R/g)) {
      fontObject.set(f[1] ?? '', f[2] ?? '');
    }
  }
  const cmapCache = new Map<string, Map<number, string>>();
  const cmapFor = (fontName: string): Map<number, string> => {
    const cached = cmapCache.get(fontName);
    if (cached) return cached;
    const font = objects.get(fontObject.get(fontName) ?? '');
    const ref = /\/ToUnicode (\d+) 0 R/.exec(font?.dict ?? '')?.[1] ?? '';
    const map = parseCmap(objects.get(ref)?.stream?.toString('latin1') ?? '');
    cmapCache.set(fontName, map);
    return map;
  };

  const lines: string[] = [];
  for (const o of objects.values()) {
    const content = o.stream?.toString('latin1') ?? '';
    if (!content.includes(' Tf')) continue;
    let font = '';
    for (const op of content.matchAll(/\/(F\d+) [\d.]+ Tf|\[([^\]]*)\] TJ|<([0-9a-fA-F]+)> Tj/g)) {
      if (op[1]) {
        font = op[1];
        continue;
      }
      const hexes =
        op[2] !== undefined
          ? [...op[2].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1] ?? '')
          : [op[3] ?? ''];
      const map = cmapFor(font);
      const text = hexes
        .join('')
        .match(/.{4}/g)
        ?.map((gid) => map.get(parseInt(gid, 16)) ?? '�')
        .join('');
      if (text) lines.push(text);
    }
  }
  return lines.join('\n');
}

/**
 * Every glyph → text mapping of every font in the PDF. A mapping longer than one character is a
 * ligature glyph; some PDF readers copy only its first letter ("Traffic" → "Trafc").
 */
export function glyphMappings(pdf: Buffer): string[] {
  const out: string[] = [];
  for (const o of readObjects(pdf).values()) {
    const text = o.stream?.toString('latin1') ?? '';
    if (text.includes('beginbfrange')) out.push(...parseCmap(text).values());
  }
  return out;
}
