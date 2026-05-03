# claustra Roadmap

## v1.0 (current focus)

All 8 rules implemented. See CLAUSTRA.md for the full v1 scope.

## v2+ (do NOT implement before v1.0 ships)

- **E1.** Misuse of `revalidatePath` / `revalidateTag` with user-controlled input
- **E2.** Cookie/session reads in cached routes
- **E3.** `redirect()` and `notFound()` thrown inside `try/catch` (they use exceptions internally)
- **E4.** Streaming/Suspense boundaries missing around slow fetches
- **E5.** Middleware reading `request.body` (breaks edge runtime silently)
- **E6.** Multi-framework support: Remix, TanStack Start, Waku
- **ESLint plugin form** — thin wrapper around the core, for teams that want IDE integration
