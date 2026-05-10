import path from 'node:path';
import ts from 'typescript';
import { hasDirective, isNextMetadataFile } from '../utils/ast.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'd01-hydration-risks';
const SEVERITY: Severity = 'high';

const SAFE_HOOK_NAMES = new Set([
  'useEffect',
  'useLayoutEffect',
  'useInsertionEffect',
  'useImperativeHandle',
  // useMemo/useCallback are render-time but the function inside only runs on initial mount + dep-change.
  // For Date.now / Math.random, they still produce different values server vs client unless deps stabilize them.
  // We treat them as safe here to avoid false positives - hydration-mismatch tooling can revisit.
  'useMemo',
  'useCallback',
]);

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const getRootObject = (expr: ts.Expression): string | undefined => {
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
};

const BROWSER_GLOBAL_NAMES = new Set([
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
]);

// Returns true if `cond` is `typeof <browser-global> <op> 'undefined'` for the
// given operator kind. Honors both strict (===, !==) and loose (==, !=) forms,
// and either argument order.
const matchesTypeofBrowserUndefined = (
  cond: ts.Expression,
  positive: boolean,
): boolean => {
  if (!ts.isBinaryExpression(cond)) return false;
  const op = cond.operatorToken.kind;
  const matchesOp = positive
    ? op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken
    : op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken;
  if (!matchesOp) return false;
  const oneSide = (a: ts.Expression, b: ts.Expression): boolean =>
    ts.isTypeOfExpression(a) &&
    ts.isIdentifier(a.expression) &&
    BROWSER_GLOBAL_NAMES.has(a.expression.text) &&
    ts.isStringLiteral(b) &&
    b.text === 'undefined';
  return oneSide(cond.left, cond.right) || oneSide(cond.right, cond.left);
};

// Detects `if (typeof X === 'undefined') return/throw;` where the body of the
// surrounding function then runs in client-only context. This is the
// "early-return" form of the guard.
const isTypeofBrowserUndefinedGuard = (stmt: ts.Statement): boolean => {
  if (!ts.isIfStatement(stmt)) return false;
  if (!matchesTypeofBrowserUndefined(stmt.expression, false)) return false;
  const exits = (s: ts.Statement): boolean => {
    if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) return true;
    if (ts.isBlock(s)) return s.statements.some(exits);
    return false;
  };
  return exits(stmt.thenStatement);
};

// Returns true when `node` is in a branch that the surrounding `if`/ternary
// gates to client-only execution. Covers three additional shapes beyond the
// early-return form:
//   - `if (typeof X !== 'undefined') { ...read... }` (positive block)
//   - `typeof X !== 'undefined' ? X.y : fallback` (ternary, truthy branch)
//   - `typeof X === 'undefined' ? fallback : X.y` (ternary, falsy branch)
const isInsidePositiveTypeofBranch = (node: ts.Node): boolean => {
  let cur: ts.Node | undefined = node;
  while (cur !== undefined) {
    const parent = cur.parent as ts.Node | undefined;
    if (parent && ts.isIfStatement(parent)) {
      if (parent.thenStatement === cur && matchesTypeofBrowserUndefined(parent.expression, true)) {
        return true;
      }
      if (parent.elseStatement === cur && matchesTypeofBrowserUndefined(parent.expression, false)) {
        return true;
      }
    }
    if (parent && ts.isConditionalExpression(parent)) {
      if (parent.whenTrue === cur && matchesTypeofBrowserUndefined(parent.condition, true)) {
        return true;
      }
      if (parent.whenFalse === cur && matchesTypeofBrowserUndefined(parent.condition, false)) {
        return true;
      }
    }
    cur = parent;
  }
  return false;
};

