import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cacheGet, cacheSet } from '../../src/llm/cache.js';

describe('llm cache', () => {
  let prevCwd: string;
  let dir: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(path.join(tmpdir(), 'claustra-cache-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined for a missing key', () => {
    expect(cacheGet('not-set')).toBeUndefined();
  });

  it('roundtrips a value through set/get', () => {
    const value = { risky: true, fields: ['password'], reasoning: 'because' };
    cacheSet('judge:a:b:c', value);
    expect(cacheGet('judge:a:b:c')).toEqual(value);
  });

  it('isolates entries by key', () => {
    cacheSet('k1', { a: 1 });
    cacheSet('k2', { a: 2 });
    expect(cacheGet('k1')).toEqual({ a: 1 });
    expect(cacheGet('k2')).toEqual({ a: 2 });
  });

  it('writes the cache directory under node_modules/.cache/claustra', () => {
    cacheSet('whatever', { ok: true });
    expect(existsSync(path.join(dir, 'node_modules', '.cache', 'claustra'))).toBe(true);
  });

  it('overwrites existing entries on re-set', () => {
    cacheSet('same-key', { v: 1 });
    cacheSet('same-key', { v: 2 });
    expect(cacheGet('same-key')).toEqual({ v: 2 });
  });
});
