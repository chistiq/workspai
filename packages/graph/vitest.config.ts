import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // The Node adapter is exercised after build by worker:check in a real
      // worker thread. V8 coverage from that isolated process is not merged by
      // Vitest, so it is governed by the dedicated runtime gate instead.
      exclude: ['src/**/*.d.ts', 'src/adapters/node/**/*.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
});
