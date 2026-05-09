import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Finding, ProjectContext, Rule, Severity } from './types.js';

const RULE_ID = 'a03-env-public-secret';
const SEVERITY: Severity = 'critical';

const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development'];
const NEXT_CONFIG_FILES = [
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs',
];

type SecretPattern = {
  name: string;
  test: (value: string) => boolean;
};

const PROVIDER_PATTERNS: SecretPattern[] = [
  {
    name: 'Anthropic API key (sk-ant-…)',
    test: (v) => /^sk-ant-(api03-)?[A-Za-z0-9_-]{20,}$/.test(v),
  },
  {
    name: 'OpenAI API key (sk-…)',
    test: (v) => /^sk-(?!ant-)[A-Za-z0-9_-]{20,}$/.test(v),
  },
  {
    name: 'Stripe secret key (sk_live_/sk_test_)',
    test: (v) => /^sk_(test|live)_[A-Za-z0-9]{24,}$/.test(v),
  },
  {
    name: 'Stripe restricted key (rk_live_/rk_test_)',
    test: (v) => /^rk_(test|live)_[A-Za-z0-9]{24,}$/.test(v),
  },
  {
    name: 'AWS access key ID (AKIA…)',
    test: (v) => /^AKIA[0-9A-Z]{16}$/.test(v),
  },
  {
    name: 'GitHub personal access token (ghp_…)',
    test: (v) => /^ghp_[A-Za-z0-9]{36}$/.test(v),
  },
];

const PUBLIC_KEY_SHAPES = [
  /^pk_(test|live)_[A-Za-z0-9]{8,}$/, // Stripe publishable
  /^pk-[A-Za-z0-9_-]{8,}$/,
];

const PLACEHOLDER_TOKENS = new Set([
  '', 'xxx', 'xxxx', 'xxxxx', 'todo', 'changeme', 'change-me', 'change_me',
  'placeholder', 'your-key-here', 'your_key_here', 'your-api-key',
  'your_api_key', 'replaceme', 'replace-me', 'replace_me', 'secret',
  'example', 'value', 'undefined', 'null',
]);

const URL_RE = /^https?:\/\//i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOSTNAME_RE = /^([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;
const BASE64_OR_HEX_RE = /^[A-Za-z0-9+/=_-]+$/;

const ENTROPY_THRESHOLD = 4.5;
const MIN_ENTROPY_LEN = 24;

const shannonEntropy = (s: string): number => {
  if (s.length === 0) return 0;
  const counts: Record<string, number> = {};
  for (const ch of s) counts[ch] = (counts[ch] ?? 0) + 1;
  let h = 0;
  for (const c of Object.values(counts)) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
};

const isPlaceholder = (value: string): boolean => {
  const v = value.trim();
  if (PLACEHOLDER_TOKENS.has(v.toLowerCase())) return true;
  // Bracket-wrapped placeholder: <your-key-here>, {{ANYTHING}}, $VAR
  if (/^[<{[].*[>}\]]$/.test(v)) return true;
  if (/^\$\{?[A-Z_][A-Z0-9_]*\}?$/.test(v)) return true;
  // Repeating same-character runs ("xxxxxxxx", "00000000")
  if (v.length >= 4 && /^(.)\1+$/.test(v)) return true;
  return false;
};

const isPublicKeyShape = (value: string): boolean =>
  PUBLIC_KEY_SHAPES.some((re) => re.test(value));

const looksLikeUrlOrHost = (value: string): boolean => {
  if (URL_RE.test(value)) return true;
  if (UUID_RE.test(value)) return true;
  if (HOSTNAME_RE.test(value) && !value.includes('/')) return true;
  return false;
};

const matchProviderPattern = (value: string): SecretPattern | null => {
  for (const p of PROVIDER_PATTERNS) if (p.test(value)) return p;
  return null;
};

const matchesEntropyHeuristic = (value: string): { entropy: number } | null => {
  if (value.length < MIN_ENTROPY_LEN) return null;
  if (!BASE64_OR_HEX_RE.test(value)) return null;
  const entropy = shannonEntropy(value);
  if (entropy < ENTROPY_THRESHOLD) return null;
  return { entropy };
};

type Match = {
  reason: string;
  detail: string;
};

const classifyValue = (value: string): Match | null => {
  const trimmed = value.trim();
  if (isPlaceholder(trimmed)) return null;
  if (isPublicKeyShape(trimmed)) return null;
  if (looksLikeUrlOrHost(trimmed)) return null;

  const provider = matchProviderPattern(trimmed);
  if (provider) {
    return {
      reason: provider.name,
      detail: `Value (length ${trimmed.length}) matches the format of a ${provider.name}. The literal value is intentionally not printed.`,
    };
  }

  const entropy = matchesEntropyHeuristic(trimmed);
  if (entropy) {
    return {
      reason: 'high-entropy secret-shaped string',
      detail: `Value (length ${trimmed.length}, Shannon entropy ${entropy.entropy.toFixed(2)} bits/char) matches the shape of a base64/hex secret. The literal value is intentionally not printed.`,
    };
  }

  return null;
};

