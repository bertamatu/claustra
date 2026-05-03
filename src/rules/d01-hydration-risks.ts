import path from 'node:path';
import ts from 'typescript';
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
  // We treat them as safe here to avoid false positives — hydration-mismatch tooling can revisit.
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

const isInSafeContext = (node: ts.Node): boolean => {
  // ts.Node.parent is typed as non-nullable in the lib, but at runtime
  // the SourceFile's parent is undefined — hence the explicit cast.
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
    detail: 'A no-argument `new Date()` resolves to the current moment — different on server vs client. The hydration string will mismatch.',
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
    detail: 'crypto.randomUUID()/getRandomValues() returns different values per call — server and client will disagree.',
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

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const file = rel(sourceFile.fileName);

    const visit = (node: ts.Node): void => {
      // Trigger checks
      for (const t of TRIGGERS) {
        if (t.match(node) && !isInSafeContext(node)) {
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
      }

      if (matchLocaleMethodNoArgs(node) && !isInSafeContext(node)) {
        const { line, column } = lineCol(sourceFile, node);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file,
          line,
          column,
          message: 'Locale-dependent formatter without explicit locale in render scope',
          detail: 'toLocaleString/toLocaleDateString/toLocaleTimeString without a locale argument uses the runtime default — server and client locales differ.',
          suggestion: "Pass an explicit locale: e.g. value.toLocaleDateString('en-US').",
        });
      }

      if (matchIntlDateTimeNoLocale(node) && !isInSafeContext(node)) {
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

      if (matchBrowserGlobalRead(node) && !isInSafeContext(node)) {
        const root = getRootObject(node as ts.PropertyAccessExpression);
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
  needsLlm: false,
  run,
};

export default rule;
