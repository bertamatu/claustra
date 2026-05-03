# next-guard — Architecture & Implementation Plan

> A CLI that catches the 8 most common Next.js App Router footguns: `'use client'` boundary violations, RSC data leakage, unvalidated Server Actions, hydration risks, and caching surprises. Static analysis first, optional LLM (BYOK) for fuzzy cases.

## Mission

Ship a single command (`npx next-guard`) that a Next.js team can run against their repo and get a prioritized list of real bugs — not style noise. Output should look like a senior engineer's PR comments, not an ESLint dump.

**Non-goals:** general code review, style/formatting, perf profiling, anything not specific to App Router / RSC.

---

## Tech stack

- **Language:** TypeScript (strict mode, no `any`)
- **Runtime:** Node 20+
- **Module system:** ESM only
- **Parser:** `@typescript-eslint/typescript-estree` for AST + the TypeScript compiler API (`typescript` package) for type-checking
- **Module graph:** built on top of `ts.createProgram` — reuse the project's own `tsconfig.json`
- **CLI framework:** `commander`
- **Output:** `picocolors` for terminal styling, plain JSON for CI, `@actions/core` annotations for GitHub Actions
- **Package manager:** `pnpm`
- **Build:** `tsup` (single ESM bundle + types)
- **Tests:** `vitest`
- **LLM client (optional):** `@anthropic-ai/sdk` — only loaded if `ANTHROPIC_API_KEY` is set

---

## Repo layout

```
next-guard/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
├── .env.example                    # ANTHROPIC_API_KEY=
├── src/
│   ├── cli.ts                      # entry point (#!/usr/bin/env node)
│   ├── config.ts                   # load .next-guard.json + env
│   ├── scanner/
│   │   ├── project.ts              # find tsconfig, enumerate files
│   │   ├── module-graph.ts         # build import graph + mark boundaries
│   │   └── boundary.ts             # classify file as server/client/either
│   ├── rules/
│   │   ├── index.ts                # rule registry
│   │   ├── types.ts                # Rule, Finding, Severity types
│   │   ├── r01-server-only-in-client.ts
│   │   ├── r02-non-serializable-props.ts
│   │   ├── r03-server-data-leakage.ts
│   │   ├── r04-unvalidated-server-actions.ts
│   │   ├── r05-accidental-dynamic.ts
│   │   ├── r06-hydration-risks.ts
│   │   ├── r07-fetch-cache-directives.ts
│   │   └── r08-rsc-pattern-misuse.ts
│   ├── llm/
│   │   ├── client.ts               # Anthropic wrapper, lazy-loaded
│   │   ├── cache.ts                # file-hash → result cache on disk
│   │   └── judges.ts               # one judge fn per fuzzy rule
│   ├── reporters/
│   │   ├── terminal.ts
│   │   ├── json.ts
│   │   └── github.ts               # GitHub Actions annotations
│   └── utils/
│       ├── ast.ts                  # AST helpers (visit, find directive, etc.)
│       ├── hash.ts
│       └── logger.ts
└── tests/
    ├── fixtures/                   # mini Next.js apps with known bugs
    │   ├── basic-app/
    │   ├── server-leak/
    │   └── ...
    └── rules/
        ├── r01.test.ts
        ├── r02.test.ts
        └── ...
```

---

## Core types

```ts
// src/rules/types.ts
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Finding = {
  ruleId: string;             // 'r01-server-only-in-client'
  severity: Severity;
  file: string;               // relative path from project root
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
  program: import('typescript').Program;
  checker: import('typescript').TypeChecker;
  boundaryMap: Map<string, FileBoundary>;
  nextVersion: string;        // parsed from package.json
};

export type Rule = {
  id: string;
  description: string;
  severity: Severity;
  needsLlm: boolean;
  run: (ctx: ProjectContext) => Promise<Finding[]>;
};
```

---

## Execution flow

