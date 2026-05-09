import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import b03 from '../../src/rules/b03-browser-storage.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/b03-browser-storage');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('b03 — sensitive value written to browser storage', () => {
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
    findings = await b03.run(ctx);
  });

  const findingsForFile = (basename: string): Finding[] =>
    findings.filter((f) => f.file.endsWith(basename));

  // ───────────── High-severity violations ─────────────

  it('flags localStorage.setItem with a token-named key', () => {
    const f = findingsForFile('bad-token-key.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.message).toContain('localStorage');
    expect(f[0]?.message).toContain('auth_token');
  });

  it('flags sessionStorage.setItem with a jwt-named key', () => {
    const f = findingsForFile('bad-jwt.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.message).toContain('sessionStorage');
  });

  it('flags JSON.stringify of a likely-PII identifier', () => {
    const f = findingsForFile('bad-pii-stringify.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.message).toContain('JSON.stringify');
  });

  it('flags window.localStorage.setItem with a jwt-named key', () => {
    const f = findingsForFile('bad-window-jwt.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.message).toContain('localStorage');
  });

  // ───────────── Medium-severity (heuristic encryption wrapper) ─────────────

  it('downgrades to medium when value is wrapped in a `secure*`-named function not in the recognized list', () => {
    const f = findingsForFile('medium-secure-wrapper.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('medium');
    expect(f[0]?.message).toContain('secureEncode');
    expect(f[0]?.message).toContain('cannot be verified');
  });

  // ───────────── Non-violations ─────────────

  it('does NOT flag setItem with a benign theme/locale/ui-state key', () => {
    expect(findingsForFile('correct-theme.tsx')).toHaveLength(0);
  });

  it('does NOT flag getItem reads even when the key is suspect', () => {
    expect(findingsForFile('correct-get-item.tsx')).toHaveLength(0);
  });

  it('does NOT flag a value wrapped in a recognized encryption helper (`encrypt`)', () => {
    expect(findingsForFile('correct-encrypt.tsx')).toHaveLength(0);
  });

  it('does NOT flag window.<storage>.setItem with a benign key', () => {
    expect(findingsForFile('correct-window-safe.tsx')).toHaveLength(0);
  });

  it('does NOT flag a setItem call in a server-only file (page.tsx)', () => {
    // page.tsx contains a setItem('jwt', 'x') guarded by typeof, but the
    // file has no 'use client' and is not reachable from one — out of scope.
    expect(findingsForFile('app/page.tsx')).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('every finding has the correct rule id and a valid location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('b03-browser-storage');
      expect(['high', 'medium']).toContain(f.severity);
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly the expected number of findings', () => {
    // 4 high + 1 medium = 5 total
    expect(findings).toHaveLength(5);
    expect(findings.filter((f) => f.severity === 'high')).toHaveLength(4);
    expect(findings.filter((f) => f.severity === 'medium')).toHaveLength(1);
  });
});
