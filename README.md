# claustra

[![CI](https://github.com/bertamatu/claustra/actions/workflows/ci.yml/badge.svg)](https://github.com/bertamatu/claustra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-20%2B-green.svg)](https://nodejs.org/)

> A CLI that audits Next.js App Router projects for the ways code or data can unsafely cross the server/client boundary. Static analysis only — no network calls, no telemetry, runs entirely on your machine.

**v1.0.0.** All eight rules ship as static checks (A1, A2, B1, B2, C1, C2, D1, D2). See [`RULES.md`](./RULES.md) for per-rule semantics, [`CLAUSTRA.md`](./CLAUSTRA.md) for the full spec, and [`ROADMAP.md`](./ROADMAP.md) for what's coming in v2+.

## Install & run

```bash
# One-off scan against the current Next.js project:
npx claustra .

# Or in CI:
npx claustra . --reporter=github

# Machine-readable output:
npx claustra . --reporter=json --json-output=findings.json
```

No config required. Drop a `.claustra.json` in your project root if you want to tune severities, ignore paths, or extend `extraServerOnlyModules`. See `CLAUSTRA.md` for the full schema.

## What it catches in v1.0

| ID  | Rule                               | Severity | What it flags                                                                                          |
| --- | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| A1  | Server-only code in client tree    | critical | Modules reachable from a `'use client'` file that import Node builtins (`node:fs`, `node:crypto`, …), known server-only packages (`@prisma/client`, `pg`, `mongoose`, `bcrypt`, `jsonwebtoken`, `server-only`, …), or read non-`NEXT_PUBLIC_` `process.env` vars. Reports the full import chain through barrel re-exports, path aliases, and workspace packages. |
| A2  | RSC pattern misuse                 | high     | Server APIs (`cookies`, `next/headers`, `server-only`) in `'use client'` files. React client hooks (`useState`, `useEffect`, `useRouter`) in server components. Event handlers on intrinsic JSX in server components. Misplaced `'use client'` / `'use server'` directives. Async client components. |
| B1  | Non-serializable props             | high     | Functions, class instances, `Map`, `Set`, `Symbol`, `BigInt` passed as props to a `'use client'` component (`Date` flagged at medium). Server Actions exempted. Skips `children`, `Promise`, spread props (B2's job), and props passed to server components. |
| B2  | Server data leakage to client      | critical | Sensitive prop names (`secret*`, `token*`, `password*`, `apiKey*`, `privateKey*`, `hash*`, `salt*`, `sessionId*`, `stripeSecret*`, `jwt*`), spread props (`<C {...obj} />`), and identifier-valued props that resolve to a Prisma/Mongoose query (`findFirst`/`findUnique`/`findMany`/`findOne`/…) without `select` or `omit`. |
| C1  | Server Actions without validation  | critical | Forward taint from each Server Action's parameters into DB/FS writes, `fetch()` URL/body, or `revalidatePath`/`revalidateTag` — flagged when no recognized validator (Zod, Valibot, Yup, ArkType, TypeBox) sits on the path. `JSON.parse`, `Number(...)`, etc. are explicitly NOT counted as validators. |
| C2  | Server Actions without auth        | high     | A function with file-level or inline `'use server'` that performs a DB/FS write (Prisma/Drizzle/Mongoose write methods, `fs.write*`/`rm*`/`rename*`, raw-SQL `INSERT/UPDATE/DELETE` template tags) before any recognized auth call (`auth()`, `getServerSession()`, `currentUser()`, `validateRequest()`, or `verify*`/`require*`/`check*`/`assert*`/`guard*` helpers). |
| D1  | Hydration mismatch risks           | high     | `Date.now()` / bare `new Date()` / `Math.random()` / `crypto.randomUUID()` / `performance.now()` in render scope. Reads of `window` / `document` / `navigator` / `localStorage` / `sessionStorage`. Locale formatters without explicit locale. Skipped inside `useEffect`, event handlers, and on elements with `suppressHydrationWarning`. |
| D2  | Caching & dynamic surprises        | medium   | `cookies()`/`headers()` in routes declared `force-static` (error) or `revalidate = N` (warning). Mismatched `revalidate` between route and `fetch`. `fetch` to `localhost`/`127.0.0.1`. Bare `fetch` in ISR routes on Next 15+ (no-store default). |

Each finding includes the rule ID, file:line, a one-line summary, an explanation of why it matters, and a concrete fix suggestion. Output reads like senior-engineer PR comments, not an ESLint dump.

## Use in CI (GitHub Actions)

claustra ships a `--reporter=github` mode that emits [GitHub Actions annotations](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message), so findings show up inline on the PR diff.

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
        with:
          node-version: '20'
      - run: npx -y claustra@latest . --reporter=github
```

The job exits non-zero whenever any finding meets `--severity` (default `high`), so it doubles as a required check.

## How it compares

| Capability                                            | claustra | `eslint-config-next` | TypeScript |
| ----------------------------------------------------- | :------: | :------------------: | :--------: |
| Static module-graph trace from every `'use client'`   |    ✅    |          ❌          |     ❌     |
| Server-only package + `node:fs`/env leak detection    |    ✅    |        partial       |     ❌     |
| Non-serializable props (`Date`, `Map`, class, fn)     |    ✅    |          ❌          |   partial  |
| Sensitive-data prop leakage (DB record, secrets)      |    ✅    |          ❌          |     ❌     |
| Server Action input-validation taint analysis         |    ✅    |          ❌          |     ❌     |
| Server Action authorization checks                    |    ✅    |          ❌          |     ❌     |
| Hydration-mismatch render-scope checks                |    ✅    |        partial       |     ❌     |
| Next.js 14↔15 caching/`fetch` default differences     |    ✅    |          ❌          |     ❌     |
| Runs locally, no API keys, no telemetry               |    ✅    |          ✅          |     ✅     |

claustra is meant to run **alongside** `eslint-config-next` and TypeScript, not replace them. ESLint covers style and generic React rules; TypeScript covers type errors; claustra covers the App-Router-specific boundary failures the other two miss.

## CLI

```
npx claustra [path]                       # scan, default cwd
  --config <file>                         # default .claustra.json
  --reporter <terminal|json|github>       # default terminal
  --severity <critical|high|medium|low>   # min severity to fail (default high)
  --rules <a02,d01,...>                   # run subset
  --json-output <path>                    # write findings to file
```

Exit codes: `0` (no findings at/above threshold), `1` (findings at/above threshold), `2` (internal error).

## License

MIT. See [`LICENSE`](./LICENSE).

## Documentation

- [`CLAUSTRA.md`](./CLAUSTRA.md) — full project spec (locked types, CLI surface, milestones)
- [`RULES.md`](./RULES.md) — every rule with authoritative source links (Next.js docs, React docs, CVEs)
- [`ROADMAP.md`](./ROADMAP.md) — what's planned for v2+
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to add a new rule
