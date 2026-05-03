import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  // Keep runtime deps external — they're in `dependencies` and installed alongside the binary.
  // Only our own source is bundled.
  external: ['commander', 'picocolors', 'typescript', 'zod', '@anthropic-ai/sdk'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
