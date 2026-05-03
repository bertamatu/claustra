import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import a02 from '../../src/rules/a02-rsc-pattern-misuse.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/a02-misuse');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
  llm: { enabled: false, model: '' },
};

describe('a02 — RSC pattern misuse', () => {
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
      boundaryMap,
      nextVersion: findNextVersion(FIXTURE_ROOT),
      config: RESOLVED_CONFIG,
    };
    findings = await a02.run(ctx);
  });

  const findFor = (relPath: string): Finding[] => findings.filter((f) => f.file === relPath);

  // ───────────── Violations ─────────────

  it('flags useState imported in a server component', () => {
    const f = findFor('app/bad-server-hooks/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('useState');
  });

  it('flags every event handler on intrinsic elements in server components', () => {
    const f = findFor('app/bad-server-events/page.tsx');
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.message).join(' ')).toContain('onClick');
    expect(f.map((x) => x.message).join(' ')).toContain('onChange');
  });

  it('flags useRouter imported in a server component', () => {
    const f = findFor('app/bad-server-router/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('useRouter');
  });

  it('flags an async function returning JSX in a client file', () => {
    const f = findFor('components/bad-async-client.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('Async');
  });

  it('flags a client file importing next/headers', () => {
    const f = findFor('components/bad-client-headers.tsx');
    expect(f.some((x) => x.message.includes('next/headers'))).toBe(true);
  });

  it('flags a client file importing the server-only guard', () => {
    const f = findFor('components/bad-client-server-only.tsx');
    expect(f.some((x) => x.message.includes('server-only'))).toBe(true);
  });

  it('flags a misplaced "use client" directive (after an import)', () => {
    const f = findFor('components/bad-misplaced-directive.tsx');
    expect(f.some((x) => x.message.includes('Misplaced'))).toBe(true);
  });

  // ───────────── Non-violations ─────────────

  it('does NOT flag a correctly-placed "use client" file using React hooks', () => {
    expect(findFor('components/counter.tsx')).toHaveLength(0);
  });

  it('does NOT flag a server component using cookies() from next/headers', () => {
    expect(findFor('components/correct-server.tsx')).toHaveLength(0);
  });

  it('does NOT flag a pure utility file', () => {
    expect(findFor('components/util.ts')).toHaveLength(0);
  });

  it('does NOT flag the existing server page that uses no hooks', () => {
    expect(findFor('app/page.tsx')).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('emits at least 5 distinct violation findings across the fixture', () => {
    expect(findings.length).toBeGreaterThanOrEqual(5);
  });

  it('every finding has a non-empty message and a 1-based line number', () => {
    for (const f of findings) {
      expect(f.message.length).toBeGreaterThan(0);
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
      expect(f.ruleId).toBe('a02-rsc-pattern-misuse');
      expect(f.severity).toBe('high');
    }
  });
});
