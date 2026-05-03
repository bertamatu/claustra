import ts from 'typescript';
import { hasDirective } from '../utils/ast.js';
import type { FileBoundary } from '../rules/types.js';
import type { ModuleGraph } from './module-graph.js';

export const classifyBoundaries = (
  program: ts.Program,
  graph: ModuleGraph,
): Map<string, FileBoundary> => {
  const map = new Map<string, FileBoundary>();
  const sourceFiles = program
    .getSourceFiles()
    .filter((f) => !f.isDeclarationFile && !f.fileName.includes('node_modules'));

  // Pass 1: explicit 'use client' files
  for (const sf of sourceFiles) {
    if (hasDirective(sf, 'use client')) map.set(sf.fileName, 'client');
  }

  // Pass 2: BFS from each client file through all transitive imports
  const reachableFromClient = new Set<string>();
  const queue = [...map.entries()]
    .filter(([, v]) => v === 'client')
    .map(([k]) => k);

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reachableFromClient.has(file)) continue;
    reachableFromClient.add(file);
    const deps = graph.get(file);
    if (deps) {
      for (const dep of deps) {
        if (!reachableFromClient.has(dep)) queue.push(dep);
      }
    }
  }

  // Pass 3: classify remaining files
  for (const sf of sourceFiles) {
    if (map.has(sf.fileName)) continue;
    map.set(
      sf.fileName,
      reachableFromClient.has(sf.fileName) ? 'either' : 'server',
    );
  }

  return map;
};