// Returns true if `node` sits in a function body whose earlier statements include
// a `if (typeof <browser-global> === 'undefined') return/throw;` early-exit guard.
const hasTypeofBrowserGuard = (node: ts.Node): boolean => {
  let cur: ts.Node | undefined = node;
  while (cur !== undefined) {
    const parent = cur.parent as ts.Node | undefined;
    if (
      parent &&
      ts.isBlock(parent) &&
      parent.parent &&
      (ts.isFunctionDeclaration(parent.parent) ||
        ts.isFunctionExpression(parent.parent) ||
        ts.isArrowFunction(parent.parent) ||
        ts.isMethodDeclaration(parent.parent))
    ) {
      // `cur` is the statement-level ancestor inside the function body.
      for (const stmt of parent.statements) {
        if (stmt === cur) break;
        if (isTypeofBrowserUndefinedGuard(stmt)) return true;
      }
      return false;
    }
    cur = parent;
  }
  return false;
};

// Returns the binding name of a function-like node when it is `function fn()`,
// `const fn = () => ...`, `const fn = function() { ... }`, or a method.
// Returns undefined for anonymous arrow/function expressions.
const getFunctionLikeName = (fn: ts.Node): string | undefined => {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) return fn.name.text;
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    const parent = fn.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
  }
  return undefined;
};

// Walks every JSX `on*={...}` attribute in the file and collects the names of
// functions that are wired to those handlers - either directly
// (`<button onClick={fn}>`) or via an inline arrow that calls them
// (`<button onClick={() => fn()}>`). The body of any function with a name in
// this set runs only in response to a user-triggered event, so browser-global
// reads inside it are not hydration risks.
const collectEventHandlerBoundNames = (sourceFile: ts.SourceFile): Set<string> => {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      /^on[A-Z]/.test(node.name.text) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      const expr = node.initializer.expression;
      // Direct identifier: <button onClick={fn}>
      if (ts.isIdentifier(expr)) {
        out.add(expr.text);
      } else {
        // Inline arrow / function expression that calls one or more bound
        // functions: <button onClick={() => fn(arg)}>
        const collectCalls = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
            out.add(n.expression.text);
          }
          ts.forEachChild(n, collectCalls);
        };
        collectCalls(expr);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
};

const isInSafeContext = (
  node: ts.Node,
  eventHandlerBoundNames: Set<string>,
): boolean => {
  // ts.Node.parent is typed as non-nullable in the lib, but at runtime
  // the SourceFile's parent is undefined - hence the explicit cast.
  let current = node.parent as ts.Node | undefined;
  let suppressed = false;
  while (current !== undefined) {
    // Inside a hook callback (useEffect, useMemo, ...)
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isIdentifier(callee) && SAFE_HOOK_NAMES.has(callee.text)) return true;
      if (ts.isPropertyAccessExpression(callee) && SAFE_HOOK_NAMES.has(callee.name.text)) return true;
    }
    // Inside a JSX event-handler attribute value: <button onClick={...}>
    if (ts.isJsxAttribute(current) && ts.isIdentifier(current.name) && /^on[A-Z]/.test(current.name.text)) {
      return true;
    }
    // Inside the body of a function that is itself wired to a JSX event
    // handler somewhere in this file (direct reference or called from an
    // inline-arrow handler). Real-world Client Components routinely declare
    // event handlers at component scope and reference them by name in the
    // JSX, e.g. `<button onClick={toggleTheme}>` or `<button onClick={() =>
    // handleConsent(false)}>`.
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      const name = getFunctionLikeName(current);
      if (name && eventHandlerBoundNames.has(name)) return true;
    }
    // Inside an opening element with suppressHydrationWarning
    const opening =
      ts.isJsxElement(current) ? current.openingElement :
      ts.isJsxSelfClosingElement(current) ? current :
      undefined;
    if (opening) {
      for (const attr of opening.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          ts.isIdentifier(attr.name) &&
          attr.name.text === 'suppressHydrationWarning'
        ) {
          suppressed = true;
        }
      }
    }
    current = current.parent;
  }
  // After a `if (typeof window === 'undefined') return;`-style guard, all subsequent
  // browser-global reads in the same function are gated to the client.
  if (hasTypeofBrowserGuard(node)) return true;
  // Inside the gated branch of a positive-typeof check: `if (typeof X !==
  // 'undefined') { ...read... }`, or the corresponding ternary forms.
  if (isInsidePositiveTypeofBranch(node)) return true;
  return suppressed;
};

type Trigger = {
  match: (node: ts.Node) => boolean;
  message: string;
  detail: string;
  suggestion: string;
};

