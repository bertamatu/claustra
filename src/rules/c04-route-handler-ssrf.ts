import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'c04-route-handler-ssrf';
const SEVERITY: Severity = 'high';

const ROUTE_FILE_RE = /[\\/]route\.[cm]?[jt]sx?$/i;
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

// Functions whose call clears taint on the argument(s).
const VALIDATOR_NAME_RE = /^(validate|check|isAllowed|allowList|allowlist)Url/i;

// Method names that, when called on a tainted receiver with a literal
// argument, count as a guard. e.g. `tainted.startsWith('https://x.com')`.
const RECEIVER_GUARD_METHODS = new Set([
  'startsWith', 'endsWith', 'includes', 'match',
]);

const URL_HEAD_HARDCODED_RE = /^https?:\/\/[^/${}]+\//;

// ───────────────────────────── helpers ─────────────────────────────

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

const isProcessEnvAccess = (node: ts.Node): boolean => {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'process' &&
    ts.isIdentifier(node.expression.name) &&
    node.expression.name.text === 'env'
  ) {
    return true;
  }
  return (
    ts.isElementAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'process' &&
    ts.isIdentifier(node.expression.name) &&
    node.expression.name.text === 'env'
  );
};

// ────────────────────── route-handler discovery ────────────────────

const isRouteHandlerFile = (sf: ts.SourceFile, rootDir: string): boolean => {
  const relPath = path.relative(rootDir, sf.fileName);
  return ROUTE_FILE_RE.test(relPath);
};

type FnNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

type Handler = { name: string; fn: FnNode };

const collectHttpHandlers = (sf: ts.SourceFile): Handler[] => {
  const out: Handler[] = [];
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

// ─────────────────────────── taint model ───────────────────────────

const markBindingTainted = (
  name: ts.BindingName,
  tainted: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): void => {
  if (ts.isIdentifier(name)) {
    const sym = checker.getSymbolAtLocation(name);
    if (sym) tainted.add(sym);
    return;
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) markBindingTainted(el.name, tainted, checker);
  }
};

// True if the AST walk hits any tainted-symbol reference inside `node`.
const expressionReadsTainted = (
  node: ts.Node,
  tainted: Set<ts.Symbol>,
  taintedExprs: Set<ts.Node>,
  checker: ts.TypeChecker,
): boolean => {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (taintedExprs.has(n)) {
      found = true;
      return;
    }
    if (ts.isIdentifier(n)) {
      const parent = n.parent as ts.Node | undefined;
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) return;
      if (parent && ts.isPropertyAssignment(parent) && parent.name === n) return;
      if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === n) {
        const valueSym = checker.getShorthandAssignmentValueSymbol(parent);
        if (valueSym && tainted.has(valueSym)) found = true;
        return;
      }
      const sym = checker.getSymbolAtLocation(n);
      if (sym && tainted.has(sym)) found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
};

