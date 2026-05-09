import path from 'node:path';
import ts from 'typescript';
import { hasDirective, hasUseServerInBody } from '../utils/ast.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'c01-unvalidated-server-actions';
const SEVERITY: Severity = 'critical';

const VALIDATOR_METHODS = new Set([
  // Zod
  'parse', 'safeParse',
  // Yup
  'validate', 'validateSync',
  // ArkType
  'assert',
  // TypeBox
  'Check',
]);

// Free-function validators: e.g. valibot's `parse(Schema, value)`.
const VALIDATOR_FREE_FN = new Set(['parse', 'safeParse']);

// Receivers that share `parse`/etc. names but are not validators.
const NON_VALIDATOR_RECEIVERS = new Set([
  'JSON', 'Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'Date', 'Math',
]);

const MUTATION_METHODS = new Set([
  'create', 'createMany',
  'update', 'updateMany',
  'delete', 'deleteMany',
  'upsert',
  'insert', 'insertMany',
  'save',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'deleteOne', 'replaceOne', 'bulkWrite',
  'writeFile', 'writeFileSync',
  'appendFile', 'appendFileSync',
  'unlink', 'unlinkSync',
  'rm', 'rmSync',
  'rmdir', 'rmdirSync',
  'mkdir', 'mkdirSync',
  'copyFile', 'copyFileSync',
  'rename', 'renameSync',
]);

const SAFE_RECEIVERS = new Set([
  'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'JSON', 'Date', 'Math', 'Number', 'String', 'Boolean',
  'React', 'Symbol', 'console', 'performance',
  'Promise', 'Error',
  'crypto', 'bcrypt', 'jsonwebtoken',
]);

const REVALIDATE_NAMES = new Set(['revalidatePath', 'revalidateTag']);

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const hasExportModifier = (node: ts.Node): boolean => {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
};

const getRootIdentifier = (expr: ts.Expression): string | undefined => {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  if (ts.isCallExpression(cur)) return getRootIdentifier(cur.expression);
  return ts.isIdentifier(cur) ? cur.text : undefined;
};

const unwrapAwait = (expr: ts.Expression): ts.Expression =>
  ts.isAwaitExpression(expr) ? unwrapAwait(expr.expression) : expr;

const isValidatorCall = (
  rawExpr: ts.Expression,
  checker: ts.TypeChecker,
): boolean => {
  const expr = unwrapAwait(rawExpr);
  if (!ts.isCallExpression(expr)) return false;
  const callee = expr.expression;
  if (ts.isPropertyAccessExpression(callee) && VALIDATOR_METHODS.has(callee.name.text)) {
    const root = getRootIdentifier(callee);
    if (root && NON_VALIDATOR_RECEIVERS.has(root)) return false;
    return true;
  }
  if (ts.isIdentifier(callee)) {
    if (VALIDATOR_FREE_FN.has(callee.text)) return true;
    // Aliased import: `import { parse as valibotParse } from 'valibot'` - resolve the alias.
    const sym = checker.getSymbolAtLocation(callee);
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      const original = checker.getAliasedSymbol(sym);
      if (VALIDATOR_FREE_FN.has(original.name)) return true;
    }
  }
  return false;
};

const isMutationCall = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!MUTATION_METHODS.has(callee.name.text)) return false;
  const root = getRootIdentifier(callee);
  if (root && SAFE_RECEIVERS.has(root)) return false;
  return true;
};

const isFetchCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'fetch';

const isRevalidateCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  REVALIDATE_NAMES.has(node.expression.text);

type FnNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

const collectServerActionFns = (sourceFile: ts.SourceFile): FnNode[] => {
  const out: FnNode[] = [];
  const fileLevelServer = hasDirective(sourceFile, 'use server');

  if (fileLevelServer) {
    for (const stmt of sourceFile.statements) {
      if (
        ts.isFunctionDeclaration(stmt) &&
        hasExportModifier(stmt) &&
        stmt.body
      ) {
        out.push(stmt);
        continue;
      }
      if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
          ) {
            out.push(decl.initializer);
          }
        }
        continue;
      }
      if (ts.isExportAssignment(stmt)) {
        const e = stmt.expression;
        if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) out.push(e);
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      hasUseServerInBody(node.body) &&
      !out.includes(node)
    ) {
      out.push(node);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);

  return out;
};

const markBindingTainted = (
  name: ts.BindingName,
  tainted: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): void => {
  if (ts.isIdentifier(name)) {
    const sym = checker.getSymbolAtLocation(name);
    if (sym) tainted.add(sym);
    return;
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) markBindingTainted(el.name, tainted, checker);
  }
};

const expressionReadsTainted = (
  node: ts.Node,
  tainted: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): boolean => {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n)) {
      const parent = n.parent as ts.Node | undefined;

      // Skip the `.foo` in `obj.foo`
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) {
        return;
      }
      // Skip the `key` in `{ key: value }` property assignments
      if (parent && ts.isPropertyAssignment(parent) && parent.name === n) {
        return;
      }
      // Shorthand `{ data }` - the same Identifier names the key AND references the
      // local variable. getSymbolAtLocation returns the property symbol; the variable
      // backing the shorthand requires the dedicated checker API.
      if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === n) {
        const valueSym = checker.getShorthandAssignmentValueSymbol(parent);
        if (valueSym && tainted.has(valueSym)) found = true;
        return;
      }

      const sym = checker.getSymbolAtLocation(n);
      if (sym && tainted.has(sym)) {
        found = true;
        return;
      }
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
};

