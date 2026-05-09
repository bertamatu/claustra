import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import c05 from '../../src/rules/c05-middleware-coverage.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/c05-middleware-coverage');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('c05 - sensitive routes lacking middleware or inline auth', () => {
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
    findings = await c05.run(ctx);
  });

  const findingsForFile = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  // ─── violations ───

  it('flags /dashboard page when middleware matcher does not cover it', () => {
    const f = findingsForFile('app/dashboard/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.message).toContain('/dashboard');
  });

  it('flags pages inside an (authenticated) route group', () => {
    const f = findingsForFile('(authenticated)/profile/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('/profile');
  });

  it('flags route handlers that mutate without auth', () => {
    const f = findingsForFile('app/api/posts-mutating/route.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('/api/posts-mutating');
  });

  // ─── non-violations ───

  it('does NOT flag /admin/users when middleware matcher /admin/:path* covers it', () => {
    expect(findingsForFile('app/admin/users/page.tsx')).toHaveLength(0);
  });

  it('does NOT flag a public marketing page', () => {
    expect(findingsForFile('app/about/page.tsx')).toHaveLength(0);
  });

  it('does NOT flag a webhook handler with a recognized signature verifier', () => {
    expect(findingsForFile('app/api/webhooks/stripe/route.ts')).toHaveLength(0);
  });

  it('does NOT flag /billing when the page itself calls auth()', () => {
    expect(findingsForFile('app/billing/page.tsx')).toHaveLength(0);
  });

  it('does NOT flag /account/team when an ancestor layout calls auth()', () => {
    expect(findingsForFile('app/account/team/page.tsx')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('c05-middleware-coverage');
      expect(f.severity).toBe('high');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(3);
  });
});
