import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import c03 from '../../src/rules/c03-webhook-verify.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/c03-webhook-verify');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('c03 — webhook handler missing signature verification', () => {
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
    findings = await c03.run(ctx);
  });

  const findingsForRoute = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  // ───────────── Violations ─────────────

  it('flags a Stripe-importing route that never calls constructEvent', () => {
    const f = findingsForRoute('bad-stripe/route.ts');
    expect(f.length).toBe(2);
    expect(f.map((x) => x.severity)).toEqual(['critical', 'critical']);
    expect(f.some((x) => x.message.includes('request.json()'))).toBe(true);
    expect(f.some((x) => x.message.includes('database write'))).toBe(true);
  });

  it('flags a generic webhook route (path-based detection, no SDK import)', () => {
    const f = findingsForRoute('bad-generic/route.ts');
    expect(f.length).toBe(2);
    expect(f.some((x) => x.message.includes('request.text()'))).toBe(true);
    expect(f.some((x) => x.message.includes('database write'))).toBe(true);
  });

  it('flags only the production-branch sinks when dev bypass exists but prod has no verifier', () => {
    const f = findingsForRoute('bad-prod-no-verify/route.ts');
    expect(f.length).toBe(2);
    // None of the findings should land on the dev-branch lines (line 9-10
    // in the fixture); they should land on the post-if production code.
    for (const finding of f) {
      expect(finding.line).toBeGreaterThan(11);
    }
  });

  // ───────────── Non-violations ─────────────

  it('does NOT flag canonical Stripe constructEvent pattern', () => {
    expect(findingsForRoute('correct-stripe/route.ts')).toHaveLength(0);
  });

  it('does NOT flag svix Webhook.verify pattern', () => {
    expect(findingsForRoute('correct-svix/route.ts')).toHaveLength(0);
  });

  it('does NOT flag custom verifier matching the verify*Signature naming', () => {
    expect(findingsForRoute('correct-custom/route.ts')).toHaveLength(0);
  });

  it('does NOT flag a handler whose dev branch skips and prod branch verifies', () => {
    expect(findingsForRoute('correct-dev-bypass/route.ts')).toHaveLength(0);
  });

  it('does NOT analyze a non-webhook route (no "webhook" in path, no webhook SDK import)', () => {
    expect(findingsForRoute('non-webhook/route.ts')).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('every finding has the correct rule id, critical severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('c03-webhook-verify');
      expect(f.severity).toBe('critical');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    // 2 + 2 + 2 = 6
    expect(findings).toHaveLength(6);
  });
});
