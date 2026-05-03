import path from 'node:path';
import ts from 'typescript';
import { collectModuleSpecRefs } from '../utils/ast.js';

export type ModuleGraph = Map<string, Set<string>>;

const resolveImport = (
  importPath: string,
  fromFile: string,
  program: ts.Program,
): string | undefined => {
  const sourceFile = program.getSourceFile(fromFile);
  if (!sourceFile) return undefined;

  const resolved = ts.resolveModuleName(
    importPath,
    fromFile,
    program.getCompilerOptions(),
    ts.sys,
  );

  return resolved.resolvedModule?.resolvedFileName;
};

export const buildModuleGraph = (program: ts.Program): ModuleGraph => {
  const graph: ModuleGraph = new Map();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const imports = new Set<string>();

    for (const { spec } of collectModuleSpecRefs(sourceFile)) {
      const resolved = resolveImport(spec, sourceFile.fileName, program);
      if (resolved && !resolved.includes('node_modules')) {
        imports.add(resolved);
      }
    }

    graph.set(sourceFile.fileName, imports);
  }

  return graph;
};

export const getTransitiveDeps = (
  startFile: string,
  graph: ModuleGraph,
): Set<string> => {
  const visited = new Set<string>();
  const queue = [startFile];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const deps = graph.get(file);
    if (deps) {
      for (const dep of deps) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }
  }

  visited.delete(startFile);
  return visited;
};

export const getImportChain = (
  from: string,
  to: string,
  graph: ModuleGraph,
  rootDir: string,
): string[] => {
  const rel = (f: string) => path.relative(rootDir, f);
  const queue: Array<{ file: string; chain: string[] }> = [
    { file: from, chain: [rel(from)] },
  ];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const deps = graph.get(file) ?? new Set();
    for (const dep of deps) {
      const newChain = [...chain, rel(dep)];
      if (dep === to) return newChain;
      if (!visited.has(dep)) queue.push({ file: dep, chain: newChain });
    }
  }

  return [rel(from), rel(to)];
};
