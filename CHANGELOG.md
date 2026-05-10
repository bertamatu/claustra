# Changelog

All notable changes to claustra are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/).

## [1.5.0] — 2026-05-10

Two new React 19 hook correctness rules. Both target silent-but-broken UI patterns that compile cleanly, type-check, and pass casual smoke tests — the kind of bugs that surface only after deployment when a user reports "the spinner never stops" or "the page never loads." 366 tests, no breaking changes.

### Added

- **A5 — `useFormStatus` co-located with `<form>` in the same component** (severity: medium). React 19's `useFormStatus` reads form state from a *parent* `<form>`; calling it in the same component that renders the form returns `pending: false` permanently because there is no parent form in scope. Detects calls to a binding produced by `import { useFormStatus } from 'react-dom'` (honoring `as` aliases) co-located with a `<form>` JSX element at the same function scope. Same-scope check does not descend into nested function-likes — a child component defined inline that calls the hook correctly walks up to the outer form. Imports from any other module (user helpers that share the name) are not tracked. See [RULES.md#a5](./RULES.md#a5--useformstatus-co-located-with-form-in-the-same-component).
- **A6 — `use()` called with an inline-created Promise** (severity: high). React's `use()` hook deduplicates by Promise reference; an unstable reference (created fresh on every render) produces infinite suspension. The component never commits, the Suspense fallback stays up, and the symptom is "the page never loads" with no error to debug. Detects calls to a binding produced by `import { use } from 'react'` whose first argument is either an inline expression (`fetch(...)`, `new Promise(...)`, async IIFE, `Promise.resolve(...)`) or a per-render local variable. Recognizes `useMemo([deps])` and React's `cache()` as stability wrappers, plus parameters, module-scope constants, and imported bindings as stable sources. See [RULES.md#a6](./RULES.md#a6--use-called-with-an-inline-created-promise).

### Changed

- **Default rule set** in `.claustra.json` now includes A5 and A6 at `error` severity. Existing configs that pin specific rules are unaffected.
- **Package description and keywords** updated to mention React 19 hook correctness coverage and add `react-19` / `hooks` keywords for npm discoverability.

## [1.4.0] — 2026-05-10

False-positive cleanup on real Next.js App Router codebases. No new rules — four existing rules' boundary handling, scope filtering, and identifier resolution corrected so they only fire where they should. Driven by scans of next-learn's `dashboard/final-example` and Vercel's `ai-chatbot`, where claustra was producing significant noise on patterns that are not actual bugs.

346 tests, no breaking changes — every existing rule and reporter is unchanged.

### Fixed

- **A01 honors the `'use server'` directive as a server-side boundary.** When a Client Component imports a Server Action from a `'use server'` file, claustra previously walked the module graph through that file and flagged its server-only imports (Prisma, `node:fs`, secret env vars) as "client-reachable." This was a false positive: at build time Next.js replaces the import with a fetch stub; the file body and its transitive imports never cross into the client bundle. Both BFS sites (`src/scanner/boundary.ts` and `src/rules/a01-server-only-in-client.ts`) now skip deps whose source file has a top-level `'use server'` directive. (PR #33)

  Real-world impact, scanned against [next-learn's `dashboard/final-example`](https://github.com/vercel/next-learn): A01 went from 3 critical findings to 0. Other rules that consume `boundaryMap` (B01, B02, D01) automatically benefit from the corrected classification.

- **D01 scopes hydration checks to client-reachable code and resolves identifiers via the TS symbol table.** D01 used to fire in any source file. Now it skips:
  - **Route Handlers** (`route.{ts,tsx,js,jsx}` under `app/`) — server endpoints, never hydrate.
  - **`'use server'` files** — RPC stubs on the client side; bodies execute server-only.
  - **Files the boundary classifier marks `'server'`** — not reachable from any `'use client'` tree.

  And per-finding: `checker.getSymbolAtLocation(rootIdent)` resolves the offending identifier. If any of the symbol's declarations lives in a non-declaration file (project code — parameter, ORM column, imported binding, local var), the finding is dropped. Catches Drizzle column properties named `document`, helper functions taking a `document` parameter, and code that imports a project-local `Date` utility. (PR #35)

- **B01 skips `'either'`-classified files.** B01 already skipped files explicitly marked `'use client'`. It still fired on files classified `'either'` — without the directive but reachable from a Client Component via the import graph. In Next.js, once a module is pulled into the client bundle by a `'use client'` boundary, its code executes in the client tree; a function prop passed to a Client Component child does not cross any boundary. The same reasoning that already applied to `'use client'` files now extends to `'either'`. (PR #36)

- **B02 narrows the spread-prop check and skips `'either'` files.** Two fixes:
  1. **Boundary scope** (parallel to B01): also skip `'either'`-classified files.
  2. **Spread narrowing**: blanket-flagging every `<Primitive {...obj}/>` fired on every shadcn/ui-style wrapper, every forwarding component, every props pass-through. The dominant shape in real codebases is `(props) => <Primitive {...props} />` (or its destructured-rest variant `({ className, ...rest }) =>`), where the spread source is the wrapper's own typed parameter — not server data. The blanket-flag was replaced with a positive signal: spread is flagged only when the source resolves (via TS symbol) to a value initialized from an unfiltered Prisma/Mongoose query, mirroring the existing `valueIsWholeRecord` check used for named props. Parameter-derived sources are explicitly skipped via a new `isParameterDerived` helper that walks `BindingElement → ObjectBindingPattern` up to a `Parameter`. (PR #37)

### Limitations of the cleanup

- Function-level `'use server'` directives (inline Server Actions inside a Client Component file) are still walked through by A01. Modeling those would require function-level granularity in the module graph and is deferred.
- Symbol resolution in D01 is a single-step check; an alias chain that traces back to `lib.dom.d.ts` is followed via TS's resolver, which the check honors.
- B02's narrowed spread-flag does not catch a spread of `await fetch(...).then(r => r.json())` — extending the `valueIsWholeRecord` analysis to handle fetch chains is a future enhancement.

## [1.3.0] — 2026-05-10

Closes the Next.js 16 caching-correctness arc opened by D3 in v1.2.0. Two new rules covering the rest of the `'use cache'` directive surface and the `next/cache` invalidation primitives. 338 tests, no breaking changes.

### Added

- **D4 — `'use cache'` function without `cacheLife` or `cacheTag`** (severity: medium, default `warn`). Pairs with D3 in covering the Next.js 16 caching directive surface. Each cached scope (function-level `'use cache'`, or every top-level function in a file-level cached file) is checked for at least one direct call to `cacheLife()` or `cacheTag()` resolved against `next/cache` imports. Without those, the cache lifetime and invalidation behavior come from framework defaults that drift between Next.js minor versions; pairing the directive with at least one configurator makes the cache contract explicit at the call site. Skipped on Next.js 15 and earlier. See [RULES.md#d4](./RULES.md#d4--use-cache-function-without-cachelife-or-cachetag).
- **D5 — `revalidateTag` / `revalidatePath` / `updateTag` outside a mutation context** (severity: high). Walks the AST tracking `inUseCache`, `inUseServer`, and `inRouteHandler` flags. Flags calls in three contexts: `'use cache'` functions (contradictory — cached function invalidating itself), `'use client'` files (`next/cache` is server-only — throws or rejected by bundler), and Server Component render paths (no-ops or invalidates mid-render). Recognizes file-level `'use server'`, function-level `'use server'` (inline Server Actions), and HTTP-method exports of `route.{ts,tsx,js,jsx}` files under `app/` as the safe contexts. Conservative on directive-less helper modules — they may be called from a Server Action and the rule cannot tell statically. Identifier resolution follows local rebinds via `next/cache` imports. Not version-gated; applies to Next.js 13.4+. See [RULES.md#d5](./RULES.md#d5--revalidatetag--revalidatepath--updatetag-outside-a-mutation-context).

### Changed

- **Default rule set** in `.claustra.json` now includes D4 (at `warn`) and D5 (at `error`). Existing configs that pin specific rules are unaffected.
- **Package description and keywords** updated to mention the Next.js 16 caching-correctness surface and add `use-cache`/`caching` keywords for npm discoverability.

## [1.2.0] — 2026-05-10

Two new rules covering the Next.js 14 → 15 → 16 migration: the `params` Promise change and the `'use cache'` directive going stable. Both are critical-severity because the failure modes are silent — pages that render with empty data, or one user's session served from cache to another. 318 tests, no breaking changes.

### Added

- **A4 — Unawaited `params`/`searchParams` in Next.js 15+** (severity: critical). Scans `app/**/{page,layout,route,loading,error,not-found,template}.{ts,tsx,js,jsx}` for default exports, HTTP-method route handlers, and `generateMetadata`/`generateStaticParams`/`generateViewport` exports. Flags property access (`params.x`), destructure-without-await (`const { x } = params`), and pass-through (`fn(params)`) on the function-parameter symbol bound to `params` or `searchParams`. Recognizes `await params` and React's `use(params)` as safe. Skipped entirely on Next.js 14 and earlier — version detected via `node_modules/next/package.json`. See [RULES.md#a4](./RULES.md#a4--unawaited-params-or-searchparams-in-nextjs-15).
- **D3 — `'use cache'` function reads request-scoped data** (severity: critical). Walks the AST with a `cached` flag set true inside any function or whole file marked with the `'use cache'` directive. Inside cached scope, flags calls to `cookies()` / `headers()` / `draftMode()` (resolved against `next/headers` imports), recognized auth helpers (reuses C2's `KNOWN_AUTH_NAMES` + `verify*`/`require*`-style regex), and member access on a `request`/`req` parameter for `.headers` / `.cookies` / `.url` / `.nextUrl`. The "inversion pattern" — caller resolves the request-scoped value and passes a primitive into the cached function — is naturally not flagged because the call is outside the cached scope. Skipped on Next.js 15 and earlier. See [RULES.md#d3](./RULES.md#d3--use-cache-function-reads-request-scoped-data).

### Changed

- **Default rule set** in `.claustra.json` now includes A4 and D3 at `error` severity. Existing configs that pin specific rules are unaffected.
- **Package description and keywords** updated to mention the Next.js 15/16 migration coverage and add `nextjs-15`/`nextjs-16` keywords for npm discoverability.

### Removed

- **CLAUSTRA.md** and **ROADMAP.md** were deleted as stale pre-v1.0 documentation. The "Guiding principles" and "Out of scope" tables were salvaged into CONTRIBUTING.md before deletion. No code or rule behavior changed.

## [1.1.0] — 2026-05-10

Five new rules covering the security gaps the v1.0 set didn't address: leaked secrets in public env, browser-storage misuse, and the three Route Handler / middleware shapes that ship endpoints publicly when developers think they're protected. 295 tests, no breaking changes — every existing rule and reporter is unchanged.

### Added

- **A3 — Secret pattern in `NEXT_PUBLIC_` env variable** (severity: critical). Scans `.env*` files and the `env` block of `next.config.{js,ts}` for `NEXT_PUBLIC_*` values matching known secret formats — Stripe (`sk_live_…`), OpenAI / Anthropic (`sk-…` / `sk-ant-…`), AWS access keys, GitHub tokens (`ghp_*`/`gho_*`/etc.), or generic high-entropy base64/hex blobs. The literal value is never printed in findings — just the variable name and file. See [RULES.md#a3](./RULES.md#a3--secret-pattern-in-next_public_-variable).
- **B3 — Sensitive value written to browser storage** (severity: high; medium when wrapped in an unverifiable `secure*`/`encrypted*` helper). Flags `localStorage.setItem` / `sessionStorage.setItem` (and `[]=` shorthand) from client-tree code where the key matches `token`/`jwt`/`auth`/`session`/`secret`/etc. or the value is `JSON.stringify(user/profile/account/...)`. Suppressed when wrapped in a recognized encryption primitive (`encrypt`, `aesGcmEncrypt`, `sealData`, libsodium, jose's `CompactEncrypt`, …). See [RULES.md#b3](./RULES.md#b3--sensitive-value-written-to-browser-storage).
- **C3 — Webhook handler missing signature verification** (severity: critical). Detects Route Handlers that look like webhook receivers — file under a `/webhook(s)/` segment OR imports from a known SDK (`stripe`, `@octokit/webhooks`, `svix`, `@clerk/backend`, `shopify-api-node`, etc.) — and reads the request body or performs a DB write without calling a recognized verifier (`stripe.webhooks.constructEvent`, `Webhook.verify`, `verify`, or any `verify*Webhook|Signature`-named helper). Honors `if (process.env.NODE_ENV === 'development')` dev-bypass blocks. See [RULES.md#c3](./RULES.md#c3--webhook-handler-missing-signature-verification).
- **C4 — Route Handler fetches user-controlled URL without allowlist** (severity: high). Intra-handler taint analysis from request-derived sources (`searchParams.get(...)`, `request.url`, `request.nextUrl.*`, dynamic-segment `params`) into outbound HTTP sinks (`fetch`, `axios`/`got` and their `.method(...)` forms, `new Request`, `new ImageResponse({ src })`). Cleared by `validate*Url`/`check*Url`/`isAllowedUrl` helpers, allowlist `.includes()` / regex `.test()`, equality vs literal, receiver-side `.startsWith`/`.endsWith`/`.includes`/`.match` with a literal arg, or `new URL(tainted, ...)`. Exempts hardcoded-host construction (`https://api.example.com/...`, `process.env.API_BASE + tainted`). Catches the SSRF shape behind image-proxy and OG-renderer endpoints. See [RULES.md#c4](./RULES.md#c4--route-handler-fetches-user-controlled-url-without-allowlist).
- **C5 — Sensitive route lacks middleware coverage and inline auth** (severity: high). Resolves auth coverage in the order Next.js does at runtime: middleware → inline → ancestor `layout.tsx`. Flags pages and route handlers whose URL contains `/admin`, `/dashboard`, `/account`, `/settings`, or `/billing`; files inside `(authenticated)`/`(protected)`/`(dashboard)` route groups; or route handlers exporting `POST`/`PUT`/`PATCH`/`DELETE` or performing DB/FS mutations — when none of (a) `middleware.ts` matcher coverage with a body that calls a recognized auth helper, (b) inline `auth()` / `currentUser()` / `validateRequest()` / `verify*Auth` in the route file, (c) auth call in any ancestor `layout.tsx`. Webhook handlers are exempt. The `(auth)` route group is intentionally NOT treated as sensitive (Next.js's own examples use it for the unauthenticated sign-in/sign-up flow). Models the path-to-regexp matcher subset Next.js advertises. See [RULES.md#c5](./RULES.md#c5--sensitive-route-lacks-middleware-coverage-and-inline-auth).

### Changed

- **Default rule set** in `.claustra.json` now includes all 13 rules at `error` severity (D2 remains `warn`). Existing configs that pin specific rules are unaffected.
- **README "What it checks"** section reorganized by category (A/B/C/D) and updated with one-liner summaries of every new rule.
- **`src/utils/`** gains `next-paths.ts` (App Router file path → URL path, with route-group / parallel-slot / intercepting-marker / dynamic-segment handling) and `middleware-matcher.ts` (path-to-regexp v6 subset → `RegExp` with conservative bail-out). Both have full unit-test coverage and are reusable by future rules.

## [1.0.1] — 2026-05-04

### Fixed

- **`.claustra.json` `ignore` field is now actually applied.** It was in the schema since v0.1.0 but never consulted at finding time, so user-provided ignore globs silently did nothing. A minimal minimatch-style matcher (`**`, `*`, `?`) now filters findings by relative file path before the reporter runs.
- **D1 (hydration risks) skips Next.js metadata-convention files.** `sitemap.ts`, `robots.ts`, `manifest.ts`, `opengraph-image.{ts,tsx}`, `twitter-image.{ts,tsx}`, `icon.{ts,tsx}`, `apple-icon.{ts,tsx}`, and `favicon.{ts,tsx}` run server-side at build/request time and never hydrate, so render-scope hydration patterns inside them are not actually hydration risks. Surfaced from real-world testing — claustra was emitting up to 7 false positives per `sitemap.ts`.
- **D1 recognizes `typeof window === 'undefined'` early-return guards.** Browser-global reads inside a function whose earlier statements include `if (typeof window === 'undefined') return;` (or `throw`, or with `document`/`navigator`/`localStorage`/`sessionStorage`) are now treated as gated to client-side execution. Cleared a class of false positives in utility modules that intentionally guard before reading globals.

### Cleaned up

- **Test-fixture `package.json` manifests no longer declare fake `next`/`react` dependencies.** Those declarations were purely cosmetic — the fixtures don't run `npm install`, there's no `node_modules` in any fixture, and claustra reads the *scanned* project's `node_modules/next/package.json` for version detection rather than the fixture's manifest. The fake deps were tripping repo-level supply-chain scanners (Socket et al.) into reporting fictitious Next.js CVEs against the claustra repo. The published npm tarball was unaffected (fixtures are excluded by the `files` field), but the noise on the GitHub side is now gone.

### Validation

Re-running v1.0.1 against a real Next.js App Router site dropped findings from 27 to 13 — every remaining finding is a real bug or worth a manual look. The 14 cleared findings were exactly the three false-positive classes above.

## [1.0.0] — 2026-05-03

Initial release. Eight static rules covering the full Next.js App Router server/client boundary surface:

- **A1** — Server-only code reachable from the client tree (module graph)
- **A2** — RSC pattern misuse (AST)
- **B1** — Non-serializable props (TS type checker)
- **B2** — Server data leakage to client (TS type checker)
- **C1** — Server Actions without input validation (forward taint)
- **C2** — Server Actions without authorization (data flow)
- **D1** — Hydration mismatch risks (AST)
- **D2** — Caching & dynamic-rendering surprises (AST + Next.js version-aware)

Static-only — no network calls, no API keys, no telemetry. Three reporters (`terminal`, `json`, `github`). MIT.
