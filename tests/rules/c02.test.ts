import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import c02 from '../../src/rules/c02-unauthorized-server-actions.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/c02-no-auth');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('c02 - server actions without authorization', () => {
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
    findings = await c02.run(ctx);
  });

  const messageFor = (action: string): Finding | undefined =>
    findings.find((f) => f.message.includes(`"${action}"`));

  // ───────────── File-level 'use server' ─────────────

  it('flags an exported server action that mutates without any auth', () => {
    const f = messageFor('deletePostUnsafe');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('high');
    expect(f?.file).toBe('app/actions/file-level.ts');
  });

  it('flags an action where auth() is called AFTER the mutation', () => {
    expect(messageFor('badOrdering')).toBeDefined();
  });

  it('flags an action with multiple unguarded writes (loop)', () => {
    expect(messageFor('bulkUpdate')).toBeDefined();
  });

  it('does NOT flag an action with auth() before mutation', () => {
    expect(messageFor('deletePost')).toBeUndefined();
  });

  it('does NOT flag an action using Clerk currentUser() before mutation', () => {
    expect(messageFor('updatePost')).toBeUndefined();
  });

  it('does NOT flag an action using a custom requireUserSession() helper', () => {
    expect(messageFor('deletePostWithCustomAuth')).toBeUndefined();
  });

  it('does NOT flag an action using a custom verifyAdminAccess() helper', () => {
    expect(messageFor('deleteAsAdmin')).toBeUndefined();
  });

  it('does NOT flag a read-only action', () => {
    expect(messageFor('readPost')).toBeUndefined();
  });

  // ───────────── Inline 'use server' ─────────────

  it('flags an inline-server-action that mutates without auth', () => {
    expect(messageFor('inlineBad')).toBeDefined();
  });

  it('does NOT flag an inline-server-action with auth before mutation', () => {
    expect(messageFor('inlineGood')).toBeUndefined();
  });

  it('does NOT flag a regular function that mutates but is not a server action', () => {
    expect(messageFor('notAnAction')).toBeUndefined();
  });

  // ───────────── Safe receivers ─────────────

  it('does NOT flag actions that call write-named methods on safe receivers (Object.create, Array.push, JSON.stringify)', () => {
    expect(messageFor('noopAction')).toBeUndefined();
  });

  // ───────────── Cross-cutting ─────────────

  it('all flagged actions report at the function name with high severity', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('c02-unauthorized-server-actions');
      expect(f.severity).toBe('high');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('emits exactly four findings against the fixture (deletePostUnsafe, badOrdering, bulkUpdate, inlineBad)', () => {
    expect(findings).toHaveLength(4);
  });
});
