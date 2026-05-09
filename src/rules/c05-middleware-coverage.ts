import path from 'node:path';
import ts from 'typescript';
import {
  fileToUrlPath,
  filePathHasSegment,
  urlPathHasSegment,
} from '../utils/next-paths.js';
import { matcherCovers } from '../utils/middleware-matcher.js';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'c05-middleware-coverage';
const SEVERITY: Severity = 'high';

// URL-segment names that mark a route as auth-protected by ecosystem
// convention (used by Next.js / NextAuth / Clerk / Supabase starter
// templates and the official auth examples).
const SENSITIVE_URL_SEGMENTS = new Set([
  'admin',
  'dashboard',
  'account',
  'settings',
  'billing',
]);

// File-path segment names (route groups, kept verbatim with parens).
// `(auth)` is intentionally excluded — Next.js's own examples use it
// for the *unauthenticated* sign-in/sign-up flow, so flagging would
// generate false positives.
const SENSITIVE_GROUP_SEGMENTS = new Set([
  '(authenticated)',
  '(protected)',
  '(dashboard)',
]);

const HTTP_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const KNOWN_AUTH_NAMES = new Set([
  'auth',
  'getServerSession',
  'getServerAuthSession',
  'currentUser',
  'validateRequest',
  'getSession',
  'getToken',
  'clerkMiddleware',
  'authMiddleware',
  'withAuth',
]);

const AUTH_NAME_PATTERN =
  /^(verify|require|check|assert|guard).*?(Auth|Session|User|Permission|Role|Access)/i;

const AUTH_PROVIDER_IMPORTS = [
  'next-auth/middleware',
  '@clerk/nextjs/server',
  '@clerk/nextjs',
  '@supabase/auth-helpers-nextjs',
  'next-auth',
  'lucia-auth',
  'lucia',
];

const MUTATION_METHODS = new Set([
  'create', 'createMany',
  'update', 'updateMany',
  'delete', 'deleteMany',
  'upsert',
  'insert', 'insertMany',
  'save',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'deleteOne', 'replaceOne', 'bulkWrite',
  'writeFile', 'writeFileSync',
  'appendFile', 'appendFileSync',
  'unlink', 'unlinkSync',
  'rm', 'rmSync',
]);

const SAFE_RECEIVERS = new Set([
  'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'JSON', 'Date', 'Math', 'Number', 'String', 'Boolean',
  'React', 'Symbol', 'console', 'performance',
  'Promise', 'Error',
  'crypto', 'bcrypt', 'jsonwebtoken',
]);

const SQL_TAG_PATTERN = /(^|\.)(sql|raw|query)$/i;
const SQL_WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|DROP|ALTER|CREATE)\b/i;

const ROUTE_FILE_RE = /[\\/]route\.[cm]?[jt]sx?$/i;
const PAGE_FILE_RE = /[\\/]page\.[cm]?[jt]sx?$/i;
const LAYOUT_FILE_RE = /[\\/]layout\.[cm]?[jt]sx?$/i;
const MIDDLEWARE_FILE_RE = /(?:^|[\\/])middleware\.[cm]?[jt]s$/i;

const WEBHOOK_SEGMENT_RE = /[\\/]webhooks?[\\/]/i;
const WEBHOOK_VERIFIER_NAMES = new Set([
  'constructEvent', 'verify', 'verifyWebhook', 'verifyWebhookSignature', 'verifySignature',
]);
const WEBHOOK_VERIFIER_PATTERN = /^verify.*?(Webhook|Signature)/i;

// ─────────────────────── shared AST helpers ────────────────────────

const lineCol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

const hasExportModifier = (node: ts.Node): boolean => {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
};

const getRootIdentifier = (expr: ts.Expression): string | undefined => {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  if (ts.isCallExpression(cur)) return getRootIdentifier(cur.expression);
  return ts.isIdentifier(cur) ? cur.text : undefined;
};

