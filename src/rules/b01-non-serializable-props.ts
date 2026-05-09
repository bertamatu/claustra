import path from 'node:path';
import ts from 'typescript';
import { hasDirective, hasUseServerInBody, unwrapAlias } from '../utils/ast.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'b01-non-serializable-props';
const SEVERITY: Severity = 'high';

type FlagKind = 'function' | 'class' | 'map' | 'set' | 'symbol' | 'bigint' | 'date';

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const getTagName = (
  el: ts.JsxOpeningLikeElement,
): ts.JsxTagNameExpression => el.tagName;

const isCapitalizedJsxName = (tagName: ts.JsxTagNameExpression): boolean => {
  const text = tagName.getText();
  return /^[A-Z]/.test(text);
};

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

const isServerActionExpression = (
  expr: ts.Expression,
  ctx: ProjectContext,
): boolean => {
  // Inline arrow / function expression with 'use server' first statement
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    if (ts.isBlock(expr.body) && hasUseServerInBody(expr.body)) {
      return true;
    }
    return false;
  }

  // Resolve the value's symbol (for `<C cb={action} />` or `<C cb={mod.action} />`)
  const sym = ctx.checker.getSymbolAtLocation(expr);
  if (!sym) return false;
  const resolved = unwrapAlias(sym, ctx.checker);
  for (const decl of resolved.declarations ?? []) {
    const sf = decl.getSourceFile();
    if (hasDirective(sf, 'use server')) return true;

    let body: ts.Block | undefined;
    if (
      (ts.isFunctionDeclaration(decl) ||
        ts.isFunctionExpression(decl) ||
        ts.isArrowFunction(decl)) &&
      decl.body &&
      ts.isBlock(decl.body)
    ) {
      body = decl.body;
    } else if (
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
      ts.isBlock(decl.initializer.body)
    ) {
      body = decl.initializer.body;
    }
    if (hasUseServerInBody(body)) return true;
  }
  return false;
};

