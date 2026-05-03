# Contributing to claustra

## Before opening a rule PR

1. Find at least one official source (Next.js docs, React docs, or a CVE) establishing the pattern as a real concern.
2. Write the RULES.md section using the template in that file.
3. Add ≥5 fixture tests under `tests/fixtures/<rule-id>/` covering violations AND non-violations.
4. Confirm the rule fits "Guiding principles" in CLAUSTRA.md. If it isn't about the server/client boundary, it belongs in a different tool.

Rules without a RULES.md section will be closed.

## Development

```bash
pnpm install
pnpm build        # compile
pnpm test         # run all tests
pnpm lint         # type-check only (no eslint in v1)
```

## Releasing

Releases are automated via `.github/workflows/release.yml` on version tags.
