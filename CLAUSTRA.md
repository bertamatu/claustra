# claustra — Project Spec for Claude Code

> A CLI that audits Next.js App Router projects for the 8 ways code or data can unsafely cross the server/client boundary. Static analysis only — no network calls, no telemetry. Open source, MIT, npm-distributed.

---

## How to use this document

This is the source of truth for what `claustra` is and how to build it. Read it top-to-bottom before writing any code. When in doubt about scope, refer back to "Guiding principles" and "Out of scope" — they prevent feature creep.

Before each implementation task, also read `.claude/skills/claustra-conventions.md` (the skill document). It encodes how to *write* the code; this document encodes *what* to build.

---

## What is claustra

A CLI tool, distributed as an npm package, that runs against a Next.js App Router codebase and reports the 8 footgun categories below. The tool is named after the Latin word for "barriers, bolts, locked enclosures" — it guards the server/client boundary in RSC applications.

**One-liner:** "claustra catches the 8 ways your Next.js App Router code can leak data, skip validation, or break hydration — without sending a line of source code anywhere."

**Distribution:** `npx claustra` runs against the current directory. No config required for default behavior.

**License:** MIT.

---

## Guiding principles

Three non-negotiable rules that shape every decision:

1. **One framework, one paradigm.** Next.js App Router + RSC. Not Pages Router, not Remix, not vanilla React. Specificity is the pitch.
2. **One concern: the server/client boundary.** Every check must relate to "what happens when code or data crosses from server to client." If a check doesn't, it goes in a different tool.
3. **Static-only, fully local.** Every rule runs against the local TypeScript program. No network calls, no API keys, no third-party services in the runtime path.

If a proposed feature doesn't fit all three, it's out of scope or a v2+ consideration.

---

## The 8 audit categories (v1 scope)

### Category A — Boundary integrity

#### A1: Server-only code reachable from client tree
**Severity:** critical · **Mechanism:** module graph

Build a transitive import graph from every `'use client'` file. Flag any reached module that:
- Imports `node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:net`, `node:dns`
- Imports known server-only packages: `pg`, `mysql2`, `mongodb`, `mongoose`, `@prisma/client`, `redis`, `ioredis`, `bcrypt`, `bcryptjs`, `jsonwebtoken`, `nodemailer`
- Imports the `'server-only'` package
- Reads `process.env.X` where `X` does not start with `NEXT_PUBLIC_`

Output: full import chain (`ClientComponent.tsx → utils/db.ts → @prisma/client`).
Allow extension via `extraServerOnlyModules` in config.

#### A2: RSC pattern misuse
**Severity:** high · **Mechanism:** AST

In `'use client'` files, flag:
- `async function Component()` returning JSX
- Top-level `await` in a component body
- Imports from `next/headers`, `next/cache`, `server-only`
- Calls to `cookies()`, `headers()`, `draftMode()`

In server files (no `'use client'`), flag:
- Calls to `useState`, `useEffect`, `useRef`, `useContext`, `useReducer`, `useCallback`, `useMemo`, `useLayoutEffect`, `useTransition`, `useDeferredValue`
- Event handler props on intrinsic elements (`onClick=`, `onChange=`, `onSubmit=`, etc.)
- Imports from `next/navigation`'s client-only hooks (`useRouter`, `useSearchParams`, `usePathname`)

Directive placement:
- `'use client'` and file-level `'use server'` must be the first non-comment statement
- Inline `'use server'` must be the first statement of the function body

### Category B — Data crossing the boundary

#### B1: Non-serializable props from server to client
**Severity:** high · **Mechanism:** type checker

