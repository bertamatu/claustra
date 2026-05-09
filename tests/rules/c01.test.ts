import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import c01 from '../../src/rules/c01-unvalidated-server-actions.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/c01-no-validation');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('c01 - server actions without input validation', () => {
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
    findings = await c01.run(ctx);
  });

  const findingsFor = (action: string): Finding[] =>
    findings.filter((f) => f.message.includes(`"${action}"`));

  // ───────────── Direct sinks ─────────────

  it('flags an unvalidated FormData parameter flowing into db.create', () => {
    const f = findingsFor('createPostUnsafe');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('database write');
    expect(f[0]?.severity).toBe('critical');
  });

  it('flags an unvalidated parameter passed as fetch URL', () => {
    const f = findingsFor('pingUnsafe');
    expect(f.some((x) => x.message.includes('fetch()'))).toBe(true);
  });

  it('flags an unvalidated parameter passed as fetch body', () => {
    const f = findingsFor('postUnsafe');
    expect(f.some((x) => x.message.includes('fetch()'))).toBe(true);
  });

  it('flags an unvalidated parameter passed to revalidatePath', () => {
    const f = findingsFor('revalidateUnsafe');
    expect(f.some((x) => x.message.includes('revalidatePath()'))).toBe(true);
  });

  it('flags an unvalidated parameter passed to revalidateTag', () => {
    const f = findingsFor('revalidateTagUnsafe');
    expect(f.some((x) => x.message.includes('revalidatePath()/revalidateTag()'))).toBe(true);
  });

  // ───────────── Validators clear taint ─────────────

  it('does NOT flag when input flows through Schema.parse() (Zod)', () => {
    expect(findingsFor('createPost')).toHaveLength(0);
  });

  it('does NOT flag when input flows through Schema.safeParse() and result.data is used', () => {
    expect(findingsFor('updatePost')).toHaveLength(0);
  });

  it('does NOT flag when input flows through valibot parse(Schema, input)', () => {
    expect(findingsFor('valibotPost')).toHaveLength(0);
  });

  it('does NOT flag when input flows through Yup .validateSync()', () => {
    expect(findingsFor('yupPost')).toHaveLength(0);
  });

  it('does NOT flag when input flows through awaited Yup .validate()', () => {
    expect(findingsFor('yupAsyncPost')).toHaveLength(0);
  });

  it('does NOT flag when input flows through ArkType .assert()', () => {
    expect(findingsFor('arkPost')).toHaveLength(0);
  });

  // ───────────── Not-a-validator ─────────────

  it('treats JSON.parse as NOT a validator - input remains tainted', () => {
    const f = findingsFor('jsonParseIsNotValidation');
    expect(f).toHaveLength(1);
  });

  // ───────────── Propagation ─────────────

  it('propagates taint through chained variable assignments', () => {
    expect(findingsFor('chainedPropagation')).toHaveLength(1);
  });

  it('propagates taint through for-of bindings (tainted iterable)', () => {
    expect(findingsFor('bulkCreate')).toHaveLength(1);
  });

  // ───────────── Inline 'use server' ─────────────

  it('flags inline server actions just like file-level ones', () => {
    expect(findingsFor('inlineBad')).toHaveLength(1);
  });

  it('does NOT flag a validated inline server action', () => {
    expect(findingsFor('inlineGood')).toHaveLength(0);
  });

  it('does NOT flag a regular function (no "use server")', () => {
    expect(findingsFor('notAnAction')).toHaveLength(0);
  });

  // ───────────── Skipped cases ─────────────

  it('does NOT flag a server action with no parameters', () => {
    expect(findingsFor('noParams')).toHaveLength(0);
  });

  it('does NOT flag a read-only server action', () => {
    expect(findingsFor('getPost')).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('every finding has the correct rule id and critical severity', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('c01-unvalidated-server-actions');
      expect(f.severity).toBe('critical');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });
});
