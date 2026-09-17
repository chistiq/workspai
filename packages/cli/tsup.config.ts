import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'internal/graph-package-shadow-bridge': 'src/graph-package-shadow-bridge.ts',
    'internal/graph-reference-worker-entry': '../graph/src/adapters/node/reference-worker-entry.ts',
  },
  format: ['esm'],
  target: 'node20',

  // Output settings
  outDir: 'dist',
  clean: true,

  // Minification and optimization
  minify: true,
  treeshake: {
    preset: 'smallest', // Aggressive tree shaking
    moduleSideEffects: false, // Assume no side effects
  },

  // Source maps only in development
  sourcemap: false,

  // Bundle settings
  splitting: true, // Enable code splitting for better caching
  bundle: true,

  // Keep shebang for CLI
  shims: true,

  // External dependencies (don't bundle them)
  // Heavy dependencies should stay external
  external: [
    'chalk',
    'commander',
    'execa',
    'fs-extra',
    'inquirer',
    'nunjucks',
    'openai',
    'ora',
    'cli-progress',
    'validate-npm-package-name',
  ],

  // TypeScript declaration files
  dts: {
    entry: {
      index: 'src/index.ts',
      'internal/graph-package-shadow-bridge': 'src/graph-package-shadow-bridge.ts',
    },
  },

  // Skip node_modules
  skipNodeModulesBundle: true,

  // Internal domain packages ship inside the public CLI artifact. End users
  // never resolve unpublished workspace dependencies.
  noExternal: ['@workspai/graph', '@workspai/shared'],

  // dist/package.json is redundant: npm packages already include root package.json.
  // Skipping the copy keeps the dist footprint under CI metrics threshold.
});
