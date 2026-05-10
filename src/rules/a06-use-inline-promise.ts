import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'a06-use-inline-promise';
const SEVERITY: Severity = 'high';

const STABLE_WRAPPERS = new Set(['useMemo', 'cache']);

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

// Returns the local name(s) bound to `use` from `react`.
const collectUseLocalNames = (sourceFile: ts.SourceFile): Set<string> => {
  const out = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== 'react') continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const spec of named.elements) {
      const sourceName = spec.propertyName?.text ?? spec.name.text;
      if (sourceName === 'use') out.add(spec.name.text);
    }
  }
  return out;
};

const unwrapParens = (expr: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(expr) ? unwrapParens(expr.expression) : expr;

const isStableWrapperCall = (call: ts.CallExpression): boolean => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return STABLE_WRAPPERS.has(callee.text);
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
    return STABLE_WRAPPERS.has(callee.name.text);
  }
  return false;
};

const isImmediatelyInvokedFunction = (call: ts.CallExpression): boolean => {
  const callee = unwrapParens(call.expression);
  return ts.isArrowFunction(callee) || ts.isFunctionExpression(callee);
};

type Verdict =
  | { kind: 'safe' }
  | { kind: 'inline'; reason: 'fetch' | 'new-promise' | 'iife' | 'promise-static' | 'inline-call' }
  | { kind: 'unstable-local' }
  | { kind: 'unknown' };

const PROMISE_STATIC_METHODS = new Set(['resolve', 'reject', 'all', 'race', 'any', 'allSettled']);

const classifyArgument = (
  argRaw: ts.Expression,
  ctx: ProjectContext,
): Verdict => {
  const arg = unwrapParens(argRaw);

  // Inline `new Promise(...)`
  if (ts.isNewExpression(arg)) {
    if (ts.isIdentifier(arg.expression) && arg.expression.text === 'Promise') {
      return { kind: 'inline', reason: 'new-promise' };
    }
    return { kind: 'inline', reason: 'inline-call' };
  }

  // Inline call expression: fetch(...), Promise.resolve(...), (async () => ...)(), foo()
  if (ts.isCallExpression(arg)) {
    if (isImmediatelyInvokedFunction(arg)) {
      return { kind: 'inline', reason: 'iife' };
    }
    if (isStableWrapperCall(arg)) {
      return { kind: 'safe' };
    }
    const callee = arg.expression;
    if (ts.isIdentifier(callee) && callee.text === 'fetch') {
      return { kind: 'inline', reason: 'fetch' };
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'Promise' &&
      ts.isIdentifier(callee.name) &&
      PROMISE_STATIC_METHODS.has(callee.name.text)
    ) {
      return { kind: 'inline', reason: 'promise-static' };
    }
    return { kind: 'inline', reason: 'inline-call' };
  }

  // Identifier - resolve via the symbol table
  if (ts.isIdentifier(arg)) {
    const sym = ctx.checker.getSymbolAtLocation(arg);
    if (!sym?.declarations) return { kind: 'unknown' };
    for (const decl of sym.declarations) {
      if (ts.isParameter(decl)) return { kind: 'safe' };
      if (ts.isBindingElement(decl)) {
        // Walk up to a parameter pattern (destructured prop)
        let cur: ts.Node = decl;
        while (cur.parent !== undefined) {
          if (ts.isParameter(cur.parent)) return { kind: 'safe' };
          if (ts.isVariableDeclaration(cur.parent)) break;
          cur = cur.parent;
        }
      }
      if (ts.isVariableDeclaration(decl)) {
        // Module scope?
        let ancestor: ts.Node = decl;
        let insideFunction = false;
        while (ancestor.parent !== undefined) {
          ancestor = ancestor.parent;
          if (ts.isSourceFile(ancestor)) {
            if (!insideFunction) return { kind: 'safe' };
            // Inside a function body. The local is stable only if its
            // initializer is `useMemo(...)` / `cache(...)` (or a memoizing
            // wrapper of the same shape).
            if (decl.initializer) {
              const init = unwrapParens(decl.initializer);
              if (ts.isCallExpression(init) && isStableWrapperCall(init)) {
                return { kind: 'safe' };
              }
            }
            return { kind: 'unstable-local' };
          }
          if (
            ts.isFunctionDeclaration(ancestor) ||
            ts.isFunctionExpression(ancestor) ||
            ts.isArrowFunction(ancestor) ||
            ts.isMethodDeclaration(ancestor)
          ) {
            insideFunction = true;
          }
        }
        return { kind: 'unknown' };
      }
      if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl)) {
        return { kind: 'safe' };
      }
    }
    return { kind: 'unknown' };
  }

  // Property access: `props.foo` / `ctx.value` - safe (came from outside the function)
  if (ts.isPropertyAccessExpression(arg)) {
    let cur: ts.Expression = arg;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    if (ts.isIdentifier(cur)) {
      const sym = ctx.checker.getSymbolAtLocation(cur);
      if (sym?.declarations?.some((d) => ts.isParameter(d))) return { kind: 'safe' };
    }
    return { kind: 'unknown' };
  }

  return { kind: 'unknown' };
};