// ───────────────────────── .env file parsing ─────────────────────────

type EnvEntry = {
  key: string;
  value: string;
  line: number;
  column: number;
};

const stripQuotes = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  // Drop trailing inline comment for unquoted values: KEY=value # comment
  const hashIdx = trimmed.indexOf(' #');
  if (hashIdx >= 0) return trimmed.slice(0, hashIdx).trim();
  return trimmed;
};

const parseEnvFile = (content: string): EnvEntry[] => {
  const out: EnvEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const stripped = raw.replace(/^\s*export\s+/, '');
    const trimmed = stripped.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const valueRaw = trimmed.slice(eq + 1);
    const value = stripQuotes(valueRaw);
    const column = raw.indexOf('=') + 2; // 1-based, char after =
    out.push({ key, value, line: i + 1, column: column > 0 ? column : 1 });
  }
  return out;
};

// ──────────────────── next.config.{ts,js,…} parsing ───────────────────

const collectNextConfigEnvEntries = (
  filePath: string,
  content: string,
): EnvEntry[] => {
  const out: EnvEntry[] = [];
  const sf = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx?$/.test(filePath) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ((ts.isIdentifier(prop.name) && prop.name.text === 'env') ||
            (ts.isStringLiteral(prop.name) && prop.name.text === 'env')) &&
          ts.isObjectLiteralExpression(prop.initializer)
        ) {
          for (const envProp of prop.initializer.properties) {
            if (!ts.isPropertyAssignment(envProp)) continue;
            let key: string | undefined;
            if (ts.isIdentifier(envProp.name)) key = envProp.name.text;
            else if (ts.isStringLiteral(envProp.name)) key = envProp.name.text;
            if (!key) continue;
            if (!ts.isStringLiteralLike(envProp.initializer)) continue;
            const value = envProp.initializer.text;
            const { line, character } = sf.getLineAndCharacterOfPosition(
              envProp.initializer.getStart(sf),
            );
            out.push({ key, value, line: line + 1, column: character + 1 });
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
};

// ─────────────────────────────── runner ───────────────────────────────

const fingerprint = (file: string, key: string, line: number): string =>
  `${file}|${key}|${line}`;

const run = async (ctx: ProjectContext): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const emit = (
    file: string,
    entry: EnvEntry,
    match: Match,
    sourceLabel: string,
  ): void => {
    const fp = fingerprint(file, entry.key, entry.line);
    if (seen.has(fp)) return;
    seen.add(fp);
    findings.push({
      ruleId: RULE_ID,
      severity: SEVERITY,
      file,
      line: entry.line,
      column: entry.column,
      message: `NEXT_PUBLIC_ env "${entry.key}" holds a value matching ${match.reason} (${sourceLabel})`,
      detail: `${match.detail} Anything assigned to a NEXT_PUBLIC_-prefixed variable is inlined into the JavaScript bundle Next.js ships to every browser visitor - making this value world-readable.`,
      suggestion: `Rotate the secret immediately, then move it to a non-NEXT_PUBLIC_ variable read only from server code (Server Components, Route Handlers, Server Actions, or middleware). If the value really is meant to be public, rename it so it does not match a known secret pattern.`,
    });
  };

  // 1) .env* files at the project root.
  for (const name of ENV_FILES) {
    const fullPath = path.join(ctx.rootDir, name);
    if (!existsSync(fullPath)) continue;
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    const entries = parseEnvFile(content);
    for (const entry of entries) {
      if (!entry.key.startsWith('NEXT_PUBLIC_')) continue;
      const match = classifyValue(entry.value);
      if (!match) continue;
      emit(name, entry, match, name);
    }
  }

  // 2) next.config.{ts,js,mjs,cjs} `env` block at the project root.
  for (const name of NEXT_CONFIG_FILES) {
    const fullPath = path.join(ctx.rootDir, name);
    if (!existsSync(fullPath)) continue;
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    const entries = collectNextConfigEnvEntries(fullPath, content);
    for (const entry of entries) {
      if (!entry.key.startsWith('NEXT_PUBLIC_')) continue;
      const match = classifyValue(entry.value);
      if (!match) continue;
      emit(name, entry, match, `${name} env block`);
    }
  }

  await Promise.resolve();
  return findings;
};

export const rule: Rule = {
  id: RULE_ID,
  description:
    'Detects NEXT_PUBLIC_-prefixed env variables (in .env* files or next.config.{js,ts}) whose values match known secret formats (Stripe, OpenAI, Anthropic, AWS, GitHub) or look like high-entropy secret-shaped strings. The literal value is never printed in findings.',
  severity: SEVERITY,
  run,
};

export default rule;
