// Convert a Next.js middleware `matcher` entry into a predicate that
// answers "does this URL path fall under the matcher?"
//
// `matcher` accepts a path-to-regexp pattern, a raw regex via the
// `()` group, or an array of either. The Next.js docs explicitly list
// these forms:
//
//   '/about/:path*'
//   '/((?!api|_next/static|_next/image|favicon.ico).*)'
//   '/(api|trpc)(.*)'
//
// We convert the path-to-regexp subset that Next.js advertises to a
// real `RegExp`. If we can't recognize the syntax, we conservatively
// return a predicate that ALWAYS matches (`() => true`). This biases
// toward false negatives (silent passes) over false positives (noisy
// flags) — the rule's job is to flag clearly-uncovered routes.

const escapeRegex = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// Translate a path-to-regexp v6 pattern (the version Next.js bundles)
// into a `RegExp`. Supported syntax:
//   - literal characters
//   - `:name` — single segment (no `/`)
//   - `:name*` — zero or more segments (the preceding `/` is folded
//     into the parameter so `/admin/:path*` matches both `/admin` and
//     `/admin/x/y`)
//   - `:name+` — one or more segments (preceding `/` required)
//   - `:name?` — optional single segment (preceding `/` folded)
//   - `(...)` — raw regex group, embedded verbatim
//   - `*` standalone — `(.*)` shorthand
//
// We anchor with `^` and `$`.
const compilePathPattern = (pattern: string): RegExp | null => {
  let i = 0;
  let out = '^';

  // Read a `:name<mod>?` token starting at index `i` (which points at
  // the colon). Returns the consumed length and emitted pattern, OR
  // null on failure.
  const readParam = (start: number): { len: number; emit: string } | null => {
    let j = start + 1;
    while (j < pattern.length && /[A-Za-z0-9_]/.test(pattern[j]!)) j++;
    if (j === start + 1) return null;
    const mod = pattern[j];
    if (mod === '*' || mod === '+' || mod === '?') {
      return { len: j + 1 - start, emit: '__PARAM__' + mod };
    }
    return { len: j - start, emit: '[^/]+' };
  };

  while (i < pattern.length) {
    const c = pattern[i]!;

    // Raw regex group: copy until the matching `)`, respecting nested
    // parens. Bail out on imbalanced parens.
    if (c === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < pattern.length && depth > 0) {
        const cj = pattern[j]!;
        if (cj === '\\' && j + 1 < pattern.length) {
          j += 2;
          continue;
        }
        if (cj === '(') depth++;
        else if (cj === ')') depth--;
        if (depth === 0) break;
        j++;
      }
      if (depth !== 0) return null;
      out += pattern.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // Slash followed by a parameter — fold the slash into the param so
    // optional/repeating params don't leave a stray `/` requirement.
    if (c === '/' && pattern[i + 1] === ':') {
      const p = readParam(i + 1);
      if (!p) return null;
      const emit = p.emit;
      if (emit === '__PARAM__*') {
        out += '(?:/[^/]+(?:/[^/]+)*)?';
      } else if (emit === '__PARAM__+') {
        out += '/[^/]+(?:/[^/]+)*';
      } else if (emit === '__PARAM__?') {
        out += '(?:/[^/]+)?';
      } else {
        out += '/' + emit;
      }
      i += 1 + p.len;
      continue;
    }

    // Bare parameter (no preceding slash).
    if (c === ':') {
      const p = readParam(i);
      if (!p) return null;
      const emit = p.emit;
      if (emit === '__PARAM__*') {
        out += '(?:[^/]+(?:/[^/]+)*)?';
      } else if (emit === '__PARAM__+') {
        out += '[^/]+(?:/[^/]+)*';
      } else if (emit === '__PARAM__?') {
        out += '(?:[^/]+)?';
      } else {
        out += emit;
      }
      i += p.len;
      continue;
    }

    // `*` standalone — `(.*)` shorthand.
    if (c === '*') {
      out += '.*';
      i++;
      continue;
    }

    out += escapeRegex(c);
    i++;
  }
  out += '$';

  try {
    return new RegExp(out);
  } catch {
    return null;
  }
};

// True if `urlPath` is matched by the given matcher source string.
// `urlPath` should be in path-to-regexp form already (as produced by
// `fileToUrlPath`). Dynamic segments like `:id` in the URL path are
// treated as concrete strings — we substitute a placeholder so they
// pass single-segment matchers.
export const matchesMatcherSource = (
  source: string,
  urlPath: string,
): boolean => {
  const compiled = compilePathPattern(source);
  // Conservative: if we can't parse, treat as covering everything.
  if (!compiled) return true;
  // Substitute path-to-regexp params in the input URL with a concrete
  // placeholder so they satisfy `[^/]+`-style segment matchers.
  const concrete = urlPath.replace(/:[A-Za-z0-9_]+\??\*?/g, 'x');
  return compiled.test(concrete);
};

// A `matcher` entry can be a string, an object `{ source, has?, … }`,
// or an array of either. Extract the underlying `source` strings.
// Returns `null` if the matcher value is in a shape we can't read
// statically (e.g. a runtime computation) — caller should treat that
// as covering everything.
export const extractMatcherSources = (matcher: unknown): string[] | null => {
  if (typeof matcher === 'string') return [matcher];
  if (Array.isArray(matcher)) {
    const out: string[] = [];
    for (const item of matcher) {
      if (typeof item === 'string') {
        out.push(item);
        continue;
      }
      if (item && typeof item === 'object' && 'source' in item) {
        const src = (item as { source: unknown }).source;
        if (typeof src === 'string') out.push(src);
        else return null;
        continue;
      }
      return null;
    }
    return out;
  }
  if (matcher && typeof matcher === 'object' && 'source' in matcher) {
    const src = matcher.source;
    if (typeof src === 'string') return [src];
  }
  return null;
};

// Convenience: does at least one of the matcher's sources cover the
// given URL path? If the matcher value is unreadable, returns `true`
// (conservative).
export const matcherCovers = (matcher: unknown, urlPath: string): boolean => {
  const sources = extractMatcherSources(matcher);
  if (sources === null) return true;
  if (sources.length === 0) return false;
  return sources.some((s) => matchesMatcherSource(s, urlPath));
};
