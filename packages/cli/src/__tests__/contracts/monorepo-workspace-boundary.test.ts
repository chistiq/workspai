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
  it('contains only the released CLI packages', () => {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const lockPackages = packageLock.packages as Record<string, unknown>;
    const rootLock = lockPackages[''] as { workspaces?: string[] };

    expect(packageJson.workspaces).toEqual(['packages/cli', 'packages/wspai']);
    expect(rootLock.workspaces).toEqual(packageJson.workspaces);
    expect(lockPackages).not.toHaveProperty('packages/graph');
    expect(lockPackages).not.toHaveProperty('packages/shared');
    expect(lockPackages).not.toHaveProperty('node_modules/@workspai/graph');
    expect(lockPackages).not.toHaveProperty('node_modules/@workspai/shared');
  });
});
