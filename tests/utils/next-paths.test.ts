import { describe, it, expect } from 'vitest';
import {
  fileToUrlPath,
  isAppRouterRouteFile,
  urlPathHasSegment,
  filePathHasSegment,
} from '../../src/utils/next-paths.js';

describe('fileToUrlPath', () => {
  it('returns / for app/page.tsx', () => {
    expect(fileToUrlPath('app/page.tsx')).toBe('/');
  });

  it('returns the path for nested page', () => {
    expect(fileToUrlPath('app/admin/page.tsx')).toBe('/admin');
    expect(fileToUrlPath('app/admin/users/page.tsx')).toBe('/admin/users');
  });

  it('handles src/app layout', () => {
    expect(fileToUrlPath('src/app/dashboard/page.tsx')).toBe('/dashboard');
  });

  it('strips route groups', () => {
    expect(fileToUrlPath('app/(marketing)/about/page.tsx')).toBe('/about');
    expect(fileToUrlPath('app/(authenticated)/account/page.tsx')).toBe('/account');
  });

  it('strips parallel slots (@ prefix)', () => {
    expect(fileToUrlPath('app/dashboard/@modal/login/page.tsx')).toBe('/dashboard/login');
  });

  it('strips intercepting markers', () => {
    expect(fileToUrlPath('app/feed/(.)photo/page.tsx')).toBe('/feed/photo');
    expect(fileToUrlPath('app/feed/(..)photo/page.tsx')).toBe('/feed/photo');
    expect(fileToUrlPath('app/feed/(...)photo/page.tsx')).toBe('/feed/photo');
  });

  it('converts dynamic segments to path-to-regexp form', () => {
    expect(fileToUrlPath('app/posts/[id]/page.tsx')).toBe('/posts/:id');
    expect(fileToUrlPath('app/docs/[...slug]/page.tsx')).toBe('/docs/:slug*');
    expect(fileToUrlPath('app/shop/[[...path]]/page.tsx')).toBe('/shop/:path?');
  });

  it('handles route handlers', () => {
    expect(fileToUrlPath('app/api/users/route.ts')).toBe('/api/users');
    expect(fileToUrlPath('app/api/proxy/[id]/route.ts')).toBe('/api/proxy/:id');
  });

  it('handles layout files', () => {
    expect(fileToUrlPath('app/admin/layout.tsx')).toBe('/admin');
  });

  it('returns null for non-route files', () => {
    expect(fileToUrlPath('app/admin/utils.ts')).toBeNull();
    expect(fileToUrlPath('app/components/Button.tsx')).toBeNull();
  });

  it('returns null for files outside an app/ tree', () => {
    expect(fileToUrlPath('lib/db.ts')).toBeNull();
    expect(fileToUrlPath('pages/index.tsx')).toBeNull();
  });
});

describe('isAppRouterRouteFile', () => {
  it('detects page/route/layout files', () => {
    expect(isAppRouterRouteFile('app/page.tsx')).toBe(true);
    expect(isAppRouterRouteFile('app/api/x/route.ts')).toBe(true);
    expect(isAppRouterRouteFile('app/admin/layout.tsx')).toBe(true);
  });

  it('rejects non-route files', () => {
    expect(isAppRouterRouteFile('app/lib/util.ts')).toBe(false);
    expect(isAppRouterRouteFile('lib/db.ts')).toBe(false);
  });
});

describe('urlPathHasSegment', () => {
  it('matches a literal segment anywhere in the URL', () => {
    expect(urlPathHasSegment('/admin/users', new Set(['admin']))).toBe(true);
    expect(urlPathHasSegment('/admin/users', new Set(['users']))).toBe(true);
  });

  it('does NOT match a substring of a segment', () => {
    expect(urlPathHasSegment('/administrative', new Set(['admin']))).toBe(false);
  });
});

describe('filePathHasSegment', () => {
  it('matches a route-group segment in the original file path', () => {
    expect(
      filePathHasSegment('app/(authenticated)/account/page.tsx', new Set(['(authenticated)'])),
    ).toBe(true);
  });

  it('does NOT match anything outside the app tree', () => {
    expect(filePathHasSegment('lib/(authenticated)/x.ts', new Set(['(authenticated)']))).toBe(
      false,
    );
  });
});
