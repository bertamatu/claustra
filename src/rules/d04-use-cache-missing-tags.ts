import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'd04-use-cache-missing-tags';
const SEVERITY: Severity = 'medium';

const NEXT_CACHE_CONFIGURATORS = new Set(['cacheLife', 'cacheTag']);

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

const functionHasOwnUseCache = (fn: FunctionLikeWithBody): boolean => {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  return hasUseCacheDirective(body.statements);
};

const collectNextCacheImports = (sourceFile: ts.SourceFile): Set<string> => {
  const localNames = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== 'next/cache') continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const spec of named.elements) {
      const sourceName = spec.propertyName?.text ?? spec.name.text;
      if (NEXT_CACHE_CONFIGURATORS.has(sourceName)) {
        localNames.add(spec.name.text);
      }
    }
  }
  return localNames;
};

const bodyCallsConfigurator = (
  fn: FunctionLikeWithBody,
  configuratorNames: Set<string>,
): boolean => {
  if (!fn.body) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (configuratorNames.has(node.expression.text)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return found;
};

type CachedTopLevelFn = {
  fn: FunctionLikeWithBody;
  nameNode: ts.Node;
  displayName: string;
};

const collectTopLevelFunctions = (sourceFile: ts.SourceFile): CachedTopLevelFn[] => {
  const out: CachedTopLevelFn[] = [];
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      const nameNode = stmt.name ?? stmt;
      const displayName = stmt.name?.text ?? '<anonymous>';
      out.push({ fn: stmt, nameNode, displayName });
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (
          ts.isFunctionExpression(decl.initializer) ||
          ts.isArrowFunction(decl.initializer)
        ) {
          out.push({
            fn: decl.initializer,
            nameNode: decl.name,
            displayName: decl.name.text,
          });
        }
      }
    }
  }
  return out;
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
    const configuratorNames = collectNextCacheImports(sourceFile);
    const file = rel(sourceFile.fileName);

    type CachedScope = {
      fn: FunctionLikeWithBody;
      nameNode: ts.Node;
      displayName: string;
      reason: 'file-level' | 'function-level';
    };
    const cachedScopes: CachedScope[] = [];

    if (fileLevelCached) {
      for (const top of collectTopLevelFunctions(sourceFile)) {
        cachedScopes.push({ ...top, reason: 'file-level' });
      }
    } else {
      const visit = (node: ts.Node): void => {
        if (isFunctionLikeWithBody(node) && functionHasOwnUseCache(node)) {
          let nameNode: ts.Node = node;
          let displayName = '<anonymous>';
          if (ts.isFunctionDeclaration(node) && node.name) {
            nameNode = node.name;
            displayName = node.name.text;
          } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
            nameNode = node.name;
            displayName = node.name.text;
          } else if (
            ts.isVariableDeclaration(node.parent) &&
            ts.isIdentifier(node.parent.name)
          ) {
            nameNode = node.parent.name;
            displayName = node.parent.name.text;
          }
          cachedScopes.push({ fn: node, nameNode, displayName, reason: 'function-level' });
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    for (const scope of cachedScopes) {
      if (bodyCallsConfigurator(scope.fn, configuratorNames)) continue;

      const { line, column } = lineCol(sourceFile, scope.nameNode);
      const directiveDescriptor =
        scope.reason === 'file-level'
          ? "Function in a file marked `'use cache'`"
          : "Function marked `'use cache'`";
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: `${directiveDescriptor} \`${scope.displayName}\` has neither \`cacheLife()\` nor \`cacheTag()\` configured`,
        detail:
          'Without an explicit `cacheLife()` (lifetime) or `cacheTag()` (invalidation key), the cache falls back to framework defaults that may not match your intent. Behavior is implicit and changes between Next.js minor versions; teammates have no way to read the cache contract from the function itself.',
        suggestion: `Add \`cacheLife('hours')\` (or your project's own profile) to make the lifetime explicit, and/or \`cacheTag('${scope.displayName}')\` so you can invalidate this cache from a Server Action via \`revalidateTag\`. Both are imported from \`next/cache\`.`,
      });
    }
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Warns when a `\'use cache\'` function has neither `cacheLife()` nor `cacheTag()` configured, leaving its lifetime and invalidation behavior implicit.',
  severity: SEVERITY,
  run,
};

export default rule;
