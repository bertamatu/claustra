import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      // Excluded: cli.ts (covered via integration test), judges.ts (needs mocked Anthropic),
      // types.ts (no runtime), rules/index.ts (empty registry placeholder).
      exclude: [
        'src/cli.ts',
        'src/llm/judges.ts',
        'src/rules/types.ts',
        'src/rules/index.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});
