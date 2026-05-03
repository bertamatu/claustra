import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { hasDirective } from '../../src/utils/ast.js';

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile('test.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

describe('hasDirective', () => {
  it('detects "use client" at top of file', () => {
    expect(hasDirective(parse(`'use client';\nexport const x = 1;`), 'use client')).toBe(true);
  });

  it('detects "use server" at top of file', () => {
    expect(hasDirective(parse(`'use server';\nexport const x = 1;`), 'use server')).toBe(true);
  });

  it('detects directive when preceded only by comments', () => {
    const src = `// header comment\n/* block */\n'use client';\nexport const x = 1;`;
    expect(hasDirective(parse(src), 'use client')).toBe(true);
  });

  it('returns false when directive appears after an import', () => {
    const src = `import { x } from 'y';\n'use client';\nexport const z = 1;`;
    expect(hasDirective(parse(src), 'use client')).toBe(false);
  });

  it('returns false when directive appears after another statement', () => {
    const src = `const x = 1;\n'use client';\nexport const z = 1;`;
    expect(hasDirective(parse(src), 'use client')).toBe(false);
  });

  it('returns false for empty file', () => {
    expect(hasDirective(parse(''), 'use client')).toBe(false);
  });

  it('returns false when looking for the wrong directive', () => {
    expect(hasDirective(parse(`'use client';`), 'use server')).toBe(false);
  });

  it('handles double-quoted directives', () => {
    expect(hasDirective(parse(`"use client";`), 'use client')).toBe(true);
  });

  it('does not falsely match similar strings', () => {
    expect(hasDirective(parse(`'use clients';`), 'use client')).toBe(false);
  });
});
