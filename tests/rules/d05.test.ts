import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import d05 from '../../src/rules/d05-revalidate-outside-mutation.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/d05-revalidate-outside-mutation');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('d05 - revalidateTag/revalidatePath outside a mutation context', () => {
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
    findings = await d05.run(ctx);
  });

  const findingsForFile = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  // ─── violations ───

  it('flags revalidatePath called during a Server Component render', () => {
    const f = findingsForFile('app/admin/page.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.message).toContain('revalidatePath');
    expect(f[0]?.message).toContain('Server Component render');
  });

  it('flags revalidateTag in a `use client` Client Component', () => {
    const f = findingsForFile('app/components/RefreshButton.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('revalidateTag');
    expect(f[0]?.message).toContain('Client Component');
  });

  it('flags revalidateTag inside a `use cache` function as contradictory', () => {
    const f = findingsForFile('app/lib/cached-with-revalidate.ts');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('revalidateTag');
    expect(f[0]?.message).toContain("'use cache'");
  });

  // ─── non-violations ───

  it('does NOT flag a file-level `use server` Server Action', () => {
    expect(findingsForFile('app/lib/actions.ts')).toHaveLength(0);
  });

  it('does NOT flag a route handler `POST` export', () => {
    expect(findingsForFile('app/api/posts/route.ts')).toHaveLength(0);
  });

  it('does NOT flag an inline `use server` action defined inside a Server Component', () => {
    expect(findingsForFile('app/profile/page.tsx')).toHaveLength(0);
  });

  it('does NOT flag a directive-less helper module (conservative skip)', () => {
    expect(findingsForFile('app/lib/helper.ts')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('d05-revalidate-outside-mutation');
      expect(f.severity).toBe('high');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(3);
  });
});