const inspectTypeShallow = (
  t: ts.Type,
  checker: ts.TypeChecker,
): FlagKind | null => {
  // any / unknown - can't conclude anything
  if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;

  // BigInt primitive
  if (t.flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return 'bigint';
  // ESSymbol primitive
  if (t.flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) return 'symbol';

  const sym = t.getSymbol() ?? t.aliasSymbol;
  const name = sym?.name;

  // Order matters: Date / Map / Set are class instances; check by name first so we don't lump them under 'class'.
  if (name === 'Promise') return null;
  if (name === 'Date') return 'date';
  if (name === 'Map' || name === 'ReadonlyMap' || name === 'WeakMap') return 'map';
  if (name === 'Set' || name === 'ReadonlySet' || name === 'WeakSet') return 'set';
  if (name === 'BigInt') return 'bigint';
  if (name === 'Symbol') return 'symbol';

  // Function: any callable type
  if (t.getCallSignatures().length > 0) return 'function';

  // Class instance heuristic: the type's symbol is a class
  if (sym && sym.flags & ts.SymbolFlags.Class) return 'class';

  // Fallback: a non-class instance whose constructor isn't Object
  // (skip - too noisy for v1)
  void checker;
  return null;
};

const inspectType = (
  t: ts.Type,
  checker: ts.TypeChecker,
  seen: Set<ts.Type> = new Set(),
): FlagKind | null => {
  if (seen.has(t)) return null;
  seen.add(t);

  const direct = inspectTypeShallow(t, checker);
  if (direct) return direct;

  if (t.isUnion() || t.isIntersection()) {
    for (const sub of t.types) {
      const r = inspectType(sub, checker, seen);
      if (r) return r;
    }
  }
  return null;
};

const messageFor = (kind: FlagKind, propName: string): {
  message: string;
  detail: string;
  suggestion: string;
  severity: Severity;
} => {
  switch (kind) {
    case 'function':
      return {
        severity: 'high',
        message: `Function passed as prop "${propName}" to a Client Component`,
        detail: 'Functions are not serializable across the server/client boundary. React drops them or throws at render time. Server Actions ("use server") are exempt - those resolve to a callable reference on the client.',
        suggestion: `Either move "${propName}" into a Server Action (mark its definition with 'use server'), or attach the handler inside the Client Component itself.`,
      };
    case 'class':
      return {
        severity: 'high',
        message: `Class instance passed as prop "${propName}" to a Client Component`,
        detail: 'React serializes props as plain JSON across the boundary. Class instances lose their prototype, methods, and private fields.',
        suggestion: `Pass plain data (a serializable object) and reconstruct the instance inside the Client Component if needed.`,
      };
    case 'map':
      return {
        severity: 'high',
        message: `Map passed as prop "${propName}" to a Client Component`,
        detail: 'Map is not part of the RSC serialization protocol. It will be silently dropped or cause a render error.',
        suggestion: 'Convert to an array of [key, value] tuples or a plain object, and rebuild on the client.',
      };
    case 'set':
      return {
        severity: 'high',
        message: `Set passed as prop "${propName}" to a Client Component`,
        detail: 'Set is not part of the RSC serialization protocol. It will be silently dropped or cause a render error.',
        suggestion: 'Convert to an array, and rebuild on the client.',
      };
    case 'symbol':
      return {
        severity: 'high',
        message: `Symbol passed as prop "${propName}" to a Client Component`,
        detail: 'Symbols cannot cross the server/client boundary - they are unique per realm.',
        suggestion: 'Use a string key instead.',
      };
    case 'bigint':
      return {
        severity: 'high',
        message: `BigInt passed as prop "${propName}" to a Client Component`,
        detail: 'BigInt is not part of the RSC serialization protocol. JSON.stringify also throws on BigInt.',
        suggestion: 'Convert to string at the boundary and parse on the client (or use a JSON-safe number range).',
      };
    case 'date':
      return {
        severity: 'medium',
        message: `Date passed as prop "${propName}" to a Client Component`,
        detail: 'Date round-trips through RSC, but the resulting client-side value can drift across timezone/format boundaries and produce hydration mismatches when rendered as a string.',
        suggestion: 'Convert to ISO string at the boundary (e.g. value.toISOString()) and parse on the client if you need a Date.',
      };
  }
};

const checkJsxElement = (
  el: ts.JsxOpeningLikeElement,
  ctx: ProjectContext,
  rel: (f: string) => string,
): Finding[] => {
  const findings: Finding[] = [];
  const tagName = getTagName(el);
  if (!isCapitalizedJsxName(tagName)) return findings;
  if (!targetIsClientComponent(tagName, ctx)) return findings;

  const sourceFile = el.getSourceFile();
  const file = rel(sourceFile.fileName);

  for (const attr of el.attributes.properties) {
    // Spread props: B2's job, skip here
    if (ts.isJsxSpreadAttribute(attr)) continue;
    if (!ts.isJsxAttribute(attr)) continue;
    if (!ts.isIdentifier(attr.name)) continue;
    const propName = attr.name.text;
    if (propName === 'children') continue;
    if (!attr.initializer) continue; // boolean shorthand <C disabled />

    let valueExpr: ts.Expression | undefined;
    if (ts.isJsxExpression(attr.initializer)) {
      valueExpr = attr.initializer.expression;
    } else if (ts.isStringLiteral(attr.initializer)) {
      // <C name="alice" /> - strings are always serializable, skip
      continue;
    }
    if (!valueExpr) continue;

    const valueType = ctx.checker.getTypeAtLocation(valueExpr);
    const kind = inspectType(valueType, ctx.checker);
    if (!kind) continue;

    if (kind === 'function' && isServerActionExpression(valueExpr, ctx)) continue;

    const { line, column } = lineCol(sourceFile, attr);
    const m = messageFor(kind, propName);
    findings.push({
      ruleId: RULE_ID,
      severity: m.severity,
      file,
      line,
      column,
      message: m.message,
      detail: m.detail,
      suggestion: m.suggestion,
    });
  }
  return findings;
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;
    // Source files that are themselves Client Components don't cross the boundary
    // when they render other Client Components - both sides run in the browser, so
    // function props / Map / Date / etc. serialize fine.
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
    'Detects non-serializable props (functions, class instances, Map/Set, Symbol, BigInt, Date) crossing into Client Components.',
  severity: SEVERITY,
  run,
};

export default rule;
