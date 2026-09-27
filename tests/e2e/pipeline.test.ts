/**
 * End-to-end: query → topic resolution → pageview retrieval → analysis → charts → JSON → PDF,
 * using the real CLI program against deterministic fake Wikimedia APIs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { summarySchema } from '../../src/cli/summary.js';
import { analysisResultSchema } from '../../src/schemas/output.js';
import { buildReportContent } from '../../src/report/template.js';
import { runCli, tempOutputDir } from '../helpers/cli.js';
import { STANDARD_CONFIG } from '../helpers/fake-wikimedia.js';

describe('e2e: analyze', () => {
  it('runs the whole pipeline and keeps numbers consistent across JSON, summary, charts and PDF', async () => {
    const out = tempOutputDir();
    const run = await runCli(
      ['analyze', '--topic', 'astronomy', '--languages', 'pl,cs,uk', '--period', '2y'],
      { outputDir: out },
    );
    expect(run.code).toBe(0);

    const summary = summarySchema.parse(run.json);
    expect(summary.topic.qid).toBe('Q333');
    expect(summary.period).toEqual({ start: '2024-01-01', end: '2025-12-31', completeMonths: 24 });

    const analysisPath = summary.artifacts.analysis;
    const full = analysisResultSchema.parse(JSON.parse(readFileSync(analysisPath, 'utf8')));
    expect(full.status).toBe('success');
    expect(Object.keys(full.languages)).toEqual(['pl', 'cs', 'uk']);

    // Summary numbers are copied, never recomputed.
    for (const lang of ['pl', 'cs', 'uk']) {
      const l = full.languages[lang];
      const s = summary.languages[lang];
      expect(s?.percentChange).toBe(l?.metrics?.percentChange);
      expect(s?.averageDailyViews).toBe(l?.metrics?.averageDailyViews);
      expect(s?.trend.direction).toBe(l?.trend.direction);
      expect(s?.evidence.strength).toBe(l?.evidence.strength);
      // Normalised index equals 100 + percent change.
      expect(full.comparison?.normalizedIndex.final[lang]).toBeCloseTo(
        100 + (l?.metrics?.percentChange ?? 0),
        2,
      );
    }

    // Ground truth from fixtures: pl steady growth, cs noisy growth, uk flat with a spike.
    expect(full.languages['pl']?.trend.direction).toBe('up');
    expect(full.languages['uk']?.outliers.influence?.material).toBe(true);
    expect(full.languages['uk']?.evidence.strength).toBe('low');
    expect(full.evidence.strength).toBe('low');

    // Charts exist and show the same latest-window index as the JSON.
    const normalized = full.artifacts.charts.find((c) => c.kind === 'normalized');
    expect(normalized).toBeDefined();
    const svg = readFileSync(normalized?.path ?? '', 'utf8');
    expect(svg).toContain(
      `pl: ${String(Math.round(full.comparison?.normalizedIndex.final['pl'] ?? 0))} (latest window)`,
    );
    const comparisonSvg = readFileSync(
      full.artifacts.charts.find((c) => c.kind === 'comparison')?.path ?? '',
      'utf8',
    );
    const plChange = full.languages['pl']?.metrics?.percentChange ?? 0;
    expect(comparisonSvg).toContain(`+${plChange.toFixed(1)}% baseline → latest`);

    // PDF exists; its content model quotes the JSON values.
    expect(full.artifacts.report).not.toBeNull();
    expect(
      readFileSync(full.artifacts.report ?? '')
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    const content = buildReportContent(full, []);
    expect(content.metricsTable.find((r) => r.language === 'pl')?.change).toBe(
      `+${plChange.toFixed(1)}%`,
    );

    // Follow-up commands point at the saved analysis.
    expect(summary.followUp.map((f) => f.command).join('\n')).toContain('--from last');
    expect(summary.answerChecklist.join(' ')).toMatch(/not demand or unique users/);
    expect(summary.previousRun).toBeNull();
    // Share-of-edition interpretation is provided as a quotable sentence.
    expect(summary.languages['pl']?.relativeToEdition).toMatch(/edition/);
  });

  it('supports the text and full output formats and skipping artifacts', async () => {
    const text = await runCli([
      'analyze',
      '--qid',
      'Q333',
      '--languages',
      'pl',
      '--format',
      'text',
      '--no-report',
      '--no-charts',
    ]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^Topic: astronomy \(Q333\)/);
    expect(text.stdout).not.toMatch(/PDF report/);
    const full = await runCli([
      'analyze',
      '--qid',
      'Q333',
      '--languages',
      'pl',
      '--format',
      'full',
      '--no-report',
    ]);
    expect(analysisResultSchema.safeParse(full.json).success).toBe(true);
    expect(full.json['comparison']).toBeNull();
  });

  it('asks for clarification on ambiguous topics (exit code 2) with ready-to-run commands', async () => {
    const run = await runCli([
      'analyze',
      '--topic',
      'Mercury',
      '--languages',
      'pl,cs',
      '--period',
      '12m',
    ]);
    expect(run.code).toBe(2);
    expect(run.json['status']).toBe('needs_clarification');
    const options = run.json['options'] as { qid: string; description: string }[];
    expect(
      options.some((o) => o.qid === 'Q308' && o.description.startsWith('Mercury (planet)')),
    ).toBe(true);
    // The tool tells the agent to ask, provides the question, and gives no pre-chosen command.
    expect(run.json['agentInstruction']).toMatch(/^STOP\. Ask the user/);
    expect(run.json['questionForUser']).toMatch(/Which one do you mean\? \(1\)/);
    expect(run.json['commandAfterUserChoice']).toBe(
      'pnpm analyze --qid <QID chosen by the user> --languages pl,cs --period 12m',
    );
    expect(JSON.stringify(run.json)).not.toMatch(/--qid Q\d+/);
  });

  it('reports partially resolved topics and still analyses available languages', async () => {
    const run = await runCli([
      'analyze',
      '--topic',
      'intermittent fasting',
      '--languages',
      'pl,cs',
    ]);
    expect(run.code).toBe(0);
    expect(run.json['status']).toBe('partial');
    const topic = run.json['topic'] as {
      missingLanguages: string[];
      articles: Record<string, string>;
    };
    expect(topic.missingLanguages[0]).toMatch(/no Wikipedia article in language "pl"/);
    expect(Object.keys(topic.articles)).toEqual(['cs']);
  });

  it('fails cleanly for unknown topics, missing articles and bad input', async () => {
    const unknown = await runCli(['analyze', '--topic', 'zzqqxx', '--languages', 'en']);
    expect(unknown.code).toBe(3);
    expect(unknown.json).toMatchObject({ status: 'error', error: { code: 'not_found' } });

    const noArticle = await runCli(['analyze', '--qid', 'Q1666254', '--languages', 'pl']);
    expect(noArticle.code).toBe(3);
    expect(noArticle.json).toMatchObject({ error: { code: 'no_articles' } });

    const badLang = await runCli(['analyze', '--topic', 'astronomy', '--languages', 'pl;rm']);
    expect(badLang.code).toBe(4);
    expect(badLang.json).toMatchObject({ error: { code: 'invalid_input' } });

    const badPeriod = await runCli([
      'analyze',
      '--topic',
      'astronomy',
      '--languages',
      'pl',
      '--period',
      'forever',
    ]);
    expect(badPeriod.code).toBe(4);

    const noTopic = await runCli(['analyze', '--languages', 'pl']);
    expect(noTopic.json).toMatchObject({ error: { message: 'Provide --topic, --qid or --from.' } });

    const bothPeriods = await runCli([
      'analyze',
      '--qid',
      'Q333',
      '--languages',
      'pl',
      '--period',
      '1y',
      '--start',
      '2025-01-01',
      '--end',
      '2025-06-30',
    ]);
    expect(bothPeriods.code).toBe(4);
  });

  it('reports insufficient data when no views were recorded', async () => {
    const config = { ...STANDARD_CONFIG, pageviews: {} };
    const run = await runCli(['analyze', '--qid', 'Q333', '--languages', 'pl,cs'], { config });
    expect(run.code).toBe(3);
    expect(run.json).toMatchObject({ error: { code: 'insufficient_data' } });
  });

  it('continues without share-of-traffic metrics when edition totals are unavailable', async () => {
    const config = { ...STANDARD_CONFIG, projectViews: false };
    const run = await runCli(
      ['analyze', '--qid', 'Q333', '--languages', 'pl', '--format', 'full', '--no-report'],
      { config },
    );
    expect(run.code).toBe(0);
    const pl = (run.json['languages'] as Record<string, { projectNormalized: unknown }>)['pl'];
    expect(pl?.projectNormalized).toBeNull();
  });

  it('maps network failures to a friendly error without stack traces on stdout', async () => {
    const failing = Object.assign(() => Promise.reject(new TypeError('getaddrinfo ENOTFOUND')), {
      calls: [] as string[],
      headers: [] as Headers[],
    });
    const run = await runCli(['analyze', '--topic', 'astronomy', '--languages', 'pl'], {
      fetch: failing,
    });
    expect(run.code).toBe(5);
    expect(run.json).toMatchObject({
      error: { code: 'network', message: 'Unable to reach Wikimedia API.' },
    });
    expect(run.stdout).not.toMatch(/at .*\.ts:\d+/);
  });
});

describe('e2e: follow-ups', () => {
  it('"Now only compare the last 12 months" keeps topic, QID and languages and changes only the period', async () => {
    const out = tempOutputDir();
    const first = await runCli(
      ['analyze', '--topic', 'astronomy', '--languages', 'pl,cs', '--period', '2y', '--no-report'],
      { outputDir: out },
    );
    const firstAnalysis = (first.json['artifacts'] as { analysis: string }).analysis;
    const second = await runCli(
      ['analyze', '--from', firstAnalysis, '--period', '12m', '--format', 'full', '--no-report'],
      { outputDir: out },
    );
    expect(second.code).toBe(0);
    const req = second.json['request'] as {
      qid: string;
      languages: string[];
      query: string;
      period: { start: string; end: string };
    };
    expect(req.qid).toBe('Q333');
    expect(req.query).toBe('astronomy');
    expect(req.languages).toEqual(['pl', 'cs']);
    expect(req.period).toMatchObject({ start: '2025-01-01', end: '2025-12-31' });
    expect(existsSync(firstAnalysis)).toBe(true);
  });

  it('"Exclude the largest spike" is passed as an explicit parameter and preserved in later follow-ups', async () => {
    const out = tempOutputDir();
    const first = await runCli(
      ['analyze', '--topic', 'astronomy', '--languages', 'uk', '--no-report'],
      { outputDir: out },
    );
    const firstPath = (first.json['artifacts'] as { analysis: string }).analysis;
    const firstChange =
      (first.json['languages'] as Record<string, { percentChange: number }>)['uk']?.percentChange ??
      0;

    const second = await runCli(
      [
        'analyze',
        '--from',
        firstPath,
        '--exclude-largest-spike',
        '--format',
        'full',
        '--no-report',
      ],
      { outputDir: out },
    );
    const secondJson = second.json as {
      request: { exclusions: { largestSpike: boolean } };
      languages: Record<
        string,
        { metrics: { percentChange: number }; data: { excludedRanges: unknown[] } }
      >;
      artifacts: { analysis: string };
    };
    expect(secondJson.request.exclusions.largestSpike).toBe(true);
    expect(secondJson.languages['uk']?.data.excludedRanges).toEqual([
      { start: '2025-04-10', end: '2025-04-14' },
    ]);
    expect(Math.abs(secondJson.languages['uk']?.metrics.percentChange ?? 99)).toBeLessThan(
      Math.abs(firstChange),
    );
    expect(secondJson.artifacts.analysis).not.toBe(firstPath);

    // A further follow-up keeps the exclusion unless explicitly cleared.
    const third = await runCli(
      [
        'analyze',
        '--from',
        secondJson.artifacts.analysis,
        '--period',
        '12m',
        '--format',
        'full',
        '--no-report',
      ],
      { outputDir: out },
    );
    expect(
      (third.json['request'] as { exclusions: { largestSpike: boolean } }).exclusions.largestSpike,
    ).toBe(true);
    const cleared = await runCli(
      [
        'analyze',
        '--from',
        secondJson.artifacts.analysis,
        '--clear-exclusions',
        '--format',
        'full',
        '--no-report',
      ],
      { outputDir: out },
    );
    expect(
      (cleared.json['request'] as { exclusions: { largestSpike: boolean } }).exclusions
        .largestSpike,
    ).toBe(false);
  });

  it('explicit date exclusions (e.g. "exclude the April 2025 spike") merge with previous ones', async () => {
    const out = tempOutputDir();
    const first = await runCli(
      [
        'analyze',
        '--qid',
        'Q333',
        '--languages',
        'uk',
        '--exclude-dates',
        '2024-12-24..2024-12-26',
        '--no-report',
      ],
      { outputDir: out },
    );
    const p = (first.json['artifacts'] as { analysis: string }).analysis;
    const second = await runCli(
      [
        'analyze',
        '--from',
        p,
        '--exclude-dates',
        '2025-04-10..2025-04-14',
        '--format',
        'full',
        '--no-report',
      ],
      { outputDir: out },
    );
    expect(
      (second.json['request'] as { exclusions: { dateRanges: unknown[] } }).exclusions.dateRanges,
    ).toEqual([
      { start: '2024-12-24', end: '2024-12-26' },
      { start: '2025-04-10', end: '2025-04-14' },
    ]);
    const bad = await runCli(['analyze', '--from', p, '--exclude-dates', '2025-04-14..2025-04-10']);
    expect(bad.code).toBe(4);
  });

  it('changing languages in a follow-up keeps the concept', async () => {
    const out = tempOutputDir();
    const first = await runCli(
      ['analyze', '--topic', 'astronomy', '--languages', 'pl', '--no-report'],
      { outputDir: out },
    );
    const p = (first.json['artifacts'] as { analysis: string }).analysis;
    const second = await runCli(['analyze', '--from', p, '--languages', 'pl,uk', '--no-report'], {
      outputDir: out,
    });
    expect(
      (second.json['topic'] as { qid: string; articles: Record<string, string> }).articles,
    ).toEqual({ pl: 'Astronomia', uk: 'Астрономія' });
  });

  it('rejects unreadable or foreign --from files', async () => {
    expect((await runCli(['analyze', '--from', 'does-not-exist.json'])).code).toBe(4);
    expect((await runCli(['analyze', '--from', 'package.json'])).json).toMatchObject({
      error: { code: 'invalid_input' },
    });
    expect((await runCli(['analyze', '--from', 'last'])).json).toMatchObject({
      error: { message: expect.stringMatching(/No previous analysis/) as unknown },
    });
  });

  it('"--from last" follows the most recent run and reports before → after per language', async () => {
    const out = tempOutputDir();
    await runCli(
      ['analyze', '--qid', 'Q333', '--languages', 'uk', '--period', '2y', '--no-report'],
      {
        outputDir: out,
      },
    );
    const narrowed = await runCli(['analyze', '--from', 'last', '--period', '12m', '--no-report'], {
      outputDir: out,
    });
    expect((narrowed.json['period'] as { start: string }).start).toBe('2025-01-01');
    // The next follow-up applies to the 12-month run, not the original 2-year one.
    const excluded = await runCli(
      ['analyze', '--from', 'last', '--exclude-largest-spike', '--no-report'],
      {
        outputDir: out,
      },
    );
    const summary = excluded.json as {
      period: { start: string };
      previousRun: {
        period: { start: string };
        languages: Record<
          string,
          {
            percentChangeBefore: number;
            percentChangeAfter: number;
            differencePercentagePoints: number;
          }
        >;
      };
    };
    expect(summary.period.start).toBe('2025-01-01');
    expect(summary.previousRun.period.start).toBe('2025-01-01');
    const uk = summary.previousRun.languages['uk'];
    expect(uk?.differencePercentagePoints).toBeCloseTo(
      (uk?.percentChangeAfter ?? 0) - (uk?.percentChangeBefore ?? 0),
      2,
    );
  });
});

describe('e2e: resolve-topic and generate-report', () => {
  it('resolve-topic returns the resolution and exit codes', async () => {
    const ok = await runCli([
      'resolve-topic',
      '--query',
      'intermittent fasting',
      '--languages',
      'cs,uk',
    ]);
    expect(ok.code).toBe(0);
    expect((ok.json['topic'] as { qid: string }).qid).toBe('Q1666254');
    const amb = await runCli(['resolve-topic', '--query', 'Mercury']);
    expect(amb.code).toBe(2);
    const bad = await runCli(['resolve-topic']);
    expect(bad.code).toBe(4);
    const notFound = await runCli(['resolve-topic', '--query', 'zzqqxx']);
    expect(notFound.code).toBe(3);
  });

  it('generate-report re-renders artifacts offline from analysis.json', async () => {
    const out = tempOutputDir();
    const first = await runCli(
      ['analyze', '--qid', 'Q333', '--languages', 'pl,cs', '--no-report', '--no-charts'],
      { outputDir: out },
    );
    const p = (first.json['artifacts'] as { analysis: string }).analysis;
    const regen = await runCli(['generate-report', '--input', p], { outputDir: out });
    expect(regen.code).toBe(0);
    const artifacts = regen.json['artifacts'] as { report: string; charts: unknown[] };
    expect(existsSync(artifacts.report)).toBe(true);
    expect(artifacts.charts).toHaveLength(3);
    const missing = await runCli(['generate-report', '--input', 'nope.json']);
    expect(missing.code).toBe(4);
    const invalid = await runCli(['generate-report', '--input', 'package.json']);
    expect(invalid.json).toMatchObject({
      error: { message: expect.stringMatching(/Report not generated/) as unknown },
    });
  });
});
