/** @jest-config-loader esbuild-register */
import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/cli/index.ts'],
  coverageReporters: ['text-summary', 'text', 'json-summary'],
  coverageThreshold: {
    // Branch totals include many defensive `?? fallback` branches required by
    // noUncheckedIndexedAccess; domain logic is held to higher statement/line coverage.
    global: { statements: 90, branches: 75, functions: 90, lines: 90 },
    './src/analysis/': { statements: 93, branches: 75, lines: 95 },
    './src/resolver/': { statements: 95, branches: 80, lines: 95 },
    './src/api/': { statements: 93, branches: 80, lines: 95 },
  },
};

export default config;
