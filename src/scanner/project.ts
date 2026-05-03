import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const findTsConfig = (startDir: string): string => {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No tsconfig.json found from ${startDir}`);
    dir = parent;
  }
};

export const findNextVersion = (rootDir: string): string => {
  const pkgPath = path.join(rootDir, 'node_modules', 'next', 'package.json');
  if (!existsSync(pkgPath)) return 'unknown';
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? 'unknown';
};

export const buildProgram = (
  tsConfigPath: string,
): { program: ts.Program; checker: ts.TypeChecker } => {
  const configFile = ts.readConfigFile(tsConfigPath, (p) => ts.sys.readFile(p));
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, ts.createCompilerHost({})));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config as object,
    ts.sys,
    path.dirname(tsConfigPath),
  );

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });

  return { program, checker: program.getTypeChecker() };
};
