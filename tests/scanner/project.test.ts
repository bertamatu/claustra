import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, findNextVersion, buildProgram } from '../../src/scanner/project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/a02-misuse');

describe('findTsConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'claustra-tsc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds tsconfig.json in the same directory', () => {
    const tsConfig = path.join(dir, 'tsconfig.json');
    writeFileSync(tsConfig, '{}');
    expect(findTsConfig(dir)).toBe(tsConfig);
  });

  it('walks up directories to find tsconfig.json', () => {
    const tsConfig = path.join(dir, 'tsconfig.json');
    writeFileSync(tsConfig, '{}');
    const nested = path.join(dir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(findTsConfig(nested)).toBe(tsConfig);
  });

  it('throws a clear error when no tsconfig is found anywhere up the tree', () => {
    // Use /tmp directly — guaranteed no tsconfig walking up to /
    expect(() => findTsConfig(dir)).toThrow(/No tsconfig\.json found/);
  });
});

describe('findNextVersion', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'claustra-next-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 'unknown' when next is not installed", () => {
    expect(findNextVersion(dir)).toBe('unknown');
  });

  it('returns the version from node_modules/next/package.json when present', () => {
    const nextDir = path.join(dir, 'node_modules', 'next');
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(path.join(nextDir, 'package.json'), JSON.stringify({ version: '15.1.2' }));
    expect(findNextVersion(dir)).toBe('15.1.2');
  });

  it("returns 'unknown' when next package.json has no version field", () => {
    const nextDir = path.join(dir, 'node_modules', 'next');
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(path.join(nextDir, 'package.json'), JSON.stringify({}));
    expect(findNextVersion(dir)).toBe('unknown');
  });
});

describe('buildProgram', () => {
  it('returns a TypeScript Program and TypeChecker from a real fixture tsconfig', () => {
    const tsConfigPath = findTsConfig(FIXTURE_ROOT);
    const { program, checker } = buildProgram(tsConfigPath);
    expect(program.getSourceFiles().length).toBeGreaterThan(0);
    expect(checker).toBeDefined();
    expect(typeof checker.getTypeAtLocation).toBe('function');
  });
});
