import { describe, it, expect } from 'vitest';
import { matchesGlob, matchesAnyGlob } from '../../src/utils/glob.js';

describe('matchesGlob', () => {
  it('matches a literal path', () => {
    expect(matchesGlob('src/cli.ts', 'src/cli.ts')).toBe(true);
    expect(matchesGlob('src/cli.ts', 'src/cli.tsx')).toBe(false);
  });

  it('treats `*` as anything but `/`', () => {
    expect(matchesGlob('src/cli.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/scanner/cli.ts', 'src/*.ts')).toBe(false);
  });

  it('treats `**` as anything including `/`', () => {
    expect(matchesGlob('app/sitemap.ts', '**/sitemap.ts')).toBe(true);
    expect(matchesGlob('sitemap.ts', '**/sitemap.ts')).toBe(true);
    expect(matchesGlob('a/b/c/sitemap.ts', '**/sitemap.ts')).toBe(true);
    expect(matchesGlob('app/sitemap.tsx', '**/sitemap.ts')).toBe(false);
  });

  it('matches a `dir/**` prefix pattern', () => {
    expect(matchesGlob('scripts/build.ts', 'scripts/**')).toBe(true);
    expect(matchesGlob('scripts/sub/build.ts', 'scripts/**')).toBe(true);
    expect(matchesGlob('not-scripts/build.ts', 'scripts/**')).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(matchesGlob('a.b', 'a.b')).toBe(true);
    expect(matchesGlob('axb', 'a.b')).toBe(false); // dot is literal, not "any char"
    expect(matchesGlob('foo+bar.ts', 'foo+bar.ts')).toBe(true);
  });

  it('treats `?` as a single non-slash char', () => {
    expect(matchesGlob('a.ts', '?.ts')).toBe(true);
    expect(matchesGlob('ab.ts', '?.ts')).toBe(false);
    expect(matchesGlob('a/ts', '?/ts')).toBe(true);
  });
});

describe('matchesAnyGlob', () => {
  it('returns true if any pattern matches', () => {
    const patterns = ['**/sitemap.ts', 'scripts/**', '**/legacy/**'];
    expect(matchesAnyGlob('app/sitemap.ts', patterns)).toBe(true);
    expect(matchesAnyGlob('scripts/build.ts', patterns)).toBe(true);
    expect(matchesAnyGlob('app/legacy/old.ts', patterns)).toBe(true);
    expect(matchesAnyGlob('app/page.tsx', patterns)).toBe(false);
  });

  it('returns false for an empty pattern list', () => {
    expect(matchesAnyGlob('app/page.tsx', [])).toBe(false);
  });
});