```
1. CLI parses args                         (cli.ts)
2. Load config + env                       (config.ts)
3. Locate project root + tsconfig          (scanner/project.ts)
4. Build TS Program + checker              (scanner/project.ts)
5. Build module graph + boundary map       (scanner/module-graph.ts)
6. Run static rules in parallel            (rules/r01..r08)
7. Collect fuzzy candidates                (each rule may emit "needs-llm" findings)
8. If ANTHROPIC_API_KEY present: run LLM judges, batched + cached
9. Merge results, sort by severity         (cli.ts)
10. Format via chosen reporter             (reporters/*)
11. Exit with code = 0 / 1 (configurable threshold)
```

---

## Rule specifications

Each rule is implemented as a self-contained module exporting a `Rule` object. All rules follow the same shape: receive `ProjectContext`, return `Finding[]`.

### R01 — Server-only code reachable from client tree

**Severity:** critical
**Needs LLM:** no

**Logic:**
- For each file with `boundary === 'client'`, walk all transitive imports via the module graph
- Flag any reached module that:
  - Imports `node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:net`, `node:dns`
  - Imports known server-only packages: `pg`, `mysql2`, `mongodb`, `mongoose`, `@prisma/client`, `redis`, `ioredis`, `bcrypt`, `bcryptjs`, `jsonwebtoken`, `nodemailer`
  - Imports `'server-only'` package
  - Reads `process.env.X` where `X` does not start with `NEXT_PUBLIC_`
- Output: full import chain so devs can trace the leak

**Implementation detail:** maintain a hard-coded `SERVER_ONLY_MODULES` set; allow extension via config.

---

### R02 — Non-serializable props across the boundary

**Severity:** high
**Needs LLM:** no (with optional LLM confirmation)

**Logic:**
- Find every JSX element where the component is defined in a `'use client'` file
- For each prop attribute:
  - Resolve the type via the TS checker
  - Flag if type contains a function (and the function is NOT a Server Action — detect by checking if the function source has `'use server'` directive)
  - Flag class instances: types with non-trivial constructors (heuristic: type has `prototype` and is not a known-safe type)
  - Flag `Map`, `Set`, `Symbol`, `BigInt`
  - Warn (not error) on `Date` — it round-trips but causes hydration drift

**Edge cases to handle:**
- `children` prop is allowed to be anything (React handles it)
- Spread props (`<Client {...obj} />`) — emit a "needs-llm" finding asking the judge to assess `obj`'s shape

---

### R03 — Server data leakage to client

**Severity:** critical
**Needs LLM:** yes (this is the rule that justifies BYOK)

**Static pass:**
- Flag prop names matching `/^(secret|token|password|apiKey|privateKey|hash|salt)/i` crossing the boundary
- Flag spread props crossing the boundary
- Flag passing the entire result of `await db.user.findUnique(...)` (or any Prisma/Drizzle query) without a `select:` or explicit destructuring

**LLM pass:**
- For each cross-boundary prop where static is uncertain, send the inferred TS type to Claude with prompt:
  > "Below is the type of a prop being passed from a Server Component to a Client Component in a Next.js app. Identify any fields that are likely sensitive (auth tokens, password hashes, internal IDs not meant for users, PII beyond what UI needs). Respond as JSON: `{ risky: boolean, fields: string[], reasoning: string }`."

---

### R04 — Server Actions without input validation

**Severity:** critical
**Needs LLM:** partial (LLM confirms ambiguous cases)

**Logic:**
- Find every function with `'use server'` directive — both:
  - File-level: `'use server'` at top of file → all exports are Server Actions
  - Inline: `async function foo() { 'use server'; ... }`
- For each Server Action's parameters, do a forward data-flow analysis:
  - Mark params as TAINTED
  - Mark variables derived from TAINTED inputs as TAINTED
  - Mark TAINTED → SAFE on validation: passing through `z.parse`, `z.safeParse`, `valibot.parse`, `yup.validateSync`, or a manual type predicate function
- Flag if TAINTED data reaches:
  - DB write call (`prisma.*.create/update/delete/upsert`, `db.insert`, `db.update`, `db.delete`)
  - Filesystem write
  - `fetch()` to an external URL
  - `revalidatePath`/`revalidateTag` with dynamic input (open redirect / cache poisoning class)
