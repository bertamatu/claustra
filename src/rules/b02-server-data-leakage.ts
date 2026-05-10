import path from 'node:path';
import ts from 'typescript';
import { unwrapAlias } from '../utils/ast.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'b02-server-data-leakage';
const SEVERITY: Severity = 'critical';

const SENSITIVE_PROP_PATTERN =
  /^(secret|token|password|apiKey|privateKey|hash|salt|sessionId|stripeSecret|jwt)/i;

const QUERY_METHODS = new Set([
  // Prisma
  'findFirst', 'findUnique', 'findMany',
  'findFirstOrThrow', 'findUniqueOrThrow',
  // Mongoose
  'findOne', 'find', 'findById',
]);

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const isCapitalizedJsxName = (tagName: ts.JsxTagNameExpression): boolean =>
  /^[A-Z]/.test(tagName.getText());

const targetIsClientComponent = (
  tagName: ts.JsxTagNameExpression,
  ctx: ProjectContext,
): boolean => {
  const sym = ctx.checker.getSymbolAtLocation(tagName);
  if (!sym) return false;
  const resolved = unwrapAlias(sym, ctx.checker);
  for (const decl of resolved.declarations ?? []) {
    const sf = decl.getSourceFile();
    if (sf.fileName.includes('node_modules')) continue;
    if (ctx.boundaryMap.get(sf.fileName) === 'client') return true;
  }
  return false;
};

const unwrapAwait = (expr: ts.Expression): ts.Expression =>
  ts.isAwaitExpression(expr) ? unwrapAwait(expr.expression) : expr;

const isWholeRecordQueryCall = (call: ts.CallExpression): boolean => {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!QUERY_METHODS.has(callee.name.text)) return false;

  // If the query receives an options object with `select` or `omit`, it's filtered.
  const arg = call.arguments[0];
  if (arg && ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        (prop.name.text === 'select' || prop.name.text === 'omit')
      ) {
        return false;
      }
    }
  }
  return true;
};

const valueIsWholeRecord = (
  value: ts.Expression,
  ctx: ProjectContext,
): boolean => {
  if (!ts.isIdentifier(value)) return false;
  const sym = ctx.checker.getSymbolAtLocation(value);
  if (!sym) return false;
  const resolved = unwrapAlias(sym, ctx.checker);
  for (const decl of resolved.declarations ?? []) {
    if (!ts.isVariableDeclaration(decl)) continue;
    if (!decl.initializer) continue;
    const init = unwrapAwait(decl.initializer);
    if (ts.isCallExpression(init) && isWholeRecordQueryCall(init)) return true;
  }
  return false;
};

// True when the expression resolves to a function parameter, or to a binding
// element (rest/destructure) that traces up to a function parameter pattern.
// This covers the React forwarding-prop pattern: `<Primitive {...props} />`
// where `props` is the component's own typed parameter, including the
// destructured-rest variant `({ className, ...props }) => <Primitive {...props}/>`.
// Spreading a parameter-derived object never originates server data; the
// caller already supplied the value.
const isParameterDerived = (
  expr: ts.Expression,
  ctx: ProjectContext,
): boolean => {
  if (!ts.isIdentifier(expr)) return false;
  const sym = ctx.checker.getSymbolAtLocation(expr);
  if (!sym?.declarations) return false;
  for (const decl of sym.declarations) {
    if (ts.isParameter(decl)) return true;
    if (ts.isBindingElement(decl)) {
      let cur: ts.Node = decl;
      while (cur.parent !== undefined) {
        if (ts.isParameter(cur.parent)) return true;
        if (ts.isVariableDeclaration(cur.parent)) return false;
        cur = cur.parent;
      }
    }
  }
  return false;
};

const checkJsxElement = (
  el: ts.JsxOpeningLikeElement,
  ctx: ProjectContext,
  rel: (f: string) => string,
): Finding[] => {
  const findings: Finding[] = [];
  const tagName = el.tagName;
  if (!isCapitalizedJsxName(tagName)) return findings;
  if (!targetIsClientComponent(tagName, ctx)) return findings;

  const sourceFile = el.getSourceFile();
  const file = rel(sourceFile.fileName);

  for (const attr of el.attributes.properties) {
    // Spread props: only flag when the source clearly originates server data.
    // The React forwarding-prop pattern - `<Primitive {...props} />` where
    // `props` is the component's own parameter, common in shadcn/ui-style
    // wrapper components - never crosses a server/client boundary because
    // the caller already supplied the value (often a Client Component
    // forwarding to another Client Component primitive). Conservative
    // narrowing: flag spreads from a whole-record DB query, skip the rest.
    if (ts.isJsxSpreadAttribute(attr)) {
      if (isParameterDerived(attr.expression, ctx)) continue;
      if (!valueIsWholeRecord(attr.expression, ctx)) continue;
      const { line, column } = lineCol(sourceFile, attr);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: 'Whole DB record spread into a Client Component',
        detail: 'Spreading a Prisma/Mongoose query result without `select` or `omit` ships every column - including private fields like `passwordHash` or internal foreign keys - into the HTML and JS sent to the browser.',
        suggestion: 'Add `select: { ... }` (or `omit: {...}`) to the query so only the fields the UI needs cross the boundary, or destructure the safe fields explicitly into named props.',
      });
      continue;
    }

    if (!ts.isJsxAttribute(attr)) continue;
    if (!ts.isIdentifier(attr.name)) continue;
    const propName = attr.name.text;
    if (propName === 'children') continue;

    // Sensitive prop name regex
    if (SENSITIVE_PROP_PATTERN.test(propName)) {
      const { line, column } = lineCol(sourceFile, attr);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: `Sensitive prop name "${propName}" passed to a Client Component`,
        detail: 'Props prefixed with secret/token/password/apiKey/privateKey/hash/salt/sessionId/stripeSecret/jwt are almost always values that must not leave the server. Anything in this prop ends up in the HTML and JS sent to the browser.',
        suggestion: `Do not send "${propName}" to the client. If the UI needs a derived state (e.g., "is the user signed in?"), compute that on the server and pass a boolean.`,
      });
      continue;
    }

    if (!attr.initializer) continue;
    if (!ts.isJsxExpression(attr.initializer)) continue;
    const valueExpr = attr.initializer.expression;
    if (!valueExpr) continue;

    if (valueIsWholeRecord(valueExpr, ctx)) {
      const { line, column } = lineCol(sourceFile, attr);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: `Whole DB record passed as prop "${propName}" to a Client Component`,
        detail: 'The value of this prop comes directly from a Prisma/Mongoose query that did not specify a `select` or `omit`. The full row - including any private columns - is serialized into the page HTML and JS.',
        suggestion: 'Add `select: { ... }` (or `omit: {...}`) to the query so only the fields the UI needs cross the boundary, or destructure the safe fields explicitly.',
      });
    }
  }
  return findings;
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;
    // Only flag from `'server'` files. `'client'` (explicit `'use client'`)
    // and `'either'` (no directive but reachable from a client tree) both
    // execute in the client bundle - props passed to other Client Components
    // do not cross any RSC serialization boundary in either case.
    const boundary = ctx.boundaryMap.get(sourceFile.fileName);
    if (boundary === 'client' || boundary === 'either') continue;

    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node)) {
        findings.push(...checkJsxElement(node, ctx, rel));
      } else if (ts.isJsxElement(node)) {
        findings.push(...checkJsxElement(node.openingElement, ctx, rel));
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects sensitive prop names, spread props, and whole DB records crossing into Client Components.',
  severity: SEVERITY,
  run,
};

export default rule;
