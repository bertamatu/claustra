// Minimal minimatch-style glob matcher - sufficient for `.claustra.json` ignore patterns.
// Supports: `*` (anything but `/`), `**` (anything including `/`), `?` (single char), `.` literal.

const escapeRegex = (s: string): string => s.replace(/[\\.+^$()|[\]{}]/g, '\\$&');

const compileGlob = (pattern: string): RegExp => {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**` → match anything (including separators)
        out += '.*';
        i += 2;
        // Eat trailing slash after `**/`
        if (pattern[i] === '/') i++;
        continue;
      }
      // `*` → match anything but `/`
      out += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i++;
      continue;
    }
    out += escapeRegex(c!);
    i++;
  }
  return new RegExp(`^${out}$`);
};

export const matchesGlob = (filePath: string, pattern: string): boolean =>
  compileGlob(pattern).test(filePath);

export const matchesAnyGlob = (filePath: string, patterns: readonly string[]): boolean => {
  for (const pattern of patterns) {
    if (matchesGlob(filePath, pattern)) return true;
  }
  return false;
};
