// Convert an App Router file path to its public URL path.
//
// App Router conventions stripped:
//   - leading `app/` (or any non-app prefix before it)
//   - route groups: `(group)` segments are removed entirely
//   - parallel slots: `@slot` segments are removed entirely
//   - intercepting markers: `(.)`, `(..)`, `(..)(..)`, `(...)` prefixes
//   - the trailing file: `page.{ext}`, `route.{ext}`, `layout.{ext}`,
//     `template.{ext}`, `default.{ext}`, `loading.{ext}`, `error.{ext}`,
//     `not-found.{ext}`, `forbidden.{ext}`, `unauthorized.{ext}`
//
// Dynamic segments are kept in path-to-regexp form so the matcher
// utility can compare them uniformly:
//   `[id]`        → `:id`
//   `[...slug]`   → `:slug*`
//   `[[...slug]]` → `:slug?`
//
// The result always starts with `/` and never ends with `/` (except for
// the root `/`).

import path from 'node:path';

const ROUTE_FILE_RE =
  /^(page|route|layout|template|default|loading|error|not-found|forbidden|unauthorized)\.[cm]?[jt]sx?$/i;

const INTERCEPTING_PREFIX_RE = /^\(\.+\)(.+)$/;

const isRouteGroup = (seg: string): boolean =>
  seg.startsWith('(') && seg.endsWith(')') && !INTERCEPTING_PREFIX_RE.test(seg);

const isParallelSlot = (seg: string): boolean => seg.startsWith('@');

const stripIntercepting = (seg: string): string => {
  const m = INTERCEPTING_PREFIX_RE.exec(seg);
  return m?.[1] ?? seg;
};

const dynamicToParam = (seg: string): string => {
  // [[...slug]] → :slug?
  const optionalCatchAll = /^\[\[\.\.\.([^\]]+)\]\]$/.exec(seg);
  if (optionalCatchAll) return `:${optionalCatchAll[1]!}?`;
  // [...slug] → :slug*
  const catchAll = /^\[\.\.\.([^\]]+)\]$/.exec(seg);
  if (catchAll) return `:${catchAll[1]!}*`;
  // [id] → :id
  const dyn = /^\[([^\]]+)\]$/.exec(seg);
  if (dyn) return `:${dyn[1]!}`;
  return seg;
};

const findAppRootIndex = (parts: string[]): number => {
  // Prefer the *last* `app` so that `src/app/...` and bare `app/...`
  // both work, and so that an `app/` directory nested under fixtures
  // (which is what our tests use) still resolves correctly.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'app') return i;
  }
  return -1;
};

// Returns the URL path (e.g. `/admin/:id`) for an App Router file, or
// `null` if the file isn't a recognized route file under an `app/`
// directory.
export const fileToUrlPath = (filePath: string): string | null => {
  const norm = filePath.split(path.sep).join('/');
  const parts = norm.split('/').filter(Boolean);
  const appIdx = findAppRootIndex(parts);
  if (appIdx === -1) return null;

  const rest = parts.slice(appIdx + 1);
  if (rest.length === 0) return null;

  const fileName = rest[rest.length - 1]!;
  if (!ROUTE_FILE_RE.test(fileName)) return null;

  const segments = rest.slice(0, -1);
  const out: string[] = [];
  for (const raw of segments) {
    if (isRouteGroup(raw)) continue;
    if (isParallelSlot(raw)) continue;
    const trimmed = stripIntercepting(raw);
    out.push(dynamicToParam(trimmed));
  }

  return out.length === 0 ? '/' : `/${out.join('/')}`;
};

// True if the file is a recognized App Router route or layout file.
export const isAppRouterRouteFile = (filePath: string): boolean =>
  fileToUrlPath(filePath) !== null;

// Inspect each segment of a URL path (as produced by `fileToUrlPath` or
// from the file's source path itself) for a literal segment matching
// any name in `names`. Used by sensitive-segment detection. Route
// groups and parallel slots are stripped before matching, but the
// caller may also want to detect *raw* group names like
// `(authenticated)` — supply those without parentheses to match the
// stripped form, OR pass the original file path and use
// `fileHasSegmentName` below.
export const urlPathHasSegment = (
  urlPath: string,
  names: ReadonlySet<string>,
): boolean => {
  const parts = urlPath.split('/').filter(Boolean);
  return parts.some((p) => names.has(p));
};

// True if the original file path contains a directory segment whose
// name matches one of `names`, considering only segments inside an
// `app/` tree. Unlike `urlPathHasSegment`, this DOES inspect route
// groups: passing `'(authenticated)'` matches an `(authenticated)/...`
// directory. Returns false for files outside any `app/` tree.
export const filePathHasSegment = (
  filePath: string,
  names: ReadonlySet<string>,
): boolean => {
  const norm = filePath.split(path.sep).join('/');
  const parts = norm.split('/').filter(Boolean);
  const appIdx = findAppRootIndex(parts);
  if (appIdx === -1) return false;
  const tail = parts.slice(appIdx + 1);
  return tail.some((p) => names.has(p));
};
