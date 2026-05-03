import { describe, it, expect, vi, afterEach } from 'vitest';
import { terminalReporter } from '../../src/reporters/terminal.js';
import type { Finding } from '../../src/rules/types.js';

// eslint-disable-next-line no-control-regex -- ANSI escape sequences are by definition control chars
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: 'a02-rsc-pattern-misuse',
  severity: 'high',
  file: 'app/page.tsx',
  line: 10,
  column: 5,
  message: 'something wrong',
  ...overrides,
});

describe('terminalReporter', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  afterEach(() => logSpy.mockClear());

  const captured = (): string =>
    stripAnsi(logSpy.mock.calls.map((c) => String(c[0] ?? '')).join('\n'));

  it('prints "0 findings" with no input', () => {
    terminalReporter([]);
    expect(captured()).toContain('0 findings');
  });

  it('prints a count and file summary', () => {
    terminalReporter([finding(), finding({ file: 'other.tsx', severity: 'critical' })]);
    expect(captured()).toContain('found 2 issues in 2 files');
  });

  it('renders rule id, location, and message for each finding', () => {
    terminalReporter([finding({ message: 'broken', line: 42, file: 'x.tsx' })]);
    const out = captured();
    expect(out).toContain('A02-RSC-PATTERN-MISUSE');
    expect(out).toContain('x.tsx:42');
    expect(out).toContain('broken');
  });

  it('renders detail and suggestion when provided', () => {
    terminalReporter([
      finding({ detail: 'multi\nline\ndetail', suggestion: 'do this instead' }),
    ]);
    const out = captured();
    expect(out).toContain('multi');
    expect(out).toContain('line');
    expect(out).toContain('detail');
    expect(out).toContain('do this instead');
  });

  it('renders import chain when provided', () => {
    terminalReporter([finding({ importChain: ['client.tsx', 'lib/db.ts', '@prisma/client'] })]);
    expect(captured()).toContain('client.tsx → lib/db.ts → @prisma/client');
  });

  it('summarizes severity counts at the end', () => {
    terminalReporter([
      finding({ severity: 'critical' }),
      finding({ severity: 'critical' }),
      finding({ severity: 'high' }),
      finding({ severity: 'medium' }),
    ]);
    const out = captured();
    expect(out).toContain('2 critical');
    expect(out).toContain('1 high');
    expect(out).toContain('1 medium');
  });

  it('uses singular forms for one issue / one file', () => {
    terminalReporter([finding()]);
    const out = captured();
    expect(out).toContain('1 issue in 1 file');
    expect(out).not.toContain('1 issues');
  });
});
