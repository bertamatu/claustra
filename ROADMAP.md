# claustra Roadmap

## v1.0 — what shipped

All 8 rules implemented as static checks: A1, A2, B1, B2, C1, C2, D1, D2. See [`CLAUSTRA.md`](./CLAUSTRA.md) for the full v1 scope and [`RULES.md`](./RULES.md) for per-rule semantics.

## v2+ (do NOT implement before v1.0 ships)

- **E1.** Cookie/session reads in cached routes (extension of D2)
- **E2.** `redirect()` and `notFound()` thrown inside `try/catch` (they use exceptions internally)
- **E3.** Streaming/Suspense boundaries missing around slow fetches
- **E4.** Middleware reading `request.body` (breaks edge runtime silently)
- **E5.** Multi-framework support: Remix, TanStack Start, Waku
- **ESLint plugin form** — thin wrapper around the core, for teams that want IDE integration

> Note: the original "E1 — misuse of `revalidatePath`/`revalidateTag` with user-controlled input" was absorbed into C1, which already taint-tracks Server Action parameters into those calls.