- Bonus check: warn if no auth call (`auth()`, `getServerSession()`, `cookies().get('session')`) appears before the mutation

**LLM fallback:** for unknown validation libraries, ask the judge "is this function call performing input validation?"

---

### R05 — Accidental dynamic rendering

**Severity:** medium
**Needs LLM:** no

**Logic:**
- For each route file (`app/**/page.tsx`, `app/**/layout.tsx`, `app/**/route.ts`), walk its server-component subtree
- Detect dynamic-forcing API calls:
  - `cookies()`, `headers()`, `draftMode()` from `next/headers`
  - `noStore()` from `next/cache`
  - `unstable_noStore()`
  - Async access to `searchParams` or `params` (in Next 15+ these became Promises and accessing forces dynamic)
  - `fetch(..., { cache: 'no-store' })` or `fetch(..., { next: { revalidate: 0 } })`
- Cross-reference with route's explicit intent:
  - `export const dynamic = 'force-static'` → mismatch is an ERROR
  - `export const revalidate = N` (N > 0) → mismatch is a WARNING
  - No declaration → INFO (still useful: "this route is dynamic, did you intend that?")

---

### R06 — Hydration mismatch risks

**Severity:** high
**Needs LLM:** no

**Logic:**
- For every component (server or client), find expressions in render scope (i.e., not inside `useEffect`, event handlers, or `useMemo` with stable deps)
- Flag:
  - `Date.now()`, `new Date()` without arguments, `performance.now()`
  - `Math.random()`, `crypto.randomUUID()`, `crypto.getRandomValues()`
  - `typeof window !== 'undefined'` branches producing different JSX
  - `window.*`, `document.*`, `localStorage.*`, `sessionStorage.*` reads
  - `.toLocaleDateString()`, `.toLocaleString()`, `.toLocaleTimeString()`, `Intl.DateTimeFormat()` without explicit locale
  - `navigator.*` reads
- Don't flag if:
  - Wrapped in `if (typeof window !== 'undefined')` AND inside `useEffect`
  - The element has `suppressHydrationWarning`
  - Inside an event handler (`onClick`, etc.)

---

### R07 — Wrong fetch caching directives

**Severity:** medium
**Needs LLM:** no

**Logic:**
- Find every `fetch(...)` call in server-side code (server components, route handlers, server actions)
- Read Next.js version from `package.json`:
  - Next 14: default is `force-cache` — flag if user expects fresh data without `cache: 'no-store'`
  - Next 15+: default is `no-store` — flag if user expects ISR without explicit `cache: 'force-cache'` or `next.revalidate`
- Detect inconsistencies:
  - `fetch` with `next.revalidate: 60` inside a route exporting `revalidate = 3600` → conflict
  - `fetch` to `localhost:` or `127.0.0.1:` → anti-pattern
  - Missing `cache:` and missing `next.revalidate` while the route declares `revalidate` → suggest explicit directive

---

### R08 — RSC pattern misuse

**Severity:** high
**Needs LLM:** no

**Logic — in client files (`'use client'`):**
- Flag: `async function Component()` with JSX return
- Flag: top-level `await` in component body
- Flag: imports from `next/headers`, `next/cache`, `server-only`
- Flag: usage of `cookies()`, `headers()`, `draftMode()`

**Logic — in server files (no `'use client'`):**
- Flag: calls to `useState`, `useEffect`, `useRef`, `useContext`, `useReducer`, `useCallback`, `useMemo`, `useLayoutEffect`
- Flag: event handler props on intrinsic elements (`onClick=`, `onChange=`, `onSubmit=`, etc.) — JSX `<button onClick={...}>` in server component
- Flag: `import { useRouter } from 'next/navigation'` (client-only hook)

**Logic — directive placement:**
- `'use client'` must be the first non-comment statement of the file — flag if anything precedes it
- `'use server'` at file level: same rule
- `'use server'` inline: must be first statement of the function body

---

## Module graph + boundary classification

This is the foundation that R01, R02, R03 depend on. Get it right first.

