import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'd03-use-cache-request-scoped';
const SEVERITY: Severity = 'critical';

const NEXT_HEADERS_REQUEST_SCOPED = new Set(['cookies', 'headers', 'draftMode']);

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

const REQUEST_PROPS = new Set(['headers', 'cookies', 'url', 'nextUrl']);
const REQUEST_PARAM_NAMES = new Set(['request', 'req']);

type UnsafeKind = 'next-headers' | 'auth-helper' | 'request-prop';

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const hasUseCacheDirective = (statements: readonly ts.Statement[]): boolean => {
  for (const stmt of statements) {
    if (!ts.isExpressionStatement(stmt)) return false;
    if (!ts.isStringLiteral(stmt.expression)) return false;
    if (stmt.expression.text === 'use cache') return true;
  }
  return false;
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

const functionHasUseCache = (fn: FunctionLikeWithBody): boolean => {
  const body = fn.body;
  if (!body) return false;
  if (!ts.isBlock(body)) return false;
  return hasUseCacheDirective(body.statements);
};

const collectNextHeadersImports = (sourceFile: ts.SourceFile): Set<string> => {
  const localNames = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== 'next/headers') continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const spec of named.elements) {
      const sourceName = spec.propertyName?.text ?? spec.name.text;
      if (NEXT_HEADERS_REQUEST_SCOPED.has(sourceName)) {
        localNames.add(spec.name.text);
      }
    }
  }
  return localNames;
};

const collectRequestParamSymbols = (
  fn: FunctionLikeWithBody,
  checker: ts.TypeChecker,
): Set<ts.Symbol> => {
  const out = new Set<ts.Symbol>();
  for (const param of fn.parameters) {
    if (!ts.isIdentifier(param.name)) continue;
    if (!REQUEST_PARAM_NAMES.has(param.name.text)) continue;
    const sym = checker.getSymbolAtLocation(param.name);
    if (sym) out.add(sym);
  }
  return out;
};

type Issue = {
  node: ts.Node;
  kind: UnsafeKind;
  label: string;
};

const classifyCall = (
  node: ts.CallExpression,
  nextHeadersImports: Set<string>,
): Issue | undefined => {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    if (nextHeadersImports.has(callee.text)) {
      return { node, kind: 'next-headers', label: `${callee.text}()` };
    }
    if (KNOWN_AUTH_NAMES.has(callee.text) || AUTH_NAME_PATTERN.test(callee.text)) {
      return { node, kind: 'auth-helper', label: `${callee.text}()` };
    }
  } else if (ts.isPropertyAccessExpression(callee)) {
    const name = callee.name.text;
    if (KNOWN_AUTH_NAMES.has(name) || AUTH_NAME_PATTERN.test(name)) {
      return { node, kind: 'auth-helper', label: `${callee.getText()}()` };
    }
  }
  return undefined;
};

const classifyPropertyAccess = (
  node: ts.PropertyAccessExpression,
  requestParamSymbols: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): Issue | undefined => {
  if (!ts.isIdentifier(node.expression)) return undefined;
  if (!REQUEST_PROPS.has(node.name.text)) return undefined;
  const sym = checker.getSymbolAtLocation(node.expression);
  if (!sym || !requestParamSymbols.has(sym)) return undefined;
  return {
    node,
    kind: 'request-prop',
    label: `${node.expression.text}.${node.name.text}`,
  };
};

const messageFor = (issue: Issue): { message: string; detail: string; suggestion: string } => {
  if (issue.kind === 'next-headers') {
    return {
      message: `\`${issue.label}\` reads request-scoped data inside a \`'use cache'\` function`,
      detail:
        'Functions marked `\'use cache\'` are cached and shared across requests. Reading cookies, headers, or draftMode inside the cached scope either errors at runtime or, worse, leaks one user\'s session into another user\'s cached output.',
      suggestion:
        'Read the request-scoped value in the caller and pass it in as an argument so it becomes part of the cache key.',
    };
  }
  if (issue.kind === 'auth-helper') {
    return {
      message: `Auth helper \`${issue.label}\` called inside a \`'use cache'\` function`,
      detail:
        'Auth helpers (next-auth `auth()`, Clerk `currentUser()`, Lucia `validateRequest()`, custom `verify*`/`require*`-style guards) read the current request\'s session. Calling one inside a cached function poisons the cache with one user\'s identity, then serves it to every other user that hits the same cache entry.',
      suggestion:
        'Resolve the auth state in the caller (Server Action, Route Handler, or non-cached Server Component) and pass the user id / role into the cached function as an argument.',
    };
  }
  return {
    message: `Request parameter property \`${issue.label}\` accessed inside a \`'use cache'\` function`,
    detail:
      'A `Request` object is per-request and cannot meaningfully be a cache input. Reading `.headers` / `.cookies` / `.url` / `.nextUrl` inside the cached scope makes the result depend on values the cache key does not know about.',
    suggestion:
      'Extract the specific value you need (`request.headers.get(\'x-region\')`, `new URL(request.url).pathname`, etc.) before calling the cached function, and pass that primitive as an argument.',
  };
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];

  const major = Number(ctx.nextVersion.split('.')[0] ?? '0');
  if (Number.isFinite(major) && major > 0 && major < 16) {
    return findings;
  }

  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const fileLevelCached = hasUseCacheDirective(sourceFile.statements);
    const nextHeadersImports = collectNextHeadersImports(sourceFile);
    const file = rel(sourceFile.fileName);

    const issues: Issue[] = [];

    const visit = (
      node: ts.Node,
      cached: boolean,
      requestParamSymbols: Set<ts.Symbol>,
    ): void => {
      if (isFunctionLikeWithBody(node)) {
        const enteringCache = cached || functionHasUseCache(node);
        const newRequestSymbols = enteringCache
          ? new Set<ts.Symbol>([
              ...requestParamSymbols,
              ...collectRequestParamSymbols(node, ctx.checker),
            ])
          : requestParamSymbols;
        if (node.body) visit(node.body, enteringCache, newRequestSymbols);
        return;
      }

      if (cached) {
        if (ts.isCallExpression(node)) {
          const issue = classifyCall(node, nextHeadersImports);
          if (issue) issues.push(issue);
        } else if (ts.isPropertyAccessExpression(node)) {
          const issue = classifyPropertyAccess(node, requestParamSymbols, ctx.checker);
          if (issue) issues.push(issue);
        }
      }

      ts.forEachChild(node, (child) => {
        visit(child, cached, requestParamSymbols);
      });
    };

    visit(sourceFile, fileLevelCached, new Set());

    for (const issue of issues) {
      const { line, column } = lineCol(sourceFile, issue.node);
      const msg = messageFor(issue);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        ...msg,
      });
    }
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'In Next.js 16, functions marked with the `\'use cache\'` directive are cached and shared across requests. This rule flags reads of request-scoped data (cookies, headers, draftMode, auth helpers, request-param properties) inside the cached scope.',
  severity: SEVERITY,
  run,
};

export default rule;
