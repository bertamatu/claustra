import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'a04-unawaited-params';
const SEVERITY: Severity = 'critical';

const ROUTE_FILE_BASENAMES = new Set([
  'page',
  'layout',
  'route',
  'loading',
  'error',
  'not-found',
  'template',
]);

const HTTP_METHOD_NAMES = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);

const GENERATE_NAMES = new Set([
  'generateMetadata',
  'generateStaticParams',
  'generateViewport',
]);

type ParamName = 'params' | 'searchParams';

const isAppRouteFile = (filePath: string): boolean => {
  const norm = filePath.replace(/\\/g, '/');
  if (!/(^|\/)app\//.test(norm)) return false;
  const m = norm.match(/\/([^/]+)\.(tsx?|jsx?)$/);
  if (!m || !m[1]) return false;
  return ROUTE_FILE_BASENAMES.has(m[1]);
};

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

type TargetFunction = {
  name: string;
  fn: ts.FunctionLikeDeclaration;
};

const collectTargets = (sourceFile: ts.SourceFile): TargetFunction[] => {
  const out: TargetFunction[] = [];

  const resolveLocalIdentifier = (
    identifierName: string,
  ): ts.FunctionLikeDeclaration | undefined => {
    for (const stmt of sourceFile.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === identifierName) {
        return stmt;
      }
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            decl.name.text === identifierName &&
            decl.initializer &&
            (ts.isFunctionExpression(decl.initializer) || ts.isArrowFunction(decl.initializer))
          ) {
            return decl.initializer;
          }
        }
      }
    }
    return undefined;
  };

  for (const stmt of sourceFile.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = stmt.expression;
      if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) {
        out.push({ name: 'default', fn: expr });
      } else if (ts.isIdentifier(expr)) {
        const fn = resolveLocalIdentifier(expr.text);
        if (fn) out.push({ name: 'default', fn });
      }
      continue;
    }

    if (ts.isFunctionDeclaration(stmt)) {
      const isExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const name = stmt.name?.text ?? '';
      if (isExport && isDefault) {
        out.push({ name: 'default', fn: stmt });
      } else if (isExport && (HTTP_METHOD_NAMES.has(name) || GENERATE_NAMES.has(name))) {
        out.push({ name, fn: stmt });
      }
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      const isExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExport) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        if (!HTTP_METHOD_NAMES.has(name) && !GENERATE_NAMES.has(name)) continue;
        if (ts.isFunctionExpression(decl.initializer) || ts.isArrowFunction(decl.initializer)) {
          out.push({ name, fn: decl.initializer });
        }
      }
    }
  }
  return out;
};

type Binding =
  | {
      kind: 'destructured';
      symbol: ts.Symbol;
      name: ParamName;
      decl: ts.BindingElement;
    }
  | {
      kind: 'whole';
      symbol: ts.Symbol;
    };

const collectBindings = (
  fn: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
): Binding[] => {
  const out: Binding[] = [];
  for (const param of fn.parameters) {
    if (ts.isObjectBindingPattern(param.name)) {
      for (const elem of param.name.elements) {
        const keyName = (() => {
          if (elem.propertyName && ts.isIdentifier(elem.propertyName)) {
            return elem.propertyName.text;
          }
          if (ts.isIdentifier(elem.name)) return elem.name.text;
          return undefined;
        })();
        if (keyName !== 'params' && keyName !== 'searchParams') continue;
        if (!ts.isIdentifier(elem.name)) continue;
        const sym = checker.getSymbolAtLocation(elem.name);
        if (!sym) continue;
        out.push({ kind: 'destructured', symbol: sym, name: keyName, decl: elem });
      }
    } else if (ts.isIdentifier(param.name)) {
      const sym = checker.getSymbolAtLocation(param.name);
      if (!sym) continue;
      out.push({ kind: 'whole', symbol: sym });
    }
  }
  return out;
};

type Issue = {
  node: ts.Node;
  bindingName: ParamName;
  reason: 'property-access' | 'destructure-without-await' | 'passed-without-await';
};

const isUseHookCall = (node: ts.Node): boolean => {
  const p = node.parent;
  if (!ts.isCallExpression(p)) return false;
  if (!p.arguments.includes(node as ts.Expression)) return false;
  const callee = p.expression;
  if (ts.isIdentifier(callee) && callee.text === 'use') return true;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.name) &&
    callee.name.text === 'use'
  ) {
    return true;
  }
  return false;
};