Find every JSX element where the component is defined in a `'use client'` file. For each prop:
- Resolve the type via the TS checker
- Flag if the type is or contains:
  - A function (unless its definition has `'use server'` — that's a Server Action, allowed)
  - A class instance (heuristic: type has non-trivial constructor, not a known-safe type)
  - `Map`, `Set`, `Symbol`, `BigInt`
  - `Date` (warn, not error — it round-trips but causes hydration drift)

Edge cases:
- `children` is allowed to be anything
- Spread props (`<Client {...obj} />`) are handled by B2
- `Promise` is allowed (RSC supports it)

#### B2: Server data leakage to client
**Severity:** critical · **Mechanism:** type checker

- Flag prop names matching `/^(secret|token|password|apiKey|privateKey|hash|salt|sessionId|stripeSecret|jwt)/i` crossing the boundary
- Flag spread props crossing the boundary
- Flag passing the entire result of a Prisma/Mongoose query (recognized via call methods like `findUnique`/`findFirst`/`findOne`) without explicit `select:`/`omit:` or destructuring

### Category C — Server Action safety

#### C1: Server Actions without input validation
**Severity:** critical · **Mechanism:** forward taint analysis

Find every function with `'use server'` directive (file-level or inline). For each Server Action's parameters, do a forward data-flow analysis:
- Mark parameters as TAINTED
- Mark variables derived from TAINTED inputs as TAINTED
- Mark TAINTED → SAFE on validation: passing through `z.parse`/`z.safeParse` (Zod), `valibot.parse`/`v.parse`, `yup.validateSync`/`.validate`, `@sinclair/typebox` checks, ArkType `assert`, `next-safe-action` schema definitions, `zsa` `.input()` calls, or a manual type predicate function

Flag if TAINTED data reaches:
- Database write call: `prisma.*.create/update/delete/upsert`, `db.insert/update/delete`, Mongoose `save/create/findOneAndUpdate`, raw SQL with template strings
- Filesystem write
- `fetch()` to an external URL (TAINTED in URL or body)
- `revalidatePath`/`revalidateTag` with TAINTED input (open redirect / cache poisoning)

#### C2: Server Actions without authorization
**Severity:** high · **Mechanism:** data-flow

For every Server Action that performs a mutation (writes to DB, filesystem, calls external API), check whether an authorization call appears before the mutation in the same function (or any function it transitively calls):
- `auth()`, `getServerSession()`, `getServerAuthSession()`
- `cookies().get('session')` followed by a verification call
- A function whose name matches `/^(verify|require|check|assert|guard).*?(Auth|Session|User|Permission|Role|Access)/i`
- Calls to `next-safe-action` middleware that takes auth context
- Clerk `auth().userId` / `currentUser()`, NextAuth `auth()`, Lucia helpers, Better-Auth helpers

Flag if mutation occurs without any of the above.

### Category D — Rendering correctness

#### D1: Hydration mismatch risks
**Severity:** high · **Mechanism:** AST

In any component (server or client), flag expressions in render scope (not inside `useEffect`, event handlers, `useMemo`, or callback props):
- `Date.now()`, `new Date()` (no args), `performance.now()`
- `Math.random()`, `crypto.randomUUID()`, `crypto.getRandomValues()`
- `typeof window !== 'undefined'` branches that produce different JSX
- Reads of `window.*`, `document.*`, `localStorage.*`, `sessionStorage.*`, `navigator.*`
- `.toLocaleDateString()`, `.toLocaleString()`, `.toLocaleTimeString()`, `Intl.DateTimeFormat()` without an explicit locale argument

Don't flag if:
- The expression is wrapped in `if (typeof window !== 'undefined')` AND inside `useEffect`
- The element has `suppressHydrationWarning`
- Inside an event handler (`onClick`, etc.) or callback prop

#### D2: Caching and dynamic rendering surprises
**Severity:** medium · **Mechanism:** AST + version-aware

Read Next.js version from `package.json`:
- Next 14: `fetch` defaults to `force-cache`; flag if user expects fresh data without `cache: 'no-store'`
- Next 15+: `fetch` defaults to `no-store`; flag if user expects ISR without explicit `cache: 'force-cache'` or `next.revalidate`

For each route file (`app/**/page.tsx`, `app/**/layout.tsx`, `app/**/route.ts`), walk the server-component tree and detect dynamic-forcing API calls:
- `cookies()`, `headers()`, `draftMode()` from `next/headers`
- `noStore()` / `unstable_noStore()` from `next/cache`
- Async access to `searchParams` or `params` (Next 15+ Promises)
- `fetch(..., { cache: 'no-store' })` or `fetch(..., { next: { revalidate: 0 } })`

Cross-reference with route's explicit intent:
- `export const dynamic = 'force-static'` + dynamic API → ERROR
- `export const revalidate = N` (N > 0) + dynamic API → WARNING
- No declaration + dynamic API → INFO ("this route is dynamic, did you intend that?")

Also flag:
- `fetch()` with `next.revalidate: X` inside a route exporting `revalidate = Y` where X ≠ Y
- `fetch` to `localhost`/`127.0.0.1` in code that runs in production

---

## Out of scope (and where to find each thing instead)

| Concern | Where to find it |
|---|---|
| Generic React anti-patterns | `eslint-plugin-react`, `eslint-plugin-react-hooks` |
| TypeScript style (`any`, return types) | `typescript-eslint` |
| Accessibility (alt, ARIA, semantic HTML) | `eslint-plugin-jsx-a11y` |
| Bundle size, performance profiling | Next.js bundle analyzer, Lighthouse |
| Dependency CVE scanning | `npm audit`, Snyk, Socket, Endor Labs |
| Pages Router rules | `@next/eslint-plugin-next` |
| Remix / TanStack Start / Waku | (out of scope, possibly v2+) |
| Code formatting | Prettier |
| Generic AI code review | `nextjs-app-auditor`, `@bobmatnyc/ai-code-review` |

If a user requests one of these, the answer is "use the right tool for the job, not claustra."

---

## v2+ roadmap (do NOT implement in v1)

Document these in `ROADMAP.md` once the repo is up. Do not start them until v1.0 ships and gets feedback.

- **E1.** Misuse of `revalidatePath` / `revalidateTag` with user-controlled input
- **E2.** Cookie/session reads in cached routes
- **E3.** `redirect()` and `notFound()` thrown inside `try/catch` (they use exceptions internally)
- **E4.** Streaming/Suspense boundaries missing around slow fetches
- **E5.** Middleware reading `request.body` (breaks edge runtime silently)
- **E6.** Multi-framework support: Remix, TanStack Start, Waku

---

## Tech stack (locked)

- **Language:** TypeScript, strict mode, no `any`
- **Runtime:** Node 20+, ESM only
- **Package manager:** pnpm
- **Build:** `tsup` → single ESM bundle + types
- **CLI:** `commander` for arg parsing, `picocolors` for terminal styling
- **Parsing & types:**
  - `typescript` (compiler API) for module graph + type checking
  - `@typescript-eslint/typescript-estree` only if needed for AST work outside the program
- **Schema validation:** `zod` (config parsing)
- **Tests:** `vitest`, fixture-based
- **CI:** GitHub Actions (lint + test + build matrix on Node 20/22)

Forbidden in v1:
- No `eslint`, `oxlint`, `biome` integration. claustra is a standalone CLI; ESLint plugin form is v2.
- No telemetry, no analytics, no `node-fetch` calls during normal scans.
- No web UI, no hosted service.

---

## Repo layout

```
claustra/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── README.md
├── ROADMAP.md
├── CONTRIBUTING.md
├── LICENSE                            # MIT
├── .gitignore                         # node_modules, dist, .cache
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   └── release.yml
│   └── ISSUE_TEMPLATE/
│       ├── bug.md
│       └── new-rule.md
├── .claude/
│   └── skills/
│       └── claustra-conventions.md    # the skill doc Claude Code reads
├── src/
│   ├── cli.ts                         # entry: #!/usr/bin/env node
│   ├── config.ts                      # load .claustra.json + env
│   ├── scanner/
│   │   ├── project.ts                 # find tsconfig, build TS Program
│   │   ├── module-graph.ts            # transitive import graph
│   │   └── boundary.ts                # server/client/either classifier
│   ├── rules/
│   │   ├── index.ts                   # rule registry
│   │   ├── types.ts                   # Rule, Finding, Severity, ProjectContext
│   │   ├── a01-server-only-in-client.ts
│   │   ├── a02-rsc-pattern-misuse.ts
│   │   ├── b01-non-serializable-props.ts
│   │   ├── b02-server-data-leakage.ts
│   │   ├── c01-unvalidated-server-actions.ts
│   │   ├── c02-unauthorized-server-actions.ts
│   │   ├── d01-hydration-risks.ts
│   │   └── d02-caching-dynamic.ts
│   ├── reporters/
│   │   ├── terminal.ts
│   │   ├── json.ts
│   │   └── github.ts                  # GitHub Actions annotations
│   └── utils/
│       ├── ast.ts
│       ├── hash.ts
│       └── logger.ts
└── tests/
    ├── fixtures/                      # mini Next.js apps with known bugs
    │   ├── a01-server-only-leak/
    │   ├── a02-misuse/
    │   ├── b01-functions-as-props/
    │   ├── b02-prisma-leak/
    │   ├── c01-no-validation/
    │   ├── c02-no-auth/
    │   ├── d01-date-now/
    │   └── d02-cache-mismatch/
    └── rules/
        ├── a01.test.ts
        ├── a02.test.ts
        └── ...
```

---

## Core types (locked — implement exactly as written)

```ts
// src/rules/types.ts
import type * as ts from 'typescript';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Finding = {
  ruleId: string;             // 'a01-server-only-in-client'
  severity: Severity;
  file: string;               // relative to project root
  line: number;
  column: number;
  message: string;            // one-line summary
  detail?: string;            // multi-line explanation
  suggestion?: string;        // how to fix
  importChain?: string[];     // for module-graph rules
};

export type FileBoundary = 'server' | 'client' | 'either';

export type ProjectContext = {
  rootDir: string;
  tsConfigPath: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  boundaryMap: Map<string, FileBoundary>;
  nextVersion: string;
  config: ResolvedConfig;
};

export type Rule = {
  id: string;
  description: string;
  severity: Severity;
  run: (ctx: ProjectContext) => Promise<Finding[]>;
};

export type ResolvedConfig = {
  rules: Record<string, 'error' | 'warn' | 'off'>;
  extraServerOnlyModules: string[];
  ignore: string[];
};
```

---

## CLI surface (locked)

```
npx claustra [path]                            # scan, default cwd
  --config <file>                              # default .claustra.json
  --reporter <terminal|json|github>            # default terminal
  --severity <critical|high|medium|low>        # min severity to fail (default high)
  --rules <a01,b02,...>                        # run subset
  --json-output <path>                         # write findings to file
  --version
  --help
```

Exit codes:
- `0` — no findings at or above `--severity`
- `1` — findings at or above `--severity`
- `2` — internal error (bad config, parse failure, etc.)

---

## Default config (`.claustra.json`)

```json
{
  "rules": {
    "a01-server-only-in-client": "error",
    "a02-rsc-pattern-misuse": "error",
    "b01-non-serializable-props": "error",
    "b02-server-data-leakage": "error",
    "c01-unvalidated-server-actions": "error",
    "c02-unauthorized-server-actions": "error",
    "d01-hydration-risks": "error",
    "d02-caching-dynamic": "warn"
  },
  "extraServerOnlyModules": [],
  "ignore": ["**/*.test.tsx", "**/*.test.ts", "**/__fixtures__/**", "**/node_modules/**"]
}
```

---

## Execution flow (locked)

1. Parse CLI args (`cli.ts`)
2. Load + merge config + env (`config.ts`)
3. Locate project root + `tsconfig.json` (`scanner/project.ts`)
4. Build TS Program + checker (`scanner/project.ts`)
5. Build module graph (`scanner/module-graph.ts`)
6. Build boundary map (`scanner/boundary.ts`)
7. Run enabled rules in parallel (`rules/*`)
8. Merge results, sort by severity, then file, then line
9. Format via chosen reporter
10. Exit with appropriate code

---

## Boundary classification algorithm (locked)

This is the foundation everything depends on. Get it right first.

```
1. Pass 1: mark every file with 'use client' directive as 'client'
2. Pass 2: BFS from each 'client' file through all transitive imports
   - Reachable files form the "client-reachable" set
   - Resolve imports via tsconfig paths, node_modules resolution, barrel re-exports
3. Pass 3: for each remaining file, classify as:
   - 'either' if reachable from at least one 'client' file (and no 'use client' directive of its own)
   - 'server' if not reachable from any 'client' file
4. Files in node_modules are excluded from the graph entirely (assumed neutral)
```

This produces `Map<string, 'server' | 'client' | 'either'>` keyed by absolute file path.

---

## Output format (terminal reporter)

```
claustra found 3 issues in 2 files

  ✖ critical  app/dashboard/page.tsx:24
    B2 — Possible server data leakage
    Passing entire `user` object to <ProfileCard /> (a client component).
    The type includes `passwordHash` and `stripeCustomerId`.
    → Destructure only the fields the client needs:
      <ProfileCard user={{ name: user.name, avatar: user.avatar }} />

  ✖ critical  app/actions/update-profile.ts:8
    C1 — Server Action without input validation
    `formData` flows directly into `prisma.user.update()` without validation.
    → Add a Zod schema:
      const Schema = z.object({ name: z.string().min(1) });
      const data = Schema.parse(Object.fromEntries(formData));

  ⚠ high      components/Clock.tsx:12
    D1 — Hydration mismatch risk
    `new Date().toLocaleString()` in render scope. Server and client locales may differ.
    → Move to useEffect, or pass an explicit locale.

3 issues: 2 critical, 1 high
Run with --reporter=json for machine-readable output.
```

---

## Implementation milestones (in order)

### Milestone 0 — Repo scaffold (1 day)
- `pnpm init`, install deps from "Tech stack"
- Create folder structure exactly as in "Repo layout"
- `tsconfig.json` strict, ESM
- `tsup.config.ts` for single-bundle build
- `.github/workflows/ci.yml` running lint + test + build on Node 20/22
- LICENSE (MIT), README skeleton, CONTRIBUTING, ROADMAP
- `.claude/skills/claustra-conventions.md` (companion skill doc — written separately)

### Milestone 1 — Foundation (2 days)
- `src/cli.ts` with full arg surface from "CLI surface"
- `src/config.ts` loading + Zod-validating `.claustra.json`
- `src/scanner/project.ts` building TS Program from project's `tsconfig.json`
- `src/scanner/module-graph.ts` resolving all imports
- `src/scanner/boundary.ts` per "Boundary classification algorithm"
- Empty `rules/index.ts` registry
- Terminal reporter that prints "0 findings" against a fixture
- Vitest passing on at least one boundary-classifier test

**Exit criteria:** `pnpm dev tests/fixtures/a02-misuse` runs without error and prints "0 findings."

### Milestone 2 — Easy rules, first release (2 days)
- Implement A2, D1, D2 (pure AST work, no module graph required)
- Fixture-based tests for each — minimum 5 fixtures per rule
- Polish terminal reporter
- Write README with install + demo + rule reference for the 3 rules
- **Publish to npm as v0.1.0**

**Exit criteria:** `npx claustra@0.1.0` runs against a real Next.js repo and produces useful output for hydration risks, RSC pattern misuse, and caching surprises.

### Milestone 3 — Module-graph rule (2 days)
- Implement A1
- Harden module-graph for: tsconfig path aliases, monorepo workspaces, barrel re-exports
- Add `extraServerOnlyModules` config support
- Release as v0.2.0

### Milestone 4 — Type-checker rules (3 days)
- Implement B1 (non-serializable props)
- Implement C2 (no authorization in mutations)
- Release as v0.3.0

### Milestone 5 — Data-flow rules (4 days)
- Implement C1 (forward taint analysis for input validation)
- Implement B2 (server data leakage)
- Release as v0.4.0

### Milestone 6 — Polish to v1.0 (2 days)
- GitHub Actions reporter (`@actions/core` annotations)
- JSON reporter for CI
- README with: badges, demo GIF, install snippet, full rule reference, GitHub Action usage, comparison table to alternatives
- ROADMAP.md with v2+ items
- **Publish v1.0.0**

---

## Performance budget

Scanning a 500-file Next.js repo:
- Module-graph build: ≤ 3 s
- All rules: ≤ 5 s
- Total: ≤ 10 s on a 2024-era laptop

---

## Testing strategy

Each rule has its own folder under `tests/fixtures/<rule-id>/` containing:
- A minimal Next.js App Router file structure
- At least 5 violation cases the rule must catch
- At least 3 non-violation cases it must NOT flag (false-positive guard)

Test file (`tests/rules/<rule>.test.ts`) imports the fixture, runs the rule, asserts findings via inline snapshot.

No mocking the TS compiler. Build a real `Program` from each fixture. Slower but produces real signal.

---

## Definition of "done" for v1.0

- All 8 rules implemented with ≥5 fixtures each
- `npx claustra` works on a fresh clone of a public Next.js 14/15/16 App Router project with zero config
- Documented `.claustra.json` schema
- README with: install, screenshot, full rule reference, GitHub Action snippet, comparison to alternatives
- Published to npm as `claustra`
- 30-second demo GIF in README catching at least one critical bug
- CI green on Node 20 and 22

---

## What NOT to do

- Don't add a 9th rule before v1.0 ships
- Don't accept feature PRs that violate guiding principles
- Don't add hosted-service language anywhere ("free forever, runs locally, no network calls" is the story)
- Don't add telemetry "to understand usage" — privacy is a key differentiator
- Don't depend on ESLint at runtime (we may ship an ESLint plugin in v2 as a *thin wrapper*, but the core stays standalone)
- Don't add Pages Router support — that dilutes focus and confuses users about what claustra is
- Don't write rules that require running the user's code

---

## First task for the AI agent

Start at **Milestone 0**. Then proceed to **Milestone 1**. Read `.claude/skills/claustra-conventions.md` before each implementation step.

The first concrete step:
1. `pnpm init` and install dependencies from "Tech stack"
2. Create the folder structure from "Repo layout" exactly
3. Set up `tsconfig.json` (strict, ESM, Node 20 target) and `tsup.config.ts`
4. Implement `src/cli.ts` shell with `commander` argument parsing — no rule logic yet
5. Implement `src/config.ts` with Zod-validated config loader and sensible defaults
6. Stub `src/rules/types.ts` with the types from "Core types"
7. Stub `src/rules/index.ts` exporting an empty rule array
8. Write a no-op terminal reporter that prints "claustra: 0 findings"
9. Verify `pnpm build && node dist/cli.js --help` works
10. Commit. Open Milestone 1.

When in doubt, re-read "Guiding principles." When tempted to add a rule not in the v1 list, re-read "Out of scope."
