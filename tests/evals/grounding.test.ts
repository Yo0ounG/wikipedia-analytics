import { describe, expect, it } from '@jest/globals';
import { ungroundedNumbers } from '../../evals/check-grounding.js';

describe('grounding checker', () => {
  const source = { a: 45.47, b: -59.62, findings: ['index 83.87, 1,234 views'] };

  it('accepts numbers present in the tool output at the displayed precision', () => {
    expect(ungroundedNumbers('Views 45.5 → fell -59.6% (index 83.87), 1,234 views.', [source])).toEqual([]);
  });

  it('flags invented numbers', () => {
    expect(ungroundedNumbers('Interest grew 12.4% and reached 999 views.', [source])).toEqual(['12.4', '999']);
  });

  it('ignores dates, years, QIDs, paths and inline code', () => {
    expect(ungroundedNumbers('Q333 from 2024-09-01 in 2025, see `pnpm analyze --period 12m` and out/a-77.json', [source])).toEqual([]);
  });
});
