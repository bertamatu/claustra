import path from 'node:path';
import ts from 'typescript';
import { collectModuleSpecRefs, hasDirective } from '../utils/ast.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'a01-server-only-in-client';
const SEVERITY: Severity = 'critical';

const NODE_BUILTINS = new Set([
  'fs',
  'fs/promises',
  'path',
  'crypto',
  'child_process',
  'net',
  'dns',
  'node:fs',
  'node:fs/promises',
  'node:path',
  'node:crypto',
  'node:child_process',
  'node:net',
  'node:dns',
]);

const SERVER_ONLY_PACKAGES = [
  'pg',
  'mysql2',
  'mongodb',
  'mongoose',
  '@prisma/client',
  'redis',
  'ioredis',
  'bcrypt',
  'bcryptjs',
  'jsonwebtoken',
  'nodemailer',
  'server-only',
];

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const matchServerOnlyModule = (
  spec: string,
  extras: string[],
): { kind: 'node-builtin' | 'package'; matched: string } | null => {
  if (NODE_BUILTINS.has(spec)) return { kind: 'node-builtin', matched: spec };
  if (spec.startsWith('node:')) return { kind: 'node-builtin', matched: spec };
  for (const pkg of SERVER_ONLY_PACKAGES) {
    if (spec === pkg || spec.startsWith(`${pkg}/`)) return { kind: 'package', matched: pkg };
  }
  for (const pat of extras) {
    if (spec === pat || spec.startsWith(`${pat}/`)) return { kind: 'package', matched: pat };
  }
  return null;
};

const collectClientReachableParents = (
  ctx: ProjectContext,
): Map<string, string | null> => {
  const parents = new Map<string, string | null>();
  const queue: string[] = [];

  for (const sf of ctx.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes('node_modules')) continue;
    if (hasDirective(sf, 'use client')) {
      parents.set(sf.fileName, null);
      queue.push(sf.fileName);
    }
  }

  while (queue.length > 0) {
    const file = queue.shift()!;
    const deps = ctx.moduleGraph.get(file);
    if (!deps) continue;
    for (const dep of deps) {
      if (parents.has(dep)) continue;
      parents.set(dep, file);
      queue.push(dep);
    }
  }

  return parents;
};

const buildChain = (
  file: string,
  parents: Map<string, string | null>,
  rel: (f: string) => string,
): string[] => {
  const chain: string[] = [];
  let cur: string | null | undefined = file;
  while (cur != null) {
    chain.unshift(rel(cur));
    const next = parents.get(cur);
    cur = next ?? null;
  }
  return chain;
};

const collectProcessEnvReads = (
  sourceFile: ts.SourceFile,
): Array<{ key: string; node: ts.Node }> => {
  const out: Array<{ key: string; node: ts.Node }> = [];
  const visit = (node: ts.Node): void => {
    // process.env.X
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'process' &&
      node.expression.name.text === 'env' &&
      ts.isIdentifier(node.name)
    ) {
      out.push({ key: node.name.text, node });
    }
    // process.env['X'] or process.env["X"]
    else if (
      ts.isElementAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'process' &&
      node.expression.name.text === 'env' &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      out.push({ key: node.argumentExpression.text, node });
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return out;
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);
  const parents = collectClientReachableParents(ctx);
  const extras = ctx.config.extraServerOnlyModules;

  for (const file of parents.keys()) {
    const sf = ctx.program.getSourceFile(file);
    if (!sf) continue;

    const chainTo = buildChain(file, parents, rel);

    // Imports + re-exports
    for (const { spec, stmt } of collectModuleSpecRefs(sf)) {
      const match = matchServerOnlyModule(spec, extras);
      if (!match) continue;

      const { line, column } = lineCol(sf, stmt);
      const message =
        match.kind === 'node-builtin'
          ? `Node builtin "${spec}" reachable from a Client Component`
          : `Server-only module "${spec}" reachable from a Client Component`;
      const detail =
        match.kind === 'node-builtin'
          ? `Node builtins do not exist in the browser. Bundling this into a client tree breaks at build time or in the browser.`
          : `${match.matched} is a server-only dependency (DB driver, secret tooling, or "server-only" guard). Importing it from a client-reachable file leaks server code or secrets to the bundle.`;
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file: rel(file),
        line,
        column,
        message,
        detail,
        suggestion:
          'Move this code behind a Server Component or Server Action, then pass only the serializable result down. If a thin abstraction must straddle the boundary, split server and client entrypoints.',
        importChain: [...chainTo, spec],
      });
    }

    // process.env reads
    for (const { key, node } of collectProcessEnvReads(sf)) {
      // NEXT_PUBLIC_* and NODE_ENV are inlined for the client by Next.js — safe to read anywhere.
      if (key.startsWith('NEXT_PUBLIC_')) continue;
      if (key === 'NODE_ENV') continue;
      const { line, column } = lineCol(sf, node);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file: rel(file),
        line,
        column,
        message: `process.env.${key} read in client-reachable code`,
        detail:
          'Only NEXT_PUBLIC_-prefixed env vars and NODE_ENV are inlined for the browser. Other reads are undefined client-side or, worse, leak server secrets if the bundler picks them up.',
        suggestion: `Rename to NEXT_PUBLIC_${key} if the value is safe to expose, or move the read to a Server Component / Server Action and pass the result down.`,
        importChain: chainTo,
      });
    }
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects server-only modules and non-public env reads reachable from a "use client" tree via transitive imports.',
  severity: SEVERITY,
  run,
};

export default rule;
