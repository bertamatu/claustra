import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const SERVER_ONLY_MODULES = new Set([
  'next/headers',
  'next/cache',
  'server-only',
]);

const REACT_CLIENT_HOOKS = new Set([
  'useState',
  'useEffect',
  'useRef',
  'useContext',
  'useReducer',
  'useCallback',
  'useMemo',
  'useLayoutEffect',
  'useTransition',
  'useDeferredValue',
  'useImperativeHandle',
  'useInsertionEffect',
  'useSyncExternalStore',
]);

const NAVIGATION_CLIENT_HOOKS = new Set([
  'useRouter',
  'useSearchParams',
  'usePathname',
  'useSelectedLayoutSegment',
  'useSelectedLayoutSegments',
  'useParams',
]);

const RULE_ID = 'a02-rsc-pattern-misuse';
const SEVERITY: Severity = 'high';

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const findMisplacedDirectives = (sourceFile: ts.SourceFile): ts.Node[] => {
  const out: ts.Node[] = [];
  let pastFirstNonDirective = false;
  for (const stmt of sourceFile.statements) {
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isStringLiteral(stmt.expression) &&
      (stmt.expression.text === 'use client' || stmt.expression.text === 'use server')
    ) {
      if (pastFirstNonDirective) out.push(stmt);
      continue;
    }
    pastFirstNonDirective = true;
  }
  return out;
};

const containsJsx = (node: ts.Node): boolean => {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
};

const isIntrinsicJsxName = (name: string): boolean =>
  /^[a-z]/.test(name);

const checkClientFile = (
  sourceFile: ts.SourceFile,
  rel: (f: string) => string,
): Finding[] => {
  const findings: Finding[] = [];
  const file = rel(sourceFile.fileName);

  // Server-only imports
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const mod = stmt.moduleSpecifier.text;
    if (SERVER_ONLY_MODULES.has(mod)) {
      const { line, column } = lineCol(sourceFile, stmt);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: `Server-only import "${mod}" in a client component`,
        detail: `'use client' files run in the browser. Importing "${mod}" will fail at runtime or pollute the client bundle.`,
        suggestion: `Move this code to a Server Component, or pass the data it produces as a serializable prop.`,
      });
    }
  }

  // Async component declarations with JSX
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
      node.body &&
      containsJsx(node.body)
    ) {
      const { line, column } = lineCol(sourceFile, node);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: 'Async function returning JSX in a client component',
        detail: 'Client Components cannot be async. Async components are a Server-only feature; this will silently break.',
        suggestion: 'Either remove the async keyword and use useEffect for data fetching, or move this component to a Server Component file (no "use client").',
      });
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);

  return findings;
};

const checkServerFile = (
  sourceFile: ts.SourceFile,
  rel: (f: string) => string,
): Finding[] => {
  const findings: Finding[] = [];
  const file = rel(sourceFile.fileName);

  // Client hooks imported (covers the "import + call" path in one shot)
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const mod = stmt.moduleSpecifier.text;
    if (mod !== 'react' && mod !== 'next/navigation') continue;

    const clause = stmt.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;

    for (const spec of clause.namedBindings.elements) {
      const name = spec.propertyName?.text ?? spec.name.text;
      const isReactHook = mod === 'react' && REACT_CLIENT_HOOKS.has(name);
      const isNavHook = mod === 'next/navigation' && NAVIGATION_CLIENT_HOOKS.has(name);
      if (!isReactHook && !isNavHook) continue;

      const { line, column } = lineCol(sourceFile, spec);
      findings.push({
        ruleId: RULE_ID,
        severity: SEVERITY,
        file,
        line,
        column,
        message: `Client hook "${name}" imported in a server component`,
        detail: `${name} only runs in the browser. Calling it from a Server Component throws at request time.`,
        suggestion: `Move this code into a "use client" file, or use the Server Component equivalent (e.g., cookies()/headers() from "next/headers" instead of useRouter()).`,
      });
    }
  }

  // Event handlers on intrinsic JSX elements
  const visit = (node: ts.Node): void => {
    const opening =
      ts.isJsxElement(node) ? node.openingElement :
      ts.isJsxSelfClosingElement(node) ? node :
      undefined;
    if (opening && ts.isIdentifier(opening.tagName) && isIntrinsicJsxName(opening.tagName.text)) {
      for (const attr of opening.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          ts.isIdentifier(attr.name) &&
          /^on[A-Z]/.test(attr.name.text)
        ) {
          const { line, column } = lineCol(sourceFile, attr);
          findings.push({
            ruleId: RULE_ID,
            severity: SEVERITY,
            file,
            line,
            column,
            message: `Event handler ${attr.name.text}= on intrinsic <${opening.tagName.text}> in a server component`,
            detail: 'Event handlers serialize as functions, which cannot cross the server/client boundary. React will throw at render time.',
            suggestion: 'Move the interactive element into a "use client" component and pass any server data in as serializable props.',
          });
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);

  return findings;
};

const checkDirectivePlacement = (
  sourceFile: ts.SourceFile,
  rel: (f: string) => string,
): Finding[] => {
  const findings: Finding[] = [];
  for (const node of findMisplacedDirectives(sourceFile)) {
    const { line, column } = lineCol(sourceFile, node);
    findings.push({
      ruleId: RULE_ID,
      severity: SEVERITY,
      file: rel(sourceFile.fileName),
      line,
      column,
      message: 'Misplaced "use client" / "use server" directive',
      detail: 'Directives must appear before any other statement (only comments may precede them). Otherwise they are silently ignored.',
      suggestion: 'Move the directive to the very top of the file, above all imports.',
    });
  }
  return findings;
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sourceFile of ctx.program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const boundary = ctx.boundaryMap.get(sourceFile.fileName);
    if (!boundary) continue;

    findings.push(...checkDirectivePlacement(sourceFile, rel));

    if (boundary === 'client') {
      findings.push(...checkClientFile(sourceFile, rel));
    } else if (boundary === 'server') {
      findings.push(...checkServerFile(sourceFile, rel));
    }
  }

  // No-op await keeps the signature consistent with rules that need async.
  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects RSC pattern misuse: server APIs in client files, client APIs in server files, and misplaced directives.',
  severity: SEVERITY,
  run,
};

export default rule;
