import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProgram } from '../../src/cli/index.js';
import { MemoryCache } from '../../src/data/cache.js';
import { createServices } from '../../src/pipeline.js';
import {
  fakeWikimedia,
  FIXED_NOW,
  STANDARD_CONFIG,
  type FakeWikimediaConfig,
} from './fake-wikimedia.js';

export interface CliRun {
  code: number;
  stdout: string;
  json: Record<string, unknown>;
  logs: string[];
}

export function tempOutputDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'wia-cli-'));
}

/** Run the real CLI program in-process against the fake Wikimedia APIs. */
export async function runCli(
  args: string[],
  options: {
    outputDir?: string;
    config?: FakeWikimediaConfig;
    fetch?: ReturnType<typeof fakeWikimedia>;
  } = {},
): Promise<CliRun> {
  const out: string[] = [];
  const logs: string[] = [];
  let code = 0;
  const fetch = options.fetch ?? fakeWikimedia(options.config ?? STANDARD_CONFIG);
  const cache = new MemoryCache();
  const program = buildProgram(
    {
      write: (t) => out.push(t),
      env: { WIA_OUTPUT_DIR: options.outputDir ?? tempOutputDir() },
      logSink: (l) => logs.push(l),
      serviceFactory: (o) =>
        createServices({
          ...o,
          fetch,
          cache,
          now: () => FIXED_NOW,
          sleep: () => Promise.resolve(),
          maxRetries: 0,
        }),
    },
    (c) => {
      code = c;
    },
  );
  program.exitOverride();
  await program.parseAsync(['node', 'wia', '--no-cache', ...args]);
  const stdout = out.join('\n');
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { code, stdout, json, logs };
}
