import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(process.cwd(), '..', '..');

function readJson(fileName: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, fileName), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('published monorepo workspace boundary', () => {
  it('tracks independent private packages without coupling the released CLI', () => {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const lockPackages = packageLock.packages as Record<string, unknown>;
    const rootLock = lockPackages[''] as { workspaces?: string[] };

    expect(packageJson.workspaces).toEqual([
      'packages/shared',
      'packages/graph',
      'packages/cli',
      'packages/wspai',
    ]);
    expect(rootLock.workspaces).toEqual(packageJson.workspaces);
    expect(lockPackages).toHaveProperty('packages/graph');
    expect(lockPackages).toHaveProperty('packages/shared');
    expect(lockPackages['node_modules/@workspai/graph']).toEqual({
      resolved: 'packages/graph',
      link: true,
    });
    expect(lockPackages['node_modules/@workspai/shared']).toEqual({
      resolved: 'packages/shared',
      link: true,
    });

    const cliManifest = readJson('packages/cli/package.json') as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const cliRuntimeDependencies = {
      ...(cliManifest.dependencies ?? {}),
      ...(cliManifest.optionalDependencies ?? {}),
      ...(cliManifest.peerDependencies ?? {}),
    };
    expect(cliRuntimeDependencies).not.toHaveProperty('@workspai/shared');
    expect(cliRuntimeDependencies).not.toHaveProperty('@workspai/graph');
    expect(cliManifest.devDependencies).toHaveProperty('@workspai/graph', '0.0.0-development');

    const cliScripts = (cliManifest as { scripts?: Record<string, string> }).scripts;
    const graphManifest = readJson('packages/graph/package.json') as {
      scripts?: Record<string, string>;
    };
    expect(cliScripts?.prebuild).toBe('corepack npm run build:internal-graph-dependencies');
    expect(cliScripts?.['build:internal-graph-dependencies']).toBe(
      'corepack npm --workspace @workspai/shared run build && corepack npm --workspace @workspai/graph run build:bundle-input'
    );
    expect(graphManifest.scripts?.['build:bundle-input']).toBe(
      'corepack npm run generate:check && tsup'
    );

    const bundleConfig = fs.readFileSync(
      path.join(repositoryRoot, 'packages/cli/tsup.config.ts'),
      'utf8'
    );
    expect(bundleConfig).toContain("'internal/graph-package-shadow-bridge':");
    expect(bundleConfig).toContain("'internal/graph-reference-worker-entry':");
    expect(bundleConfig).toContain("noExternal: ['@workspai/graph', '@workspai/shared']");
  });
});
