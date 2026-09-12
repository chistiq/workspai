import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'contracts/index': 'src/contracts/index.ts',
    'compatibility/index': 'src/compatibility/index.ts',
    'validation/index': 'src/validation/index.ts',
    'registry/index': 'src/registry/index.ts',
    browser: 'src/browser.ts',
    node: 'src/node.ts',
    'cli/index': 'cli/index.ts',
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
});
