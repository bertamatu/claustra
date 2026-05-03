import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ResolvedConfig } from './rules/types.js';

const ConfigSchema = z.object({
  rules: z
    .record(z.enum(['error', 'warn', 'off']))
    .default({
      'a01-server-only-in-client': 'error',
      'a02-rsc-pattern-misuse': 'error',
      'b01-non-serializable-props': 'error',
      'b02-server-data-leakage': 'error',
      'c01-unvalidated-server-actions': 'error',
      'c02-unauthorized-server-actions': 'error',
      'd01-hydration-risks': 'error',
      'd02-caching-dynamic': 'warn',
    }),
  extraServerOnlyModules: z.array(z.string()).default([]),
  ignore: z
    .array(z.string())
    .default([
      '**/*.test.tsx',
      '**/*.test.ts',
      '**/__fixtures__/**',
      '**/node_modules/**',
    ]),
  llm: z
    .object({
      enabled: z.boolean().default(true),
      model: z.string().default('claude-haiku-4-5-20251001'),
    })
    .default({}),
});

export const loadConfig = (
  projectRoot: string,
  configPath?: string,
): ResolvedConfig => {
  const file = configPath ?? path.join(projectRoot, '.claustra.json');
  if (!existsSync(file)) return ConfigSchema.parse({});

  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const result = ConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(
      `Invalid .claustra.json:\n${result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }

  return result.data;
};