const propagateTaint = (
  body: ts.Block,
  tainted: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): void => {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (!isValidatorCall(node.initializer, checker)) {
        if (expressionReadsTainted(node.initializer, tainted, checker)) {
          markBindingTainted(node.name, tainted, checker);
        }
      }
    }
    if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      if (expressionReadsTainted(node.expression, tainted, checker)) {
        for (const decl of node.initializer.declarations) {
          markBindingTainted(decl.name, tainted, checker);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(body);
};

type SinkKind = 'db-write' | 'fs-write' | 'fetch' | 'revalidate';

type Sink = {
  node: ts.CallExpression;
  kind: SinkKind;
  taintedArg: ts.Node;
};

const findTaintedSinks = (
  body: ts.Block,
  tainted: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): Sink[] => {
  const out: Sink[] = [];

  const checkArgs = (
    call: ts.CallExpression,
    kind: SinkKind,
    args: readonly ts.Expression[],
  ): void => {
    for (const arg of args) {
      if (expressionReadsTainted(arg, tainted, checker)) {
        out.push({ node: call, kind, taintedArg: arg });
        return;
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (isMutationCall(node)) {
      const callee = node.expression as ts.PropertyAccessExpression;
      const isFsMethod = /^(writeFile|appendFile|unlink|rm|rmdir|mkdir|copyFile|rename)/.test(callee.name.text);
      checkArgs(node, isFsMethod ? 'fs-write' : 'db-write', node.arguments);
    } else if (isFetchCall(node)) {
      const args: ts.Expression[] = [];
      if (node.arguments[0]) args.push(node.arguments[0]);
      const opts = node.arguments[1];
      if (opts && ts.isObjectLiteralExpression(opts)) {
        for (const prop of opts.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            (prop.name.text === 'body' || prop.name.text === 'url')
          ) {
            args.push(prop.initializer);
          }
        }
      }
      checkArgs(node, 'fetch', args);
    } else if (isRevalidateCall(node)) {
      checkArgs(node, 'revalidate', node.arguments);
    }
    node.forEachChild(visit);
  };
  visit(body);
  return out;
};

const fnNameForReporting = (fn: FnNode): string => {
  if (
    (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) &&
    fn.name &&
    ts.isIdentifier(fn.name)
  ) {
    return fn.name.text;
  }
  const parent = fn.parent as ts.Node | undefined;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return '<anonymous>';
};

const messageForKind = (kind: SinkKind, fnName: string): {
  message: string;
  detail: string;
  suggestion: string;
} => {
  const base = `Server Action "${fnName}" passes unvalidated input into`;
  switch (kind) {
    case 'db-write':
      return {
        message: `${base} a database write`,
        detail: 'Server Actions are public POST endpoints - TypeScript types are erased at runtime. Without runtime validation, an attacker can send arbitrary payloads and write whatever they want.',
        suggestion: 'Validate the input with Zod (Schema.parse), Valibot (parse(Schema, input)), Yup (Schema.validateSync), ArkType (Schema.assert), or a manual type predicate before passing it to the database.',
      };
    case 'fs-write':
      return {
        message: `${base} a filesystem write`,
        detail: 'Filesystem writes driven by user input enable path-traversal and arbitrary-file-write attacks.',
        suggestion: 'Validate and normalize the path with a schema and reject anything outside an allowlisted directory.',
      };
    case 'fetch':
      return {
        message: `${base} fetch()`,
        detail: 'Sending unvalidated input as a URL or request body lets an attacker pivot through your server to internal services (SSRF) or smuggle attacker-controlled payloads to a third party.',
        suggestion: 'Validate the URL (allowlist of hosts) and the body shape with a schema before issuing the fetch.',
      };
    case 'revalidate':
      return {
        message: `${base} revalidatePath()/revalidateTag()`,
        detail: 'Unvalidated cache-tag/path arguments enable cache poisoning - an attacker can force unrelated paths to be invalidated or trigger unexpected cache misses.',
        suggestion: 'Validate the tag/path against an allowlist before calling revalidatePath or revalidateTag.',
      };
  }
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const file = rel(sourceFile.fileName);
    const actions = collectServerActionFns(sourceFile);

    for (const fn of actions) {
      if (!fn.body || !ts.isBlock(fn.body)) continue;
      if (fn.parameters.length === 0) continue;

      const tainted = new Set<ts.Symbol>();
      for (const p of fn.parameters) markBindingTainted(p.name, tainted, ctx.checker);
      if (tainted.size === 0) continue;

      propagateTaint(fn.body, tainted, ctx.checker);

      const sinks = findTaintedSinks(fn.body, tainted, ctx.checker);
      const fnName = fnNameForReporting(fn);

      for (const sink of sinks) {
        const { line, column } = lineCol(sourceFile, sink.node);
        const m = messageForKind(sink.kind, fnName);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file,
          line,
          column,
          message: m.message,
          detail: m.detail,
          suggestion: m.suggestion,
        });
      }
    }
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects Server Actions whose parameters reach DB/FS writes, fetch(), or revalidatePath/Tag without passing through a recognized validator (Zod, Valibot, Yup, ArkType, TypeBox).',
  severity: SEVERITY,
  run,
};

export default rule;
