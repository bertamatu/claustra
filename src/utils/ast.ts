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
