import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import d02 from '../../src/rules/d02-caching-dynamic.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/d02-cache-mismatch');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('d02 - caching and dynamic surprises', () => {
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
    findings = await d02.run(ctx);
  });

  const findFor = (relPath: string): Finding[] => findings.filter((f) => f.file === relPath);

  it('reads Next.js version 15 from the fixture node_modules', () => {
    expect(findNextVersion(FIXTURE_ROOT)).toBe('15.0.0');
  });

  // ───────────── Violations ─────────────

  it('flags force-static + cookies() as a hard error', () => {
    const f = findFor('app/static-route/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.message).toContain('force-static');
  });

  it('flags ISR + headers() as a medium warning', () => {
    const f = findFor('app/isr-route/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('medium');
    expect(f[0]?.message).toContain('headers');
  });

  it('flags fetch revalidate mismatch with route revalidate', () => {
    const f = findFor('app/isr-mismatch/page.tsx');
    expect(f.some((x) => x.message.includes('revalidate=60') && x.message.includes('revalidate=3600'))).toBe(true);
  });

  it('flags fetch with cache: no-store inside an ISR-declared route', () => {
    const f = findFor('app/isr-no-store/page.tsx');
    expect(f.some((x) => x.message.includes("'no-store'"))).toBe(true);
  });

  it('flags fetch to localhost / 127.0.0.1', () => {
    const f = findFor('app/localhost-fetch/page.tsx');
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.message.includes('localhost'))).toBe(true);
  });

  it('flags bare fetch in ISR routes on Next 15+ (no-store default)', () => {
    const f = findFor('app/isr-bare-fetch/page.tsx');
    expect(f.some((x) => x.message.includes('no cache directive'))).toBe(true);
  });

  // ───────────── Non-violations ─────────────

  it('does NOT flag intentional dynamic routes (no static/ISR declaration)', () => {
    expect(findFor('app/correct-dynamic/page.tsx')).toHaveLength(0);
  });

  it('does NOT flag ISR routes with matching, explicit fetch options', () => {
    expect(findFor('app/correct-isr/page.tsx')).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('emits at least 5 distinct violation findings', () => {
    expect(findings.length).toBeGreaterThanOrEqual(5);
  });

  it('every finding has rule id and a real location', () => {
    for (const f of findings) {
      expect(f.ruleId).toBe('d02-caching-dynamic');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });
});