const calleeName = (call: ts.CallExpression): string | undefined => {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.name)) return c.name.text;
  return undefined;
};

const isAuthCall = (node: ts.Node): boolean => {
  if (!ts.isCallExpression(node)) return false;
  const name = calleeName(node);
  if (!name) return false;
  if (KNOWN_AUTH_NAMES.has(name)) return true;
  if (AUTH_NAME_PATTERN.test(name)) return true;
  return false;
};

const isWebhookVerifierCall = (node: ts.Node): boolean => {
  if (!ts.isCallExpression(node)) return false;
  const name = calleeName(node);
  if (!name) return false;
  if (WEBHOOK_VERIFIER_NAMES.has(name)) return true;
  return WEBHOOK_VERIFIER_PATTERN.test(name);
};

const isMutationCall = (node: ts.Node): boolean => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!MUTATION_METHODS.has(callee.name.text)) return false;
  const root = getRootIdentifier(callee);
  if (root && SAFE_RECEIVERS.has(root)) return false;
  return true;
};

const isMutationTaggedTemplate = (node: ts.Node): boolean => {
  if (!ts.isTaggedTemplateExpression(node)) return false;
  const tag = node.tag.getText();
  if (!SQL_TAG_PATTERN.test(tag)) return false;
  return SQL_WRITE_KEYWORDS.test(node.template.getText());
};

const sourceContains = (sf: ts.SourceFile, predicate: (n: ts.Node) => boolean): boolean => {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (predicate(n)) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return found;
};

const importsFromAny = (sf: ts.SourceFile, modules: readonly string[]): boolean => {
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      if (modules.includes(spec)) return true;
    }
  }
  return false;
};

// ────────────────────── middleware detection ───────────────────────

type MiddlewareInfo = {
  sourceFile: ts.SourceFile;
  matcherValue: unknown;        // raw extracted value, or undefined if absent
  matcherUnreadable: boolean;   // true if `config` exists but matcher is dynamic
  callsAuth: boolean;
};

// Walk an `export const config = { ... }` and extract the `matcher`
// property value as a JS-ish runtime value, when statically known.
// Returns:
//   { value: <decoded> }  — readable
//   { unreadable: true }  — dynamic (e.g. spread, identifier)
//   undefined             — config or matcher field absent
const extractMatcherValue = (
  sf: ts.SourceFile,
): { value?: unknown; unreadable?: true } | undefined => {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (!hasExportModifier(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== 'config') continue;
      if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) {
        return { unreadable: true };
      }
      for (const prop of decl.initializer.properties) {
        if (
          !ts.isPropertyAssignment(prop) ||
          !ts.isIdentifier(prop.name) ||
          prop.name.text !== 'matcher'
        ) {
          continue;
        }
        return decodeMatcher(prop.initializer);
      }
      return undefined;
    }
  }
  return undefined;
};

const decodeMatcher = (
  expr: ts.Expression,
): { value?: unknown; unreadable?: true } => {
  if (ts.isStringLiteralLike(expr)) return { value: expr.text };
  if (ts.isArrayLiteralExpression(expr)) {
    const out: unknown[] = [];
    for (const el of expr.elements) {
      if (ts.isStringLiteralLike(el)) {
        out.push(el.text);
        continue;
      }
      if (ts.isObjectLiteralExpression(el)) {
        const obj = decodeObject(el);
        if (!obj) return { unreadable: true };
        out.push(obj);
        continue;
      }
      return { unreadable: true };
    }
    return { value: out };
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const obj = decodeObject(expr);
    if (!obj) return { unreadable: true };
    return { value: obj };
  }
  return { unreadable: true };
};

const decodeObject = (expr: ts.ObjectLiteralExpression): Record<string, unknown> | null => {
  const out: Record<string, unknown> = {};
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) return null;
    if (!ts.isIdentifier(prop.name)) return null;
    const key = prop.name.text;
    if (ts.isStringLiteralLike(prop.initializer)) {
      out[key] = prop.initializer.text;
      continue;
    }
    // For `has`/`missing` we don't care about contents — record presence.
    out[key] = '<dynamic>';
  }
  return out;
};

