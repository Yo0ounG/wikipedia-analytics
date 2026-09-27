import { Command, Option } from 'commander';
import { pathToFileURL } from 'node:url';
import { ACCESS_TYPES, AGENT_TYPES } from '../types/pageviews.js';
import { OUTPUT_FORMATS } from '../schemas/input.js';
import { analyzeCommand, type AnalyzeCliOptions } from './analyze.js';
import { generateReportCommand, type GenerateReportCliOptions } from './generate-report.js';
import { resolveTopicCommand, type ResolveCliOptions } from './resolve-topic.js';
import { createContext, type CliDeps, type GlobalOptions } from './shared.js';

const collect = (value: string, previous: string[]): string[] => [...previous, value];

export function buildProgram(
  deps: CliDeps = {},
  setExitCode: (code: number) => void = (c) => {
    process.exitCode = c;
  },
): Command {
  const program = new Command('wia')
    .description(
      'Wikipedia interest analysis: resolve a topic across Wikipedia languages, fetch Wikimedia pageviews and compute trends, spikes, seasonality and evidence strength.',
    )
    .option(
      '--log-level <level>',
      'debug | info | warn | error | silent (logs go to stderr)',
      'warn',
    )
    .option('--no-cache', 'disable the filesystem response cache (.cache/)')
    .showHelpAfterError();

  const globals = (): GlobalOptions => program.opts<GlobalOptions>();

  const analyze = program
    .command('analyze')
    .description('Analyze pageview interest in a topic across one or more Wikipedia languages.')
    .option('-t, --topic <text>', 'topic in natural language, e.g. "intermittent fasting"')
    .option(
      '--qid <QID>',
      'Wikidata QID of the concept (use after a clarification or to skip search)',
    )
    .option(
      '--from <analysis.json>',
      'follow-up: reuse topic, QID, languages, period and exclusions of a previous run',
    )
    .option('-l, --languages <codes>', 'comma-separated Wikipedia language codes, e.g. pl,cs,uk')
    .option('--search-lang <code>', 'Wikipedia edition used to search the topic text', 'en')
    .option(
      '-p, --period <spec>',
      'relative period: 90d, 12w, 12m, 2y (default 2y; months/years end at the last complete month)',
    )
    .option('--start <YYYY-MM-DD>', 'explicit start date (with --end)')
    .option('--end <YYYY-MM-DD>', 'explicit end date (with --start)')
    .option(
      '--exclude-dates <ranges>',
      'exclude dates: YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD (comma-separated, repeatable)',
      collect,
      [],
    )
    .option(
      '--exclude-largest-spike',
      'exclude the largest detected spike event in each language',
      false,
    )
    .option('--clear-exclusions', 'with --from: drop exclusions of the previous run', false)
    .option(
      '--missing-as-zero',
      'treat days not reported by the API as zero views (explicit assumption)',
      false,
    )
    .addOption(
      new Option('--access <type>', 'access method').choices(ACCESS_TYPES).default('all-access'),
    )
    .addOption(
      new Option('--agent <type>', 'agent type: user = humans (bots filtered)')
        .choices(AGENT_TYPES)
        .default('user'),
    )
    .option('--no-charts', 'do not write SVG charts')
    .option('--no-report', 'do not write the PDF report')
    .addOption(
      new Option('-f, --format <format>', 'stdout format')
        .choices(OUTPUT_FORMATS)
        .default('summary'),
    )
    .action(async (opts: AnalyzeCliOptions) => {
      const ctx = createContext(globals(), deps);
      setExitCode(
        await analyzeCommand(ctx, opts, (name) => analyze.getOptionValueSource(name) === 'cli'),
      );
    });

  program
    .command('resolve-topic')
    .description(
      'Resolve a topic to one Wikidata concept and its article in each language (no pageviews).',
    )
    .option('-q, --query <text>', 'topic in natural language')
    .option('--qid <QID>', 'Wikidata QID')
    .option('-l, --languages <codes>', 'comma-separated language codes', 'en')
    .option('--search-lang <code>', 'Wikipedia edition used to search the query', 'en')
    .action(async (opts: ResolveCliOptions) => {
      setExitCode(await resolveTopicCommand(createContext(globals(), deps), opts));
    });

  program
    .command('generate-report')
    .description(
      'Re-render SVG charts and the one-page PDF from an existing analysis.json (offline).',
    )
    .requiredOption('-i, --input <analysis.json>', 'analysis JSON written by `analyze`')
    .option('-o, --out-dir <dir>', 'output directory (default: next to the input)')
    .action(async (opts: GenerateReportCliOptions) => {
      setExitCode(await generateReportCommand(createContext(globals(), deps), opts));
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync([...argv]);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly || process.argv[1]?.endsWith('cli.js') === true) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        schemaVersion: '1.0',
        status: 'error',
        error: { code: 'internal', message: 'Unexpected internal error.', hint: String(error) },
      }),
    );
    process.exitCode = 1;
  });
}
