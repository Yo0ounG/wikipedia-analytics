import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from '@jest/globals';
import { createServices, runAnalysis, type AnalysisParams } from '../../src/pipeline.js';
import { renderCharts } from '../../src/charts/index.js';
import { renderOnePagePdf, writeArtifacts } from '../../src/report/generate.js';
import { countPdfPages, renderPdf, REPORT_SECTIONS } from '../../src/report/pdf.js';
import {
  buildReportContent,
  ReportValidationError,
  validateForReport,
} from '../../src/report/template.js';
import type { AnalysisResult } from '../../src/types/analysis.js';
import { silentLogger } from '../../src/utils/logging.js';
import { MemoryCache } from '../../src/data/cache.js';
import { fakeWikimedia, FIXED_NOW, STANDARD_CONFIG } from '../helpers/fake-wikimedia.js';
import { extractPdfText, glyphMappings } from '../helpers/pdf-text.js';

let result: AnalysisResult;

const params = (overrides: Partial<AnalysisParams> = {}): AnalysisParams => ({
  query: 'astronomy',
  languages: ['pl', 'cs', 'uk'],
  searchLanguage: 'en',
  period: { spec: '2y' },
  access: 'all-access',
  agent: 'user',
  exclusions: [],
  excludeLargestSpike: false,
  missingAsZero: false,
  outputRoot: 'output',
  ...overrides,
});

beforeAll(async () => {
  const services = createServices({
    logger: silentLogger,
    userAgent: 't',
    fetch: fakeWikimedia(STANDARD_CONFIG),
    cache: new MemoryCache(),
    now: () => FIXED_NOW,
  });
  const outcome = await runAnalysis(services, params());
  if (outcome.kind !== 'success') throw new Error(`unexpected outcome ${outcome.kind}`);
  result = outcome.result;
});

describe('report content', () => {
  it('contains every required section, built from the analysis only', () => {
    const content = buildReportContent(result, []);
    expect(content.title).toBe('Wikipedia interest: astronomy');
    expect(content.meta.map((m) => m.label)).toEqual(['Topic', 'Languages', 'Period', 'Traffic']);
    expect(content.meta[0]?.value).toContain('Q333');
    expect(content.meta[2]?.value).toContain('2024-01-01 to 2025-12-31');
    expect(content.metricsTable.map((r) => r.language)).toEqual(['pl', 'cs', 'uk']);
    expect(content.keyFindings.length).toBeGreaterThanOrEqual(3);
    expect(content.evidence.strength).toBe(result.evidence.strength);
    expect(content.limitations.join(' ')).toMatch(/not market demand/);
    expect(content.dataSource).toMatch(/Wikimedia/);
    expect(content.generatedAt).toBe(FIXED_NOW.toISOString());
    expect(content.subtitle).toMatch(/not market demand/);
  });

  it('quotes metric values exactly as computed', () => {
    const content = buildReportContent(result, []);
    const plMetrics = result.languages['pl']?.metrics;
    const row = content.metricsTable.find((r) => r.language === 'pl');
    expect(row?.change).toBe(`+${(plMetrics?.percentChange ?? 0).toFixed(1)}%`);
  });
});

describe('report validation', () => {
  it('rejects schema-invalid input', () => {
    expect(() => validateForReport({ status: 'success' })).toThrow(ReportValidationError);
  });

  it('rejects analyses without usable data', () => {
    const broken = structuredClone(result);
    for (const l of Object.values(broken.languages)) l.metrics = null;
    expect(() => validateForReport(broken)).toThrow(/no language with usable/);
  });

  it('rejects internally inconsistent numbers instead of producing a misleading report', () => {
    const tampered = structuredClone(result);
    const m = tampered.languages['pl']?.metrics;
    if (!m) throw new Error('metrics expected');
    m.percentChange = (m.percentChange ?? 0) + 25;
    expect(() => validateForReport(tampered)).toThrow(/Inconsistent percentage change/);

    const tampered2 = structuredClone(result);
    const m2 = tampered2.languages['cs']?.metrics;
    if (!m2) throw new Error('metrics expected');
    m2.absoluteChange += 50;
    expect(() => validateForReport(tampered2)).toThrow(/Inconsistent absolute change/);

    const tampered3 = structuredClone(result);
    if (tampered3.comparison) tampered3.comparison.normalizedIndex.final['uk'] = 999;
    expect(() => validateForReport(tampered3)).toThrow(/Normalised index/);
  });
});

