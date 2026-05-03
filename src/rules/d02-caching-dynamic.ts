import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'd02-caching-dynamic';
const SEVERITY: Severity = 'medium';

const DYNAMIC_FORCING_NAMES = new Set([
  'cookies',
  'headers',
  'draftMode',
  'noStore',
  'unstable_noStore',
]);

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const isRouteFile = (filePath: string): boolean => {
  const norm = filePath.replace(/\\/g, '/');
  return /\/app\/.*\/(page|layout|route)\.(tsx?|jsx?)$/.test(norm) ||
    /\/app\/(page|layout|route)\.(tsx?|jsx?)$/.test(norm);
};

type RouteIntent =
  | { kind: 'force-static' }
  | { kind: 'force-dynamic' }
  | { kind: 'auto' }
  | { kind: 'revalidate'; seconds: number }
  | { kind: 'none' };

const readRouteIntent = (sourceFile: ts.SourceFile): RouteIntent => {
  let intent: RouteIntent = { kind: 'none' };
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      if (decl.name.text === 'dynamic' && ts.isStringLiteral(decl.initializer)) {
        if (decl.initializer.text === 'force-static') intent = { kind: 'force-static' };
        else if (decl.initializer.text === 'force-dynamic') intent = { kind: 'force-dynamic' };
        else intent = { kind: 'auto' };
      } else if (decl.name.text === 'revalidate' && ts.isNumericLiteral(decl.initializer)) {
        intent = { kind: 'revalidate', seconds: Number(decl.initializer.text) };
      }
    }
  }
  return intent;
};

const findDynamicForcingImports = (
  sourceFile: ts.SourceFile,
): { name: string; node: ts.Node }[] => {
  const out: { name: string; node: ts.Node }[] = [];
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const mod = stmt.moduleSpecifier.text;
    if (mod !== 'next/headers' && mod !== 'next/cache') continue;
    const named = stmt.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const spec of named.elements) {
      const name = spec.propertyName?.text ?? spec.name.text;
      if (DYNAMIC_FORCING_NAMES.has(name)) {
        out.push({ name, node: spec });
      }
    }
  }
  return out;
};

type FetchOptions = {
  cache?: 'force-cache' | 'no-store' | 'other';
  revalidate?: number;
};

const readFetchOptions = (call: ts.CallExpression): FetchOptions | undefined => {
  if (call.arguments.length < 2) return undefined;
  const opts = call.arguments[1];
  if (!opts || !ts.isObjectLiteralExpression(opts)) return undefined;

  const out: FetchOptions = {};
  for (const prop of opts.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === 'cache' && ts.isStringLiteral(prop.initializer)) {
      const v = prop.initializer.text;
      out.cache = v === 'force-cache' || v === 'no-store' ? v : 'other';
    } else if (prop.name.text === 'next' && ts.isObjectLiteralExpression(prop.initializer)) {
      for (const nProp of prop.initializer.properties) {
        if (
          ts.isPropertyAssignment(nProp) &&
          ts.isIdentifier(nProp.name) &&
          nProp.name.text === 'revalidate' &&
          ts.isNumericLiteral(nProp.initializer)
        ) {
          out.revalidate = Number(nProp.initializer.text);
        }
      }
    }
  }
  return out;
};

const isLocalhostUrl = (call: ts.CallExpression): boolean => {
  const arg = call.arguments[0];
  if (!arg || !ts.isStringLiteral(arg)) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)/.test(arg.text);
};

