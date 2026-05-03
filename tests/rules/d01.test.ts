import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import d01 from '../../src/rules/d01-hydration-risks.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/d01-hydration');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('d01 — hydration mismatch risks', () => {
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
    findings = await d01.run(ctx);
  });

  const findFor = (relPath: string): Finding[] => findings.filter((f) => f.file === relPath);

  // ───────────── Violations ─────────────

  it('flags Date.now() and `new Date()` in render scope', () => {
    const f = findFor('components/bad-date.tsx');
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.some((x) => x.message.includes('Date.now'))).toBe(true);
    expect(f.some((x) => x.message.includes('new Date'))).toBe(true);
  });

  it('flags Math.random() and crypto.randomUUID() in render scope', () => {
    const f = findFor('components/bad-random.tsx');
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.some((x) => x.message.includes('Math.random'))).toBe(true);
    expect(f.some((x) => x.message.includes('crypto'))).toBe(true);
  });

  it('flags reads of window/document/navigator in render scope', () => {
    const f = findFor('components/bad-browser-globals.tsx');
    expect(f.length).toBeGreaterThanOrEqual(3);
    const messages = f.map((x) => x.message).join(' ');
    expect(messages).toContain('window');
    expect(messages).toContain('document');
    expect(messages).toContain('navigator');
  });

  it('flags locale formatters without explicit locale + bare new Intl.DateTimeFormat()', () => {
    const f = findFor('components/bad-locale.tsx');
    expect(f.length).toBeGreaterThanOrEqual(3);
    expect(f.some((x) => x.message.includes('Locale-dependent'))).toBe(true);
    expect(f.some((x) => x.message.includes('Intl.DateTimeFormat'))).toBe(true);
  });

  it('flags performance.now() in render scope', () => {
    const f = findFor('components/bad-performance.tsx');
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0]?.message).toContain('performance.now');
  });

  // ───────────── Non-violations ─────────────

  it('does NOT flag triggers inside useEffect', () => {
    expect(findFor('components/correct-useeffect.tsx')).toHaveLength(0);
  });

  it('does NOT flag triggers inside JSX event handler props', () => {
    expect(findFor('components/correct-event-handler.tsx')).toHaveLength(0);
  });

  it('does NOT flag elements marked suppressHydrationWarning', () => {
    expect(findFor('components/correct-suppressed.tsx')).toHaveLength(0);
  });

  it('does NOT flag locale formatters with an explicit locale argument', () => {
    expect(findFor('components/correct-explicit-locale.tsx')).toHaveLength(0);
  });

  it('does NOT flag Next.js metadata files (sitemap.ts / robots.ts) — they run server-side and never hydrate', () => {
    expect(findFor('app/sitemap.ts')).toHaveLength(0);
    expect(findFor('app/robots.ts')).toHaveLength(0);
  });

  it('does NOT flag browser-global reads after a `typeof window === "undefined"` early-return guard', () => {
    const f = findFor('components/correct-typeof-guard.tsx');
    // Three guarded functions × multiple reads each must all be skipped.
    // Only the unguarded `noGuard` should fire.
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('document');
  });

  // ───────────── Cross-cutting ─────────────

  it('emits at least 5 distinct violation findings', () => {
    expect(findings.length).toBeGreaterThanOrEqual(5);
  });

  it('every finding has rule id, severity, and a real location', () => {
    for (const f of findings) {
      expect(f.ruleId).toBe('d01-hydration-risks');
      expect(f.severity).toBe('high');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });
});
