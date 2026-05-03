import { describe, it, expect, vi, afterEach } from 'vitest';
import { jsonReporter } from '../../src/reporters/json.js';
import type { Finding } from '../../src/rules/types.js';

const finding: Finding = {
  ruleId: 'a02-rsc-pattern-misuse',
  severity: 'high',
  file: 'app/page.tsx',
  line: 10,
  column: 5,
  message: 'something wrong',
};

describe('jsonReporter', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  afterEach(() => logSpy.mockClear());

  it('emits a JSON object with a findings array', () => {
    jsonReporter([finding]);
    const output = String(logSpy.mock.calls[0]?.[0] ?? '');
    const parsed = JSON.parse(output) as { findings: Finding[] };
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.ruleId).toBe('a02-rsc-pattern-misuse');
  });

  it('emits an empty array for no findings', () => {
    jsonReporter([]);
    const output = String(logSpy.mock.calls[0]?.[0] ?? '');
    expect(JSON.parse(output)).toEqual({ findings: [] });
  });

  it('preserves all finding fields', () => {
    const full: Finding = { ...finding, detail: 'd', suggestion: 's', importChain: ['a', 'b'] };
    jsonReporter([full]);
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? '')) as { findings: Finding[] };
    expect(parsed.findings[0]).toEqual(full);
  });
});