const isFetchCall = (call: ts.CallExpression): boolean =>
  ts.isIdentifier(call.expression) && call.expression.text === 'fetch';

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const file = rel(sourceFile.fileName);
    const isRoute = isRouteFile(sourceFile.fileName);
    const intent = isRoute ? readRouteIntent(sourceFile) : { kind: 'none' as const };

    // Route-level: dynamic-forcing imports vs declared intent
    if (isRoute) {
      const dynamicImports = findDynamicForcingImports(sourceFile);
      for (const { name, node } of dynamicImports) {
        if (intent.kind === 'force-static') {
          const { line, column } = lineCol(sourceFile, node);
          findings.push({
            ruleId: RULE_ID,
            severity: 'high',
            file,
            line,
            column,
            message: `Dynamic-forcing API "${name}" used in a route declared as force-static`,
            detail: `This route exports \`dynamic = 'force-static'\`, but ${name}() opts the route out of the Full Route Cache. Next.js will throw at build time.`,
            suggestion: `Either remove the \`dynamic = 'force-static'\` export, or remove the use of ${name}() and source the data without it.`,
          });
        } else if (intent.kind === 'revalidate') {
          const { line, column } = lineCol(sourceFile, node);
          findings.push({
            ruleId: RULE_ID,
            severity: SEVERITY,
            file,
            line,
            column,
            message: `Dynamic-forcing API "${name}" used in a route declared with \`revalidate = ${String(intent.seconds)}\``,
            detail: `${name}() forces dynamic rendering, silently overriding the ISR \`revalidate\` declaration. Every request renders fresh; the revalidate value is dead code.`,
            suggestion: `Either remove the \`revalidate\` export and accept dynamic rendering, or move the ${name}() call into a Suspense-boundary child component so the outer route can still ISR.`,
          });
        }
      }
    }

    // fetch()-level checks (apply everywhere, but most meaningful in routes)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isFetchCall(node)) {
        if (isLocalhostUrl(node)) {
          const { line, column } = lineCol(sourceFile, node);
          findings.push({
            ruleId: RULE_ID,
            severity: SEVERITY,
            file,
            line,
            column,
            message: 'fetch() to localhost / 127.0.0.1',
            detail: 'Localhost URLs are an anti-pattern in deployed code — they will fail in production. If this is meant to be a relative call to your own app, use a relative URL or env-driven base URL.',
            suggestion: 'Replace with a relative path (e.g., `/api/x`) or `process.env.NEXT_PUBLIC_API_URL`.',
          });
        }

        const opts = readFetchOptions(node);
        if (opts && intent.kind === 'revalidate' && opts.revalidate !== undefined && opts.revalidate !== intent.seconds) {
          const { line, column } = lineCol(sourceFile, node);
          findings.push({
            ruleId: RULE_ID,
            severity: SEVERITY,
            file,
            line,
            column,
            message: `fetch() declares revalidate=${String(opts.revalidate)} inside a route declaring revalidate=${String(intent.seconds)}`,
            detail: 'Mismatched revalidate values. The lower of the two will win in practice and the other is misleading.',
            suggestion: 'Pick one revalidation interval — the route export, or the per-fetch option — and remove the other.',
          });
        }

        if (opts?.cache === 'no-store' && intent.kind === 'revalidate') {
          const { line, column } = lineCol(sourceFile, node);
          findings.push({
            ruleId: RULE_ID,
            severity: SEVERITY,
            file,
            line,
            column,
            message: "fetch() with cache: 'no-store' inside an ISR-declared route",
            detail: 'cache: "no-store" forces dynamic rendering for this request, opting the whole route out of static rendering. The route\'s revalidate export becomes dead code.',
            suggestion: 'Either remove the route\'s `revalidate` export, or remove `cache: "no-store"` and use `next: { revalidate: N }`.',
          });
        }

        // Version-aware: warn if user expects ISR on Next 15+ but neither cache nor next.revalidate is set
        const major = Number(ctx.nextVersion.split('.')[0] ?? '0');
        if (
          intent.kind === 'revalidate' &&
          opts === undefined &&
          major >= 15
        ) {
          const { line, column } = lineCol(sourceFile, node);
          findings.push({
            ruleId: RULE_ID,
            severity: SEVERITY,
            file,
            line,
            column,
            message: 'fetch() with no cache directive in an ISR-declared route on Next 15+',
            detail: `Next ${ctx.nextVersion} defaults fetch to no-store. The route declares \`revalidate = ${String(intent.seconds)}\` but this fetch will be uncached on every request, defeating ISR.`,
            suggestion: `Add cache: 'force-cache' or next: { revalidate: ${String(intent.seconds)} } to this fetch.`,
          });
        }
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
    'Detects caching and dynamic-rendering conflicts: dynamic-forcing APIs in static/ISR routes, mismatched revalidate values, fetch to localhost, version-aware fetch defaults.',
  severity: SEVERITY,
  needsLlm: false,
  run,
};

export default rule;
