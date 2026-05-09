import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import d03 from '../../src/rules/d03-use-cache-request-scoped.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_16 = path.resolve(__dirname, '../fixtures/d03-use-cache-request-scoped');
const FIXTURE_15 = path.resolve(__dirname, '../fixtures/d03-use-cache-request-scoped-next15');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

const buildContext = (root: string): ProjectContext => {
  const tsConfigPath = findTsConfig(root);
  const { program, checker } = buildProgram(tsConfigPath);
  const graph = buildModuleGraph(program);
  const boundaryMap = classifyBoundaries(program, graph);
  return {
    rootDir: root,
    tsConfigPath,
    program,
    checker,
    moduleGraph: graph,
    boundaryMap,
    nextVersion: findNextVersion(root),
    config: RESOLVED_CONFIG,
  };
};

describe('d03 - request-scoped reads inside `use cache`', () => {
  let findings: Finding[];

  beforeAll(async () => {
    findings = await d03.run(buildContext(FIXTURE_16));
  });

  const findingsForFile = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  it('reads Next.js version 16.0.0 from the fixture node_modules', () => {
    expect(findNextVersion(FIXTURE_16)).toBe('16.0.0');
  });

  // ─── violations ───

  it('flags `cookies()` inside a function-level `use cache`', () => {
    const f = findingsForFile('app/lib/bad-cookies.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('critical');
    expect(f[0]?.message).toContain('cookies()');
  });

  it('flags `headers()` inside a function-level `use cache`', () => {
    const f = findingsForFile('app/lib/bad-headers.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('headers()');
  });

  it('flags an auth helper inside a function-level `use cache`', () => {
    const f = findingsForFile('app/lib/bad-auth.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('auth()');
    expect(f[0]?.detail).toMatch(/auth/i);
  });

  it('flags `draftMode()` inside a file-level `use cache`', () => {
    const f = findingsForFile('app/lib/bad-file-level.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('draftMode()');
  });

  it('flags a `verify*UserSession` helper inside a function-level `use cache`', () => {
    const f = findingsForFile('app/lib/bad-verify-helper.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('verifyUserSession');
  });

  // ─── non-violations ───

  it('does NOT flag a cached function that takes the request-scoped value as an argument', () => {
    expect(findingsForFile('app/lib/correct-passed-in.ts')).toHaveLength(0);
  });

  it('does NOT flag a cached function with no request-scoped reads', () => {
    expect(findingsForFile('app/lib/correct-no-request-scoped.ts')).toHaveLength(0);
  });

  it('does NOT flag request-scoped calls in a function that is not cached', () => {
    expect(findingsForFile('app/lib/correct-not-cached.ts')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('d03-use-cache-request-scoped');
      expect(f.severity).toBe('critical');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(5);
  });
});

describe('d03 - skipped on Next.js 15 projects', () => {
  it('produces zero findings even when the same shape is present', async () => {
    const ctx = buildContext(FIXTURE_15);
    expect(findNextVersion(FIXTURE_15)).toBe('15.4.0');
    const findings = await d03.run(ctx);
    expect(findings).toHaveLength(0);
  });
});
