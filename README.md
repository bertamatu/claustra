# claustra

[![CI](https://github.com/bertamatu/claustra/actions/workflows/ci.yml/badge.svg)](https://github.com/bertamatu/claustra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-20%2B-green.svg)](https://nodejs.org/)

> **Catches the ten ways a Next.js App Router project can ship secret data to visitors, crash on hydrate, or expose unauthenticated database writes.** Pure static analysis, no network calls, no API keys, no telemetry — runs entirely on your machine in a few seconds.

---

## Why claustra exists

Next.js App Router is powerful but unforgiving. The same file can mix code that runs on your server with code that runs in every visitor's browser, and the line between them is a single `'use client'` directive at the top of a file. **Cross that line wrong and one of three bad things happens:**

### 1. You leak server-only data into the browser bundle

A function that fetches a user record from the database. A `process.env.STRIPE_SECRET_KEY` lookup. A whole row that includes `passwordHash`. If any of these end up reachable from a `'use client'` file — even five imports deep, even through a barrel file — the bundler quietly ships them to the browser. Every visitor's browser, every page load. Next.js' build only sometimes catches this.

### 2. You break the page when it loads

React hydration mismatches happen when the HTML the server sent doesn't match what the browser tries to render a millisecond later. Pages flash. Layouts shift. The error in production is a vague *"text content does not match server-rendered HTML"* you can't reproduce locally. The usual culprits are tiny: a `new Date()` in a render body, a `Math.random()` for a key, a `localStorage.getItem()` outside `useEffect`.

### 3. You expose Server Actions without auth or validation

Every Server Action (a function with `'use server'`) is a public HTTP POST endpoint — anyone can call it from any browser, with any payload, regardless of what your UI lets them do. TypeScript types are erased at runtime. Without explicit validation and an authorization check, a Server Action that updates user profiles can be called by anyone to update *anyone's* profile.

**claustra catches all three classes statically, before the code ever runs.**

---

## See it in action

Here's a real bug pattern claustra catches. Suppose you have a Client Component for display:

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

Looks innocent. The problem: `db.user.findUnique` returns *every column on the row* — including `passwordHash`, `stripeCustomerId`, internal notes, anything else the schema decides to add later. All of it gets serialized into the page HTML and into the JavaScript bundle the browser downloads. Anyone can View Source.

Run `npx claustra .` and you get:

```
claustra found 1 issue in 1 file

  ✖ critical  app/profile/page.tsx:7
    B02-SERVER-DATA-LEAKAGE — Whole DB record passed as prop "user" to a Client Component
    The value of this prop comes directly from a Prisma/Mongoose query that did
    not specify a `select` or `omit`. The full row — including any private
    columns — is serialized into the page HTML and JS.
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

That's the shape of every claustra finding: rule ID, file:line, plain-English explanation of why it matters, and a concrete fix.

---

## Quickstart (5 minutes, zero config)

You need **Node.js 20 or newer** and a Next.js project that uses the App Router.

### 1. Check your Node version

```bash
node --version
```

If it prints `v20.x` or higher you're good. If not, install the latest LTS from [nodejs.org](https://nodejs.org/) or use [nvm](https://github.com/nvm-sh/nvm).

### 2. Run claustra against your project

From inside your Next.js project root:

```bash
npx claustra .
```

The first run downloads claustra and its TypeScript runtime dependency (a few MB total, since claustra uses the real TS compiler API for module resolution and type-checking). Subsequent runs of the same version are cached and start in under a second. No install step, no config file, no flags required.

### 3. Read the output

Each finding tells you four things:

| Part | Example | What it means |
|---|---|---|
| **Severity** | `✖ critical` | How bad. critical → fix today. high → before merge. medium → when you can. |
| **Location** | `app/profile/page.tsx:7` | The exact file and line, click-through in most terminals. |
| **What & why** | `B02 — Whole DB record passed as prop "user"` | The rule + a one-line explanation of why this is a bug. |
| **How to fix** | `→ Add select: { ... } to the query` | A concrete, actionable suggestion. |

The exit code matches the severity: `0` if nothing serious, `1` if anything at or above your `--severity` threshold (default `high`), `2` if claustra itself crashed.

### 4. Wire it into CI (optional, recommended)

Drop this file in your repo:

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

The `--reporter=github` flag emits [GitHub Actions annotations](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message), so findings appear inline on your pull-request diff. The job fails on any high-or-above finding, so it doubles as a required check.

---

## What it checks

Ten rules across four categories. Each one cites authoritative Next.js / React docs or a CVE — see [`RULES.md`](./RULES.md) for the full per-rule reference, code examples, and source links.

**Boundary integrity (A)**
- **A1** — Server-only code reachable from the client tree (`@prisma/client`, `node:fs`, secret env vars), traced through barrel files and path aliases.
- **A2** — RSC pattern misuse: `cookies()`/`useState`/event handlers in the wrong component type, misplaced directives.
- **A3** — Secret-shaped value in a `NEXT_PUBLIC_` env variable (Stripe / OpenAI / Anthropic / AWS / GitHub formats, or high-entropy base64/hex). Scans `.env*` files and the `env` block of `next.config.{js,ts}`. Never prints the literal value.

**Data crossing the boundary (B)**
- **B1** — Non-serializable props: functions, classes, `Map`/`Set`/`Symbol`/`BigInt`, raw `Date`.
- **B2** — Server data leakage: sensitive prop names, spread props, whole DB records crossing into Client Components.
- **B3** — Auth tokens or PII written to `localStorage` / `sessionStorage` from client code (key matches `token`/`jwt`/`auth`/`session`/`secret`/…, or value is `JSON.stringify(user/profile/account)`). Suppressed when the value is wrapped in a recognized encryption helper; downgraded to medium when wrapped in an unverifiable `secure*`/`encrypted*` function.

**Server Action safety (C)**
- **C1** — Server Actions whose parameters reach a database write, `fetch()`, or cache invalidation without passing through a recognized validator (Zod, Valibot, Yup, ArkType, TypeBox).
- **C2** — Server Actions that mutate without an authorization check (NextAuth `auth()`, Clerk `currentUser()`, Lucia `validateRequest()`, custom `verify*`/`require*`/`check*` helpers).

**Rendering correctness (D)**
- **D1** — Hydration mismatch risks: `Date`, `Math.random()`, browser globals in render scope, locale formatters without explicit locale.
- **D2** — Caching & dynamic-rendering surprises: Next.js 14 ↔ 15 default-`fetch` behavior, `cookies()`/`headers()` in statically-cached routes, ISR mismatches.

---

## How claustra compares

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

claustra is meant to run **alongside** `eslint-config-next` and TypeScript, not replace them. ESLint covers style and generic React rules. TypeScript catches type mismatches. claustra catches the App-Router-specific *boundary* failures — the kind that compile cleanly, pass type-check, look correct on a code review, and still ship a security bug.

---

## FAQ

**Does claustra send my source code anywhere?**
No. Zero network calls during a scan. No telemetry. No API keys. The only files it reads are inside the project you point it at; the only output is the findings on stdout (or wherever `--json-output` writes). Run it on the most private codebase you have.

**Does it work with Pages Router?**
App Router only — that's where the rules are tuned. Pages Router files in a mixed-router project will still be scanned (they're part of the same TypeScript program) and a few rules like D1 (hydration) will still fire on them, but the rules aren't tailored to that paradigm — expect occasional false positives. If your codebase is Pages-Router-only, claustra isn't the right tool.

**How long does a scan take?**
About 3–10 seconds on a 500-file Next.js project on a 2024-era laptop. The first `npx` run also downloads claustra and its TypeScript runtime dependency (a few MB), which takes a few extra seconds. CI runs are network-bound for the install, scan-bound for the rest.

**What about false positives?**
Each rule has fixture-based tests (about 190 total across all 8 rules) covering both violations *and* non-violations, so the rule logic is anchored to known-good and known-bad cases. If you find a false positive on real code, please open an issue with a minimal reproduction — that's exactly the feedback loop that improves the rules.

**Do I need to install anything besides `npx claustra`?**
Just Node.js 20+. `npx` fetches claustra on first run; from then on it's cached.

**Is there a paid version, hosted dashboard, or sign-up?**
No. MIT-licensed, free forever, no upsell, no cloud component. The "fully local" design is deliberate — the codebase you scan is yours and stays yours.

**My team uses a custom auth helper. Will C2 recognize it?**
If your helper's name matches `verify*Auth/Session/User/Permission/Role/Access`, `require*…`, `check*…`, `assert*…`, or `guard*…` (case-insensitive), yes. Otherwise either rename to match or open a PR adding the helper name to the recognized list.

**Will it run as part of `next lint`?**
Not in v1. claustra is a standalone CLI. An ESLint-plugin wrapper is on the v2 roadmap, and the existing CLI is meant to coexist with `next lint`/ESLint, not replace it.

**Can I disable specific rules or whole categories?**
Yes — drop a `.claustra.json` next to your `package.json`:

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

Or pass `--rules a01,b02,c01` on the command line for a subset.

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

**Exit codes:** `0` (no findings at/above threshold), `1` (findings at/above threshold), `2` (internal error — bad config, missing tsconfig, etc.).

---

## License

MIT — see [`LICENSE`](./LICENSE). Use it on any codebase, public or private. Modify it. Bundle it (keep the LICENSE file when you redistribute). Stars are welcome but never required.

## Documentation

- [`RULES.md`](./RULES.md) — every rule with code examples, authoritative sources (Next.js docs, React docs, CVEs), and known limitations
- [`CLAUSTRA.md`](./CLAUSTRA.md) — full project specification (locked types, CLI surface, milestones)
- [`ROADMAP.md`](./ROADMAP.md) — what's planned for v2+
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to add or improve a rule
