import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'c03-webhook-verify';
const SEVERITY: Severity = 'critical';

// SDKs that strongly imply a route handler is a webhook receiver.
// Importing any of these triggers webhook-handler detection even when
// the file path does not contain "webhook".
const WEBHOOK_SDKS: ReadonlyArray<string> = [
  'stripe',
  '@octokit/webhooks',
  '@octokit/webhooks-methods',
  'svix',
  '@clerk/backend',
  'shopify-api-node',
  '@vercel/webhooks',
];

// HTTP methods we analyze. GET/HEAD/OPTIONS are read-only and do not
// receive a body in normal usage, so they are out of scope.
const HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// Function names that, called anywhere inside the handler, count as
// signature verification. Includes the major provider SDKs.
const VERIFIER_NAMES = new Set([
  'verify',
  'constructEvent', // stripe.webhooks.constructEvent
]);

// User-defined verifier helpers per the SCALE_PLAN: anything shaped
// like `verifyWebhook`, `validateSignature`, `checkWebhookSignature`,
// `verifySignatureWebhook`, etc. Either token may appear after the
// verb, optionally followed by the other.
const VERIFIER_NAME_RE = /^(verify|validate|check)(Webhook|Signature)(Signature|Webhook)?$/;

// Body-read methods on the Request parameter. Reading any of these
// without a verifier in scope means the handler is treating the raw
// body as trusted.
const BODY_READ_METHODS = new Set(['json', 'text', 'formData', 'arrayBuffer', 'blob']);

const MUTATION_METHODS = new Set([
  'create', 'createMany',
  'update', 'updateMany',
  'delete', 'deleteMany',
  'upsert',
  'insert', 'insertMany',
  'save',
  'updateOne', 'deleteOne', 'replaceOne', 'bulkWrite',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
]);

// Receivers of methods named like mutations but that are not DB writes.
const SAFE_RECEIVERS = new Set([
  'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'JSON', 'Date', 'Math', 'Number', 'String', 'Boolean',
  'Promise', 'Error', 'console', 'crypto',
]);

const ROUTE_FILE_RE = /[\\/]route\.[cm]?[jt]sx?$/i;

// ─────────────────────────────── helpers ───────────────────────────────

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

const isDescendantOf = (descendant: ts.Node, ancestor: ts.Node): boolean =>
  descendant === ancestor ||
  ts.findAncestor(descendant.parent, (n) => n === ancestor) !== undefined;

// `process.env.NODE_ENV === 'development' | 'dev'` (positive form), or
// `process.env.NODE_ENV !== 'production' | 'prod'` (negative form).
const isDevEnvCheck = (expr: ts.Expression): boolean => {
  if (!ts.isBinaryExpression(expr)) return false;
  const op = expr.operatorToken.kind;
  const isEq = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
  const isNeq = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
  if (!isEq && !isNeq) return false;

  const isNodeEnv = (e: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    ts.isIdentifier(e.expression.expression) &&
    e.expression.expression.text === 'process' &&
    ts.isIdentifier(e.expression.name) &&
    e.expression.name.text === 'env' &&
    ts.isIdentifier(e.name) &&
    e.name.text === 'NODE_ENV';

  let literal: ts.Expression | undefined;
  if (isNodeEnv(expr.left)) literal = expr.right;
  else if (isNodeEnv(expr.right)) literal = expr.left;
  else return false;

  if (!ts.isStringLiteralLike(literal)) return false;
  const v = literal.text;
  if (isEq) return v === 'development' || v === 'dev';
  return v === 'production' || v === 'prod';
};

const isInsideDevBypass = (node: ts.Node, fnBody: ts.Node): boolean =>
  ts.findAncestor(node.parent, (cur) => {
    if (cur === fnBody) return 'quit';
    return (
      ts.isIfStatement(cur) &&
      isDevEnvCheck(cur.expression) &&
      isDescendantOf(node, cur.thenStatement)
    );
  }) !== undefined;

// ─────────────────── webhook-file & handler discovery ──────────────────

const isWebhookHandlerFile = (sf: ts.SourceFile, rootDir: string): boolean => {
  const relPath = path.relative(rootDir, sf.fileName);
  if (!ROUTE_FILE_RE.test(relPath)) return false;
  // Match `webhook` or `webhooks` as a path segment, not as a substring
  // of an unrelated segment like `non-webhook`.
  if (/[\\/]webhooks?[\\/]/i.test(relPath)) return true;
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    for (const sdk of WEBHOOK_SDKS) {
      if (spec === sdk || spec.startsWith(`${sdk}/`)) return true;
    }
  }
  return false;
};

type FnNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