const findMiddlewareSourceFile = (program: ts.Program): ts.SourceFile | undefined => {
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes('node_modules')) continue;
    if (MIDDLEWARE_FILE_RE.test(sf.fileName)) return sf;
  }
  return undefined;
};

const buildMiddlewareInfo = (program: ts.Program): MiddlewareInfo | undefined => {
  const sf = findMiddlewareSourceFile(program);
  if (!sf) return undefined;
  const decoded = extractMatcherValue(sf);
  const callsAuth =
    sourceContains(sf, isAuthCall) || importsFromAny(sf, AUTH_PROVIDER_IMPORTS);
  return {
    sourceFile: sf,
    matcherValue: decoded?.value,
    matcherUnreadable: decoded?.unreadable === true,
    callsAuth,
  };
};

// ─────────────────────── route classification ──────────────────────

type RouteCandidate = {
  sourceFile: ts.SourceFile;
  urlPath: string;
  kind: 'page' | 'route';
  reasons: string[];
};

const isWebhookHandler = (sf: ts.SourceFile): boolean => {
  if (WEBHOOK_SEGMENT_RE.test(sf.fileName)) return true;
  if (sourceContains(sf, isWebhookVerifierCall)) return true;
  return false;
};

const routeExportsMutatingMethod = (sf: ts.SourceFile): boolean => {
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      hasExportModifier(stmt) &&
      stmt.name &&
      HTTP_MUTATING_METHODS.has(stmt.name.text)
    ) {
      return true;
    }
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          HTTP_MUTATING_METHODS.has(decl.name.text)
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

const fileHasMutation = (sf: ts.SourceFile): boolean =>
  sourceContains(sf, (n) => isMutationCall(n) || isMutationTaggedTemplate(n));

const fileIsSensitive = (
  sf: ts.SourceFile,
  urlPath: string,
  kind: 'page' | 'route',
): { sensitive: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  if (urlPathHasSegment(urlPath, SENSITIVE_URL_SEGMENTS)) {
    reasons.push(`path under sensitive segment "${urlPath}"`);
  }
  if (filePathHasSegment(sf.fileName, SENSITIVE_GROUP_SEGMENTS)) {
    reasons.push('file under a protected route group');
  }
  if (kind === 'route') {
    if (routeExportsMutatingMethod(sf)) reasons.push('exports POST/PUT/PATCH/DELETE');
    if (fileHasMutation(sf)) reasons.push('performs DB/FS mutation');
  }
  return { sensitive: reasons.length > 0, reasons };
};

// ─────────────────── inline + ancestor-layout auth ──────────────────

const findAncestorLayouts = (
  routeFilePath: string,
  layoutByDir: Map<string, ts.SourceFile>,
): ts.SourceFile[] => {
  const out: ts.SourceFile[] = [];
  let dir = path.dirname(routeFilePath);
  for (;;) {
    const layout = layoutByDir.get(dir);
    if (layout) out.push(layout);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    // Stop ascending once we leave any `app/` tree — layouts above
    // `app/` aren't part of the App Router subtree.
    if (path.basename(dir) === 'app') break;
    dir = parent;
  }
  return out;
};

const buildLayoutByDir = (program: ts.Program): Map<string, ts.SourceFile> => {
  const out = new Map<string, ts.SourceFile>();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes('node_modules')) continue;
    if (LAYOUT_FILE_RE.test(sf.fileName)) {
      out.set(path.dirname(sf.fileName), sf);
    }
  }
  return out;
};

const protectedInlineOrAncestor = (
  sf: ts.SourceFile,
  layoutByDir: Map<string, ts.SourceFile>,
): boolean => {
  if (sourceContains(sf, isAuthCall)) return true;
  for (const layout of findAncestorLayouts(sf.fileName, layoutByDir)) {
    if (sourceContains(layout, isAuthCall)) return true;
  }
  return false;
};

