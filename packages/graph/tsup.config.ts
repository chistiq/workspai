import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'contracts/index': 'src/contracts/index.ts',
    'providers/index': 'src/providers/index.ts',
    'conformance/index': 'src/conformance/index.ts',
    'testing/index': 'src/testing/index.ts',
    'adapters/node/index': 'src/adapters/node/index.ts',
    'adapters/node/reference-worker-entry': 'src/adapters/node/reference-worker-entry.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'neutral',
  outDir: 'dist',
  clean: true,
  bundle: true,
  splitting: true,
  sourcemap: true,
  dts: true,
  treeshake: true,
  skipNodeModulesBundle: true,
  external: ['@workspai/shared'],
});