```ts
// scanner/boundary.ts (pseudo)
export const classifyFiles = (program: ts.Program): Map<string, FileBoundary> => {
  const map = new Map<string, FileBoundary>();
  const sourceFiles = program.getSourceFiles().filter(f => !f.isDeclarationFile);

  // Pass 1: mark explicit 'use client' files
  for (const sf of sourceFiles) {
    if (hasDirective(sf, 'use client')) map.set(sf.fileName, 'client');
  }

  // Pass 2: propagate — anything imported by a 'client' file is reachable from client
  // This is "boundary as taint" — once tainted, stays tainted in the client graph.
  // But: a file CAN be imported by both server and client (boundary = 'either').

  const reachableFromClient = new Set<string>();
  const queue = [...map.entries()].filter(([, v]) => v === 'client').map(([k]) => k);
  while (queue.length) {
    const file = queue.pop()!;
    if (reachableFromClient.has(file)) continue;
    reachableFromClient.add(file);
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    for (const imp of getImportPaths(sf)) {
      const resolved = resolveImport(imp, file, program);
      if (resolved && !reachableFromClient.has(resolved)) queue.push(resolved);
    }
  }

  // Pass 3: anything reachable ONLY from server-component routes is 'server'
  // Anything reachable from BOTH is 'either'
  for (const sf of sourceFiles) {
    if (map.has(sf.fileName)) continue;
    map.set(sf.fileName, reachableFromClient.has(sf.fileName) ? 'either' : 'server');
  }

  return map;
};
```

---

## LLM judge protocol

Only loaded when `ANTHROPIC_API_KEY` is set. All calls go through `llm/client.ts`.

**Caching:** every LLM call is keyed by a hash of `(rule_id, file_content, snippet_range)`. Cache lives at `node_modules/.cache/next-guard/`. Re-runs on unchanged code = zero API cost.

**Batching:** findings flagged "needs-llm" are collected, then sent in a single `messages.create` call with structured output (JSON mode).

**Default model:** `claude-haiku-4-5-20251001` for cost; allow override via `--model`.

**Per-judge prompts:** stored as constants in `llm/judges.ts`. Each judge takes a typed input and returns a typed output validated with Zod.

```ts
// llm/judges.ts (sketch)
export const judgeServerLeakage = async (
  client: Anthropic,
  input: { propType: string; componentName: string }
): Promise<{ risky: boolean; fields: string[]; reasoning: string }> => {
  // ... single Claude call returning JSON, validated with Zod
};
```

---

## CLI surface

```
npx next-guard [path]              # scan, default: cwd
  --config <file>                  # default: .next-guard.json
  --reporter <terminal|json|github>  # default: terminal
  --severity <critical|high|medium|low>  # min severity to fail (default: high)
  --rules <r01,r02,...>            # subset to run
  --no-llm                         # skip LLM judges even if key present
  --model <name>                   # override Claude model
  --fix                            # apply autofixes for safe rules (R06, R08 directive placement)
  --json-output <path>             # write findings to file
```

**Exit codes:**
- `0` — no findings at or above `--severity`
- `1` — findings at or above `--severity`
- `2` — internal error (bad config, parse failure, etc.)

---

## Config file (`.next-guard.json`)

```json
{
  "rules": {
    "r01-server-only-in-client": "error",
    "r02-non-serializable-props": "error",
    "r03-server-data-leakage": "error",
    "r04-unvalidated-server-actions": "error",
    "r05-accidental-dynamic": "warn",
    "r06-hydration-risks": "error",
    "r07-fetch-cache-directives": "warn",
    "r08-rsc-pattern-misuse": "error"
  },
  "extraServerOnlyModules": ["@my-org/server-utils"],
  "ignore": ["**/*.test.tsx", "**/__fixtures__/**"],
  "llm": {
    "enabled": true,
    "model": "claude-haiku-4-5-20251001"
  }
}
```

---

## Output format (terminal reporter)

