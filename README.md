# claustra

[![CI](https://github.com/bertamatu/claustra/actions/workflows/ci.yml/badge.svg)](https://github.com/bertamatu/claustra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-20%2B-green.svg)](https://nodejs.org/)
[![npm](https://img.shields.io/npm/v/claustra.svg)](https://www.npmjs.com/package/claustra)

> **Static analyzer for Next.js App Router. Catches twenty bug shapes that compile, type-check, pass ESLint, look fine in code review - and ship broken.**

```bash
npx claustra .
```

No install, no config, no network. Pure static analysis on your machine. Twenty rules, every finding tied back to a Next.js or React doc.

---

## Why now

If your codebase is Next.js App Router, three things are probably true right now:

- **You're mid-migration to Next.js 15 or 16.** `params` and `searchParams` became Promises in 15. The `'use cache'` directive went stable in 16. Both broke a category of code that still passes `tsc` and still passes ESLint - pages render with `undefined` data, cached functions leak one user's session into another user's response.
- **You adopted React 19 Server Actions.** Every Server Action is a public POST endpoint. The action ID is in the JS bundle. Anyone can `curl` it with any payload, regardless of what your UI lets them do. Without an explicit `auth()` check, a "save profile" action saves to the wrong profile.
- **You use shadcn/ui or a similar component library.** Most components forward typed props through. When a Server Component renders one with a whole DB row, that row's `passwordHash` and `stripeCustomerId` columns ship in the page HTML to every visitor.

claustra catches all three classes - and seventeen more - before they reach production. Representative output against a typical App Router codebase:

```
$ npx claustra@latest .
claustra found 9 issues in 7 files

  ⚠ high  app/seed/route.ts:1
    C05-MIDDLEWARE-COVERAGE - Sensitive route "/seed" is not protected
    by middleware or an inline auth check

  ⚠ high  app/lib/actions.ts:38
    C02-UNAUTHORIZED-SERVER-ACTIONS - Server Action "createInvoice"
    performs a mutation without an authorization check
  …
```

A C05 finding on a public route that performs DB writes with no auth gate. C02 findings on Server Actions that mutate without an authorization check. Other C05 findings on dashboard pages without middleware coverage or inline auth. None of these surface in a `tsc` build or a Lighthouse audit. claustra finds them in three seconds.

---

## What it catches

Twenty rules across five risk classes. Every rule cites an authoritative Next.js or React doc; full per-rule reference in [`RULES.md`](./RULES.md).

| Risk class                                                  | What ships broken                                                                                                                                       | Rules                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 🛡️ **Server-only data leaks into the browser bundle**       | `process.env.STRIPE_SECRET_KEY` reachable from a `'use client'` import chain · whole Prisma rows passed as props · `NEXT_PUBLIC_` env holding a *secret* | A1 · A3 · B1 · B2    |
| 🚧 **Next.js 15/16 migration silently broken**              | `params.id` instead of `(await params).id` · `'use cache'` reading cookies · missing `cacheLife`/`cacheTag` · `revalidateTag` in render scope            | A4 · D3 · D4 · D5    |
| 🔒 **Endpoints look protected, aren't**                     | Webhook handlers without signature verify · Server Actions without auth · `/dashboard` routes that slipped past `middleware.ts` matcher · OG/image SSRF | C2 · C3 · C4 · C5    |
| 🪝 **React 19 Actions/hooks silently break loading state**  | `useFormStatus` co-located with `<form>` · `use()` with inline-created Promise · `useActionState` dispatcher outside `startTransition`                  | A5 · A6 · C6         |
| 💧 **Hydration & client-state mistakes**                    | `new Date()` in render · browser globals before mount · auth tokens in `localStorage` · `cookies()` in a static-cached route                            | A2 · B3 · D1 · D2    |

ESLint and TypeScript don't catch any of these - they're App-Router-specific *boundary* failures, the kind that compile cleanly and look correct on a code review.

---

## How claustra compares

| Capability                                              | claustra | `eslint-config-next` | TypeScript |
| ------------------------------------------------------- | :------: | :------------------: | :--------: |
| Static module-graph trace from every `'use client'`     |    ✅    |          ❌          |     ❌     |
| Server-only package + `node:fs`/env leak detection      |    ✅    |        partial       |     ❌     |
| Secret patterns in `NEXT_PUBLIC_*` env values           |    ✅    |          ❌          |     ❌     |
| Non-serializable props (`Date`, `Map`, class, fn)       |    ✅    |          ❌          |   partial  |
| Sensitive-data prop leakage (DB record, secrets)        |    ✅    |          ❌          |     ❌     |
| Auth tokens written to `localStorage` / `sessionStorage`|    ✅    |          ❌          |     ❌     |
| Server Action input-validation taint analysis           |    ✅    |          ❌          |     ❌     |
| Server Action authorization checks                      |    ✅    |          ❌          |     ❌     |
| Webhook signature-verification check                    |    ✅    |          ❌          |     ❌     |
| Route Handler SSRF taint analysis                       |    ✅    |          ❌          |     ❌     |
| Middleware auth-coverage / `config.matcher` drift       |    ✅    |          ❌          |     ❌     |
| Next.js 15+ `params` / `searchParams` Promise migration |    ✅    |          ❌          |   partial  |
| Next.js 16 `'use cache'` correctness (`cookies`, tags)  |    ✅    |          ❌          |     ❌     |
| `revalidateTag` outside mutation context                |    ✅    |          ❌          |     ❌     |
| React 19 hook correctness (`useFormStatus`, `use()`)    |    ✅    |          ❌          |     ❌     |
| Hydration-mismatch render-scope checks                  |    ✅    |        partial       |     ❌     |
| Runs locally, no API keys, no telemetry                 |    ✅    |          ✅          |     ✅     |

claustra is meant to run **alongside** `eslint-config-next` and TypeScript, not replace them. ESLint covers style and generic React rules. TypeScript catches type mismatches. claustra catches the App-Router-specific *boundary* failures.

---

## See it in action

A real bug pattern claustra catches. You have a Client Component for display:

```tsx
// app/profile/ProfileCard.tsx
'use client';
export const ProfileCard = ({ user }: { user: unknown }) => <div>{/* ... */}</div>;
```

…and a Server Component that loads a user from your database and renders it:

```tsx
// app/profile/page.tsx  (Server Component, no 'use client')
import { db } from '@/lib/db';
import { ProfileCard } from './ProfileCard';

export default async function Page() {
  const user = await db.user.findUnique({ where: { id: '...' } });
  return <ProfileCard user={user} />;        // 🟥 the whole row crosses the boundary
}
```

Looks innocent. The problem: `db.user.findUnique` returns *every column on the row* - including `passwordHash`, `stripeCustomerId`, and anything else the schema decides to add later. All of it gets serialized into the page HTML and into the JavaScript bundle the browser downloads. View Source reveals the lot.

```bash
$ npx claustra .

claustra found 1 issue in 1 file

  ✖ critical  app/profile/page.tsx:7
    B02-SERVER-DATA-LEAKAGE - Whole DB record passed as prop "user" to a Client Component
    The value of this prop comes directly from a Prisma/Mongoose query that did
    not specify a `select` or `omit`. The full row - including any private
    columns - is serialized into the page HTML and JS.
    → Add `select: { ... }` (or `omit: {...}`) to the query so only the fields
      the UI needs cross the boundary, or destructure the safe fields explicitly.

1 issue: 1 critical
```

The fix:

```tsx
const user = await db.user.findUnique({
  where: { id: '...' },
  select: { id: true, name: true, avatarUrl: true },   // ✅ only what the UI needs
});
return <ProfileCard user={user} />;
```

Every claustra finding has the same shape: rule ID, file:line, plain-English explanation of why it matters, and a concrete fix.

---

## Quickstart

You need **Node.js 20+** and a Next.js project that uses the App Router.

```bash
# from inside your Next.js project root
npx claustra .
```

The first run downloads claustra and its TypeScript runtime dependency (a few MB total). Subsequent runs of the same version are cached and start in under a second. No install step, no config file, no flags required.

### Wire it into CI

```yaml
# .github/workflows/claustra.yml
name: claustra
on:
  pull_request:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx -y claustra@latest . --reporter=github
```

`--reporter=github` emits [GitHub Actions annotations](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message), so findings appear inline on your pull-request diff. The job fails on any high-or-above finding, so it doubles as a required check.

### Reading the output

Each finding tells you four things:

| Part         | Example                                            | What it means                                                              |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Severity     | `✖ critical`                                       | critical → fix today · high → before merge · medium → when you can         |
| Location     | `app/profile/page.tsx:7`                           | The exact file and line, click-through in most terminals                   |
| What & why   | `B02 - Whole DB record passed as prop "user"`      | The rule + a one-line explanation of why this is a bug                     |
| How to fix   | `→ Add select: { ... } to the query`               | A concrete, actionable suggestion                                          |

Exit codes match the threshold: `0` if nothing serious, `1` if anything at or above your `--severity` threshold (default `high`), `2` if claustra itself crashed.

---

## CLI reference

```
npx claustra [path]                          # scan, default cwd
  --config <file>                            # default .claustra.json
  --reporter <terminal|json|github>          # default terminal
  --severity <critical|high|medium|low>      # min severity to fail (default high)
  --rules <a01,b02,...>                      # run subset
  --json-output <path>                       # write findings to a file
  --version
  --help
```

### Configuration

Drop a `.claustra.json` next to your `package.json` to disable rules, lower severity, or add ignore globs:

```json
{
  "rules": {
    "d02-caching-dynamic": "off",
    "b01-non-serializable-props": "warn"
  },
  "extraServerOnlyModules": ["@my-org/internal-secrets"],
  "ignore": ["**/legacy/**"]
}
```

---

## All twenty rules

<details>
<summary><strong>Boundary integrity (A) - six rules</strong></summary>

- **A1** - Server-only code reachable from the client tree (`@prisma/client`, `node:fs`, secret env vars), traced through barrel files and path aliases. Honors the `'use server'` boundary as an RPC stub.
- **A2** - RSC pattern misuse: `cookies()`/`useState`/event handlers in the wrong component type, misplaced directives.
- **A3** - Secret-shaped value in a `NEXT_PUBLIC_` env variable (Stripe / OpenAI / Anthropic / AWS / GitHub formats, or high-entropy base64/hex). Scans `.env*` files and the `env` block of `next.config.{js,ts}`. Never prints the literal value.
- **A4** - `params` or `searchParams` accessed without `await` in a Next.js 15+ page, layout, route handler, or `generateMetadata`/`generateStaticParams`. Catches `params.x`, `const { x } = params`, and pass-through into another call. Recognizes `use(params)` as the safe Client-Component alternative. Skipped on Next.js 14.
- **A5** - `useFormStatus` from `react-dom` called in the same component that renders the `<form>`. The hook reads from a *parent* `<form>`; co-locating it returns `pending: false` permanently and the submit button never reflects the in-flight state.
- **A6** - `use()` from `react` called with a Promise that is created inline (`fetch(...)`, `new Promise(...)`, async IIFE) or held in a per-render local variable. The hook deduplicates by reference; an unstable reference produces infinite suspension. Recognizes `useMemo([deps])` and React's `cache()` as stability wrappers.

</details>

<details>
<summary><strong>Data crossing the boundary (B) - three rules</strong></summary>

- **B1** - Non-serializable props: functions, classes, `Map`/`Set`/`Symbol`/`BigInt`, raw `Date`. Skips Server Actions (they're an exempt callable reference). Skips `'use client'` and `'either'`-classified files (no boundary crossed).
- **B2** - Server data leakage: sensitive prop names, whole DB records spread into Client Components. The spread check requires the source to resolve to an unfiltered Prisma/Mongoose query - the React forwarding-prop pattern (`<Primitive {...props} />`) is recognized and skipped.
- **B3** - Auth tokens or PII written to `localStorage` / `sessionStorage` from client code (key matches `token`/`jwt`/`auth`/`session`/`secret`/…, or value is `JSON.stringify(user/profile/account)`). Suppressed when wrapped in a recognized encryption helper; downgraded to `medium` for unverifiable `secure*`/`encrypted*` wrappers.

</details>

<details>
<summary><strong>Server Action safety (C) - six rules</strong></summary>

- **C1** - Server Actions whose parameters reach a database write, `fetch()`, or cache invalidation without passing through a recognized validator (Zod, Valibot, Yup, ArkType, TypeBox).
- **C2** - Server Actions that mutate without an authorization check (NextAuth `auth()`, Clerk `currentUser()`, Lucia `validateRequest()`, custom `verify*`/`require*`/`check*` helpers).
- **C3** - Webhook route handlers (`stripe`/`svix`/`@octokit/webhooks`/`@clerk/backend`/etc., or any `route.ts` under a `/webhook(s)/` segment) that read the request body or perform a database write without calling a recognized signature verifier.
- **C4** - Route Handlers (`route.ts`) that pass a request-derived URL - `searchParams.get(...)`, `request.url`, `request.nextUrl.*`, dynamic-segment `params` - to `fetch` / `axios` / `got` / `new Request` / `new ImageResponse({ src })` without an allowlist check, a `validate*Url`-style helper, or a hardcoded host. Catches the SSRF shape behind image-proxy and OG-renderer endpoints.
- **C5** - Sensitive App Router pages and route handlers (paths under `/admin`, `/dashboard`, `/account`, `/settings`, `/billing`; files in `(authenticated)`/`(protected)`/`(dashboard)` route groups; route handlers exporting `POST`/`PUT`/`PATCH`/`DELETE` or performing DB/FS mutations) that are neither covered by an auth-calling `middleware.ts` matcher nor protected by an inline `auth()` call (or one in an ancestor `layout.tsx`). Catches matcher-drift bugs.
- **C6** - The dispatcher returned by React 19's `useActionState` called outside `startTransition` and not assigned to a `<form action={dispatch}>` / `formAction` prop. The transition is required for `isPending` to track the in-flight state.

</details>

<details>
<summary><strong>Rendering correctness (D) - five rules</strong></summary>

- **D1** - Hydration mismatch risks: `Date`, `Math.random()`, browser globals in render scope, locale formatters without explicit locale. Scoped to client-reachable code; identifiers resolve via the TS symbol table to distinguish the global `document` from a parameter named `document`.
- **D2** - Caching & dynamic-rendering surprises: Next.js 14 ↔ 15 default-`fetch` behavior, `cookies()`/`headers()` in statically-cached routes, ISR mismatches.
- **D3** - `'use cache'` functions that read request-scoped state (`cookies()` / `headers()` / `draftMode()`, auth helpers, `request.headers`/`cookies`/`url`). Recognizes the inversion pattern (caller resolves the value, passes a primitive into the cached function). Skipped on Next.js 15 and earlier.
- **D4** - `'use cache'` function without an explicit `cacheLife()` or `cacheTag()` from `next/cache`. Contract hygiene; defaults drift between Next.js minor versions. Default severity `warn`.
- **D5** - `revalidateTag` / `revalidatePath` / `updateTag` from `next/cache` called outside a mutation context: inside a Client Component (throws), during a Server Component render (no-ops), or inside a `'use cache'` function (contradictory).

</details>

---

## FAQ

**Does claustra send my source code anywhere?**
No. Zero network calls during a scan. No telemetry. No API keys. The only files it reads are inside the project you point it at; the only output is the findings on stdout (or wherever `--json-output` writes). Run it on the most private codebase you have.

**Does it work with Pages Router?**
App Router only - that's where the rules are tuned. Pages-Router-only projects should use `eslint-plugin-next` instead.

**How long does a scan take?**
About 3–10 seconds on a 500-file Next.js project on a 2024-era laptop. The first `npx` run also downloads claustra and its TypeScript runtime dependency.

**What about false positives?**
Each rule has fixture-based tests (379 total across all 20 rules) covering both violations *and* non-violations. Real-world scans against production App Router codebases drove a dedicated false-positive cleanup release (v1.4.0) tightening A01, B01, B02, and D01, plus a follow-up v1.6.1 cleanup for D01. If you find a false positive on real code, please open an issue with a minimal reproduction.

**Do I need to install anything besides `npx claustra`?**
Just Node.js 20+. `npx` fetches claustra on first run; from then on it's cached.

**Is there a paid version, hosted dashboard, or sign-up?**
No. MIT-licensed, free forever, no upsell, no cloud component. The "fully local" design is deliberate.

**My team uses a custom auth helper. Will C2 recognize it?**
If your helper's name matches `verify*Auth/Session/User/Permission/Role/Access`, `require*…`, `check*…`, `assert*…`, or `guard*…` (case-insensitive), yes. Otherwise either rename to match or open a PR adding the helper name to the recognized list.

**Will it run as part of `next lint`?**
Not currently. claustra is a standalone CLI. An ESLint-plugin wrapper is on the roadmap.

**Can I disable specific rules?**
Yes - see the [Configuration](#configuration) section above, or pass `--rules a01,b02,c01` on the command line for a subset.

---

## License

MIT - see [`LICENSE`](./LICENSE). Use it on any codebase, public or private. Modify it. Bundle it (keep the LICENSE file when you redistribute). Stars are welcome but never required.

## Documentation

- [`RULES.md`](./RULES.md) - every rule with code examples, authoritative sources (Next.js docs, React docs, CVEs), and known limitations
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - guiding principles, out-of-scope concerns, and how to add or improve a rule
- [`CHANGELOG.md`](./CHANGELOG.md) - release notes and behavior changes since v1.0
