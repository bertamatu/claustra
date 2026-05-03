import { describe, it, expect, vi, afterEach } from 'vitest';
import { githubReporter } from '../../src/reporters/github.js';
import type { Finding } from '../../src/rules/types.js';

const make = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: 'a02-rsc-pattern-misuse',
  severity: 'high',
  file: 'app/page.tsx',
  line: 10,
  column: 5,
  message: 'broken',
  ...overrides,
});

describe('githubReporter', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  afterEach(() => logSpy.mockClear());

  const lines = (): string[] => logSpy.mock.calls.map((c) => String(c[0] ?? ''));

  it('maps critical and high severities to ::error', () => {
    githubReporter([make({ severity: 'critical' }), make({ severity: 'high' })]);
    expect(lines()[0]).toMatch(/^::error/);
    expect(lines()[1]).toMatch(/^::error/);
  });

  it('maps medium to ::warning and low to ::notice', () => {
    githubReporter([make({ severity: 'medium' }), make({ severity: 'low' })]);
    expect(lines()[0]).toMatch(/^::warning/);
    expect(lines()[1]).toMatch(/^::notice/);
  });

  it('includes file, line, col, and title in the annotation', () => {
    githubReporter([make({ file: 'x.ts', line: 7, column: 3, ruleId: 'd01-foo' })]);
    expect(lines()[0]).toContain('file=x.ts');
    expect(lines()[0]).toContain('line=7');
    expect(lines()[0]).toContain('col=3');
    expect(lines()[0]).toContain('title=d01-foo');
  });

  it('appends the suggestion when present', () => {
    githubReporter([make({ message: 'broken', suggestion: 'fix it' })]);
    expect(lines()[0]).toContain('broken Fix: fix it');
  });

  it('emits no output for empty findings', () => {
    githubReporter([]);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
