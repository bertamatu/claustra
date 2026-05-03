import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'claustra-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns full defaults when no config file exists', () => {
    const cfg = loadConfig(dir);
    expect(cfg.rules['a01-server-only-in-client']).toBe('error');
    expect(cfg.rules['d02-caching-dynamic']).toBe('warn');
    expect(cfg.extraServerOnlyModules).toEqual([]);
    expect(cfg.llm.enabled).toBe(true);
    expect(cfg.llm.model).toBe('claude-haiku-4-5-20251001');
    expect(cfg.ignore).toContain('**/node_modules/**');
  });

  it('loads custom rule severities from .claustra.json', () => {
    writeFileSync(
      path.join(dir, '.claustra.json'),
      JSON.stringify({
        rules: { 'a01-server-only-in-client': 'off', 'd01-hydration-risks': 'warn' },
      }),
    );
    const cfg = loadConfig(dir);
    expect(cfg.rules['a01-server-only-in-client']).toBe('off');
    expect(cfg.rules['d01-hydration-risks']).toBe('warn');
  });

  it('loads extraServerOnlyModules', () => {
    writeFileSync(
      path.join(dir, '.claustra.json'),
      JSON.stringify({ extraServerOnlyModules: ['@my-org/db', '@my-org/secrets'] }),
    );
    const cfg = loadConfig(dir);
    expect(cfg.extraServerOnlyModules).toEqual(['@my-org/db', '@my-org/secrets']);
  });

  it('loads llm overrides', () => {
    writeFileSync(
      path.join(dir, '.claustra.json'),
      JSON.stringify({ llm: { enabled: false, model: 'claude-sonnet-4-6' } }),
    );
    const cfg = loadConfig(dir);
    expect(cfg.llm.enabled).toBe(false);
    expect(cfg.llm.model).toBe('claude-sonnet-4-6');
  });

  it('honours an explicit configPath', () => {
    const custom = path.join(dir, 'custom.json');
    writeFileSync(custom, JSON.stringify({ extraServerOnlyModules: ['@foo'] }));
    const cfg = loadConfig(dir, custom);
    expect(cfg.extraServerOnlyModules).toEqual(['@foo']);
  });

  it('throws a readable error on invalid severity', () => {
    writeFileSync(
      path.join(dir, '.claustra.json'),
      JSON.stringify({ rules: { 'a01-server-only-in-client': 'fatal' } }),
    );
    expect(() => loadConfig(dir)).toThrow(/Invalid \.claustra\.json/);
  });

  it('throws on invalid JSON', () => {
    writeFileSync(path.join(dir, '.claustra.json'), '{ not json');
    expect(() => loadConfig(dir)).toThrow();
  });
});
