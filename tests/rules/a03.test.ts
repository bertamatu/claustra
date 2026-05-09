import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';
import a03 from '../../src/rules/a03-env-public-secret.js';
import type { Finding, ProjectContext, ResolvedConfig } from '../../src/rules/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/a03-env-public-secret');

const RESOLVED_CONFIG: ResolvedConfig = {
  rules: {},
  extraServerOnlyModules: [],
  ignore: [],
};

describe('a03 - secret pattern in NEXT_PUBLIC_ variable', () => {
  let findings: Finding[];

  beforeAll(async () => {
    const tsConfigPath = findTsConfig(FIXTURE_ROOT);
    const { program, checker } = buildProgram(tsConfigPath);
    const graph = buildModuleGraph(program);
    const boundaryMap = classifyBoundaries(program, graph);
    const ctx: ProjectContext = {
      rootDir: FIXTURE_ROOT,
      tsConfigPath,
      program,
      checker,
      moduleGraph: graph,
      boundaryMap,
      nextVersion: findNextVersion(FIXTURE_ROOT),
      config: RESOLVED_CONFIG,
    };
    findings = await a03.run(ctx);
  });

  const findingsForKey = (key: string): Finding[] =>
    findings.filter((f) => f.message.includes(`"${key}"`));

  // ───────────── Violations in .env ─────────────

  it('flags an OpenAI key (sk-…)', () => {
    const f = findingsForKey('NEXT_PUBLIC_OPENAI');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('OpenAI');
  });

  it('flags a high-entropy base64-shaped string', () => {
    const f = findingsForKey('NEXT_PUBLIC_TOKEN');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('high-entropy');
  });

  // ───────────── Violations in .env.local ─────────────

  it('flags an AWS access key (AKIA…)', () => {
    const f = findingsForKey('NEXT_PUBLIC_AWS_KEY');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('AWS');
    expect(f[0]?.file).toBe('.env.local');
  });

  it('flags a GitHub PAT (ghp_…)', () => {
    const f = findingsForKey('NEXT_PUBLIC_GH_TOKEN');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('GitHub');
  });

  it('flags an Anthropic key (sk-ant-…) and does NOT double-match it as OpenAI', () => {
    const f = findingsForKey('NEXT_PUBLIC_ANTHROPIC');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('Anthropic');
    expect(f[0]?.message).not.toContain('OpenAI');
  });

  // ───────────── Violation in next.config.ts ─────────────

  it('flags a high-entropy value inlined into next.config.ts env block', () => {
    const f = findingsForKey('NEXT_PUBLIC_INLINE_TOKEN');
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('high-entropy');
    expect(f[0]?.file).toBe('next.config.ts');
  });

  // ───────────── Non-violations ─────────────

  it('does NOT flag a Stripe publishable key in next.config.ts env block', () => {
    expect(findingsForKey('NEXT_PUBLIC_PK')).toHaveLength(0);
  });

  it('does NOT flag a URL value', () => {
    expect(findingsForKey('NEXT_PUBLIC_API_URL')).toHaveLength(0);
  });

  it('does NOT flag a URL value inside next.config.ts env block', () => {
    expect(findingsForKey('NEXT_PUBLIC_API_BASE')).toHaveLength(0);
  });

  it('does NOT flag a placeholder value (<your-key-here>)', () => {
    expect(findingsForKey('NEXT_PUBLIC_PLACEHOLDER')).toHaveLength(0);
  });

  it('does NOT flag a UUID', () => {
    expect(findingsForKey('NEXT_PUBLIC_UUID')).toHaveLength(0);
  });

  it('does NOT flag a hostname', () => {
    expect(findingsForKey('NEXT_PUBLIC_HOST')).toHaveLength(0);
  });

  it('does NOT flag a short boolean-ish value', () => {
    expect(findingsForKey('NEXT_PUBLIC_FEATURE_FLAG')).toHaveLength(0);
  });

  it('does NOT flag a same-character repeating placeholder', () => {
    expect(findingsForKey('NEXT_PUBLIC_REPEATING')).toHaveLength(0);
  });

  it('does NOT flag a non-NEXT_PUBLIC_ secret (out of scope for a03)', () => {
    expect(findingsForKey('DATABASE_URL')).toHaveLength(0);
  });

  // ───────────── Cross-cutting ─────────────

  it('every finding has the correct rule id, critical severity, and a redacted detail message', () => {
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBe('a03-env-public-secret');
      expect(f.severity).toBe('critical');
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
      expect(f.detail).toContain('intentionally not printed');
    }
  });

  it('does not include any literal secret value in any finding text', () => {
    // None of the synthetic violation values should appear verbatim in the
    // user-visible output. This is the redaction invariant.
    const valuesThatMustNotLeak = [
      'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD',
      'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5',
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'Xq7vK2pQ8mN4sF6dG9hL3bR1tY5wZ0cE8oP2nM6k',
    ];
    for (const f of findings) {
      const blob = `${f.message} ${f.detail ?? ''} ${f.suggestion ?? ''}`;
      for (const v of valuesThatMustNotLeak) {
        expect(blob).not.toContain(v);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Stripe-pattern coverage via runtime construction
// ─────────────────────────────────────────────────────────────────────
// The Stripe `sk_live_…`/`rk_live_…` shapes are matched by a03's regex,
// but committing such literal strings to the repo trips GitHub's secret-
// scanning push protection. We build the test values at runtime via
// string concatenation so no literal Stripe-shaped string appears in
// source. The .env file is written into a tmp dir before the rule runs.

describe('a03 - Stripe-pattern detection (runtime-constructed values)', () => {
  let tmpRoot: string;
  let findings: Finding[];

  beforeAll(async () => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'claustra-a03-stripe-'));
    // Produce Stripe-shaped values without ever embedding the literal in source.
    const sk = 'sk' + '_' + 'live' + '_' + 'A'.repeat(25);
    const rk = 'rk' + '_' + 'live' + '_' + 'B'.repeat(25);
    writeFileSync(
      path.join(tmpRoot, '.env'),
      `NEXT_PUBLIC_STRIPE_KEY=${sk}\nNEXT_PUBLIC_RESTRICTED=${rk}\n`,
      'utf8',
    );
    // A03 only reads .env*/next.config.* off rootDir; it does not require
    // a TypeScript program to fire. We still construct one because the
    // Rule.run signature demands a ProjectContext - reuse the static
    // fixture's tsconfig so buildProgram has something valid to chew on.
    if (!existsSync(path.join(tmpRoot, 'app'))) mkdirSync(path.join(tmpRoot, 'app'));
    writeFileSync(
      path.join(tmpRoot, 'app', 'page.tsx'),
      'export default function Page(): JSX.Element { return <main /> }\n',
      'utf8',
    );
    writeFileSync(
      path.join(tmpRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2022', 'DOM'],
          jsx: 'preserve',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          isolatedModules: true,
        },
        include: ['app'],
      }),
      'utf8',
    );

    const tsConfigPath = findTsConfig(tmpRoot);
    const { program, checker } = buildProgram(tsConfigPath);
    const graph = buildModuleGraph(program);
    const boundaryMap = classifyBoundaries(program, graph);
    const ctx: ProjectContext = {
      rootDir: tmpRoot,
      tsConfigPath,
      program,
      checker,
      moduleGraph: graph,
      boundaryMap,
      nextVersion: findNextVersion(tmpRoot),
      config: RESOLVED_CONFIG,
    };
    findings = await a03.run(ctx);
  });

  afterAll(() => {
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('flags a Stripe live secret key (sk_live_…)', () => {
    const f = findings.filter((x) => x.message.includes('"NEXT_PUBLIC_STRIPE_KEY"'));
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('Stripe secret key');
    expect(f[0]?.severity).toBe('critical');
  });

  it('flags a Stripe restricted key (rk_live_…)', () => {
    const f = findings.filter((x) => x.message.includes('"NEXT_PUBLIC_RESTRICTED"'));
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('Stripe restricted key');
  });

  it('does not include the literal Stripe-shaped value in any finding text', () => {
    const sk = 'sk' + '_' + 'live' + '_' + 'A'.repeat(25);
    const rk = 'rk' + '_' + 'live' + '_' + 'B'.repeat(25);
    for (const f of findings) {
      const blob = `${f.message} ${f.detail ?? ''} ${f.suggestion ?? ''}`;
      expect(blob).not.toContain(sk);
      expect(blob).not.toContain(rk);
    }
  });
});
