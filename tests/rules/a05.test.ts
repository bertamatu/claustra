import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import a05 from '../../src/rules/a05-useformstatus-colocation.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/a05-useformstatus-colocation');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('a05 - useFormStatus colocated with <form>', () => {
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
    findings = await a05.run(ctx);
  });

  const findingsForFile = (segment: string): Finding[] =>
    findings.filter((f) => f.file.includes(segment));

  // ─── violations ───

  it('flags useFormStatus and <form> in the same component', () => {
    const f = findingsForFile('components/bad-inline-button.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('medium');
    expect(f[0]?.message).toContain('useFormStatus');
    expect(f[0]?.detail).toMatch(/parent/i);
  });

  it('flags an arrow component with the same shape', () => {
    const f = findingsForFile('components/bad-arrow-component.tsx');
    expect(f).toHaveLength(1);
  });

  it('follows aliased imports (`useFormStatus as useStatus`)', () => {
    const f = findingsForFile('components/bad-aliased-import.tsx');
    expect(f).toHaveLength(1);
  });

  // ─── non-violations ───

  it('does NOT flag an extracted SubmitButton child of a form', () => {
    expect(findingsForFile('components/correct-extracted-button.tsx')).toHaveLength(0);
  });

  it('does NOT flag a component using useFormStatus with no <form> in scope', () => {
    expect(findingsForFile('components/correct-no-form.tsx')).toHaveLength(0);
  });

  it('does NOT flag a plain form with no useFormStatus call', () => {
    expect(findingsForFile('components/correct-no-hook.tsx')).toHaveLength(0);
  });

  it('does NOT flag a same-named helper imported from a non-react-dom module', () => {
    expect(findingsForFile('components/correct-not-react-dom.tsx')).toHaveLength(0);
  });

  // ─── cross-cutting ───

  it('every finding has the correct rule id, severity, and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('a05-useformstatus-colocation');
      expect(f.severity).toBe('medium');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings overall', () => {
    expect(findings).toHaveLength(3);
  });
});
