import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import a06 from '../../src/rules/a06-use-inline-promise.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/a06-use-inline-promise');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('a06 - use() with inline-created Promise', () => {
  let findings: Finding[];

  beforeAll(async () => {
    const tsConfigPath = findTsConfig(FIXTURE_ROOT);
    const { program, checker } = buildProgram(tsConfigPath);
    const graph = buildModuleGraph(program);
    const boundaryMap = classifyBoundaries(program, graph);
    const ctx: ProjectContext = {
      rootDir: FIXTURE_ROOT,
      tsConfigPath,
      program,
      checker,
      moduleGraph: graph,
      boundaryMap,
      nextVersion: findNextVersion(FIXTURE_ROOT),
      config: RESOLVED_CONFIG,
    };
    findings = await a06.run(ctx);
  });

  const findingsForFile = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  // ─── violations ───

  it('flags `use(fetch(...))`', () => {
    const f = findingsForFile('components/bad-inline-fetch.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.detail).toMatch(/fetch/i);
  });

  it('flags `use(new Promise(...))`', () => {
    const f = findingsForFile('components/bad-new-promise.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toMatch(/new Promise/i);
  });

  it('flags `use((async () => ...)())` (inline async IIFE)', () => {
    const f = findingsForFile('components/bad-iife.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toMatch(/async function/i);
  });

  it('flags the degenerate `use(Promise.resolve(x))` shape', () => {
    const f = findingsForFile('components/bad-promise-resolve.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toMatch(/degenerate|Promise\.resolve/i);
  });

  it('flags a Promise stored in a per-render local variable', () => {
    const f = findingsForFile('components/bad-local-variable.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('inside the component body');
  });

  // ─── non-violations ───

  it('does NOT flag a Promise passed in as a prop', () => {
    expect(findingsForFile('components/correct-prop.tsx')).toHaveLength(0);
  });

  it('does NOT flag a Promise hoisted to module scope', () => {
    expect(findingsForFile('components/correct-module-scope.tsx')).toHaveLength(0);
  });

  it('does NOT flag a Promise wrapped in `useMemo`', () => {
    expect(findingsForFile('components/correct-usememo.tsx')).toHaveLength(0);
  });

  it('does NOT flag a same-named helper that is not React `use`', () => {
    expect(findingsForFile('components/correct-not-react-use.tsx')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('a06-use-inline-promise');
      expect(f.severity).toBe('high');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(5);
  });
});