const classifyParent = (
  node: ts.Node,
): Issue['reason'] | 'safe' | 'ignore' => {
  const parent = node.parent;
  if (ts.isAwaitExpression(parent) && parent.expression === node) return 'safe';
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return 'property-access';
  if (ts.isElementAccessExpression(parent) && parent.expression === node) return 'property-access';
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    if (ts.isObjectBindingPattern(parent.name) || ts.isArrayBindingPattern(parent.name)) {
      return 'destructure-without-await';
    }
    return 'ignore';
  }
  if (ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression)) {
    if (isUseHookCall(node)) return 'safe';
    return 'passed-without-await';
  }
  if (ts.isSpreadElement(parent)) return 'passed-without-await';
  return 'ignore';
};

const checkBody = (
  fn: ts.FunctionLikeDeclaration,
  bindings: Binding[],
  checker: ts.TypeChecker,
): Issue[] => {
  const results: Issue[] = [];
  const body = fn.body;
  if (!body) return results;

  const destructuredSymbols = new Map<ts.Symbol, ParamName>();
  const wholeSymbols = new Set<ts.Symbol>();
  for (const b of bindings) {
    if (b.kind === 'destructured') destructuredSymbols.set(b.symbol, b.name);
    else wholeSymbols.add(b.symbol);
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      (node.text === 'params' || node.text === 'searchParams') &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
      !ts.isBindingElement(node.parent)
    ) {
      const sym = checker.getSymbolAtLocation(node);
      const matched = sym ? destructuredSymbols.get(sym) : undefined;
      if (matched) {
        const cls = classifyParent(node);
        if (cls !== 'safe' && cls !== 'ignore') {
          const issueNode =
            cls === 'property-access' || cls === 'destructure-without-await'
              ? node.parent
              : node;
          results.push({ node: issueNode, bindingName: matched, reason: cls });
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const objSym = checker.getSymbolAtLocation(node.expression);
      if (objSym && wholeSymbols.has(objSym)) {
        const propName = node.name.text;
        if (propName === 'params' || propName === 'searchParams') {
          const cls = classifyParent(node);
          if (cls !== 'safe' && cls !== 'ignore') {
            const issueNode =
              cls === 'property-access' || cls === 'destructure-without-await'
                ? node.parent
                : node;
            results.push({ node: issueNode, bindingName: propName, reason: cls });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(body);
  return results;
};

const messageFor = (
  bindingName: ParamName,
  reason: Issue['reason'],
): { message: string; detail: string; suggestion: string } => {
  const message = `\`${bindingName}\` is a Promise in Next.js 15+ and must be awaited`;
  let detail: string;
  if (reason === 'property-access') {
    detail = `Accessing a property on the Promise (e.g. \`${bindingName}.x\`) returns \`undefined\` - the property lookup happens on the Promise object, not the resolved value.`;
  } else if (reason === 'destructure-without-await') {
    detail = `Destructuring the Promise (\`const { x } = ${bindingName}\`) does not unwrap it. The Promise has no own enumerable properties, so every destructured name resolves to \`undefined\`.`;
  } else {
    detail = `Passing the Promise to another function defers the bug. The callee receives a Promise, not the resolved value, and the same access shape will fail there.`;
  }
  return {
    message,
    detail,
    suggestion: `Use \`const { x } = await ${bindingName}\` (or \`const resolved = await ${bindingName}\` and access \`resolved.x\`). For sync Client Components, use the \`use(${bindingName})\` hook from React.`,
  };
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];

  const major = Number(ctx.nextVersion.split('.')[0] ?? '0');
  if (Number.isFinite(major) && major > 0 && major < 15) {
    return findings;
  }

  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;
    if (!isAppRouteFile(sourceFile.fileName)) continue;

    const targets = collectTargets(sourceFile);
    for (const { fn } of targets) {
      const bindings = collectBindings(fn, ctx.checker);
      if (bindings.length === 0) continue;
      const issues = checkBody(fn, bindings, ctx.checker);
      for (const issue of issues) {
        const { line, column } = lineCol(sourceFile, issue.node);
        const msg = messageFor(issue.bindingName, issue.reason);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file: rel(sourceFile.fileName),
          line,
          column,
          ...msg,
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
    'In Next.js 15+, `params` and `searchParams` are Promises. Detects direct property access, destructure-without-await, and pass-through without `await`.',
  severity: SEVERITY,
  run,
};

export default rule;
