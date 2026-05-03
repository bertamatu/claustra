import type * as ts from 'typescript';

export const hasDirective = (
  sourceFile: ts.SourceFile,
  directive: 'use client' | 'use server',
): boolean => {
  for (const stmt of sourceFile.statements) {
    if (
      stmt.kind === 241 /* ExpressionStatement */ &&
      (stmt as ts.ExpressionStatement).expression.kind === 11 /* StringLiteral */
    ) {
      const text = ((stmt as ts.ExpressionStatement).expression as ts.StringLiteral).text;
      if (text === directive) return true;
    } else {
      break;
    }
  }
  return false;
};
