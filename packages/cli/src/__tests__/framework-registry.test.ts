import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateCommand } from '../framework-registry.js';

describe('framework command preflight', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => fs.remove(directory)));
  });

  it('resolves executable project-local wrappers against their execution directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-command-preflight-'));
    tempDirs.push(root);
    const wrapper = path.join(root, 'gradlew');
    await fs.outputFile(wrapper, '#!/bin/sh\nexit 0\n');
    await fs.chmod(wrapper, 0o755);

    await expect(validateCommand('./gradlew', root)).resolves.toEqual({ valid: true });
  });

  it('fails closed when a project-local wrapper is absent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-command-preflight-'));
    tempDirs.push(root);

    const result = await validateCommand('./gradlew', root);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain(root);
  });
});
