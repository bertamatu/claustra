---
name: claustra-conventions
description: How to write code in the claustra repo. Read before any implementation task. Pairs with CLAUSTRA.md (what to build) and RULES.md (rule definitions and authoritative sources).
---

# claustra coding conventions

This skill encodes *how* to write code in this repo. CLAUSTRA.md says *what* to build; this says *how*. Read both before starting any rule or feature.

## Source of truth

When the two docs disagree, the priority is:

1. **CLAUSTRA.md** — locked types, CLI surface, milestones, scope
2. **RULES.md** — rule semantics and authoritative sources (every rule must cite official Next.js/React docs or a CVE)

## Code style

These are enforced by `eslint.config.js`. Read it before adjusting any of these.

- **Strict TypeScript, no `any`.** Use `unknown` + narrowing or a real type. `any` is an `error` in the linter.
- **Const arrow functions only** for all named exports and locals: `export const handleX = () => ...`. Function declarations (`function foo() {}`) are flagged.
- **Type-only imports for type-only usage.** `import type * as ts from 'typescript'` when only types are referenced. Mixing runtime + types in one default import is flagged by `consistent-type-imports`.
- **Early returns over nested branches.** Don't write `if (x) { ... else { ... } }` when an early return reads cleaner.
- **No floating Promises.** Either `await`, `void`, or pass to a handler. The linter catches this — don't disable.
- **No `// @ts-ignore` / `// @ts-expect-error`** without a `// eslint-disable-next-line` comment explaining why and what specifically you're working around.

## File structure

- **Each rule lives in its own file** under `src/rules/<id>-<short-name>.ts`. Export a default `Rule` object matching the type in `src/rules/types.ts`.
- **No global state.** Everything that varies between runs flows through `ProjectContext`.
- **`src/utils/`** is for pure helpers reused across rules/scanner. No I/O at module load.
- **`src/scanner/`** owns the TS Program, module graph, and boundary classifier. Rules consume; they don't construct.
- **`src/reporters/`** are sinks — they take `Finding[]` and emit. They never compute findings.

## Rule template

```ts
import type { Rule, Finding, ProjectContext } from './types.js';

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  // visit source files, push findings
  return findings;
};

export const rule: Rule = {
  id: 'a02-rsc-pattern-misuse',
  description: 'Detects ...',
  severity: 'high',
  run,
};

export default rule;
```

After creating the file, register it in `src/rules/index.ts`.

## Testing

- **Every rule needs ≥5 fixture-based tests** covering both violations and non-violations.
- **Fixtures live at `tests/fixtures/<rule-id>/`** as a minimal Next.js App Router structure with its own `tsconfig.json` and `package.json`.
- **No mocking the TS compiler.** Build a real `Program` from each fixture. Slower, but produces real signal.
- **No mocking modules under test** unless absolutely necessary. If you find yourself reaching for `vi.mock`, consider whether the code under test should be refactored to take a dependency as an argument.
- **Coverage thresholds** (in `vitest.config.ts`) are 80% lines/functions/statements, 75% branches. Don't chase 100% — aim for every meaningful branch + a real integration test.
- **CLI argument logic** is covered by `tests/cli.integration.test.ts` (subprocess-based), not by unit-mocking commander. Add cases there when CLI behavior changes.
- **Excluded from coverage** (with reason): `cli.ts` (covered by integration), `types.ts` (no runtime), `rules/index.ts` (placeholder).

### When to write a test

- **Always**: pure functions with branches, anything other rules depend on, anything where a silent regression is costly, and any bug you've already hit.
- **Pragmatically**: prefer one integration test over many heavily-mocked unit tests; thin wrappers around well-tested libraries get one smoke test, not a full suite.
- **Skip**: pure type files, empty placeholders, code that requires infrastructure (mocks, network) you don't have set up yet — exclude from coverage with a comment explaining why.

## Comments

Default to writing none. Add one only when the *why* is non-obvious — a hidden constraint, a workaround, a subtle invariant. Don't restate what the code does. Don't reference the current task or PR (`// added for X`, `// fixes Y`) — that belongs in the commit message.

## Performance

- **Module graph build ≤ 3s** on a 500-file repo
- **All rules ≤ 5s** on a 500-file repo
- **Total ≤ 10s** on a 2024-era laptop

If a rule exceeds these, profile before adding more checks. Don't pre-optimize.

## Commits

- One logical change per commit. The commit message explains *why*, not *what* (the diff shows what).
- No `Co-Authored-By` lines unless the user explicitly asks for them.
- Use Conventional Commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Each milestone gets its own branch (`milestone-N-<short-name>`); merge to `main` via PR.

## Out of scope (don't accept these)

If a proposed feature isn't about the server/client boundary in Next.js App Router, it goes in a different tool. The "Out of scope" table in CLAUSTRA.md is the canonical answer for where each non-claustra concern belongs. Re-read "Guiding principles" in CLAUSTRA.md when tempted.
