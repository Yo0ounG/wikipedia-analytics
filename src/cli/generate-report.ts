import type { z } from 'zod';
import { generateReportInputSchema, parseInput } from '../schemas/input.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeArtifacts } from '../report/generate.js';
import { ReportValidationError } from '../report/template.js';
import { SCHEMA_VERSION } from '../schemas/output.js';
import { EXIT, printJson, type CliContext } from './shared.js';

/** Raw options as commander provides them; validated by `generateReportInputSchema`. */
export type GenerateReportCliOptions = z.input<typeof generateReportInputSchema>;

/** Re-render charts and the PDF from an existing analysis.json (no network access). */
export async function generateReportCommand(ctx: CliContext, rawOptions: unknown): Promise<number> {
  const fail = (message: string, code: 'invalid_input' | 'internal' = 'invalid_input'): number => {
    printJson(ctx, {
      schemaVersion: SCHEMA_VERSION,
      status: 'error',
      error: { code, message, hint: null },
    });
    return code === 'invalid_input' ? EXIT.invalidInput : EXIT.internal;
  };
  const parsed = parseInput(generateReportInputSchema, rawOptions);
  if (!parsed.ok) return fail(parsed.message);
  const opts = parsed.data;
  let json: unknown;
  try {
    json = JSON.parse(await readFile(opts.input, 'utf8'));
  } catch {
    return fail(`Cannot read analysis JSON "${opts.input}".`);
  }
  const directory = opts.outDir ?? path.dirname(opts.input);
  try {
    const result = await writeArtifacts(json, { directory, charts: true, report: true });
    printJson(ctx, {
      schemaVersion: SCHEMA_VERSION,
      status: 'ok',
      artifacts: result.artifacts,
      warnings: result.warnings,
    });
    return EXIT.ok;
  } catch (error) {
    if (error instanceof ReportValidationError)
      return fail(`Report not generated: ${error.message}`);
    ctx.logger.debug('generate-report failed', {
      error: error instanceof Error ? error.stack : String(error),
    });
    return fail('Failed to generate report.', 'internal');
  }
}
