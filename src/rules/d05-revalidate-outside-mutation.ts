import path from 'node:path';
import ts from 'typescript';
import { hasDirective } from '../utils/ast.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'd05-revalidate-outside-mutation';
const SEVERITY: Severity = 'high';

const REVALIDATION_NAMES = new Set(['revalidateTag', 'updateTag', 'revalidatePath']);

const HTTP_METHOD_NAMES = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);

const RENDER_BASENAMES = new Set([
  'page',
  'layout',
  'template',
  'loading',
  'error',
  'not-found',
]);

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const fileBasename = (filePath: string): string => {
  const m = filePath.replace(/\\/g, '/').match(/\/([^/]+)\.(tsx?|jsx?)$/);
  return m?.[1] ?? '';
};

const isRouteFile = (filePath: string): boolean => {
  if (fileBasename(filePath) !== 'route') return false;
  return /(^|\/)app\//.test(filePath.replace(/\\/g, '/'));
};

const isRenderFile = (filePath: string): boolean => {
  if (!RENDER_BASENAMES.has(fileBasename(filePath))) return false;
  return /(^|\/)app\//.test(filePath.replace(/\\/g, '/'));
};

const collectRevalidateImports = (sourceFile: ts.SourceFile): Set<string> => {
  const localNames = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== 'next/cache') continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const spec of named.elements) {
      const sourceName = spec.propertyName?.text ?? spec.name.text;
      if (REVALIDATION_NAMES.has(sourceName)) {
        localNames.add(spec.name.text);
      }
    }
  }
  return localNames;
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

const directiveAtBodyTop = (
  fn: FunctionLikeWithBody,
  directive: 'use server' | 'use cache',
): boolean => {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  for (const stmt of body.statements) {
    if (!ts.isExpressionStatement(stmt)) return false;
    if (!ts.isStringLiteral(stmt.expression)) return false;
    if (stmt.expression.text === directive) return true;
  }
  return false;
};

const isHttpMethodExport = (node: FunctionLikeWithBody): boolean => {
  if (ts.isFunctionDeclaration(node)) {
    const name = node.name?.text;
    if (!name || !HTTP_METHOD_NAMES.has(name)) return false;
    const mods = ts.getModifiers(node);
    return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const decl = node.parent;
    if (!ts.isVariableDeclaration(decl)) return false;
    if (!ts.isIdentifier(decl.name)) return false;
    if (!HTTP_METHOD_NAMES.has(decl.name.text)) return false;
    const stmt = decl.parent.parent;
    if (!ts.isVariableStatement(stmt)) return false;
    return stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
  return false;
};

type Context = {
  inUseCache: boolean;
  inUseServer: boolean;
  inRouteHandler: boolean;
};

type Reason =
  | 'use-cache-contradiction'
  | 'client-throws'
  | 'render-path-noop';

const decideReason = (
  ctx: Context,
  fileLevelUseServer: boolean,
  fileIsClient: boolean,
  fileIsRender: boolean,
): Reason | undefined => {
  if (ctx.inUseCache) return 'use-cache-contradiction';
  if (ctx.inUseServer || ctx.inRouteHandler || fileLevelUseServer) return undefined;
  if (fileIsClient) return 'client-throws';
  if (fileIsRender) return 'render-path-noop';
  return undefined;
};

const messageFor = (
  reason: Reason,
  calleeName: string,
): { message: string; detail: string; suggestion: string } => {
  if (reason === 'use-cache-contradiction') {
    return {
      message: `\`${calleeName}()\` called inside a \`'use cache'\` function`,
      detail:
        'A cached function invalidating its own cache (or any cache) is contradictory. The function output has already been memoized; calling `revalidateTag` here either no-ops against the wrong cache layer or fights its own caching strategy.',
      suggestion: `Move \`${calleeName}\` out of the cached function. The Server Action or Route Handler that performs the data mutation is the only correct invalidation site.`,
    };
  }
  if (reason === 'client-throws') {
    return {
      message: `\`${calleeName}()\` called from a Client Component`,
      detail:
        'Cache-invalidation functions from `next/cache` only work in server contexts (Server Actions or Route Handlers). Calling them in a `\'use client\'` file throws at runtime — `next/cache` is server-only and the import itself is rejected by the bundler in many configurations.',
      suggestion: `Wrap the mutation in a Server Action (\`'use server'\` file or function) and call \`${calleeName}\` from there. The Client Component invokes the action; the action handles invalidation server-side.`,
    };
  }
  return {
    message: `\`${calleeName}()\` called during a Server Component render`,
    detail:
      'Calling a cache-invalidation function during render either no-ops or invalidates a cache mid-render, producing inconsistent output. Render paths are read paths — they should not mutate cache state.',
    suggestion: `Move \`${calleeName}\` to the Server Action, Route Handler, or webhook that performs the data write. Render the result of that mutation; do not invalidate during render.`,
  };
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const revalidateImports = collectRevalidateImports(sourceFile);
    if (revalidateImports.size === 0) continue;

    const fileLevelUseServer = hasDirective(sourceFile, 'use server');
    const fileIsClient = hasDirective(sourceFile, 'use client');
    const fileIsRender = isRenderFile(sourceFile.fileName);
    const fileIsRoute = isRouteFile(sourceFile.fileName);
    const file = rel(sourceFile.fileName);

    const visit = (node: ts.Node, currentCtx: Context): void => {
      if (isFunctionLikeWithBody(node)) {
        const newCtx: Context = {
          inUseCache: currentCtx.inUseCache || directiveAtBodyTop(node, 'use cache'),
          inUseServer: currentCtx.inUseServer || directiveAtBodyTop(node, 'use server'),
          inRouteHandler:
            currentCtx.inRouteHandler || (fileIsRoute && isHttpMethodExport(node)),
        };
        if (node.body) visit(node.body, newCtx);
        return;
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        revalidateImports.has(node.expression.text)
      ) {
        const reason = decideReason(currentCtx, fileLevelUseServer, fileIsClient, fileIsRender);
        if (reason) {
          const { line, column } = lineCol(sourceFile, node);
          const msg = messageFor(reason, node.expression.text);
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

      ts.forEachChild(node, (child) => {
        visit(child, currentCtx);
      });
    };

    visit(sourceFile, { inUseCache: false, inUseServer: false, inRouteHandler: false });
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Flags `revalidateTag` / `updateTag` / `revalidatePath` calls in contexts where they throw or no-op: Client Components, `\'use cache\'` functions, and Server Component render paths.',
  severity: SEVERITY,
  run,
};

export default rule;
