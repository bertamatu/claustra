import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import d04 from '../../src/rules/d04-use-cache-missing-tags.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_16 = path.resolve(__dirname, '../fixtures/d04-use-cache-missing-tags');
const FIXTURE_15 = path.resolve(__dirname, '../fixtures/d04-use-cache-missing-tags-next15');

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

describe('d04 - `use cache` without cacheLife or cacheTag', () => {
  let findings: Finding[];

  beforeAll(async () => {
    findings = await d04.run(buildContext(FIXTURE_16));
  });

  const findingsForFile = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  it('reads Next.js version 16.0.0 from the fixture node_modules', () => {
    expect(findNextVersion(FIXTURE_16)).toBe('16.0.0');
  });

  // ─── violations ───

  it('flags a function-level `use cache` with no cacheLife/cacheTag', () => {
    const f = findingsForFile('app/lib/bad-bare-function.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('medium');
    expect(f[0]?.message).toContain('getCatalog');
    expect(f[0]?.message).toContain('cacheLife');
    expect(f[0]?.message).toContain('cacheTag');
  });

  it('flags every top-level function in a file-level cached file individually', () => {
    const f = findingsForFile('app/lib/bad-file-level.ts');
    expect(f).toHaveLength(2);
    const names = f.map((x) => x.message).join(' ');
    expect(names).toContain('getProducts');
    expect(names).toContain('getCategories');
  });

  it('flags when cacheLife is imported but never called inside the cached scope', () => {
    const f = findingsForFile('app/lib/bad-imported-but-unused.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('getReport');
  });

  // ─── non-violations ───

  it('does NOT flag when cacheLife is called inside the cached scope', () => {
    expect(findingsForFile('app/lib/correct-cache-life.ts')).toHaveLength(0);
  });

  it('does NOT flag when cacheTag is called inside the cached scope', () => {
    expect(findingsForFile('app/lib/correct-cache-tag.ts')).toHaveLength(0);
  });

  it('does NOT flag when both cacheLife and cacheTag are called', () => {
    expect(findingsForFile('app/lib/correct-both.ts')).toHaveLength(0);
  });

  it('does NOT flag a function with no `use cache` directive', () => {
    expect(findingsForFile('app/lib/correct-not-cached.ts')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('d04-use-cache-missing-tags');
      expect(f.severity).toBe('medium');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
      expect(f.suggestion).toMatch(/cacheLife|cacheTag/);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(4);
  });
});

describe('d04 - skipped on Next.js 15 projects', () => {
  it('produces zero findings even when the same shape is present', async () => {
    const ctx = buildContext(FIXTURE_15);
    expect(findNextVersion(FIXTURE_15)).toBe('15.4.0');
    const findings = await d04.run(ctx);
    expect(findings).toHaveLength(0);
  });
});
