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
    // Spread props: any object across the boundary may carry sensitive fields.
    if (ts.isJsxSpreadAttribute(attr)) {
      const { line, column } = lineCol(sourceFile, attr);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: 'Spread props passed to a Client Component',
        detail: 'Anything spread across the server/client boundary is serialized into the page HTML/JS bundle. If the source object contains private fields (passwordHash, internal IDs, third-party keys), they leak to every visitor.',
        suggestion: 'Replace `{...obj}` with explicit props for only the fields the UI needs.',
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
    // Client → client renders don't cross the server/client boundary - nothing leaks.
    if (ctx.boundaryMap.get(sourceFile.fileName) === 'client') continue;

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
