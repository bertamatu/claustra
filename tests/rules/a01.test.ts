import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import a01 from '../../src/rules/a01-server-only-in-client.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/a01-server-only-leak');

const buildContext = (extraServerOnlyModules: string[]): ProjectContext => {
  const tsConfigPath = findTsConfig(FIXTURE_ROOT);
  const { program, checker } = buildProgram(tsConfigPath);
  const graph = buildModuleGraph(program);
  const boundaryMap = classifyBoundaries(program, graph);
  const config: ResolvedConfig = {
    rules: {},
    extraServerOnlyModules,
    ignore: [],
    llm: { enabled: false, model: '' },
  };
  return {
    rootDir: FIXTURE_ROOT,
    tsConfigPath,
    program,
    checker,
    moduleGraph: graph,
    boundaryMap,
    nextVersion: findNextVersion(FIXTURE_ROOT),
    config,
  };
};

describe('a01 — server-only code reachable from client tree', () => {
  let findings: Finding[];

  beforeAll(async () => {
    findings = await a01.run(buildContext(['my-internal-secrets']));
  });

  const findFor = (relPath: string): Finding[] =>
    findings.filter((f) => f.file === relPath);

  // ───────────── Direct violations (client file imports server-only directly) ─────────────

  it('flags a client component importing node:fs', () => {
    const f = findFor('components/bad-direct-fs.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('node:fs');
    expect(f[0]?.severity).toBe('critical');
  });

  it('flags a client component importing @prisma/client directly', () => {
    const f = findFor('components/bad-direct-prisma.tsx');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('@prisma/client');
  });

  it('flags a client component importing the server-only guard', () => {
    const f = findFor('components/bad-server-only.tsx');
    expect(f.some((x) => x.message.includes('server-only'))).toBe(true);
  });

  // ───────────── Transitive chain ─────────────

  it('flags a server-only package reached through a multi-hop chain', () => {
    const f = findFor('lib/db.ts');
    expect(f.some((x) => x.message.includes('@prisma/client'))).toBe(true);
    const finding = f.find((x) => x.message.includes('@prisma/client'));
    expect(finding?.importChain).toBeDefined();
    const chain = finding?.importChain ?? [];
    expect(chain[0]).toMatch(/bad-deep-chain\.tsx$/);
    expect(chain[chain.length - 1]).toBe('@prisma/client');
    expect(chain).toContain('lib/user-service.ts');
    expect(chain).toContain('lib/db.ts');
  });

  // ───────────── Barrel re-exports ─────────────

  it('flags a server-only package reached through a barrel re-export', () => {
    const f = findFor('lib/barrel-leaf.ts');
    expect(f.some((x) => x.message.includes('mongoose'))).toBe(true);
    const finding = f.find((x) => x.message.includes('mongoose'));
    const chain = finding?.importChain ?? [];
    expect(chain[0]).toMatch(/bad-via-barrel\.tsx$/);
    expect(chain).toContain('lib/barrel.ts');
    expect(chain).toContain('lib/barrel-leaf.ts');
    expect(chain[chain.length - 1]).toBe('mongoose');
  });

  // ───────────── process.env ─────────────

  it('flags non-NEXT_PUBLIC_ process.env reads in client-reachable code', () => {
    const f = findFor('components/bad-process-env.tsx');
    const messages = f.map((x) => x.message);
    expect(messages).toContain('process.env.SECRET_KEY read in client-reachable code');
    expect(messages).toContain('process.env.DATABASE_URL read in client-reachable code');
  });

  it('does NOT flag process.env reads of NEXT_PUBLIC_ vars', () => {
    expect(findFor('components/correct-public-env.tsx')).toHaveLength(0);
  });

  // ───────────── Config: extraServerOnlyModules ─────────────

  it('flags imports of extraServerOnlyModules entries', () => {
    const f = findFor('components/bad-extra-pkg.tsx');
    expect(f.some((x) => x.message.includes('my-internal-secrets'))).toBe(true);
  });

  it('does NOT flag the extra package when it is not configured', async () => {
    const out = await a01.run(buildContext([]));
    const f = out.filter((x) => x.file === 'components/bad-extra-pkg.tsx');
    expect(f).toHaveLength(0);
  });

  // ───────────── Non-violations ─────────────

  it('does NOT flag a pure server file that imports @prisma/client and node:fs', () => {
    expect(findFor('app/server/page.tsx')).toHaveLength(0);
  });

  it('does NOT flag an orphan server-only file that no client tree reaches', () => {
    expect(findFor('lib/server-only-untouched.ts')).toHaveLength(0);
  });

  it('does NOT flag a clean client component', () => {
    expect(findFor('components/correct-client.tsx')).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('every finding carries an importChain rooted at a client file', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('a01-server-only-in-client');
      expect(f.severity).toBe('critical');
      expect(f.importChain).toBeDefined();
      expect((f.importChain ?? []).length).toBeGreaterThanOrEqual(1);
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });
});
