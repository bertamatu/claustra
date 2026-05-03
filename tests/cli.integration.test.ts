import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/a02-misuse');
const CLI_ENTRY = path.join(REPO_ROOT, 'src/cli.ts');
const TSX = path.join(REPO_ROOT, 'node_modules/.bin/tsx');

const runCli = (...args: string[]): { stdout: string; stderr: string; status: number | null } => {
  const result = spawnSync(TSX, [CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
};

describe('claustra CLI (integration)', () => {
  beforeAll(() => {
    expect(existsSync(TSX), 'tsx must be installed').toBe(true);
  });

  it('prints help text on --help', () => {
    const { stdout, status } = runCli('--help');
    expect(status).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('claustra');
    expect(stdout).toContain('--reporter');
  });

  it('prints version on --version', () => {
    const { stdout, status } = runCli('--version');
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('scans the fixture and exits 0 with no findings (no rules registered yet)', () => {
    const { stdout, status } = runCli(FIXTURE, '--no-llm');
    expect(status).toBe(0);
    expect(stdout).toContain('0 findings');
  });

  it('emits valid JSON when --reporter=json is used', () => {
    const { stdout, status } = runCli(FIXTURE, '--no-llm', '--reporter', 'json');
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as { findings: unknown[] };
    expect(Array.isArray(parsed.findings)).toBe(true);
  });

  it('exits with code 2 when given a nonexistent path (no tsconfig)', () => {
    const { status, stderr } = runCli('/tmp/claustra-nonexistent-path-xyz', '--no-llm');
    expect(status).toBe(2);
    expect(stderr).toContain('No tsconfig.json found');
  });
});
