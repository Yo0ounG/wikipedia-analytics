/**
 * Cross-checks one analysis folder: JSON metrics vs SVG chart labels vs PDF content model,
 * index = 100 + percent change, and a one-page PDF.  Usage: pnpm consistency <output dir>
 */
import { readFileSync } from 'node:fs';
import { analysisResultSchema } from '../src/schemas/output.js';
import { buildReportContent } from '../src/report/template.js';
import { countPdfPages } from '../src/report/pdf.js';
import { formatSignedPercent, formatViews } from '../src/utils/numbers.js';
const dir = process.argv[2] ?? '';
const r = analysisResultSchema.parse(JSON.parse(readFileSync(`${dir}/analysis.json`, 'utf8')));
const svg = (k: string) => readFileSync(`${dir}/charts/${k}.svg`, 'utf8');
const content = buildReportContent(r, []);
const checks: [string, boolean][] = [];
for (const lang of r.request.languages) {
  const m = r.languages[lang]?.metrics;
  if (!m) continue;
  const pct = formatSignedPercent(m.percentChange);
  const idx = r.comparison?.normalizedIndex.final[lang] ?? null;
  checks.push([
    `${lang}: index = 100 + change`,
    idx !== null && Math.abs(idx - (100 + (m.percentChange ?? 0))) < 0.02,
  ]);
  checks.push([
    `${lang}: normalized.svg label`,
    svg('normalized').includes(`${lang}: ${String(Math.round(idx ?? 0))} (latest window)`),
  ]);
  checks.push([
    `${lang}: comparison.svg change`,
    svg('comparison').includes(`${pct} baseline → latest`),
  ]);
  checks.push([
    `${lang}: comparison.svg absolute`,
    svg('comparison').includes(
      `${formatViews(m.baseline.averageDailyViews)} → ${formatViews(m.latest.averageDailyViews)} views/day`,
    ),
  ]);
  const row = content.metricsTable.find((x) => x.language === lang);
  checks.push([`${lang}: PDF table change`, row?.change === pct]);
  checks.push([`${lang}: PDF table avg`, row?.averageDaily === formatViews(m.averageDailyViews)]);
  checks.push([`${lang}: finding sentence`, r.findings.some((f) => f.includes(pct))]);
}
checks.push(['PDF is one page', countPdfPages(readFileSync(`${dir}/report.pdf`)) === 1]);
for (const [n, ok] of checks) console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}`);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
