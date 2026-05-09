import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import c04 from '../../src/rules/c04-route-handler-ssrf.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/c04-route-handler-ssrf');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('c04 - Route Handler fetches user-controlled URL without allowlist', () => {
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
    findings = await c04.run(ctx);
  });

  const findingsForRoute = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  // ─── violations ───

  it('flags searchParams URL passed to fetch with no guard', () => {
    const f = findingsForRoute('bad-search-params-fetch/route.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.message).toContain('fetch()');
  });

  it('flags searchParams URL passed to axios.get', () => {
    const f = findingsForRoute('bad-axios/route.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('axios.get()');
  });

  it('flags route-segment params used as fetch host', () => {
    const f = findingsForRoute('bad-params-fetch/route.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('fetch()');
  });

  it('flags searchParams.src passed to new ImageResponse({ src })', () => {
    const f = findingsForRoute('bad-image-response/route.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('ImageResponse');
  });

  // ─── non-violations ───

  it('does NOT flag when URL.hostname is checked against an allowlist', () => {
    expect(findingsForRoute('correct-allowlist/route.ts')).toHaveLength(0);
  });

  it('does NOT flag when value passes through a validate*Url helper', () => {
    expect(findingsForRoute('correct-validator/route.ts')).toHaveLength(0);
  });

  it('does NOT flag when tainted value is interpolated into a hardcoded-host template', () => {
    expect(findingsForRoute('correct-hardcoded-host/route.ts')).toHaveLength(0);
  });

  it('does NOT flag when host comes from process.env and only path/query is tainted', () => {
    expect(findingsForRoute('correct-env-base/route.ts')).toHaveLength(0);
  });

  it('does NOT flag a handler that has no fetch-like sink', () => {
    expect(findingsForRoute('no-fetch/route.ts')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('c04-route-handler-ssrf');
      expect(f.severity).toBe('high');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(4);
  });
});
