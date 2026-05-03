import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import b02 from '../../src/rules/b02-server-data-leakage.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/b02-leakage');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('b02 — server data leakage to client', () => {
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
    findings = await b02.run(ctx);
  });

  const inPage = (): Finding[] => findings.filter((f) => f.file === 'app/page.tsx');

  // ───────────── Sensitive prop names ─────────────

  it.each([
    'secret',
    'token',
    'password',
    'apiKey',
    'privateKey',
    'hash',
    'salt',
    'sessionId',
    'stripeSecret',
    'jwt',
  ])('flags sensitive prop name "%s"', (name) => {
    const f = inPage().find((x) => x.message.includes(`"${name}"`));
    expect(f).toBeDefined();
    expect(f?.severity).toBe('critical');
  });

  // ───────────── Whole-record queries ─────────────

  it('flags a Prisma findUnique result without select/omit (passed as `user`)', () => {
    const f = inPage().filter((x) => x.message.includes('Whole DB record') && x.message.includes('"user"'));
    // Three usages: fullUser, fullPost, mongoUser — all bound to the `user` prop.
    expect(f).toHaveLength(3);
  });

  it('does NOT flag a Prisma query that uses `select`', () => {
    const text = inPage().map((x) => x.message).join('\n');
    expect(text).not.toContain('safeUser');
    // No "Whole DB record" finding should reference the `name` prop.
  });

  // ───────────── Spread props ─────────────

  it('flags a spread attribute on a Client Component', () => {
    const f = inPage().filter((x) => x.message.includes('Spread props'));
    // One spread on Card, one on ServerCard. Only the Client one is flagged.
    expect(f).toHaveLength(1);
  });

  // ───────────── Server-target component ─────────────

  it('does NOT flag sensitive props on a server component target', () => {
    // ServerCard's secret={...} should not be flagged.
    // Since both Card and ServerCard receive `secret`, we check that exactly one
    // sensitive `"secret"` finding exists (the Card one, not ServerCard).
    const sensitiveSecret = findings.filter((f) =>
      f.message.includes('Sensitive prop name "secret"'),
    );
    expect(sensitiveSecret).toHaveLength(1);
  });

  // ───────────── Allowed cases ─────────────

  it('does NOT flag plain serializable string props', () => {
    const text = inPage().map((x) => x.message).join('\n');
    expect(text).not.toContain('"name"');
    expect(text).not.toContain('"email"');
  });

  it('does NOT flag a Client Component rendering other Client Components (no boundary crossed)', () => {
    // ClientParent is itself 'use client' and renders <Card secret={...} {...obj} />.
    // Both sides run in the browser — nothing crosses the boundary.
    const f = findings.filter((x) => x.file === 'components/client-parent.tsx');
    expect(f).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('every finding has the correct rule id and critical severity', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('b02-server-data-leakage');
      expect(f.severity).toBe('critical');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });
});
