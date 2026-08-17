import { defineConfig } from 'vitest/config';

const isWindows = process.platform === 'win32';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    // Full workspace operations perform real filesystem transactions and are
    // intentionally exercised under coverage on all three CI platforms.
    // Windows filesystem transactions and V8 coverage contend heavily when
    // Vitest uses every runner core. Bound concurrency instead of allowing
    // timed-out work to race teardown and create EBUSY/ENOTEMPTY cascades.
    ...(isWindows ? { maxWorkers: 2 } : {}),
    testTimeout: isWindows ? 90_000 : 30_000,
    hookTimeout: isWindows ? 120_000 : 60_000,
    teardownTimeout: isWindows ? 60_000 : 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/index.ts',
        'src/workspace.ts',
        // Workspace Intelligence is a first-class architectural surface. Keep
        // every stage, graph provider, runner, artifact producer, and consumer
        // bridge inside the official coverage gate so newly added stages can
        // never remain invisible to the release metrics.
        'src/workspace-*.ts',
        'src/analyze.ts',
        'src/readiness.ts',
        'src/artifact-remediation-plan.ts',
        'src/doctor.ts',
        'src/create.ts',
        'src/ai/**/*.ts',
        'src/commands/**/*.ts',
        'src/config/**/*.ts',
        'src/contracts/**/*.ts',
        'src/core-bridge/**/*.ts',
        'src/generators/**/*.ts',
        'src/observability/**/*.ts',
        'src/runtime-adapters/**/*.ts',
        'src/utils/**/*.ts',
      ],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'src/__tests__/**',
        // These modules intentionally contain no executable JavaScript. The
        // public compatibility barrel is covered by an export-contract test,
        // while runtime adapter declarations are enforced by TypeScript.
        'src/utils/default-import-workspace.ts',
        'src/runtime-adapters/types.ts',
      ],
      thresholds: {
        lines: 60,
        functions: 75,
        statements: 60,
        branches: 50,
      },
    },
  },
});
