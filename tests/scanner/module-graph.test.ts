import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTsConfig, buildProgram } from '../../src/scanner/project.js';
import {
  buildModuleGraph,
  getTransitiveDeps,
  getImportChain,
  type ModuleGraph,
} from '../../src/scanner/module-graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/a02-misuse');

describe('buildModuleGraph', () => {
  const { program } = buildProgram(findTsConfig(FIXTURE_ROOT));
  const graph = buildModuleGraph(program);

  const abs = (rel: string) => path.join(FIXTURE_ROOT, rel);

  it('captures imports from page.tsx', () => {
    const deps = graph.get(abs('app/page.tsx'));
    expect(deps).toBeDefined();
    expect(deps).toContain(abs('components/counter.tsx'));
    expect(deps).toContain(abs('components/util.ts'));
  });

  it('captures imports from counter.tsx', () => {
    const deps = graph.get(abs('components/counter.tsx'));
    expect(deps).toBeDefined();
    expect(deps).toContain(abs('components/util.ts'));
  });

  it('records leaf files with no project-relative imports', () => {
    const deps = graph.get(abs('components/util.ts'));
    // util.ts has no imports — should still be in the graph with an empty set
    expect(deps).toBeDefined();
    expect(deps?.size).toBe(0);
  });

  it('excludes node_modules and .d.ts files', () => {
    for (const [file, deps] of graph) {
      expect(file).not.toContain('node_modules');
      for (const dep of deps) {
        expect(dep).not.toContain('node_modules');
      }
    }
  });
});

describe('getTransitiveDeps', () => {
  const { program } = buildProgram(findTsConfig(FIXTURE_ROOT));
  const graph = buildModuleGraph(program);
  const abs = (rel: string) => path.join(FIXTURE_ROOT, rel);

  it('returns all transitive dependencies excluding the start file', () => {
    const deps = getTransitiveDeps(abs('app/page.tsx'), graph);
    expect(deps.has(abs('components/counter.tsx'))).toBe(true);
    expect(deps.has(abs('components/util.ts'))).toBe(true);
    expect(deps.has(abs('app/page.tsx'))).toBe(false);
  });

  it('returns empty set for a leaf file with no deps', () => {
    const deps = getTransitiveDeps(abs('components/util.ts'), graph);
    expect(deps.size).toBe(0);
  });

  it('handles cycles without infinite loop', () => {
    const cyclic: ModuleGraph = new Map([
      ['/a.ts', new Set(['/b.ts'])],
      ['/b.ts', new Set(['/a.ts'])],
    ]);
    const deps = getTransitiveDeps('/a.ts', cyclic);
    expect(deps.has('/b.ts')).toBe(true);
    expect(deps.has('/a.ts')).toBe(false);
  });

  it('returns empty set for a file not in the graph', () => {
    expect(getTransitiveDeps('/nonexistent.ts', graph).size).toBe(0);
  });
});

describe('getImportChain', () => {
  it('finds a direct import chain', () => {
    const graph: ModuleGraph = new Map([
      ['/root/a.ts', new Set(['/root/b.ts'])],
      ['/root/b.ts', new Set()],
    ]);
    expect(getImportChain('/root/a.ts', '/root/b.ts', graph, '/root')).toEqual(['a.ts', 'b.ts']);
  });

  it('finds a multi-hop import chain', () => {
    const graph: ModuleGraph = new Map([
      ['/r/a.ts', new Set(['/r/b.ts'])],
      ['/r/b.ts', new Set(['/r/c.ts'])],
      ['/r/c.ts', new Set()],
    ]);
    expect(getImportChain('/r/a.ts', '/r/c.ts', graph, '/r')).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('returns a fallback two-element chain when no path exists', () => {
    const graph: ModuleGraph = new Map([
      ['/r/a.ts', new Set()],
    ]);
    expect(getImportChain('/r/a.ts', '/r/b.ts', graph, '/r')).toEqual(['a.ts', 'b.ts']);
  });

  it('does not loop forever on cycles', () => {
    const graph: ModuleGraph = new Map([
      ['/r/a.ts', new Set(['/r/b.ts'])],
      ['/r/b.ts', new Set(['/r/a.ts'])],
    ]);
    expect(getImportChain('/r/a.ts', '/r/b.ts', graph, '/r')).toEqual(['a.ts', 'b.ts']);
  });
});
