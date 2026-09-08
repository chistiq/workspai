import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { missingShellActivationDiagnostic } from '../utils/shell-activation-diagnostics.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('shell activation diagnostics', () => {
  it('distinguishes an adopted non-Python project from a missing project', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-shell-project-'));
    roots.push(root);
    const nested = path.join(root, 'src', 'feature');
    await fsExtra.ensureDir(nested);
    await fsExtra.outputJson(path.join(root, '.workspai', 'project.json'), {
      name: 'web-app',
      runtime: 'node',
    });

    expect(missingShellActivationDiagnostic(nested)).toContain('Workspai project found at');
    expect(missingShellActivationDiagnostic(nested)).toContain('no Python virtual environment');
  });

  it('reports missing metadata when no project boundary exists', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-shell-empty-'));
    roots.push(root);
    expect(missingShellActivationDiagnostic(root)).toContain('No Workspai project metadata');
  });
});
