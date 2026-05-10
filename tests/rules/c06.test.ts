import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import c06 from '../../src/rules/c06-useactionstate-dispatch.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/c06-useactionstate-dispatch');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('c06 - useActionState dispatcher outside startTransition', () => {
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
    findings = await c06.run(ctx);
  });

  const findingsForFile = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  // ─── violations ───

  it('flags dispatcher called from onClick without startTransition', () => {
    const f = findingsForFile('components/bad-onclick.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('medium');
    expect(f[0]?.message).toContain('useActionState');
  });

  it('flags dispatcher called from useEffect without startTransition', () => {
    const f = findingsForFile('components/bad-useeffect.tsx');
    expect(f).toHaveLength(1);
  });

  it('flags an awaited dispatcher inside an async event handler', () => {
    const f = findingsForFile('components/bad-async-handler.tsx');
    expect(f).toHaveLength(1);
  });

  // ─── non-violations ───

  it('does NOT flag dispatcher passed as `<form action={dispatch}>`', () => {
    expect(findingsForFile('components/correct-form-action.tsx')).toHaveLength(0);
  });

  it('does NOT flag dispatcher passed as `<button formAction={dispatch}>`', () => {
    expect(findingsForFile('components/correct-formaction-button.tsx')).toHaveLength(0);
  });

  it('does NOT flag dispatcher wrapped in `startTransition()` from `react`', () => {
    expect(findingsForFile('components/correct-start-transition.tsx')).toHaveLength(0);
  });

  it('does NOT flag dispatcher wrapped in startTransition from useTransition()', () => {
    expect(findingsForFile('components/correct-use-transition.tsx')).toHaveLength(0);
  });

  it('does NOT flag a same-named user helper imported from a non-react module', () => {
    expect(findingsForFile('components/correct-not-react.tsx')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('c06-useactionstate-dispatch');
      expect(f.severity).toBe('medium');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(3);
  });
});