const TRIGGERS: Trigger[] = [
  {
    match: (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Date' &&
      n.expression.name.text === 'now',
    message: 'Date.now() in render scope',
    detail: 'Server and client wall-clocks differ. The hydrated HTML will mismatch on every render.',
    suggestion: 'Move to useEffect, or render a stable placeholder on the server and update client-side.',
  },
  {
    match: (n) =>
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'Date' &&
      (!n.arguments || n.arguments.length === 0),
    message: 'new Date() with no arguments in render scope',
    detail: 'A no-argument `new Date()` resolves to the current moment - different on server vs client. The hydration string will mismatch.',
    suggestion: 'Pass an explicit timestamp, or initialize in useEffect.',
  },
  {
    match: (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'performance' &&
      n.expression.name.text === 'now',
    message: 'performance.now() in render scope',
    detail: 'performance.now() returns a high-resolution monotonic clock that diverges between server and client.',
    suggestion: 'Move to useEffect.',
  },
  {
    match: (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Math' &&
      n.expression.name.text === 'random',
    message: 'Math.random() in render scope',
    detail: 'Math.random() produces a different value on every call. Server-rendered HTML and client-rendered HTML will not match.',
    suggestion: 'Generate the random value once in useEffect, or pass a deterministic seed via props.',
  },
  {
    match: (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'crypto' &&
      (n.expression.name.text === 'randomUUID' || n.expression.name.text === 'getRandomValues'),
    message: 'crypto random API in render scope',
    detail: 'crypto.randomUUID()/getRandomValues() returns different values per call - server and client will disagree.',
    suggestion: 'Generate in useEffect, or accept the value as a prop from a stable parent.',
  },
];

const LOCALE_METHODS = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);

const matchLocaleMethodNoArgs = (n: ts.Node): boolean =>
  ts.isCallExpression(n) &&
  ts.isPropertyAccessExpression(n.expression) &&
  LOCALE_METHODS.has(n.expression.name.text) &&
  n.arguments.length === 0;

const matchIntlDateTimeNoLocale = (n: ts.Node): boolean =>
  ts.isNewExpression(n) &&
  ts.isPropertyAccessExpression(n.expression) &&
  ts.isIdentifier(n.expression.expression) &&
  n.expression.expression.text === 'Intl' &&
  n.expression.name.text === 'DateTimeFormat' &&
  (!n.arguments || n.arguments.length === 0);

const BROWSER_GLOBALS = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator']);

const matchBrowserGlobalRead = (n: ts.Node): boolean =>
  ts.isPropertyAccessExpression(n) &&
  // Only flag the leftmost-rooted access (avoid double-flagging window.foo.bar)
  !ts.isPropertyAccessExpression(n.parent) &&
  getRootObject(n) !== undefined &&
  BROWSER_GLOBALS.has(getRootObject(n)!);

const getRootIdentifierNode = (expr: ts.Expression): ts.Identifier | undefined => {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  return ts.isIdentifier(cur) ? cur : undefined;
};

// Returns true if the identifier resolves (via the TS symbol table) to a
// declaration in user/project code rather than a built-in global. We use this
// to suppress findings where `document`, `Date`, `navigator`, etc. happen to
// be the name of a function parameter, ORM column, imported binding, or local
// variable - not the browser global of the same name.
const resolvesToLocalDeclaration = (
  ident: ts.Identifier,
  checker: ts.TypeChecker,
): boolean => {
  const sym = checker.getSymbolAtLocation(ident);
  if (!sym?.declarations) return false;
  for (const decl of sym.declarations) {
    if (!decl.getSourceFile().isDeclarationFile) return true;
  }
  return false;
};

// Route handlers under `app/` are server endpoints, not render code. Hydration
// risks don't apply to their bodies even if the file happens to be reachable
// from the client tree via shared utilities.
const isAppRouteHandler = (filePath: string): boolean => {
  const norm = filePath.replace(/\\/g, '/');
  if (!/(^|\/)app\//.test(norm)) return false;
  return /\/route\.(tsx?|jsx?)$/.test(norm);
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;
    // Next.js metadata-convention files (sitemap.ts, robots.ts, manifest.ts,
    // opengraph-image.tsx, etc.) run server-side at build/request time and
    // never hydrate, so render-scope hydration checks don't apply.
    if (isNextMetadataFile(sourceFile)) continue;
    // Route handlers are server endpoints; their bodies execute server-side
    // per request and never hydrate. The new Date() / params.document patterns
    // there are not hydration risks.
    if (isAppRouteHandler(sourceFile.fileName)) continue;
    // Files marked `'use server'` are RPC stubs on the client side; the
    // declared functions execute server-only.
    if (hasDirective(sourceFile, 'use server')) continue;
    // Files the boundary classifier determines are unreachable from any
    // Client Component never hydrate. Hydration-mismatch checks only matter
    // for code that actually runs in the browser.
    const boundary = ctx.boundaryMap.get(sourceFile.fileName);
    if (boundary === 'server') continue;

    const file = rel(sourceFile.fileName);
    const eventHandlerBoundNames = collectEventHandlerBoundNames(sourceFile);

    // Suppress a finding when the root identifier of the offending expression
    // resolves to a project-level declaration (parameter, ORM column,
    // imported binding) rather than a built-in global. This eliminates the
    // false positives where a Drizzle column is named `document`, a tool
    // function takes a `document` parameter, or a wrapper imports `Date`
    // from a custom utility.
    const flagsTheGlobal = (rootExpr: ts.Expression): boolean => {
      const ident = getRootIdentifierNode(rootExpr);
      if (!ident) return true;
      return !resolvesToLocalDeclaration(ident, ctx.checker);
    };

    const inSafe = (node: ts.Node): boolean =>
      isInSafeContext(node, eventHandlerBoundNames);

    const visit = (node: ts.Node): void => {
      // Trigger checks
      for (const t of TRIGGERS) {
        if (!t.match(node) || inSafe(node)) continue;
        const rootExpr =
          ts.isCallExpression(node) ? node.expression :
          ts.isNewExpression(node) ? node.expression :
          undefined;
        if (rootExpr && !flagsTheGlobal(rootExpr)) continue;
        const { line, column } = lineCol(sourceFile, node);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file,
          line,
          column,
          message: t.message,
          detail: t.detail,
          suggestion: t.suggestion,
        });
      }

      if (matchLocaleMethodNoArgs(node) && !inSafe(node)) {
        const { line, column } = lineCol(sourceFile, node);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file,
          line,
          column,
          message: 'Locale-dependent formatter without explicit locale in render scope',
          detail: 'toLocaleString/toLocaleDateString/toLocaleTimeString without a locale argument uses the runtime default - server and client locales differ.',
          suggestion: "Pass an explicit locale: e.g. value.toLocaleDateString('en-US').",
        });
      }

      if (
        matchIntlDateTimeNoLocale(node) &&
        !inSafe(node) &&
        ts.isNewExpression(node) &&
        flagsTheGlobal(node.expression)
      ) {
        const { line, column } = lineCol(sourceFile, node);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file,
          line,
          column,
          message: 'new Intl.DateTimeFormat() without an explicit locale in render scope',
          detail: 'Without a locale, Intl.DateTimeFormat picks the runtime default. Server and client defaults differ.',
          suggestion: "Pass an explicit locale: new Intl.DateTimeFormat('en-US').",
        });
      }

      if (
        matchBrowserGlobalRead(node) &&
        !inSafe(node) &&
        ts.isPropertyAccessExpression(node) &&
        flagsTheGlobal(node)
      ) {
        const root = getRootObject(node);
        const { line, column } = lineCol(sourceFile, node);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file,
          line,
          column,
          message: `Read of browser-only \`${root}\` in render scope`,
          detail: `${root} doesn't exist on the server. The first render will throw, or React will fall back to client-only rendering.`,
          suggestion: `Read ${root} inside useEffect, or guard with typeof ${root} !== 'undefined' AND useEffect.`,
        });
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
    'Detects expressions in render scope that produce different values on server vs client (Date, Math.random, browser globals, locale formatting).',
  severity: SEVERITY,
  run,
};

export default rule;
