import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'extensions/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: false,
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
  },
  resolve: {
    // Prefer .ts sources over pre-compiled .js files so tests run against
    // the TypeScript source (which may differ from stale compiled output).
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: {
      '@nexus/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@nexus/agent': path.resolve(__dirname, 'packages/agent/src/index.ts'),
      '@nexus/telegram': path.resolve(__dirname, 'extensions/telegram/src/index.ts'),
      '@nexus/discord': path.resolve(__dirname, 'extensions/discord/src/index.ts'),
    },
  },
});
