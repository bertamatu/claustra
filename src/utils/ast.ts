import ts from 'typescript';

export const hasDirective = (
  sourceFile: ts.SourceFile,
  directive: 'use client' | 'use server',
): boolean => {
  for (const stmt of sourceFile.statements) {
    if (!ts.isExpressionStatement(stmt)) break;
    if (!ts.isStringLiteral(stmt.expression)) break;
    if (stmt.expression.text === directive) return true;
  }
  return false;
};

export type ModuleSpecRef = {
  spec: string;
  stmt: ts.ImportDeclaration | ts.ExportDeclaration;
};

export const collectModuleSpecRefs = (
  sourceFile: ts.SourceFile,
): ModuleSpecRef[] => {
  const out: ModuleSpecRef[] = [];
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      out.push({ spec: stmt.moduleSpecifier.text, stmt });
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      out.push({ spec: stmt.moduleSpecifier.text, stmt });
    }
  }
  return out;
};
