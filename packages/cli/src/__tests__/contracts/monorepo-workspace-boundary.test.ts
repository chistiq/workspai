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
  });
});