// Recognize taint-source expressions that don't necessarily live in a
// `tainted` symbol set yet - direct reads of `.url`, `.nextUrl.*`, and
// `.searchParams.get(...)` calls. The result of these expressions is
// itself attacker-controlled.
const collectTaintedExpressions = (
  body: ts.Block,
  requestSyms: Set<ts.Symbol>,
  paramsLikeSyms: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): Set<ts.Node> => {
  const out = new Set<ts.Node>();

  const isRequestLike = (expr: ts.Expression): boolean => {
    if (!ts.isIdentifier(expr)) return false;
    const sym = checker.getSymbolAtLocation(expr);
    return sym ? requestSyms.has(sym) : false;
  };

  const isParamsLike = (expr: ts.Expression): boolean => {
    if (!ts.isIdentifier(expr)) return false;
    const sym = checker.getSymbolAtLocation(expr);
    return sym ? paramsLikeSyms.has(sym) : false;
  };

  // Recursively determine whether a property-access chain bottoms out
  // at a request-like or searchParams-bearing root.
  const chainHasSearchParams = (expr: ts.Expression): boolean => {
    let cur: ts.Expression = expr;
    while (ts.isPropertyAccessExpression(cur)) {
      if (cur.name.text === 'searchParams') return true;
      cur = cur.expression;
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    // <request>.url
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'url' &&
      isRequestLike(node.expression)
    ) {
      out.add(node);
    }
    // <request>.nextUrl.<x> and deeper chains rooted at .nextUrl
    if (ts.isPropertyAccessExpression(node)) {
      let root: ts.Expression = node;
      while (ts.isPropertyAccessExpression(root)) root = root.expression;
      if (
        isRequestLike(root) &&
        node !== root &&
        chainContains(node, 'nextUrl')
      ) {
        out.add(node);
      }
    }
    // <x>.searchParams.get(<y>)  - tainted result
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      if (ts.isPropertyAccessExpression(c) && c.name.text === 'get') {
        if (chainHasSearchParams(c.expression)) out.add(node);
      }
    }
    // <paramsLike>.<x> and deeper
    if (ts.isPropertyAccessExpression(node)) {
      let root: ts.Expression = node;
      while (ts.isPropertyAccessExpression(root)) root = root.expression;
      if (isParamsLike(root) && node !== root) out.add(node);
    }
    node.forEachChild(visit);
  };
  visit(body);
  return out;
};

const chainContains = (node: ts.PropertyAccessExpression, segment: string): boolean => {
  let cur: ts.Expression = node;
  while (ts.isPropertyAccessExpression(cur)) {
    if (cur.name.text === segment) return true;
    cur = cur.expression;
  }
  return false;
};

// Inputs for taint propagation: walk const/let declarations, mark any
// binding whose initializer reads a tainted source / symbol. Records
// each tainted symbol's initializer so the hardcoded-host exemption
// can be checked against the original construction site.
const propagateTaint = (
  body: ts.Block,
  tainted: Set<ts.Symbol>,
  taintedExprs: Set<ts.Node>,
  symbolInitializers: Map<ts.Symbol, ts.Expression>,
  checker: ts.TypeChecker,
): void => {
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (expressionReadsTainted(node.initializer, tainted, taintedExprs, checker)) {
          const before = tainted.size;
          markBindingTainted(node.name, tainted, checker);
          if (tainted.size > before) {
            changed = true;
            // Record the initializer for the (now tainted) bindings.
            const recordOne = (n: ts.BindingName): void => {
              if (ts.isIdentifier(n)) {
                const sym = checker.getSymbolAtLocation(n);
                if (sym && !symbolInitializers.has(sym)) {
                  symbolInitializers.set(sym, node.initializer as ts.Expression);
                }
              }
            };
            recordOne(node.name);
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(body);
  }
};

// ───────────────────────── sanitizer detection ──────────────────────

// True if `node` (an Identifier reference to a tainted symbol) appears
// within a sanitizer/guard pattern: validateUrl()-style call, equality
// check vs literal, .includes/.startsWith/etc., new URL(), regex test.
const isInSanitizerContext = (node: ts.Node): boolean => {
  let prev: ts.Node = node;
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    // 1) Argument to a validator-named call: validateUrl(prev), checkUrlSafe(prev), …
    if (
      ts.isCallExpression(cur) &&
      cur.arguments.includes(prev as ts.Expression)
    ) {
      const name = calleeName(cur);
      if (name && VALIDATOR_NAME_RE.test(name)) return true;
      // 2) Allowlist check: <arr>.includes(prev), or regex.test(prev)
      if (name === 'includes' || name === 'test') return true;
    }
    // new URL(prev, ...) - handled separately because NewExpression isn't CallExpression
    if (
      ts.isNewExpression(cur) &&
      ts.isIdentifier(cur.expression) &&
      cur.expression.text === 'URL' &&
      cur.arguments &&
      cur.arguments[0] === prev
    ) {
      return true;
    }
    // 3) Equality check vs string literal: prev === '...' or '...' === prev
    if (ts.isBinaryExpression(cur)) {
      const op = cur.operatorToken.kind;
      const isEq =
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken;
      if (isEq) {
        const otherSide = cur.left === prev ? cur.right : cur.left;
        if (ts.isStringLiteralLike(otherSide)) return true;
      }
    }
    // 4) Receiver-side guard: prev.startsWith('…') / prev.includes('…') / …
    if (
      ts.isPropertyAccessExpression(cur) &&
      cur.expression === prev &&
      RECEIVER_GUARD_METHODS.has(cur.name.text)
    ) {
      // Confirm it's actually called with at least one argument.
      const grand: ts.Node | undefined = cur.parent;
      if (grand && ts.isCallExpression(grand) && grand.expression === cur && grand.arguments.length > 0) {
        return true;
      }
    }
    prev = cur;
    cur = cur.parent;
  }
  return false;
};