type HttpHandler = { name: string; fn: FnNode };

const collectHttpHandlers = (sf: ts.SourceFile): HttpHandler[] => {
  const out: HttpHandler[] = [];
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      hasExportModifier(stmt) &&
      stmt.name &&
      stmt.body &&
      HTTP_METHODS.has(stmt.name.text)
    ) {
      out.push({ name: stmt.name.text, fn: stmt });
      continue;
    }
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          HTTP_METHODS.has(decl.name.text) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          out.push({ name: decl.name.text, fn: decl.initializer });
        }
      }
    }
  }
  return out;
};

// ─────────────────────────── verifier detection ────────────────────────

const callsVerifier = (body: ts.Block): boolean => {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name: string | undefined;
      if (ts.isIdentifier(callee)) name = callee.text;
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        name = callee.name.text;
      }
      if (name && (VERIFIER_NAMES.has(name) || VERIFIER_NAME_RE.test(name))) {
        found = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(body);
  return found;
};

// ─────────────────────────── sink collection ───────────────────────────

type Sink = {
  node: ts.CallExpression;
  kind: 'body-read' | 'db-write';
  label: string;
};

const collectSinks = (body: ts.Block, requestParamName: string | undefined): Sink[] => {
  const out: Sink[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        const method = callee.name.text;
        if (BODY_READ_METHODS.has(method)) {
          const root = getRootIdentifier(callee);
          if (requestParamName && root === requestParamName) {
            out.push({ node, kind: 'body-read', label: `request.${method}()` });
          }
        } else if (MUTATION_METHODS.has(method)) {
          const root = getRootIdentifier(callee);
          if (!root || !SAFE_RECEIVERS.has(root)) {
            out.push({ node, kind: 'db-write', label: `${method}()` });
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(body);
  return out;
};

// ────────────────────────────────── run ────────────────────────────────

const messageFor = (handler: string, sink: Sink): { message: string; detail: string; suggestion: string } => {
  if (sink.kind === 'body-read') {
    return {
      message: `Webhook handler "${handler}" reads ${sink.label} without first verifying the provider's signature`,
      detail:
        'Webhook endpoints are public POST endpoints — anyone who knows the URL can call them with arbitrary payloads. Without signature verification, the request body is attacker-controlled and any code path that consumes it can be triggered with crafted input.',
      suggestion:
        "Read the raw body with request.text(), pass it to your provider's verifier (stripe.webhooks.constructEvent, Webhook.verify (svix), verify (octokit), or your own verifyWebhook helper) along with the signature header, and use only the verified result. If a development-only bypass is needed, wrap it in `if (process.env.NODE_ENV === 'development') { … }` so the production path is still required to verify.",
    };
  }
  return {
    message: `Webhook handler "${handler}" performs a database write (${sink.label}) without first verifying the provider's signature`,
    detail:
      'Mutating storage from an unverified webhook lets anyone with the endpoint URL trigger writes with attacker-supplied data. Combined with knowledge of your data shape, this is a direct path to data corruption or account takeover.',
    suggestion:
      "Verify the signature first (e.g. stripe.webhooks.constructEvent / Webhook.verify), then perform the mutation using only data from the verified event. If a development-only bypass is needed, wrap it in `if (process.env.NODE_ENV === 'development') { … }`.",
  };
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sf of ctx.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes('node_modules')) continue;
    if (!isWebhookHandlerFile(sf, ctx.rootDir)) continue;

    for (const { name, fn } of collectHttpHandlers(sf)) {
      if (!fn.body || !ts.isBlock(fn.body)) continue;
      if (callsVerifier(fn.body)) continue;

      const firstParam = fn.parameters[0];
      const paramName =
        firstParam && ts.isIdentifier(firstParam.name) ? firstParam.name.text : undefined;

      const sinks = collectSinks(fn.body, paramName);
      for (const sink of sinks) {
        if (isInsideDevBypass(sink.node, fn.body)) continue;
        const { line, column } = lineCol(sf, sink.node);
        const m = messageFor(name, sink);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file: rel(sf.fileName),
          line,
          column,
          message: m.message,
          detail: m.detail,
          suggestion: m.suggestion,
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
    'Detects Next.js Route Handlers that look like webhook receivers (path includes "webhook" or imports a known webhook SDK) and read the request body or perform a database write without calling a recognized signature verifier (stripe.webhooks.constructEvent, svix Webhook.verify, octokit verify, or a verify*/validate*/check*Webhook|Signature helper). Body reads inside an `if (process.env.NODE_ENV === \'development\')` block are exempt.',
  severity: SEVERITY,
  run,
};

export default rule;
