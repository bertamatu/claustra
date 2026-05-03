import path from 'node:path';
import ts from 'typescript';
import { hasDirective, hasUseServerInBody } from '../utils/ast.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'c02-unauthorized-server-actions';
const SEVERITY: Severity = 'high';

const KNOWN_AUTH_NAMES = new Set([
  'auth',
  'getServerSession',
  'getServerAuthSession',
  'currentUser',
  'validateRequest',
  'getSession',
]);

const AUTH_NAME_PATTERN =
  /^(verify|require|check|assert|guard).*?(Auth|Session|User|Permission|Role|Access)/i;

const MUTATION_METHODS = new Set([
  // Prisma / Drizzle / generic ORM
  'create', 'createMany',
  'update', 'updateMany',
  'delete', 'deleteMany',
  'upsert',
  'insert', 'insertMany',
  // Mongoose
  'save',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'deleteOne', 'replaceOne', 'bulkWrite',
  // FS writes
  'writeFile', 'writeFileSync',
  'appendFile', 'appendFileSync',
  'unlink', 'unlinkSync',
  'rm', 'rmSync',
  'rmdir', 'rmdirSync',
  'mkdir', 'mkdirSync',
  'copyFile', 'copyFileSync',
  'rename', 'renameSync',
]);

// Receivers we never treat as DB/FS targets.
const SAFE_RECEIVERS = new Set([
  'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'JSON', 'Date', 'Math', 'Number', 'String', 'Boolean',
  'React', 'Symbol', 'console', 'performance',
  'Promise', 'Error',
  'crypto', 'bcrypt', 'jsonwebtoken',
]);

const SQL_TAG_PATTERN = /(^|\.)(sql|raw|query)$/i;
const SQL_WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|DROP|ALTER|CREATE)\b/i;

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

const isMutationCallExpression = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const method = callee.name.text;
  if (!MUTATION_METHODS.has(method)) return false;

  const root = getRootIdentifier(callee);
  if (root && SAFE_RECEIVERS.has(root)) return false;
  return true;
};

const isMutationTaggedTemplate = (
  node: ts.Node,
): node is ts.TaggedTemplateExpression => {
  if (!ts.isTaggedTemplateExpression(node)) return false;
  const tagText = node.tag.getText();
  if (!SQL_TAG_PATTERN.test(tagText)) return false;
  return SQL_WRITE_KEYWORDS.test(node.template.getText());
};

const isAuthCallExpression = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  let name: string | undefined;
  if (ts.isIdentifier(callee)) name = callee.text;
  else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
  if (!name) return false;
  if (KNOWN_AUTH_NAMES.has(name)) return true;
  if (AUTH_NAME_PATTERN.test(name)) return true;
  return false;
};

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
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer))
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

  // Inline 'use server' — anywhere in the file
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

const collectMatching = (
  body: ts.Node,
  predicate: (n: ts.Node) => boolean,
): ts.Node[] => {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    if (predicate(n)) out.push(n);
    n.forEachChild(visit);
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
  // Arrow / anonymous: try the parent VariableDeclaration name
  const parent = fn.parent as ts.Node | undefined;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return '<anonymous>';
};

const fnReportNode = (fn: FnNode): ts.Node => {
  if (
    (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) &&
    fn.name
  ) {
    return fn.name;
  }
  const parent = fn.parent as ts.Node | undefined;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name;
  }
  return fn;
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
      if (!fn.body) continue;

      const mutations = collectMatching(
        fn.body,
        (n) => isMutationCallExpression(n) || isMutationTaggedTemplate(n),
      );
      if (mutations.length === 0) continue;

      const auths = collectMatching(fn.body, isAuthCallExpression);
      const firstMutationStart = mutations[0]!.getStart();
      const hasAuthBefore = auths.some((a) => a.getStart() < firstMutationStart);
      if (hasAuthBefore) continue;

      const reportAt = fnReportNode(fn);
      const { line, column } = lineCol(sourceFile, reportAt);
      const name = fnNameForReporting(fn);
      const firstMutationLine = sourceFile.getLineAndCharacterOfPosition(firstMutationStart).line + 1;

      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: `Server Action "${name}" performs a mutation without an authorization check`,
        detail: `Server Actions are public POST endpoints — anyone can invoke them. The mutation at line ${firstMutationLine} runs before any recognized auth call (auth(), getServerSession(), currentUser(), validateRequest(), or a verify*/require*/check*/assert*/guard*Auth|Session|User|Permission|Role|Access helper).`,
        suggestion:
          'Call your auth helper (e.g. auth() / currentUser()) at the top of the action and throw on missing session before any DB/FS write.',
      });
    }
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects Server Actions that perform DB/FS mutations without a recognized authorization check before the write.',
  severity: SEVERITY,
  needsLlm: false,
  run,
};

export default rule;