// ──────────────────────────────── run ───────────────────────────────

const collectCandidates = (program: ts.Program): RouteCandidate[] => {
  const out: RouteCandidate[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes('node_modules')) continue;

    const isPage = PAGE_FILE_RE.test(sf.fileName);
    const isRoute = ROUTE_FILE_RE.test(sf.fileName);
    if (!isPage && !isRoute) continue;

    if (isRoute && isWebhookHandler(sf)) continue;

    const urlPath = fileToUrlPath(sf.fileName);
    if (!urlPath) continue;

    const kind: 'page' | 'route' = isPage ? 'page' : 'route';
    const { sensitive, reasons } = fileIsSensitive(sf, urlPath, kind);
    if (!sensitive) continue;

    out.push({ sourceFile: sf, urlPath, kind, reasons });
  }
  return out;
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  const middleware = buildMiddlewareInfo(ctx.program);
  const layoutByDir = buildLayoutByDir(ctx.program);

  const middlewareCovers = (urlPath: string): boolean => {
    if (!middleware) return false;
    if (!middleware.callsAuth) return false;
    if (middleware.matcherUnreadable) return true;
    if (middleware.matcherValue === undefined) {
      // No `config.matcher` exported → middleware runs on all paths.
      return true;
    }
    return matcherCovers(middleware.matcherValue, urlPath);
  };

  for (const candidate of collectCandidates(ctx.program)) {
    if (middlewareCovers(candidate.urlPath)) continue;
    if (protectedInlineOrAncestor(candidate.sourceFile, layoutByDir)) continue;

    const { line, column } = lineCol(candidate.sourceFile, candidate.sourceFile);
    const middlewareDetail = middleware
      ? middleware.callsAuth
        ? `\`middleware.${path.extname(middleware.sourceFile.fileName).slice(1)}\` exists but its \`config.matcher\` does not cover ${candidate.urlPath}.`
        : `\`middleware.${path.extname(middleware.sourceFile.fileName).slice(1)}\` exists but does not call any recognized auth helper (auth(), currentUser(), validateRequest(), clerkMiddleware, withAuth, getToken, or a verify*/require*/check*/assert*/guard* helper) and does not import from a recognized auth provider.`
      : 'No `middleware.ts`/`.js` file is present at the project root or under `src/`.';

    findings.push({
      ruleId: RULE_ID,
      severity: SEVERITY,
      file: rel(candidate.sourceFile.fileName),
      line,
      column,
      message: `Sensitive ${candidate.kind} "${candidate.urlPath}" is not protected by middleware or an inline auth check`,
      detail:
        `Reasons this route is sensitive: ${candidate.reasons.join('; ')}. ` +
        `${middlewareDetail} ` +
        `The file itself does not call a recognized auth helper, and no ancestor \`layout.tsx\` calls one either. Anyone can hit this URL — including indexers and unauthenticated bots.`,
      suggestion:
        `Either (a) add a matcher entry like \`'${candidate.urlPath}/:path*'\` to \`middleware.ts\`'s \`config.matcher\` and ensure the middleware body calls \`auth()\` (or your provider's equivalent), or (b) call \`auth()\` / \`currentUser()\` / \`validateRequest()\` at the top of this ${candidate.kind === 'page' ? 'component' : 'handler'} and redirect/throw on missing session, or (c) add the auth call to a shared ancestor \`layout.tsx\` so the whole subtree inherits it.`,
    });
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects sensitive Next.js App Router pages and route handlers — paths under `admin`/`dashboard`/`account`/`settings`/`billing`, files inside `(authenticated)`/`(protected)`/`(dashboard)` route groups, and route handlers that mutate or expose POST/PUT/PATCH/DELETE — that are neither covered by an auth-calling `middleware.ts` matcher nor protected by an inline `auth()` call (or one in an ancestor `layout.tsx`).',
  severity: SEVERITY,
  run,
};

export default rule;
