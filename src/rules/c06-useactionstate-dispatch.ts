import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'c06-useactionstate-dispatch';
const SEVERITY: Severity = 'medium';

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

// Returns the local name(s) bound to `useActionState` from `react`.
const collectUseActionStateLocalNames = (sourceFile: ts.SourceFile): Set<string> => {
  const out = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== 'react') continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const spec of named.elements) {
      const sourceName = spec.propertyName?.text ?? spec.name.text;
      if (sourceName === 'useActionState') out.add(spec.name.text);
    }
  }
  return out;
};

const unwrapAwait = (expr: ts.Expression): ts.Expression =>
  ts.isAwaitExpression(expr) ? unwrapAwait(expr.expression) : expr;

// For each `const [_, dispatch, _] = useActionState(...)` declaration in the
// file, collect the symbol of the dispatcher (the second array-binding
// element). We track symbols so that downstream references resolve correctly
// even when the same name is reused across components.
const collectDispatcherSymbols = (
  sourceFile: ts.SourceFile,
  hookNames: Set<string>,
  checker: ts.TypeChecker,
): Set<ts.Symbol> => {
  const out = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer
    ) {
      const init = unwrapAwait(node.initializer);
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        hookNames.has(init.expression.text)
      ) {
        const elements = node.name.elements;
        if (elements.length >= 2) {
          const second = elements[1];
          if (
            second &&
            ts.isBindingElement(second) &&
            ts.isIdentifier(second.name)
          ) {
            const sym = checker.getSymbolAtLocation(second.name);
            if (sym) out.add(sym);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
};

// Walks up the AST from `node` looking for an enclosing call to
// `startTransition(...)` (either the bare React import or the dispatcher
// returned by `useTransition()`). Returns true if found.
const isInsideStartTransition = (node: ts.Node): boolean => {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (ts.isCallExpression(cur)) {
      const callee = cur.expression;
      if (ts.isIdentifier(callee) && callee.text === 'startTransition') return true;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.name) &&
        callee.name.text === 'startTransition'
      ) {
        return true;
      }
    }
    cur = cur.parent;
  }
  return false;
};

type ReferenceVerdict = 'safe' | 'flag' | 'skip';

const classifyReference = (ref: ts.Identifier): ReferenceVerdict => {
  const parent = ref.parent;

  // Direct call: `dispatch(args)` - flag unless wrapped in startTransition.
  if (ts.isCallExpression(parent) && parent.expression === ref) {
    return isInsideStartTransition(parent) ? 'safe' : 'flag';
  }

  // JSX attribute: `<form action={dispatch}>` / `<button formAction={dispatch}>`.
  // The shorthand `action="..."` does not apply here because dispatcher is a
  // function reference, not a string. The wrapping JsxExpression is the
  // attribute initializer.
  if (
    ts.isJsxExpression(parent) &&
    parent.parent !== undefined &&
    ts.isJsxAttribute(parent.parent) &&
    ts.isIdentifier(parent.parent.name)
  ) {
    const attrName = parent.parent.name.text;
    if (attrName === 'action' || attrName === 'formAction') return 'safe';
    // Pass-through to a non-form attribute: conservative skip - the child
    // component may use it as a `<form action>` itself, which the rule does
    // not chase across the boundary.
    return 'skip';
  }

  // Anything else (variable assignment, return statement, spread into props,
  // etc.) is a pass-through; the actual call site shows up elsewhere.
  return 'skip';
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const hookNames = collectUseActionStateLocalNames(sourceFile);
    if (hookNames.size === 0) continue;

    const dispatcherSymbols = collectDispatcherSymbols(sourceFile, hookNames, ctx.checker);
    if (dispatcherSymbols.size === 0) continue;

    const file = rel(sourceFile.fileName);

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        // Skip the binding declaration itself (it is not a reference).
        const parent = node.parent;
        if (
          (ts.isBindingElement(parent) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node)
        ) {
          ts.forEachChild(node, visit);
          return;
        }
        const sym = ctx.checker.getSymbolAtLocation(node);
        if (sym && dispatcherSymbols.has(sym)) {
          const verdict = classifyReference(node);
          if (verdict === 'flag') {
            const { line, column } = lineCol(sourceFile, node);
            findings.push({
              ruleId: RULE_ID,
              severity: SEVERITY,
              file,
              line,
              column,
              message: '`useActionState` dispatcher called outside `startTransition` and not assigned to `<form action>`',
              detail:
                'The dispatcher returned by `useActionState` must run inside a transition for `isPending` to update correctly. Calling it directly from `onClick`/`onChange`/`useEffect` skips the transition machinery: the action still executes, but `isPending` stays `false`, so spinners and disabled-button UI never reflect the in-flight state.',
              suggestion:
                'Either wrap the call in `startTransition(() => dispatch(...))` (import `startTransition` from `react`, or take the second tuple element from `useTransition()`), or pass the dispatcher directly as `<form action={dispatch}>` / `<button formAction={dispatch}>` so React schedules the transition for you.',
            });
          }
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
    'Flags the dispatcher returned by `useActionState` when called outside `startTransition` and not assigned to a `<form action>` / `formAction` prop. Calling it raw skips the transition; `isPending` never updates.',
  severity: SEVERITY,
  run,
};

export default rule;
