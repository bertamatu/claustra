import { describe, it, expect } from 'vitest';
import {
  matchesMatcherSource,
  extractMatcherSources,
  matcherCovers,
} from '../../src/utils/middleware-matcher.js';

describe('matchesMatcherSource - literal patterns', () => {
  it('matches an exact literal path', () => {
    expect(matchesMatcherSource('/admin', '/admin')).toBe(true);
    expect(matchesMatcherSource('/admin', '/admin/users')).toBe(false);
    expect(matchesMatcherSource('/admin', '/about')).toBe(false);
  });
});

describe('matchesMatcherSource - :name modifiers', () => {
  it('matches one-or-more segments with :path*', () => {
    expect(matchesMatcherSource('/admin/:path*', '/admin')).toBe(true);
    expect(matchesMatcherSource('/admin/:path*', '/admin/users')).toBe(true);
    expect(matchesMatcherSource('/admin/:path*', '/admin/users/123')).toBe(true);
    expect(matchesMatcherSource('/admin/:path*', '/about')).toBe(false);
  });

  it('matches a single segment with :name', () => {
    expect(matchesMatcherSource('/posts/:id', '/posts/42')).toBe(true);
    expect(matchesMatcherSource('/posts/:id', '/posts')).toBe(false);
    expect(matchesMatcherSource('/posts/:id', '/posts/42/edit')).toBe(false);
  });

  it('treats dynamic URL segments (:id) as concrete', () => {
    // URL came from fileToUrlPath('app/posts/[id]/page.tsx')
    expect(matchesMatcherSource('/posts/:id', '/posts/:id')).toBe(true);
    expect(matchesMatcherSource('/admin/:path*', '/admin/:slug')).toBe(true);
  });
});

describe('matchesMatcherSource - raw regex groups', () => {
  it('matches Next.js negative-lookahead pattern', () => {
    const m = '/((?!api|_next/static|_next/image|favicon.ico).*)';
    expect(matchesMatcherSource(m, '/admin')).toBe(true);
    expect(matchesMatcherSource(m, '/dashboard')).toBe(true);
    expect(matchesMatcherSource(m, '/api/users')).toBe(false);
    expect(matchesMatcherSource(m, '/_next/static/foo')).toBe(false);
  });

  it('matches alternation groups', () => {
    expect(matchesMatcherSource('/(api|trpc)(.*)', '/api/users')).toBe(true);
    expect(matchesMatcherSource('/(api|trpc)(.*)', '/trpc/get')).toBe(true);
    expect(matchesMatcherSource('/(api|trpc)(.*)', '/about')).toBe(false);
  });
});

describe('matchesMatcherSource - fallback behavior', () => {
  it('returns true (conservative) for an unparseable pattern', () => {
    // Unbalanced paren - bail out
    expect(matchesMatcherSource('/admin/(unclosed', '/admin')).toBe(true);
  });
});

describe('extractMatcherSources', () => {
  it('extracts a single string', () => {
    expect(extractMatcherSources('/admin')).toEqual(['/admin']);
  });

  it('extracts an array of strings', () => {
    expect(extractMatcherSources(['/admin', '/dashboard'])).toEqual(['/admin', '/dashboard']);
  });

  it('extracts the source field from object entries', () => {
    expect(extractMatcherSources({ source: '/admin' })).toEqual(['/admin']);
    expect(
      extractMatcherSources([
        { source: '/admin', has: [{ type: 'header', key: 'x' }] },
        '/dashboard',
      ]),
    ).toEqual(['/admin', '/dashboard']);
  });

  it('returns null for unreadable shapes', () => {
    expect(extractMatcherSources(undefined)).toBeNull();
    expect(extractMatcherSources(123)).toBeNull();
    expect(extractMatcherSources([{ wrong: 'shape' }])).toBeNull();
  });
});

describe('matcherCovers', () => {
  it('treats unreadable matcher as covering everything', () => {
    expect(matcherCovers(undefined, '/admin')).toBe(true);
    expect(matcherCovers(42, '/admin')).toBe(true);
  });

  it('returns false when no source matches', () => {
    expect(matcherCovers(['/admin/:path*'], '/dashboard')).toBe(false);
  });

  it('returns true when at least one source matches', () => {
    expect(matcherCovers(['/admin/:path*', '/dashboard/:path*'], '/dashboard/users')).toBe(true);
  });

  it('returns false for an empty array (explicit "matches nothing")', () => {
    expect(matcherCovers([], '/admin')).toBe(false);
  });
});
