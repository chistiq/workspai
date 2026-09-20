import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  findOwningWorkspaiProjectRoot,
  getVenvPythonPath,
  resolvePythonLifecycleInterpreter,
} from '../utils/platform-capabilities.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

async function writeFakePython(filePath: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, '#!/usr/bin/env python3\n');
  try {
    await fs.chmod(filePath, 0o755);
  } catch {
    // Windows fixtures only need the path to exist as a file.
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.remove(directory)));
});

describe('python lifecycle interpreter', () => {
  it('prefers the owning Workspai project venv on POSIX', async () => {
    const project = await tempDir('workspai-python-project-venv-');
    const unit = path.join(project, 'agents', 'primary');
    await fs.outputJson(path.join(project, '.workspai', 'project.json'), { name: 'agent' });
    await fs.ensureDir(unit);
    const interpreter = getVenvPythonPath(path.join(project, '.venv'), 'linux');
    await writeFakePython(interpreter);

    const resolved = resolvePythonLifecycleInterpreter({
      unitRoot: unit,
      env: {},
      platform: 'linux',
    });
    expect(findOwningWorkspaiProjectRoot(unit)).toBe(path.resolve(project));
    expect(resolved.source).toBe('project-venv');
    expect(resolved.interpreter).toBe(interpreter);
    expect(resolved.usedForDependencyInstall).toBe(true);
  });

  it('resolves Windows Scripts/python.exe', async () => {
    const project = await tempDir('workspai-python-windows-venv-');
    const unit = path.join(project, 'agents', 'primary');
    await fs.outputJson(path.join(project, '.workspai', 'project.json'), { name: 'agent' });
    await fs.ensureDir(unit);
    const interpreter = getVenvPythonPath(path.join(project, '.venv'), 'win32');
    await writeFakePython(interpreter);

    const resolved = resolvePythonLifecycleInterpreter({
      unitRoot: unit,
      env: {},
      platform: 'win32',
    });
    expect(resolved.source).toBe('project-venv');
    expect(resolved.interpreter).toBe(interpreter);
    expect(path.basename(resolved.interpreter)).toBe('python.exe');
  });

  it('accepts an active venv only when it belongs to the project', async () => {
    const project = await tempDir('workspai-python-active-venv-');
    const unit = path.join(project, 'agents', 'primary');
    await fs.outputJson(path.join(project, '.workspai', 'project.json'), { name: 'agent' });
    await fs.ensureDir(unit);
    const owned = path.join(project, '.venv');
    await writeFakePython(getVenvPythonPath(owned, 'linux'));

    const unrelated = await tempDir('workspai-python-unrelated-venv-');
    await writeFakePython(getVenvPythonPath(unrelated, 'linux'));

    expect(
      resolvePythonLifecycleInterpreter({
        unitRoot: unit,
        env: { VIRTUAL_ENV: owned },
        platform: 'linux',
      }).source
    ).toBe('project-venv');

    const ignored = resolvePythonLifecycleInterpreter({
      unitRoot: unit,
      env: { VIRTUAL_ENV: unrelated },
      platform: 'linux',
    });
    expect(ignored.source).toBe('project-venv');
  });

  it('ignores an unrelated active venv when the project has no venv', async () => {
    const project = await tempDir('workspai-python-unrelated-active-');
    const unit = path.join(project, 'agents', 'primary');
    await fs.outputJson(path.join(project, '.workspai', 'project.json'), { name: 'agent' });
    await fs.ensureDir(unit);
    const unrelated = await tempDir('workspai-python-foreign-venv-');
    await writeFakePython(getVenvPythonPath(unrelated, 'linux'));

    const resolved = resolvePythonLifecycleInterpreter({
      unitRoot: unit,
      env: { VIRTUAL_ENV: unrelated },
      platform: 'linux',
    });
    expect(resolved.source).toBe('system');
    expect(resolved.usedForDependencyInstall).toBe(false);
    expect(resolved.interpreter).toBe('python3');
  });

  it('keeps two projects isolated by their own venvs', async () => {
    const workspace = await tempDir('workspai-python-multi-');
    const first = path.join(workspace, 'alpha with spaces');
    const second = path.join(workspace, 'beta');
    for (const project of [first, second]) {
      await fs.outputJson(path.join(project, '.workspai', 'project.json'), {
        name: path.basename(project),
      });
      await fs.ensureDir(path.join(project, 'agents', 'primary'));
      await writeFakePython(getVenvPythonPath(path.join(project, '.venv'), 'linux'));
    }

    const alpha = resolvePythonLifecycleInterpreter({
      unitRoot: path.join(first, 'agents', 'primary'),
      platform: 'linux',
      env: {},
    });
    const beta = resolvePythonLifecycleInterpreter({
      unitRoot: path.join(second, 'agents', 'primary'),
      platform: 'linux',
      env: {},
    });
    expect(alpha.interpreter).toBe(getVenvPythonPath(path.join(first, '.venv'), 'linux'));
    expect(beta.interpreter).toBe(getVenvPythonPath(path.join(second, '.venv'), 'linux'));
    expect(alpha.interpreter).not.toBe(beta.interpreter);
  });

  it('does not install dependencies through an external WORKSPAI_PYTHON interpreter', async () => {
    const project = await tempDir('workspai-python-configured-');
    const unit = path.join(project, 'agents', 'primary');
    await fs.outputJson(path.join(project, '.workspai', 'project.json'), { name: 'agent' });
    await fs.ensureDir(unit);
    const configured = path.join(project, 'custom', 'python');
    await writeFakePython(configured);

    const resolved = resolvePythonLifecycleInterpreter({
      unitRoot: unit,
      env: { WORKSPAI_PYTHON: configured },
      platform: 'linux',
    });
    expect(resolved.source).toBe('system');
    expect(resolved.interpreter).toBe('python3');
    expect(resolved.usedForDependencyInstall).toBe(false);
  });

  it('uses WORKSPAI_PYTHON when it belongs to the project venv', async () => {
    const project = await tempDir('workspai-python-configured-owned-');
    const unit = path.join(project, 'agents', 'primary');
    await fs.outputJson(path.join(project, '.workspai', 'project.json'), { name: 'agent' });
    await fs.ensureDir(unit);
    const configured = getVenvPythonPath(path.join(project, '.venv'), 'linux');
    await writeFakePython(configured);

    const resolved = resolvePythonLifecycleInterpreter({
      unitRoot: unit,
      env: { WORKSPAI_PYTHON: configured },
      platform: 'linux',
    });
    expect(resolved.source).toBe('configured');
    expect(resolved.interpreter).toBe(configured);
    expect(resolved.usedForDependencyInstall).toBe(true);
  });
});