```
next-guard found 3 issues in 2 files

  ✖ critical  app/dashboard/page.tsx:24
    R03 — Possible server data leakage
    Passing entire `user` object to <ProfileCard /> (a client component).
    The type includes `passwordHash` and `stripeCustomerId`.
    → Destructure only the fields the client needs:
      <ProfileCard user={{ name: user.name, avatar: user.avatar }} />

  ✖ critical  app/actions/update-profile.ts:8
    R04 — Server Action without input validation
    `formData` flows directly into `prisma.user.update()` without validation.
    → Add a Zod schema:
      const Schema = z.object({ name: z.string().min(1) });
      const data = Schema.parse(Object.fromEntries(formData));

  ⚠ high      components/Clock.tsx:12
    R06 — Hydration mismatch risk
    `new Date().toLocaleString()` in render scope. Server and client locales may differ.
    → Move to useEffect, or pass an explicit locale.

3 issues: 2 critical, 1 high
```

---

## Implementation milestones

**Milestone 1 — skeleton (1 day)**
- Repo scaffold, CLI entry, config loader, terminal reporter
- TS program + module graph builder
- Boundary classifier
- Empty rule registry; `next-guard` runs on a fixture and prints "0 findings"

**Milestone 2 — easy rules (1-2 days)**
- R06 (hydration), R07 (fetch cache), R08 (pattern misuse)
- Fixture-based tests for each
- v0.1.0 release: ship to npm with these three rules alone

**Milestone 3 — graph rules (2-3 days)**
- R01 (server-only in client), R05 (accidental dynamic)
- Module graph hardening (monorepo paths, barrel exports)
- v0.2.0

**Milestone 4 — type rules (2-3 days)**
- R02 (non-serializable props)
- v0.3.0

**Milestone 5 — flow rules + LLM (3-5 days)**
- R03 (data leakage), R04 (unvalidated actions)
- LLM judge layer with cache + batching
- v0.4.0 (BYOK)

**Milestone 6 — polish (2 days)**
- GitHub Actions reporter
- Autofix for R06, R08 placement issues
- README with demo GIF, marketing copy
- v1.0.0

---

## Code conventions

- **Strict TS, no `any`.** Use `unknown` + narrowing.
- **Const arrow functions only:** `const handleX = () => ...`
- **Early returns** to reduce nesting.
- **Each rule is a single file** exporting a default `Rule` object.
- **No global state.** Everything flows through `ProjectContext`.
- **Tests:** every rule has fixture-based tests under `tests/rules/`. A fixture is a tiny Next.js app structure with known violations; the test asserts findings match an inline-snapshot.
- **LLM is optional everywhere.** A rule must produce useful results without an API key; the LLM only refines.
- **Performance budget:** scanning a 500-file Next.js repo without LLM should complete in under 10 seconds on a laptop.

---

## What "done" looks like for v1.0

- `npx next-guard` works on a fresh clone of any Next.js 14/15/16 App Router project with zero config
- All 8 rules implemented with at least 5 fixture tests each
- Documented `.next-guard.json` schema
- README with: installation, screenshot, rule reference, BYOK setup, GitHub Action snippet
- Published to npm under `next-guard`
- A 30-second demo GIF showing the tool catching a real bug

---

## First task for the AI agent picking this up

1. Initialize repo: `pnpm init`, install dev deps (`typescript`, `tsup`, `vitest`, `@typescript-eslint/typescript-estree`, `commander`, `picocolors`, `zod`)
2. Create the folder structure exactly as listed in "Repo layout"
3. Implement `src/cli.ts` with the argument surface from "CLI surface"
4. Implement `src/scanner/project.ts` and `src/scanner/module-graph.ts`
5. Implement `src/scanner/boundary.ts` per the pseudo-code in "Module graph + boundary classification"
6. Implement R08 first (simplest, pure AST) as a reference for rule structure
7. Write fixture tests for R08
8. Then proceed to R06, R07, then in milestone order

Each rule file should be self-contained and follow this template:

```ts
// src/rules/r08-rsc-pattern-misuse.ts
import type { Rule, Finding, ProjectContext } from './types.js';

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  // ... visit each source file, apply checks, push findings
  return findings;
};

export const rule: Rule = {
  id: 'r08-rsc-pattern-misuse',
  description: 'Detects misuse of RSC patterns (async client components, hooks in server components, etc.)',
  severity: 'high',
  needsLlm: false,
  run,
};

export default rule;
```
