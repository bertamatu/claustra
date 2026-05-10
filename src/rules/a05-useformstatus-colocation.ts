import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'a05-useformstatus-colocation';
const SEVERITY: Severity = 'medium';

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

// Returns the local name(s) bound to `useFormStatus` from `react-dom`.
// Honors `import { useFormStatus }`, `import { useFormStatus as us }`, etc.
const collectUseFormStatusLocalNames = (sourceFile: ts.SourceFile): Set<string> => {
  const out = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== 'react-dom') continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const spec of named.elements) {
      const sourceName = spec.propertyName?.text ?? spec.name.text;
      if (sourceName === 'useFormStatus') out.add(spec.name.text);
    }
  }
  return out;
};

type FunctionLikeWithBody =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

const isFunctionLikeWithBody = (node: ts.Node): node is FunctionLikeWithBody =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

type ComponentScan = {
  hookCalls: ts.CallExpression[];
  formElements: ts.JsxOpeningLikeElement[];
};

// Walk a function body and collect `useFormStatus()` calls and `<form>` JSX
// elements at the SAME scope - i.e. inside the function but not crossing into
// any nested function-like node. A child component defined or rendered inline
// gets its own scan, so a form in the parent and a hook in the child never
// match each other.
const scanComponentBody = (
  fn: FunctionLikeWithBody,
  hookNames: Set<string>,
): ComponentScan => {
  const hookCalls: ts.CallExpression[] = [];
  const formElements: ts.JsxOpeningLikeElement[] = [];
  const body = fn.body;
  if (!body) return { hookCalls, formElements };

  const visit = (node: ts.Node): void => {
    if (node !== body && isFunctionLikeWithBody(node)) return;

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      hookNames.has(node.expression.text)
    ) {
      hookCalls.push(node);
    }

    let opening: ts.JsxOpeningLikeElement | undefined;
    if (ts.isJsxElement(node)) opening = node.openingElement;
    else if (ts.isJsxSelfClosingElement(node)) opening = node;
    if (
      opening &&
      ts.isIdentifier(opening.tagName) &&
      opening.tagName.text === 'form'
    ) {
      formElements.push(opening);
    }

    ts.forEachChild(node, visit);
  };
  visit(body);
  return { hookCalls, formElements };
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const hookNames = collectUseFormStatusLocalNames(sourceFile);
    if (hookNames.size === 0) continue;

    const file = rel(sourceFile.fileName);

    const visitForFns = (node: ts.Node): void => {
      if (isFunctionLikeWithBody(node)) {
        const scan = scanComponentBody(node, hookNames);
        if (scan.hookCalls.length > 0 && scan.formElements.length > 0) {
          for (const call of scan.hookCalls) {
            const { line, column } = lineCol(sourceFile, call);
            findings.push({
              ruleId: RULE_ID,
              severity: SEVERITY,
              file,
              line,
              column,
              message: '`useFormStatus()` called in the same component as a `<form>` element',
              detail:
                '`useFormStatus` reads pending/data/method/action from the *parent* `<form>` element. When the hook and the form live in the same component, the hook has no parent form to read from in this scope - it returns `pending: false` permanently and the submit button never reflects the in-flight state.',
              suggestion:
                'Extract the component that calls `useFormStatus()` (typically a submit button) into its own component, render it as a child of the `<form>`, and import it back. The hook then reads the form state from the now-outer `<form>` boundary.',
            });
          }
        }
        // Continue descending so nested functions get their own scan.
      }
      ts.forEachChild(node, visitForFns);
    };
    visitForFns(sourceFile);
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Flags components that call `useFormStatus()` from `react-dom` while also rendering a `<form>` element in the same scope. The hook reads from a parent `<form>`, so co-locating it with the form makes it return `pending: false` permanently.',
  severity: SEVERITY,
  run,
};

export default rule;