describe('PDF', () => {
  it('renders a valid, non-empty, one-page PDF with embedded charts', async () => {
    const charts = renderCharts(result).charts.map((c) => ({ title: c.title, svg: c.svg }));
    const pdf = await renderOnePagePdf(buildReportContent(result, charts));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toMatch(/%%EOF/);
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(countPdfPages(pdf)).toBe(1);
    expect(pdf.toString('latin1')).toContain('/Title');
  });

  it('contains every report section as a bookmark in the PDF itself', async () => {
    const pdf = (await renderOnePagePdf(buildReportContent(result, []))).toString('latin1');
    for (const section of REPORT_SECTIONS) expect(pdf).toContain(`(${section})`);
  });

  it('keeps report text copyable and contains the sections and numbers of the analysis', async () => {
    const pdf = await renderOnePagePdf(buildReportContent(result, []));
    const text = extractPdfText(pdf);
    for (const section of REPORT_SECTIONS) expect(text).toContain(section.toUpperCase());
    // Words with ff/fi/fl would lose letters if ligature glyphs were used.
    expect(text).toContain('Traffic: ');
    expect(text).toMatch(/high confidence|moderate confidence|low confidence/);
    expect(text).toContain('not market demand');
    const pl = result.languages['pl']?.metrics;
    expect(text).toContain(`+${(pl?.percentChange ?? 0).toFixed(1)}%`);
    expect(text).toContain(`Generated ${FIXED_NOW.toISOString().slice(0, 10)}`);
    expect(text).not.toContain('�');
  });

  it('uses no ligature glyphs, so every reader copies the text correctly', async () => {
    const pdf = await renderOnePagePdf(buildReportContent(result, []));
    const multi = glyphMappings(pdf).filter((m) => Array.from(m).length > 1);
    expect(multi).toEqual([]);
  });

  it('stays on one page even with overflowing content', async () => {
    const content = buildReportContent(
      result,
      renderCharts(result).charts.map((c) => ({ title: c.title, svg: c.svg })),
    );
    const long = {
      ...content,
      keyFindings: Array.from({ length: 40 }, (_, i) => `Finding ${String(i)} ${'x'.repeat(150)}`),
    };
    expect(countPdfPages(await renderPdf(long))).toBeGreaterThan(1);
    expect(countPdfPages(await renderOnePagePdf(long))).toBe(1);
  });

  it('writes analysis.json, charts and report.pdf', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wia-report-'));
    const final = await writeArtifacts(result, { directory: dir, charts: true, report: true });
    expect(final.artifacts.charts.map((c) => c.kind).sort()).toEqual([
      'comparison',
      'normalized',
      'trend',
    ]);
    expect(final.artifacts.report).toMatch(/report\.pdf$/);
    const saved = JSON.parse(
      readFileSync(path.join(dir, 'analysis.json'), 'utf8'),
    ) as AnalysisResult;
    expect(saved.artifacts.report).toBe(final.artifacts.report);
    expect(readFileSync(path.join(dir, 'report.pdf')).subarray(0, 4).toString()).toBe('%PDF');
    expect(readFileSync(path.join(dir, 'charts', 'normalized.svg'), 'utf8')).toContain('<svg');
  });

  it('can skip charts and the report', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wia-report-'));
    const final = await writeArtifacts(result, { directory: dir, charts: false, report: false });
    expect(final.artifacts.charts).toEqual([]);
    expect(final.artifacts.report).toBeNull();
  });
});
