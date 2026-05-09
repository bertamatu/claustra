import path from 'node:path';
import ts from 'typescript';
import { hasDirective } from '../utils/ast.js';
import {
  KNOWN_ENCRYPTION_HELPERS,
  HEURISTIC_ENCRYPTION_NAME_RE,
} from '../utils/known-helpers.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'b03-browser-storage';
const SEVERITY: Severity = 'high';

// Keys whose name suggests an auth/credential/session secret.
const SUSPECT_KEY_RE = /token|jwt|auth|session|credential|secret|password|apikey|api[_-]?key/i;

// Identifier names that, when JSON.stringify-ed into a storage value,
// likely carry PII. Substring match (covers `currentUser`, `userProfile`,
// `accountData`, `sessionInfo`, etc.).
const SUSPECT_PII_NAME_RE = /(user|profile|account|session)/i;

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

// Replicates the BFS used by a01 to enumerate every file reachable
// from a `'use client'` entry point through the module graph. Kept
// inline (rather than imported from a01) per SCALE_PLAN's "do not
// modify existing rules" constraint.
const collectClientReachableFiles = (ctx: ProjectContext): Set<string> => {
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const sf of ctx.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes('node_modules')) continue;
    if (hasDirective(sf, 'use client')) {
      reachable.add(sf.fileName);
      queue.push(sf.fileName);
    }
  }

  while (queue.length > 0) {
    const file = queue.shift()!;
    const deps = ctx.moduleGraph.get(file);
    if (!deps) continue;
    for (const dep of deps) {
      if (reachable.has(dep)) continue;
      reachable.add(dep);
      queue.push(dep);
    }
  }

  return reachable;
};

type StorageKind = 'localStorage' | 'sessionStorage';

type StorageWriteCall = {
  call: ts.CallExpression;
  storage: StorageKind;
};

const matchStorageSetItem = (node: ts.Node): StorageWriteCall | null => {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (callee.name.text !== 'setItem') return null;

  const obj = callee.expression;

  // localStorage.setItem(...) / sessionStorage.setItem(...)
  if (ts.isIdentifier(obj)) {
    if (obj.text === 'localStorage') return { call: node, storage: 'localStorage' };
    if (obj.text === 'sessionStorage') return { call: node, storage: 'sessionStorage' };
  }

  // window.localStorage.setItem(...) / window.sessionStorage.setItem(...)
  if (
    ts.isPropertyAccessExpression(obj) &&
    ts.isIdentifier(obj.expression) &&
    obj.expression.text === 'window' &&
    ts.isIdentifier(obj.name)
  ) {
    if (obj.name.text === 'localStorage') return { call: node, storage: 'localStorage' };
    if (obj.name.text === 'sessionStorage') return { call: node, storage: 'sessionStorage' };
  }

  return null;
};

const getStaticKey = (arg: ts.Expression | undefined): string | undefined => {
  if (!arg) return undefined;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return undefined;
};

const getDirectCalleeName = (call: ts.CallExpression): string | undefined => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return e.name.text;
  return undefined;
};

type WrappingKind = 'recognized' | 'heuristic' | 'none';

const detectWrapping = (arg: ts.Expression | undefined): { kind: WrappingKind; name?: string } => {
  if (!arg || !ts.isCallExpression(arg)) return { kind: 'none' };
  const name = getDirectCalleeName(arg);
  if (!name) return { kind: 'none' };
  if (KNOWN_ENCRYPTION_HELPERS.has(name)) return { kind: 'recognized', name };
  if (HEURISTIC_ENCRYPTION_NAME_RE.test(name)) return { kind: 'heuristic', name };
  return { kind: 'none' };
};

type SuspectValue = { name: string };

const valueIsSuspectStringify = (
  arg: ts.Expression | undefined,
): SuspectValue | null => {
  if (!arg || !ts.isCallExpression(arg)) return null;
  const callee = arg.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'JSON') return null;
  if (!ts.isIdentifier(callee.name) || callee.name.text !== 'stringify') return null;
  const inner = arg.arguments[0];
  if (!inner || !ts.isIdentifier(inner)) return null;
  if (!SUSPECT_PII_NAME_RE.test(inner.text)) return null;
  return { name: inner.text };
};

const collectStorageWrites = (sourceFile: ts.SourceFile): StorageWriteCall[] => {
  const out: StorageWriteCall[] = [];
  const visit = (node: ts.Node): void => {
    const m = matchStorageSetItem(node);
    if (m) out.push(m);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return out;
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);
  const reachable = collectClientReachableFiles(ctx);

  for (const file of reachable) {
    const sf = ctx.program.getSourceFile(file);
    if (!sf) continue;

    for (const { call, storage } of collectStorageWrites(sf)) {
      const keyArg = call.arguments[0];
      const valueArg = call.arguments[1];

      const wrapping = detectWrapping(valueArg);
      if (wrapping.kind === 'recognized') continue;

      const { line, column } = lineCol(sf, call);

      if (wrapping.kind === 'heuristic') {
        findings.push({
          ruleId: RULE_ID,
          severity: 'medium',
          file: rel(file),
          line,
          column,
          message: `${storage}.setItem wrapped in "${wrapping.name ?? '?'}" — encryption cannot be verified statically`,
          detail: `The value is passed through "${wrapping.name ?? '?'}", whose name suggests encryption, but the function is not in claustra's recognized helper list. If the helper does perform real authenticated encryption, you can ignore this; if it is a pass-through or weak encoding (base64, btoa, custom XOR), this write is no safer than a plain setItem.`,
          suggestion: 'Confirm the wrapper performs authenticated encryption with a key not derivable from the bundle. If it does, consider renaming it to one of the recognized helper names so future scans suppress this warning. Otherwise, prefer httpOnly cookies for auth tokens or in-memory state for session data.',
        });
        continue;
      }

      const staticKey = getStaticKey(keyArg);
      const keyHit = staticKey !== undefined && SUSPECT_KEY_RE.test(staticKey);
      const valueHit = valueIsSuspectStringify(valueArg);

      if (!keyHit && !valueHit) continue;

      const reasonParts: string[] = [];
      if (keyHit) reasonParts.push(`key "${staticKey}" matches token/auth/session pattern`);
      if (valueHit) reasonParts.push(`value is JSON.stringify(${valueHit.name}) — likely PII`);

      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file: rel(file),
        line,
        column,
        message: `${storage}.setItem writes likely-sensitive data — ${reasonParts.join('; ')}`,
        detail:
          'Anything in localStorage / sessionStorage is readable by any JavaScript that runs on the same origin, including XSS payloads, third-party scripts, and browser extensions. Auth tokens stored here turn one XSS into a full account takeover; PII stored here makes the storage layer a permanent liability.',
        suggestion:
          'Use httpOnly cookies for auth tokens (the browser will send them automatically and JS cannot read them), or in-memory React state/context for session data that should not survive a tab close. If the value really must persist client-side, encrypt it with a key not derivable from the bundle.',
      });
    }
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects writes to localStorage / sessionStorage from client-reachable code where the key name suggests an auth token / credential / session, or the value is a JSON.stringify of a likely-PII object. Downgrades to a medium "unverifiable encryption" warning when the value is wrapped in a function whose name suggests (but does not prove) encryption.',
  severity: SEVERITY,
  run,
};

export default rule;
