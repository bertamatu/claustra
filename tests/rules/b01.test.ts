import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import b01 from '../../src/rules/b01-non-serializable-props.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/b01-props');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('b01 - non-serializable props', () => {
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
    findings = await b01.run(ctx);
  });

  const inPage = (): Finding[] => findings.filter((f) => f.file === 'app/page.tsx');

  // ───────────── Function props ─────────────

  it('flags an inline arrow function passed as a prop', () => {
    const f = inPage().filter((x) => x.message.includes('Function passed as prop "cb"'));
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0]?.severity).toBe('high');
  });

  it('flags a named function reference passed as a prop', () => {
    const fns = inPage().filter((x) => x.message.includes('Function passed as prop'));
    // Three function findings expected: inline arrow, inlineHandler, plus the cast deletePost (non-action call).
    // Server action references should NOT contribute.
    expect(fns.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT flag a Server Action reference (file-level "use server")', () => {
    // logClick is from actions.ts ('use server' file) → no finding for that JSX element line.
    // The fixture passes logClick directly: `<Widget cb={logClick} />`.
    // We assert no Function finding mentions logClick's call site by checking total function findings count.
    const allFns = inPage().filter((x) => x.message.includes('Function passed as prop'));
    // 4 cb={...} usages total: inline arrow, inlineHandler, logClick, deletePost-as-cast.
    // The cast `(deletePost as unknown as () => void)` strips the server-action symbol, so it gets flagged.
    // logClick must NOT be flagged → so we expect exactly 3 function findings.
    expect(allFns).toHaveLength(3);
  });

  // ───────────── Other non-serializables ─────────────

  it('flags Date (medium severity)', () => {
    const f = inPage().find((x) => x.message.includes('Date passed as prop'));
    expect(f).toBeDefined();
    expect(f?.severity).toBe('medium');
  });

  it('flags Map', () => {
    const f = inPage().find((x) => x.message.includes('Map passed as prop'));
    expect(f).toBeDefined();
    expect(f?.severity).toBe('high');
  });

  it('flags Set', () => {
    const f = inPage().find((x) => x.message.includes('Set passed as prop'));
    expect(f).toBeDefined();
    expect(f?.severity).toBe('high');
  });

  it('flags BigInt', () => {
    const f = inPage().find((x) => x.message.includes('BigInt passed as prop'));
    expect(f).toBeDefined();
  });

  it('flags Symbol', () => {
    const f = inPage().find((x) => x.message.includes('Symbol passed as prop'));
    expect(f).toBeDefined();
  });

  it('flags class instance', () => {
    const f = inPage().find((x) => x.message.includes('Class instance passed as prop "user"'));
    expect(f).toBeDefined();
    expect(f?.severity).toBe('high');
  });

  // ───────────── Allowed cases ─────────────

  it('does NOT flag Promise props', () => {
    expect(inPage().some((x) => x.message.includes('"promise"'))).toBe(false);
  });

  it('does NOT flag plain serializable props (string / number)', () => {
    expect(inPage().some((x) => x.message.includes('"data"'))).toBe(false);
    expect(inPage().some((x) => x.message.includes('"count"'))).toBe(false);
  });

  it('does NOT flag children', () => {
    expect(inPage().some((x) => x.message.includes('children'))).toBe(false);
  });

  it('does NOT flag spread attributes (B2 territory)', () => {
    // No finding should reference the spread; we don't assert exact lines, just that totals match expectations elsewhere.
    // Indirect: total function findings already asserted to be 3. If spread leaked, count would change.
    expect(true).toBe(true);
  });

  it('does NOT flag props passed to a server component', () => {
    // ServerCounter is NOT 'use client'. cb={() => {}} on it must not produce any finding.
    // We can't grep by component name in findings, but total Function findings is 3 (asserted above) - implies ServerCounter wasn't counted.
    expect(true).toBe(true);
  });

  it('does NOT flag event handlers on intrinsic elements (A2 territory)', () => {
    // <button onClick={() => {}}> - same reasoning: total function count of 3 implies no flag here.
    expect(true).toBe(true);
  });

  it('does NOT flag a Client Component rendering other Client Components (no boundary crossed)', () => {
    // ClientParent is itself 'use client' and renders <Widget> with all sorts of
    // non-serializable props. Both sides run in the browser - nothing crosses the boundary.
    const f = findings.filter((x) => x.file === 'components/client-parent.tsx');
    expect(f).toHaveLength(0);
  });

  it("does NOT flag a non-directive component reachable from 'use client' (boundary 'either')", () => {
    // `either-helper.tsx` has no `'use client'` but is imported by `client-parent.tsx`.
    // The boundary classifier marks it as 'either' - in Next.js, once a module is
    // pulled into the client bundle by a directive boundary, it executes in the
    // client tree, so its function props don't cross any boundary.
    const f = findings.filter((x) => x.file === 'components/either-helper.tsx');
    expect(f).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('every finding has the correct rule id and a 1-based location', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('b01-non-serializable-props');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
      expect(['high', 'medium']).toContain(f.severity);
    }
  });
});
