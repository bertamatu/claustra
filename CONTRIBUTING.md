# Contributing to claustra

## Guiding principles

Three non-negotiable rules that shape every decision:

1. **One framework, one paradigm.** Next.js App Router + RSC. Not Pages Router, not Remix, not vanilla React. Specificity is the pitch.
2. **One concern: the server/client boundary.** Every check must relate to "what happens when code or data crosses from server to client." If a check doesn't, it goes in a different tool.
3. **Static-only, fully local.** Every rule runs against the local TypeScript program. No network calls, no API keys, no third-party services in the runtime path.

If a proposed feature doesn't fit all three, it's out of scope.

## Out of scope (and where to find each thing instead)

| Concern | Where to find it |
|---|---|
| Generic React anti-patterns | `eslint-plugin-react`, `eslint-plugin-react-hooks` |
| TypeScript style (`any`, return types) | `typescript-eslint` |
| Accessibility (alt, ARIA, semantic HTML) | `eslint-plugin-jsx-a11y` |
| Bundle size, performance profiling | Next.js bundle analyzer, Lighthouse |
| Dependency CVE scanning | `npm audit`, Snyk, Socket, Endor Labs |
| Pages Router rules | `@next/eslint-plugin-next` |
| Remix / TanStack Start / Waku | out of scope |
| Code formatting | Prettier |
| Generic AI code review | `nextjs-app-auditor`, `@bobmatnyc/ai-code-review` |

If a user requests one of these, the answer is "use the right tool for the job, not claustra."

## Before opening a rule PR

1. Find at least one official source (Next.js docs, React docs, or a CVE) establishing the pattern as a real concern.
2. Write the RULES.md section using the template in that file.
3. Add ≥5 fixture tests under `tests/fixtures/<rule-id>/` covering violations AND non-violations.
4. Confirm the rule fits the "Guiding principles" above. If it isn't about the server/client boundary, it belongs in a different tool.

Rules without a RULES.md section will be closed.

## Development

```bash
pnpm install
pnpm build        # compile via tsup
pnpm test         # run all tests
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
pnpm check        # lint + typecheck + test
```

## Releasing

Releases are automated via `.github/workflows/release.yml` on version tags.
