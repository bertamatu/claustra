import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import a04 from '../../src/rules/a04-unawaited-params.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_15 = path.resolve(__dirname, '../fixtures/a04-unawaited-params');
const FIXTURE_14 = path.resolve(__dirname, '../fixtures/a04-unawaited-params-next14');

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

describe('a04 - unawaited params/searchParams in Next.js 15+', () => {
  let findings: Finding[];

  beforeAll(async () => {
    findings = await a04.run(buildContext(FIXTURE_15));
  });

  const findingsForFile = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  it('reads Next.js version 15.1.0 from the fixture node_modules', () => {
    expect(findNextVersion(FIXTURE_15)).toBe('15.1.0');
  });

  // ─── violations ───

  it('flags destructure-without-await on params', () => {
    const f = findingsForFile('app/dashboard/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('critical');
    expect(f[0]?.message).toContain('params');
    expect(f[0]?.detail).toMatch(/destructur/i);
  });

  it('flags direct property access on params and searchParams', () => {
    const f = findingsForFile('app/[id]/page.tsx');
    expect(f).toHaveLength(2);
    const messages = f.map((x) => x.message).join(' ');
    expect(messages).toContain('params');
    expect(messages).toContain('searchParams');
    expect(f.every((x) => x.detail?.match(/property/i))).toBe(true);
  });

  it('flags route handler accessing params.x without await', () => {
    const f = findingsForFile('app/api/[id]/route.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('params');
  });

  it('flags generateMetadata accessing params without await', () => {
    const f = findingsForFile('app/metadata/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('params');
  });

  // ─── non-violations ───

  it('does NOT flag a page that awaits params and searchParams', () => {
    expect(findingsForFile('app/correct/page.tsx')).toHaveLength(0);
  });

  it('does NOT flag a page that takes no params', () => {
    expect(findingsForFile('app/static/page.tsx')).toHaveLength(0);
  });

  it('does NOT flag a Client Component using the React `use(params)` hook', () => {
    expect(findingsForFile('app/use-hook/page.tsx')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('a04-unawaited-params');
      expect(f.severity).toBe('critical');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
      expect(f.suggestion).toMatch(/await/);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(5);
  });
});

describe('a04 - skipped on Next.js 14 projects', () => {
  it('produces zero findings even when the same shape is present', async () => {
    const ctx = buildContext(FIXTURE_14);
    expect(findNextVersion(FIXTURE_14)).toBe('14.2.0');
    const findings = await a04.run(ctx);
    expect(findings).toHaveLength(0);
  });
});
