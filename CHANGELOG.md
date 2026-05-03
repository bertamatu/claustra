# Changelog

All notable changes to claustra are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/).

## [1.0.1] — 2026-05-04

### Fixed

- **`.claustra.json` `ignore` field is now actually applied.** It was in the schema since v0.1.0 but never consulted at finding time, so user-provided ignore globs silently did nothing. A minimal minimatch-style matcher (`**`, `*`, `?`) now filters findings by relative file path before the reporter runs.
- **D1 (hydration risks) skips Next.js metadata-convention files.** `sitemap.ts`, `robots.ts`, `manifest.ts`, `opengraph-image.{ts,tsx}`, `twitter-image.{ts,tsx}`, `icon.{ts,tsx}`, `apple-icon.{ts,tsx}`, and `favicon.{ts,tsx}` run server-side at build/request time and never hydrate, so render-scope hydration patterns inside them are not actually hydration risks. Surfaced from real-world testing — claustra was emitting up to 7 false positives per `sitemap.ts`.
- **D1 recognizes `typeof window === 'undefined'` early-return guards.** Browser-global reads inside a function whose earlier statements include `if (typeof window === 'undefined') return;` (or `throw`, or with `document`/`navigator`/`localStorage`/`sessionStorage`) are now treated as gated to client-side execution. Cleared a class of false positives in utility modules that intentionally guard before reading globals.

### Validation

Re-running v1.0.1 against a real Next.js App Router site dropped findings from 27 to 13 — every remaining finding is a real bug or worth a manual look. The 14 cleared findings were exactly the three false-positive classes above.

## [1.0.0] — 2026-05-03

Initial release. Eight static rules covering the full Next.js App Router server/client boundary surface:

- **A1** — Server-only code reachable from the client tree (module graph)
- **A2** — RSC pattern misuse (AST)
- **B1** — Non-serializable props (TS type checker)
- **B2** — Server data leakage to client (TS type checker)
- **C1** — Server Actions without input validation (forward taint)
- **C2** — Server Actions without authorization (data flow)
- **D1** — Hydration mismatch risks (AST)
- **D2** — Caching & dynamic-rendering surprises (AST + Next.js version-aware)

Static-only — no network calls, no API keys, no telemetry. Three reporters (`terminal`, `json`, `github`). MIT.