const calleeName = (call: ts.CallExpression): string | undefined => {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.name)) return c.name.text;
  return undefined;
};

// Walk the function and figure out which tainted symbols ever appear
// in a sanitizer context. Presence-based: at least one sanitized use
// clears the symbol for the whole handler (mirrors c01's approach).
const findSanitizedSymbols = (
  body: ts.Block,
  tainted: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): Set<ts.Symbol> => {
  const out = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const sym = checker.getSymbolAtLocation(node);
      if (sym && tainted.has(sym) && !out.has(sym)) {
        if (isInSanitizerContext(node)) out.add(sym);
      }
    }
    node.forEachChild(visit);
  };
  visit(body);
  return out;
};

// ───────────────────────────── sinks ────────────────────────────────

const FETCH_LIKE_FREE_NAMES = new Set(['fetch', 'axios', 'got']);

type SinkInfo = { call: ts.Node; argNode: ts.Expression; label: string };

const collectSinks = (body: ts.Block): SinkInfo[] => {
  const out: SinkInfo[] = [];

  const visit = (node: ts.Node): void => {
    // fetch(<url>, ...)  axios(<url>, ...)  got(<url>, ...)  <x>.fetch(<url>)  axios.<m>(<url>) got.<m>(<url>)
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      let isFetchSink = false;
      let label: string | undefined;
      if (ts.isIdentifier(c)) {
        if (FETCH_LIKE_FREE_NAMES.has(c.text)) {
          isFetchSink = true;
          label = `${c.text}()`;
        }
      } else if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.name)) {
        const method = c.name.text;
        if (method === 'fetch') {
          isFetchSink = true;
          label = `${rootName(c) ?? '<expr>'}.fetch()`;
        }
        if (
          ts.isIdentifier(c.expression) &&
          (c.expression.text === 'axios' || c.expression.text === 'got')
        ) {
          isFetchSink = true;
          label = `${c.expression.text}.${method}()`;
        }
      }
      if (isFetchSink) {
        const first = node.arguments[0];
        if (first) out.push({ call: node, argNode: first, label: label ?? 'fetch()' });
        // axios/fetch second arg can also carry a `url:` field
        const second = node.arguments[1];
        if (second && ts.isObjectLiteralExpression(second)) {
          for (const prop of second.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'url'
            ) {
              out.push({ call: node, argNode: prop.initializer, label: `${label ?? 'fetch()'} options.url` });
            }
          }
        }
      }
    }
    // new Request(<url>, ...) - first arg
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Request') {
      const first = node.arguments?.[0];
      if (first) out.push({ call: node, argNode: first, label: 'new Request()' });
    }
    // new ImageResponse({ src: <url> })
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'ImageResponse'
    ) {
      const first = node.arguments?.[0];
      if (first && ts.isObjectLiteralExpression(first)) {
        for (const prop of first.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'src'
          ) {
            out.push({ call: node, argNode: prop.initializer, label: 'new ImageResponse({ src })' });
          }
          // { src } shorthand - the property name is also the value.
          if (
            ts.isShorthandPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'src'
          ) {
            out.push({ call: node, argNode: prop.name, label: 'new ImageResponse({ src })' });
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(body);
  return out;
};

const rootName = (expr: ts.Expression): string | undefined => {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  if (ts.isCallExpression(cur)) return rootName(cur.expression);
  return ts.isIdentifier(cur) ? cur.text : undefined;
};

// ────────────────── hardcoded-host exemption check ──────────────────

const leftmostLeaf = (expr: ts.Expression): ts.Expression => {
  let cur: ts.Expression = expr;
  while (
    ts.isBinaryExpression(cur) &&
    cur.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    cur = cur.left;
  }
  return cur;
};

const argHostIsHardcoded = (arg: ts.Expression): boolean => {
  // Plain string literal starting with http(s)://
  if (
    (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
    URL_HEAD_HARDCODED_RE.test(arg.text)
  ) {
    return true;
  }
  // Template literal: head must already include scheme + host + first '/'.
  if (ts.isTemplateExpression(arg)) {
    return URL_HEAD_HARDCODED_RE.test(arg.head.text);
  }
  // String concat: leftmost leaf is a literal-with-host or process.env.X
  if (
    ts.isBinaryExpression(arg) &&
    arg.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = leftmostLeaf(arg);
    if (
      (ts.isStringLiteral(left) || ts.isNoSubstitutionTemplateLiteral(left)) &&
      URL_HEAD_HARDCODED_RE.test(left.text)
    ) {
      return true;
    }
    if (isProcessEnvAccess(left)) return true;
  }
  // new URL(<tainted>, <literal-base>)
  if (
    ts.isNewExpression(arg) &&
    ts.isIdentifier(arg.expression) &&
    arg.expression.text === 'URL' &&
    arg.arguments &&
    arg.arguments.length >= 2
  ) {
    const base = arg.arguments[1];
    if (
      base &&
      (ts.isStringLiteral(base) || ts.isNoSubstitutionTemplateLiteral(base)) &&
      URL_HEAD_HARDCODED_RE.test(base.text)
    ) {
      return true;
    }
    if (base && isProcessEnvAccess(base)) return true;
  }
  return false;
};

// ──────────────────────────────── run ───────────────────────────────

const collectRequestSymbols = (
  fn: FnNode,
  checker: ts.TypeChecker,
): { requestSyms: Set<ts.Symbol>; paramsLikeSyms: Set<ts.Symbol> } => {
  const requestSyms = new Set<ts.Symbol>();
  const paramsLikeSyms = new Set<ts.Symbol>();

  const first = fn.parameters[0];
  if (first && ts.isIdentifier(first.name)) {
    const sym = checker.getSymbolAtLocation(first.name);
    if (sym) requestSyms.add(sym);
  }

  const second = fn.parameters[1];
  if (second) {
    if (ts.isIdentifier(second.name)) {
      // ctx itself - params is ctx.params
      // We'll treat any property access ctx.params.<x> via paramsLikeSyms = {} and rely on chains.
      // For simplicity, also add ctx as a paramsLike root so ctx.params.<x> taints.
      const sym = checker.getSymbolAtLocation(second.name);
      if (sym) paramsLikeSyms.add(sym);
    } else if (ts.isObjectBindingPattern(second.name)) {
      for (const el of second.name.elements) {
        if (
          ts.isBindingElement(el) &&
          ts.isIdentifier(el.name) &&
          (el.propertyName ? ts.isIdentifier(el.propertyName) && el.propertyName.text === 'params' : el.name.text === 'params')
        ) {
          const sym = checker.getSymbolAtLocation(el.name);
          if (sym) paramsLikeSyms.add(sym);
        }
      }
    }
  }

  return { requestSyms, paramsLikeSyms };
};

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const rel = (f: string): string => path.relative(ctx.rootDir, f);

  for (const sf of ctx.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes('node_modules')) continue;
    if (!isRouteHandlerFile(sf, ctx.rootDir)) continue;

    for (const { name, fn } of collectHttpHandlers(sf)) {
      if (!fn.body || !ts.isBlock(fn.body)) continue;

      const { requestSyms, paramsLikeSyms } = collectRequestSymbols(fn, ctx.checker);
      const taintedExprs = collectTaintedExpressions(fn.body, requestSyms, paramsLikeSyms, ctx.checker);
      const tainted = new Set<ts.Symbol>();
      const symbolInitializers = new Map<ts.Symbol, ts.Expression>();

      // Seed: const x = <taintedExpr> propagated by propagateTaint.
      propagateTaint(fn.body, tainted, taintedExprs, symbolInitializers, ctx.checker);

      const sanitized = findSanitizedSymbols(fn.body, tainted, ctx.checker);

      const sinks = collectSinks(fn.body);

      for (const sink of sinks) {
        if (!expressionReadsTainted(sink.argNode, tainted, taintedExprs, ctx.checker)) continue;
        if (argHostIsHardcoded(sink.argNode)) continue;
        // Resolve `fetch(url)` where `url` is tainted: check the
        // initializer of `url` for hardcoded-host construction.
        if (ts.isIdentifier(sink.argNode)) {
          const sym = ctx.checker.getSymbolAtLocation(sink.argNode);
          const init = sym ? symbolInitializers.get(sym) : undefined;
          if (init && argHostIsHardcoded(init)) continue;
        }

        // If the only tainted symbols read are sanitized somewhere in
        // the function, treat the sink as guarded.
        if (allReadTaintedSymbolsAreSanitized(sink.argNode, tainted, sanitized, ctx.checker)) continue;

        const { line, column } = lineCol(sf, sink.call);
        findings.push({
          ruleId: RULE_ID,
          severity: SEVERITY,
          file: rel(sf.fileName),
          line,
          column,
          message: `Route Handler "${name}" passes user-controlled URL to ${sink.label} without an allowlist check`,
          detail:
            'Server-side requests built from request URL params or route segments are an SSRF gadget: an attacker can point your server at internal services (localhost, 169.254.169.254 metadata endpoints, internal subnets), at private files via file:/gopher:/dict: schemes, or at endpoints that respond differently to server-side vs public callers. Even an "image proxy" or "OG renderer" handler is an exploitable foothold without a host allowlist.',
          suggestion:
            'Validate the URL against an allowlist before fetching. Common shapes: `if (!ALLOWED_HOSTS.includes(new URL(url).hostname)) throw …`, a regex test against a hostname pattern, or a `validateUrl(url)` helper. If the URL is meant to live on a fixed host, build it as `fetch(\\`https://api.example.com/x?id=${"$"}{id}\\`)` so the host is hardcoded - or read the base from `process.env.<X>`.',
        });
      }
    }
  }

  await Promise.resolve();
  return findings;
};

const allReadTaintedSymbolsAreSanitized = (
  argNode: ts.Expression,
  tainted: Set<ts.Symbol>,
  sanitized: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): boolean => {
  // If the sink reads any tainted-EXPRESSION (e.g. inline req.url) it
  // cannot be sanitized - there's no symbol to clear.
  let allClean = true;
  let sawAnyTaintedSymbol = false;
  const visit = (n: ts.Node): void => {
    if (!allClean) return;
    if (ts.isIdentifier(n)) {
      const parent = n.parent as ts.Node | undefined;
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) return;
      if (parent && ts.isPropertyAssignment(parent) && parent.name === n) return;
      if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === n) {
        const valueSym = checker.getShorthandAssignmentValueSymbol(parent);
        if (valueSym && tainted.has(valueSym)) {
          sawAnyTaintedSymbol = true;
          if (!sanitized.has(valueSym)) allClean = false;
        }
        return;
      }
      const sym = checker.getSymbolAtLocation(n);
      if (sym && tainted.has(sym)) {
        sawAnyTaintedSymbol = true;
        if (!sanitized.has(sym)) allClean = false;
      }
      return;
    }
    n.forEachChild(visit);
  };
  visit(argNode);
  return sawAnyTaintedSymbol && allClean;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects Next.js Route Handlers that pass a request-derived URL (from searchParams, request.url, request.nextUrl, or route params) to fetch / axios / got / new Request / new ImageResponse without an allowlist check, validator function call, or hardcoded-host context - the static signature of an SSRF gadget.',
  severity: SEVERITY,
  run,
};

export default rule;
