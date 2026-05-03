import type * as ts from 'typescript';
import type { ModuleGraph } from '../scanner/module-graph.js';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Finding = {
  ruleId: string;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  message: string;
  detail?: string;
  suggestion?: string;
  importChain?: string[];
};

export type FileBoundary = 'server' | 'client' | 'either';

export type ResolvedConfig = {
  rules: Record<string, 'error' | 'warn' | 'off'>;
  extraServerOnlyModules: string[];
  ignore: string[];
};

export type ProjectContext = {
  rootDir: string;
  tsConfigPath: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  moduleGraph: ModuleGraph;
  boundaryMap: Map<string, FileBoundary>;
  nextVersion: string;
  config: ResolvedConfig;
};

export type Rule = {
  id: string;
  description: string;
  severity: Severity;
  run: (ctx: ProjectContext) => Promise<Finding[]>;
};
