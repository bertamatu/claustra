import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, buildProgram } from '../../src/scanner/project.js';
import { buildModuleGraph } from '../../src/scanner/module-graph.js';
import { classifyBoundaries } from '../../src/scanner/boundary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/a02-misuse');

describe('boundary classifier', () => {
  const tsConfigPath = findTsConfig(FIXTURE_ROOT);
  const { program } = buildProgram(tsConfigPath);
  const graph = buildModuleGraph(program);
  const boundaries = classifyBoundaries(program, graph);

  const lookup = (relPath: string): string | undefined => {
    const abs = path.join(FIXTURE_ROOT, relPath);
    return boundaries.get(abs);
  };

  it('marks files with "use client" directive as client', () => {
    expect(lookup('components/counter.tsx')).toBe('client');
  });

  it('marks server-only files as server', () => {
    expect(lookup('app/page.tsx')).toBe('server');
  });

  it('marks files imported by both server and client as either', () => {
    expect(lookup('components/util.ts')).toBe('either');
  });

  it('excludes node_modules from classification', () => {
    for (const filePath of boundaries.keys()) {
      expect(filePath).not.toContain('node_modules');
    }
  });
});
