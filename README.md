# claustra

> A CLI that audits Next.js App Router projects for the 8 ways code or data can unsafely cross the server/client boundary.

**Status:** under active development. v1.0 not yet released. See [`CLAUSTRA.md`](./CLAUSTRA.md) for the full project spec, [`RULES.md`](./RULES.md) for rule definitions and authoritative sources, and [`ROADMAP.md`](./ROADMAP.md) for what's planned.

## What it will do

Run `npx claustra` against a Next.js App Router codebase and get a prioritized list of real bugs across:

- Server-only code reachable from the client tree
- Misuse of `'use client'` / `'use server'` patterns
- Non-serializable props crossing the boundary
- Server data leakage to the client
- Server Actions without input validation or authorization
- Hydration mismatch risks
- Caching and dynamic rendering surprises

Static analysis first. Optional LLM (BYOK via `ANTHROPIC_API_KEY`) refines fuzzy cases. No telemetry, no hosted service, runs entirely locally.

## License

MIT