const messageFor = (
  verdict: Extract<Verdict, { kind: 'inline' } | { kind: 'unstable-local' }>,
): { message: string; detail: string; suggestion: string } => {
  if (verdict.kind === 'unstable-local') {
    return {
      message: '`use()` called with a Promise declared inside the component body',
      detail:
        'Each render creates a new local variable, so the Promise reference passed to `use()` changes every time the component renders. React treats the changed reference as a new pending value and suspends again - producing infinite suspension and an unmounted/unmountable tree.',
      suggestion:
        'Hoist the Promise to module scope, wrap its creation in `useMemo(() => createPromise(), [stableDeps])`, or use React\'s `cache()` for server-side memoization. The Promise reference must be stable across renders.',
    };
  }
  const detailByReason: Record<typeof verdict.reason, string> = {
    fetch:
      'Each render evaluates `fetch(...)` afresh, returning a new Promise every time. `use()` sees a different reference on every render and suspends again, never resolving.',
    'new-promise':
      'Each render constructs a new Promise via `new Promise(...)`. `use()` cannot deduplicate the reference, so suspension never completes.',
    iife:
      'Each render invokes the inline async function and produces a new Promise. `use()` cannot deduplicate the reference, so suspension never completes.',
    'promise-static':
      'Even degenerate cases like `use(Promise.resolve(x))` create a new Promise per render. `use()` requires a stable reference - this pattern still produces infinite suspension.',
    'inline-call':
      'Each render invokes the call expression and (likely) produces a new Promise. `use()` requires a stable reference across renders to resolve cleanly.',
  };
  return {
    message: '`use()` called with an inline-created Promise',
    detail: detailByReason[verdict.reason],
    suggestion:
      'Hoist the Promise to module scope, wrap its creation in `useMemo(() => createPromise(), [stableDeps])`, or pass the Promise in as a prop from a stable parent. The Promise reference must be stable across renders.',
  };
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const useNames = collectUseLocalNames(sourceFile);
    if (useNames.size === 0) continue;

    const file = rel(sourceFile.fileName);

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        useNames.has(node.expression.text) &&
        node.arguments.length >= 1
      ) {
        const verdict = classifyArgument(node.arguments[0]!, ctx);
        if (verdict.kind === 'inline' || verdict.kind === 'unstable-local') {
          const { line, column } = lineCol(sourceFile, node);
          const m = messageFor(verdict);
          findings.push({
            ruleId: RULE_ID,
            severity: SEVERITY,
            file,
            line,
            column,
            ...m,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Flags `use()` from `react` called with a Promise that is created inline in render scope or held in a per-render local variable. The Promise reference must be stable across renders or React suspends infinitely.',
  severity: SEVERITY,
  run,
};

export default rule;
