# claustra

> A CLI that audits Next.js App Router projects for the ways code or data can unsafely cross the server/client boundary. Static analysis, BYOK LLM optional, runs entirely locally.

**v0.3.0 — early release.** Six rules live (A1, A2, B1, C2, D1, D2). Two more (B2, C1, both LLM-refined) land before v1.0; see [`ROADMAP.md`](./ROADMAP.md) and [`CLAUSTRA.md`](./CLAUSTRA.md).

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

## What it catches in v0.3.0

| ID  | Rule                               | Severity | What it flags                                                                                          |
| --- | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| A1  | Server-only code in client tree    | critical | Modules reachable from a `'use client'` file that import Node builtins (`node:fs`, `node:crypto`, …), known server-only packages (`@prisma/client`, `pg`, `mongoose`, `bcrypt`, `jsonwebtoken`, `server-only`, …), or read non-`NEXT_PUBLIC_` `process.env` vars. Reports the full import chain through barrel re-exports, path aliases, and workspace packages. |
| A2  | RSC pattern misuse                 | high     | Server APIs (`cookies`, `next/headers`, `server-only`) in `'use client'` files. React client hooks (`useState`, `useEffect`, `useRouter`) in server components. Event handlers on intrinsic JSX in server components. Misplaced `'use client'` / `'use server'` directives. Async client components. |
| B1  | Non-serializable props             | high     | Functions, class instances, `Map`, `Set`, `Symbol`, `BigInt` passed as props to a `'use client'` component (`Date` flagged at medium). Server Actions exempted. Skips `children`, `Promise`, spread props (B2's job), and props passed to server components. |
| C2  | Server Actions without auth        | high     | A function with file-level or inline `'use server'` that performs a DB/FS write (Prisma/Drizzle/Mongoose write methods, `fs.write*`/`rm*`/`rename*`, raw-SQL `INSERT/UPDATE/DELETE` template tags) before any recognized auth call (`auth()`, `getServerSession()`, `currentUser()`, `validateRequest()`, or `verify*`/`require*`/`check*`/`assert*`/`guard*` helpers). |
| D1  | Hydration mismatch risks           | high     | `Date.now()` / bare `new Date()` / `Math.random()` / `crypto.randomUUID()` / `performance.now()` in render scope. Reads of `window` / `document` / `navigator` / `localStorage` / `sessionStorage`. Locale formatters without explicit locale. Skipped inside `useEffect`, event handlers, and on elements with `suppressHydrationWarning`. |
| D2  | Caching & dynamic surprises        | medium   | `cookies()`/`headers()` in routes declared `force-static` (error) or `revalidate = N` (warning). Mismatched `revalidate` between route and `fetch`. `fetch` to `localhost`/`127.0.0.1`. Bare `fetch` in ISR routes on Next 15+ (no-store default). |

Each finding includes the rule ID, file:line, a one-line summary, an explanation of why it matters, and a concrete fix suggestion. Output reads like senior-engineer PR comments, not an ESLint dump.

## Coming before v1.0

- **B2** — server data leakage to client (type checker + optional LLM)
- **C1** — Server Actions without input validation (data-flow + optional LLM)

## CLI

```
npx claustra [path]                       # scan, default cwd
  --config <file>                         # default .claustra.json
  --reporter <terminal|json|github>       # default terminal
  --severity <critical|high|medium|low>   # min severity to fail (default high)
  --rules <a02,d01,...>                   # run subset
  --no-llm                                # skip LLM judges
  --model <name>                          # override Claude model
  --json-output <path>                    # write findings to file
```

Exit codes: `0` (no findings at/above threshold), `1` (findings at/above threshold), `2` (internal error).

## Optional LLM (BYOK)

Set `ANTHROPIC_API_KEY` to enable LLM refinement on fuzzy cases (will matter once B2 and C1 ship in the next milestone — none of the v0.3.0 rules use the LLM). claustra never sends source unprompted; calls are cached on disk by content hash, so re-runs on unchanged code are free. Default model: `claude-haiku-4-5-20251001`.

## License

MIT. See [`LICENSE`](./LICENSE).

## Documentation

- [`CLAUSTRA.md`](./CLAUSTRA.md) — full project spec (locked types, CLI surface, milestones)
- [`RULES.md`](./RULES.md) — every rule with authoritative source links (Next.js docs, React docs, CVEs)
- [`ROADMAP.md`](./ROADMAP.md) — what's planned for v2+
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to add a new rule
