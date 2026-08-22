import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fsExtra from 'fs-extra';
import os from 'os';
import path from 'path';

import { installWorkspaceDependencies } from '../index.js';
import { readProjectMetadata } from '../utils/project-metadata.js';

describe('workspace Python engine install gate', () => {
  let workspacePath: string;
  const itOnPosix = process.platform === 'win32' ? it.skip : it;

  beforeEach(async () => {
    workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-engine-gate-'));
    await fsExtra.ensureDir(path.join(workspacePath, '.workspai'));
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'workspace.json'),
      {
        schema_version: '1.0',
        workspace_name: 'demo',
        profile: 'polyglot',
        bootstrap_note: 'python-engine-skipped',
        engine: {
          install_method: 'venv',
          python_version: null,
          python_core: {
            status: 'skipped',
            reason: 'user-opted-out',
          },
        },
      },
      { spaces: 2 }
    );
  });

  afterEach(async () => {
    await fsExtra.remove(workspacePath);
  });

  it('does not install the local Python engine for an empty skipped workspace', async () => {
    await expect(installWorkspaceDependencies(workspacePath)).resolves.toBe(0);

    expect(await fsExtra.pathExists(path.join(workspacePath, '.venv'))).toBe(false);
  });

  it('does not install the local Python engine for an arbitrary adopted FastAPI project', async () => {
    const projectPath = path.join(workspacePath, 'custom-api');
    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.outputJson(
      path.join(projectPath, '.workspai', 'project.json'),
      {
        name: 'custom-api',
        runtime: 'python',
        framework: 'fastapi',
        kit_name: 'adopted.fastapi',
        module_support: false,
      },
      { spaces: 2 }
    );

    await expect(installWorkspaceDependencies(workspacePath)).resolves.toBe(0);

    expect(await fsExtra.pathExists(path.join(workspacePath, '.venv'))).toBe(false);
  });

  it('does not install the local Python engine for custom projects that only set module_support true', async () => {
    const projectPath = path.join(workspacePath, 'custom-api');
    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.outputJson(
      path.join(projectPath, '.workspai', 'project.json'),
      {
        name: 'custom-api',
        runtime: 'python',
        framework: 'fastapi',
        module_support: true,
      },
      { spaces: 2 }
    );

    await expect(installWorkspaceDependencies(workspacePath)).resolves.toBe(0);

    expect(await fsExtra.pathExists(path.join(workspacePath, '.venv'))).toBe(false);
    expect(readProjectMetadata(projectPath)?.moduleSupport).toBe(false);
  });

  it('keeps module support tied to RapidKit module-enabled kit metadata', async () => {
    const customProjectPath = path.join(workspacePath, 'custom-api');
    await fsExtra.ensureDir(path.join(customProjectPath, '.workspai'));
    await fsExtra.outputJson(path.join(customProjectPath, '.workspai', 'project.json'), {
      runtime: 'python',
      framework: 'fastapi',
      kit_name: 'adopted.fastapi',
    });

    const kitProjectPath = path.join(workspacePath, 'kit-api');
    await fsExtra.ensureDir(path.join(kitProjectPath, '.workspai'));
    await fsExtra.outputJson(path.join(kitProjectPath, '.workspai', 'project.json'), {
      runtime: 'python',
      framework: 'fastapi',
      kit_name: 'fastapi.standard',
    });

    expect(readProjectMetadata(customProjectPath)?.moduleSupport).toBe(false);
    expect(readProjectMetadata(kitProjectPath)?.moduleSupport).toBe(true);
  });

  it('recognizes all RapidKit module-enabled kit metadata', async () => {
    for (const kitName of ['fastapi.standard', 'fastapi.ddd', 'nestjs.standard']) {
      const kitProjectPath = path.join(workspacePath, kitName.replace('.', '-'));
      await fsExtra.ensureDir(path.join(kitProjectPath, '.workspai'));
      await fsExtra.outputJson(path.join(kitProjectPath, '.workspai', 'project.json'), {
        runtime: kitName.startsWith('nestjs') ? 'node' : 'python',
        framework: kitName.startsWith('nestjs') ? 'nestjs' : 'fastapi',
        kit_name: kitName,
      });

      expect(readProjectMetadata(kitProjectPath)?.moduleSupport).toBe(true);
    }
  });

  it('never installs the workspace Python engine for a node-only NestJS workspace', async () => {
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'workspace.json'),
      {
        schema_version: '1.0',
        workspace_name: 'node-demo',
        profile: 'node-only',
        bootstrap_note: 'python-engine-skipped',
        engine: { python_core: { status: 'skipped' } },
      },
      { spaces: 2 }
    );
    const projectPath = path.join(workspacePath, 'api');
    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.outputJson(path.join(projectPath, '.workspai', 'project.json'), {
      runtime: 'node',
      framework: 'nestjs',
      kit_name: 'nestjs.standard',
      module_support: true,
    });

    await expect(installWorkspaceDependencies(workspacePath)).resolves.toBe(0);
    await expect(fsExtra.pathExists(path.join(workspacePath, '.venv'))).resolves.toBe(false);
  });

  itOnPosix(
    'installs skipped venv workspaces with pip even when no pyproject stub exists',
    async () => {
      const originalDevPath = process.env.RAPIDKIT_DEV_PATH;
      const originalSuppressOutput = process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT;
      const originalTimeout = process.env.RAPIDKIT_WORKSPACE_DEPS_TIMEOUT_MS;
      const fakePythonPath = path.join(workspacePath, '.venv', 'bin', 'python');
      const fakePipLogPath = path.join(workspacePath, 'pip-commands.log');
      const moduleProjectPath = path.join(workspacePath, 'kit-api');

      await fsExtra.outputJson(
        path.join(workspacePath, '.workspai-workspace'),
        {
          signature: 'RAPIDKIT_WORKSPACE',
          createdBy: 'rapidkit-npm',
          version: '0.42.0',
          createdAt: '2026-07-06T00:00:00.000Z',
          name: 'demo',
          metadata: {
            npm: {
              packageVersion: '0.42.0',
              installMethod: 'venv',
            },
            python: {
              coreStatus: 'skipped',
              coreReason: 'user-opted-out',
            },
          },
        },
        { spaces: 2 }
      );
      await fsExtra.ensureDir(path.join(moduleProjectPath, '.workspai'));
      await fsExtra.outputJson(path.join(moduleProjectPath, '.workspai', 'project.json'), {
        runtime: 'python',
        framework: 'fastapi',
        kit_name: 'fastapi.standard',
      });
      await fsExtra.outputFile(
        fakePythonPath,
        `#!/usr/bin/env node\n` +
          `const fs = require('fs');\n` +
          `const path = require('path');\n` +
          `fs.appendFileSync(path.join(process.cwd(), 'pip-commands.log'), process.argv.slice(2).join(' ') + '\\n');\n`,
        { encoding: 'utf-8', mode: 0o755 }
      );

      try {
        process.env.RAPIDKIT_DEV_PATH = workspacePath;
        process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT = '1';
        process.env.RAPIDKIT_WORKSPACE_DEPS_TIMEOUT_MS = '5000';

        await expect(installWorkspaceDependencies(workspacePath)).resolves.toBe(0);
      } finally {
        if (typeof originalDevPath === 'undefined') delete process.env.RAPIDKIT_DEV_PATH;
        else process.env.RAPIDKIT_DEV_PATH = originalDevPath;
        if (typeof originalSuppressOutput === 'undefined') {
          delete process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT;
        } else {
          process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT = originalSuppressOutput;
        }
        if (typeof originalTimeout === 'undefined')
          delete process.env.RAPIDKIT_WORKSPACE_DEPS_TIMEOUT_MS;
        else process.env.RAPIDKIT_WORKSPACE_DEPS_TIMEOUT_MS = originalTimeout;
      }

      await expect(fsExtra.pathExists(path.join(workspacePath, 'pyproject.toml'))).resolves.toBe(
        false
      );
      await expect(fsExtra.readFile(fakePipLogPath, 'utf-8')).resolves.toContain(
        `-m pip install ${workspacePath} --quiet --disable-pip-version-check`
      );

      const manifest = await fsExtra.readJson(
        path.join(workspacePath, '.workspai', 'workspace.json')
      );
      expect(manifest.bootstrap_note).toBeUndefined();
      expect(manifest.engine.python_core.status).toBe('installed');
      const marker = await fsExtra.readJson(path.join(workspacePath, '.workspai-workspace'));
      expect(marker.metadata.python.coreStatus).toBe('installed');
      expect(marker.metadata.python.venvPath).toBe('.venv');
    }
  );
});
