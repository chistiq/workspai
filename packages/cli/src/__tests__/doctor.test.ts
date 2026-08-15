import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import fs from 'fs';
import fsExtra from 'fs-extra';
import os from 'os';
import path from 'path';

// Mock modules
vi.mock('execa');
const promptMock = vi.hoisted(() => vi.fn());
vi.mock('inquirer', () => ({
  default: {
    prompt: promptMock,
  },
}));
const mockedExeca = vi.mocked(execa as any);

function realpathForAssertion(value: string): string {
  return fs.realpathSync.native(value);
}

function expectSameFilesystemEntry(actualPath: string, expectedPath: string): void {
  const actualStat = fs.statSync(actualPath);
  const expectedStat = fs.statSync(expectedPath);
  expect({ dev: actualStat.dev, ino: actualStat.ino, directory: actualStat.isDirectory() }).toEqual(
    {
      dev: expectedStat.dev,
      ino: expectedStat.ino,
      directory: expectedStat.isDirectory(),
    }
  );
}

describe('Doctor Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should pass basic import test', async () => {
    // Basic test to get coverage started
    const { runDoctor } = await import('../doctor.js');
    expect(runDoctor).toBeDefined();
    expect(typeof runDoctor).toBe('function');
  }, 15_000);

  it('should fail doctor apply exit code when a fix execution fails', async () => {
    const { computeDoctorFixAwareExitCode } = await import('../doctor.js');

    expect(
      computeDoctorFixAwareExitCode(
        { errors: 0, warnings: 0 },
        { profile: 'local' },
        {
          schemaVersion: 'rapidkit-doctor-fix-result-v1',
          generatedAt: new Date().toISOString(),
          appliedFixes: [
            {
              path: '/workspace/api',
              action: 'dependency-sync',
              outcome: 'failed',
              projectName: 'api',
              command: 'poetry install --no-root',
            },
          ],
          remainingBlockers: ['api: Dependencies not installed'],
          verifyRecommended: 'npx workspai workspace verify --json',
        }
      )
    ).toBe(1);
  });

  it('should handle doctor command with mocked successful checks', async () => {
    // Mock successful command executions
    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return {
            stdout: 'Python 3.11.0',
            stderr: '',
            exitCode: 0,
          } as any;
        }
        if (args?.[0] === '-c') {
          return {
            stdout: '3.11.0',
            stderr: '',
            exitCode: 0,
          } as any;
        }
      }
      if (cmd === 'pip' || cmd === 'pip3') {
        return {
          stdout: 'pip 24.0',
          stderr: '',
          exitCode: 0,
        } as any;
      }
      if (cmd === 'pipx') {
        if (args?.[0] === '--version') {
          return {
            stdout: '1.4.0',
            stderr: '',
            exitCode: 0,
          } as any;
        }
        if (args?.[0] === 'list') {
          return {
            stdout: 'rapidkit-core 0.2.3',
            stderr: '',
            exitCode: 0,
          } as any;
        }
      }
      if (cmd === 'poetry') {
        return {
          stdout: 'Poetry version 1.7.0',
          stderr: '',
          exitCode: 0,
        } as any;
      }
      if (cmd === 'rapidkit') {
        return {
          stdout: '0.2.3',
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { runDoctor } = await import('../doctor.js');

      await expect(runDoctor({ json: true })).resolves.toBe(0);
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.scope).toBe('system');
      expect(payload.status).toBe('ok');
      expect(payload.system.python.status).toBe('ok');
      expect(payload.nextActions).toContain('npx workspai doctor workspace --json');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('should handle doctor command with some failed checks', async () => {
    // Mock some failed checks
    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return {
            stdout: 'Python 3.11.0',
            stderr: '',
            exitCode: 0,
          } as any;
        }
        if (args?.[0] === '-c') {
          return {
            stdout: '3.11.0',
            stderr: '',
            exitCode: 0,
          } as any;
        }
      }
      if (cmd === 'pip' || cmd === 'pip3') {
        throw new Error('pip not found');
      }
      if (cmd === 'pipx') {
        throw new Error('pipx not found');
      }
      if (cmd === 'poetry') {
        throw new Error('poetry not found');
      }
      if (cmd === 'rapidkit') {
        throw new Error('rapidkit not found');
      }
      throw new Error('Command not found');
    });

    const { runDoctor } = await import('../doctor.js');

    // Should not throw even with failed checks
    await expect(runDoctor({ json: true })).resolves.not.toThrow();
  });

  it('should handle doctor command with all failed checks', async () => {
    // Mock all checks failing
    mockedExeca.mockImplementation(async () => {
      throw new Error('Command not found');
    });

    const { runDoctor } = await import('../doctor.js');

    // Should not throw even with all failed checks
    await expect(runDoctor({ json: true })).resolves.not.toThrow();
  });

  it('should handle doctor with verbose output', async () => {
    mockedExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'python3' || cmd === 'python') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const { runDoctor } = await import('../doctor.js');
    await expect(runDoctor({ json: false })).resolves.not.toThrow();
  });

  it('should handle doctor with fix option', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-fix-'));
    const originalCwd = process.cwd();

    mockedExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'python3' || cmd === 'python') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    try {
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await expect(runDoctor({ json: false, fix: true })).resolves.not.toThrow();
    } finally {
      process.chdir(originalCwd);
      await fsExtra.remove(tempRoot);
    }
  });

  it('should handle different python versions', async () => {
    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '-c') {
          return { stdout: '3.9.0', stderr: '', exitCode: 0 } as any;
        }
        return { stdout: 'Python 3.9.0', stderr: '', exitCode: 0 } as any;
      }
      throw new Error('Command not found');
    });

    const { runDoctor } = await import('../doctor.js');
    await expect(runDoctor({ json: true })).resolves.not.toThrow();
  });

  it('should handle old python version warnings', async () => {
    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '-c') {
          return { stdout: '3.8.0', stderr: '', exitCode: 0 } as any;
        }
        return { stdout: 'Python 3.8.0', stderr: '', exitCode: 0 } as any;
      }
      throw new Error('Command not found');
    });

    const { runDoctor } = await import('../doctor.js');
    await expect(runDoctor({ json: true })).resolves.not.toThrow();
  });

  it('should check pip installation', async () => {
    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pip' || cmd === 'pip3') {
        if (args?.[0] === '--version') {
          return { stdout: 'pip 24.0 from /usr/lib/python3.11', stderr: '', exitCode: 0 } as any;
        }
      }
      throw new Error('Command not found');
    });

    const { runDoctor } = await import('../doctor.js');
    await expect(runDoctor({ json: true })).resolves.not.toThrow();
  });

  it('should handle workspace checks', async () => {
    mockedExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'python3' || cmd === 'python') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pip' || cmd === 'pip3') {
        return { stdout: 'pip 24.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 1.7.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx') {
        return { stdout: '1.4.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: '0.2.3', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const { runDoctor } = await import('../doctor.js');
    await expect(runDoctor({ json: false })).resolves.not.toThrow();
  });

  it('should handle error states gracefully', async () => {
    mockedExeca.mockRejectedValue(new Error('ENOENT: command not found') as never);

    const { runDoctor } = await import('../doctor.js');
    await expect(runDoctor({ json: true })).resolves.not.toThrow();
  });

  it('should detect rapidkit core via pipx', async () => {
    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === 'list') {
        return {
          stdout: '  package rapidkit-core 0.2.3, installed using Python 3.11.0\n    - rapidkit',
          stderr: '',
          exitCode: 0,
        } as any;
      }
      if (cmd === 'rapidkit' && args?.[0] === '--version') {
        return { stdout: '0.2.3', stderr: '', exitCode: 0 } as any;
      }
      throw new Error('Command not found');
    });

    const { runDoctor } = await import('../doctor.js');
    await expect(runDoctor({ json: true })).resolves.not.toThrow();
  });

  it('should report workspace .venv as optional advisory when only global RapidKit Core is installed', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-global-only-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const tempHome = path.join(tempRoot, 'home');
    const globalRapidkitPath = path.join(tempHome, '.local', 'bin', 'rapidkit');

    await fsExtra.ensureDir(path.join(workspacePath, '.workspai', 'reports'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });
    await fsExtra.ensureDir(path.dirname(globalRapidkitPath));
    await fsExtra.writeFile(globalRapidkitPath, '#!/usr/bin/env bash\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-c') {
          return { stdout: '3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === globalRapidkitPath && args?.[0] === '--version') {
        return { stdout: 'RapidKit Version: 0.4.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === globalRapidkitPath && args?.[0] === 'list') {
        return { stdout: '{"kits":[]}', stderr: '', exitCode: 0 } as any;
      }
      throw new Error('Command not found');
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;

    try {
      process.env.HOME = tempHome;
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.system.rapidkitCore.status).toBe('ok');
      expect(payload.system.rapidkitCore.paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: globalRapidkitPath,
            version: '0.4.0',
          }),
        ])
      );
      expect(
        (payload.system.rapidkitCore.paths as Array<{ location: string }>).some((p) =>
          p.location.startsWith('Global (')
        )
      ).toBe(true);
      expect(payload.system.rapidkitCore.paths).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ location: 'Workspace (.venv)' })])
      );
      expect(payload.system.rapidkitCore.details).toContain('Workspace (.venv): not installed');
      expect(payload.system.rapidkitCore.details).toContain('optional');
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('reports a version-visible Core installation as unusable when a real catalog command fails', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-core-probe-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const tempHome = path.join(tempRoot, 'home');
    const rapidkitPath = path.join(tempHome, '.local', 'bin', 'rapidkit');

    await fsExtra.outputJSON(path.join(workspacePath, '.workspai-workspace'), {
      signature: 'RAPIDKIT_WORKSPACE',
      name: 'workspace',
      version: '1.0.0',
    });
    await fsExtra.outputFile(rapidkitPath, '#!/usr/bin/env python3\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if ((cmd === 'python3' || cmd === 'python') && args?.[0] === '--version') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === rapidkitPath && args?.[0] === '--version') {
        return { stdout: 'RapidKit Version: 0.6.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === rapidkitPath && args?.[0] === 'list') {
        return {
          stdout: '',
          stderr: "Failed to import main CLI: No module named 'typing_extensions'",
          exitCode: 1,
        } as any;
      }
      throw new Error('Command not found');
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    try {
      process.env.HOME = tempHome;
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      const payload = JSON.parse(jsonLine);
      expect(payload.system.rapidkitCore).toMatchObject({
        status: 'error',
        message: 'RapidKit Core 0.6.0 installed but unusable',
      });
      expect(payload.system.rapidkitCore.details).toContain('typing_extensions');
      expect(payload.system.rapidkitCore.paths).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: rapidkitPath, version: '0.6.0' })])
      );
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('resolves workspace RapidKit Core from a nested project instead of process cwd', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-project-venv-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'api');
    const tempHome = path.join(tempRoot, 'home');
    const workspaceRapidkitPath = path.join(
      workspacePath,
      '.venv',
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'rapidkit.exe' : 'rapidkit'
    );

    await fsExtra.ensureDir(path.dirname(workspaceRapidkitPath));
    await fsExtra.writeFile(workspaceRapidkitPath, 'workspace rapidkit launcher\n');
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });
    await fsExtra.outputJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'api',
      kit_name: 'nestjs.standard',
      runtime: 'node',
    });
    await fsExtra.outputJSON(path.join(projectPath, 'package.json'), {
      name: 'api',
      scripts: { test: 'node --test', build: 'tsc' },
    });

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if ((cmd === 'python3' || cmd === 'python') && args?.[0] === '--version') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (
        typeof cmd === 'string' &&
        fs.existsSync(cmd) &&
        realpathForAssertion(cmd) === realpathForAssertion(workspaceRapidkitPath) &&
        args?.[0] === '--version'
      ) {
        return { stdout: 'RapidKit Version: 0.6.0', stderr: '', exitCode: 0 } as any;
      }
      if (
        typeof cmd === 'string' &&
        fs.existsSync(cmd) &&
        realpathForAssertion(cmd) === realpathForAssertion(workspaceRapidkitPath) &&
        args?.[0] === 'list'
      ) {
        return { stdout: '{"kits":[]}', stderr: '', exitCode: 0 } as any;
      }
      throw new Error('Command not found');
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;

    try {
      process.env.HOME = tempHome;
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      const payload = JSON.parse(jsonLine as string);

      expect(payload.system.rapidkitCore.message).toContain('0.6.0');
      const workspaceInstallation = (
        payload.system.rapidkitCore.paths as Array<{
          location: string;
          path: string;
          version: string;
        }>
      ).find((entry) => entry.location === 'Workspace (.venv)');
      expect(workspaceInstallation).toEqual(
        expect.objectContaining({
          location: 'Workspace (.venv)',
          version: '0.6.0',
        })
      );

      // Windows can report the same file using a long path (RunnerAdmin) or
      // its 8.3 alias (RUNNER~1). Compare filesystem identity, not spelling.
      const [reportedStat, expectedStat] = await Promise.all([
        fs.promises.stat(workspaceInstallation?.path as string, { bigint: true }),
        fs.promises.stat(workspaceRapidkitPath, { bigint: true }),
      ]);
      expect({ dev: reportedStat.dev, ino: reportedStat.ino }).toEqual({
        dev: expectedStat.dev,
        ino: expectedStat.ino,
      });
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should run workspace doctor from an explicit workspace path outside cwd', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-explicit-workspace-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const outsidePath = path.join(tempRoot, 'outside');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.ensureDir(outsidePath);
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      signature: 'RAPIDKIT_WORKSPACE',
      name: 'legacy-workspace-name',
      version: '1.0.0',
    });
    await fsExtra.writeJSON(path.join(workspacePath, '.workspai-workspace'), {
      signature: 'RAPIDKIT_WORKSPACE',
      createdBy: 'workspai-cli',
      name: 'canonical-workspace-name',
      version: '1.0.0',
      createdAt: '2026-07-17T00:00:00.000Z',
    });
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      name: 'workspace',
      version: 1,
    });

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (args?.[0] === '--version') {
        return { stdout: `${cmd} 1.0.0`, stderr: '', exitCode: 0 } as any;
      }
      if (args?.[0] === '-c') {
        return { stdout: '0.5.4', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(outsidePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: workspacePath, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(fsExtra.realpathSync(payload.workspace.path)).toBe(
        fsExtra.realpathSync(workspacePath)
      );
      expect(payload.cache.evidencePath).toBe(
        path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json')
      );
      expect(payload.cache.receiptPath).toBe(
        path.join(workspacePath, '.workspai', 'reports', 'doctor-receipt-last-run.json')
      );
      expect(payload.summary.counts).toMatchObject({
        projectsScanned: 0,
        affectedProjects: 0,
        blockingCauses: 0,
        dependencyAdvisorySubjects: 0,
        dependencyVulnerabilityFindings: 0,
      });
      expect(payload.workspace.name).toBe('canonical-workspace-name');
      expect(await fsExtra.pathExists(payload.cache.evidencePath)).toBe(true);
      const receipt = await fsExtra.readJSON(payload.cache.receiptPath);
      expect(receipt).toMatchObject({
        schemaVersion: 'workspai.doctor-receipt.v1',
        scope: { kind: 'workspace', name: 'canonical-workspace-name' },
        counts: { projectsScanned: 0 },
      });

      logSpy.mockClear();
      await runDoctor({ workspace: workspacePath, json: 'summary', fresh: true });
      const summaryLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      expect(JSON.parse(summaryLine)).toMatchObject({
        schemaVersion: 'workspai.doctor-summary.v1',
        scope: 'workspace',
        workspace: { name: 'canonical-workspace-name' },
        counts: { projectsScanned: 0, blockingCauses: 0 },
        freshness: { status: 'fresh' },
        artifacts: {
          evidence: payload.cache.evidencePath,
          receipt: payload.cache.receiptPath,
        },
      });
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should handle normal output format', async () => {
    mockedExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'python3') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pip3') {
        return { stdout: 'pip 24.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 1.7.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx') {
        return { stdout: '1.4.0', stderr: '', exitCode: 0 } as any;
      }
      throw new Error('not found');
    });

    const { runDoctor } = await import('../doctor.js');
    await expect(runDoctor({ json: false })).resolves.not.toThrow();
  });

  it('should not count workspace root .rapidkit as a project', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const apiPath = path.join(workspacePath, 'saas-api');
    const adminPath = path.join(workspacePath, 'saas-admin');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit', 'users_core.db'), '');
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(apiPath, '.rapidkit'));
    await fsExtra.ensureDir(path.join(adminPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(apiPath, '.rapidkit', 'project.json'), {
      name: 'saas-api',
      framework: 'fastapi',
    });
    await fsExtra.writeJSON(path.join(adminPath, '.rapidkit', 'project.json'), {
      name: 'saas-admin',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(apiPath, 'pyproject.toml'),
      '[tool.poetry]\nname = "saas-api"\n'
    );
    await fsExtra.writeFile(
      path.join(adminPath, 'pyproject.toml'),
      '[tool.poetry]\nname = "saas-admin"\n'
    );
    await fsExtra.ensureDir(path.join(apiPath, '.venv'));
    await fsExtra.ensureDir(path.join(adminPath, '.venv'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.8', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx') {
        if (args?.[0] === '--version') {
          return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.8', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    promptMock.mockImplementation(async () => ({ confirm: true }));
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true, fix: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.summary.totalProjects).toBe(2);
      expect(payload.projects.map((p: { name: string }) => p.name).sort()).toEqual([
        'saas-admin',
        'saas-api',
      ]);
    } finally {
      process.chdir(originalCwd);
      promptMock.mockReset();
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should not treat an empty workspace shell as a project because of root toolchain files', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-empty-workspace-shell-')
    );
    const workspacePath = path.join(tempRoot, 'enterprise-workspace');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      signature: 'RAPIDKIT_WORKSPACE',
      name: 'enterprise-workspace',
      version: '1.0.0',
    });
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      name: 'enterprise-workspace',
      profile: 'enterprise',
      version: 1,
    });
    await fsExtra.writeFile(
      path.join(workspacePath, 'pyproject.toml'),
      '[tool.poetry]\nname = "enterprise-workspace"\nversion = "0.1.0"\n'
    );
    await fsExtra.writeFile(
      path.join(workspacePath, 'poetry.toml'),
      '[virtualenvs]\nin-project = true\n'
    );

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (args?.[0] === '--version') {
        return { stdout: `${cmd} 1.0.0`, stderr: '', exitCode: 0 } as any;
      }
      if (args?.[0] === '-c') {
        return { stdout: '0.5.4', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(fsExtra.realpathSync(payload.workspace.path)).toBe(
        fsExtra.realpathSync(workspacePath)
      );
      expect(payload.summary.totalProjects).toBe(0);
      expect(payload.projects).toEqual([]);
      expect(payload.scoreBreakdown).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'workspace:projects-discovered',
            status: 'warn',
            reason: 'No projects discovered for workspace analysis.',
          }),
        ])
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('keeps runtime-neutral workspaces usable when optional Python tooling is absent', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-doctor-runtime-neutral-')
    );
    await fsExtra.writeJSON(path.join(tempRoot, '.workspai-workspace'), {
      signature: 'WORKSPAI_WORKSPACE',
      name: 'runtime-neutral',
      version: '1.0.0',
    });
    await fsExtra.ensureDir(path.join(tempRoot, '.workspai'));
    await fsExtra.writeJSON(path.join(tempRoot, '.workspai', 'workspace.json'), {
      name: 'runtime-neutral',
      profile: 'minimal',
      projects: [],
    });

    mockedExeca.mockRejectedValue(new Error('tool not found'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;

    try {
      process.env.HOME = path.join(tempRoot, 'home');
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await expect(runDoctor({ workspace: true, json: true })).resolves.toBe(0);

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      const payload = JSON.parse(jsonLine);
      expect(payload.summary).toMatchObject({
        totalProjects: 0,
        hasSystemErrors: false,
      });
      expect(payload.system.python).toMatchObject({ status: 'warn' });
      expect(payload.system.python.details).toContain('no detected Python project');
      expect(payload.system.rapidkitCore).toMatchObject({ status: 'warn' });
      expect(payload.system.rapidkitCore.details).toContain('optional engine');
      expect(payload.healthScore).toMatchObject({ errors: 0, verdict: 'passed' });
      expect(payload.healthScore.presentation).toMatchObject({
        diagnosticPassRatePercent: null,
        notApplicableChecks: 5,
      });
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should detect workspace root with .rapidkit-workspace marker only', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-marker-only-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const apiPath = path.join(workspacePath, 'saas-api');

    await fsExtra.ensureDir(workspacePath);
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(apiPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(apiPath, '.rapidkit', 'project.json'), {
      name: 'saas-api',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(apiPath, 'pyproject.toml'),
      '[tool.poetry]\nname = "saas-api"\n'
    );
    await fsExtra.ensureDir(path.join(apiPath, '.venv'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.4.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx') {
        if (args?.[0] === '--version') {
          return { stdout: '1.11.1', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.4.0', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(fsExtra.realpathSync(payload.workspace.path)).toBe(
        fsExtra.realpathSync(workspacePath)
      );
      expect(payload.summary.totalProjects).toBe(1);
      expect(payload.projects[0].name).toBe('saas-api');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should ignore dist artifact directories during workspace scan', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-dist-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const apiPath = path.join(workspacePath, 'saas-api');
    const distApiPath = path.join(workspacePath, 'dist-customer-release', 'saas-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(apiPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(apiPath, '.rapidkit', 'project.json'), {
      name: 'saas-api',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(apiPath, 'pyproject.toml'),
      '[tool.poetry]\nname = "saas-api"\n'
    );
    await fsExtra.ensureDir(path.join(apiPath, '.venv'));

    await fsExtra.ensureDir(path.join(distApiPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(distApiPath, '.rapidkit', 'project.json'), {
      name: 'saas-api-dist',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(distApiPath, 'pyproject.toml'),
      '[tool.poetry]\nname = "saas-api-dist"\n'
    );

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.8', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx') {
        if (args?.[0] === '--version') {
          return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.8', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.summary.totalProjects).toBe(1);
      expect(payload.projects.map((p: { name: string }) => p.name)).toEqual(['saas-api']);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should discover child project surfaces without treating workspace root package.json as a project', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-workspace-surfaces-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const apiPath = path.join(workspacePath, 'services', 'api');
    const webPath = path.join(workspacePath, 'apps', 'web');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });
    await fsExtra.writeJSON(path.join(workspacePath, 'package.json'), {
      name: 'workspace-root',
      private: true,
      workspaces: ['apps/*', 'services/*'],
    });

    await fsExtra.ensureDir(path.join(apiPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(apiPath, '.rapidkit', 'project.json'), {
      name: 'api',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(path.join(apiPath, 'pyproject.toml'), '[tool.poetry]\nname = "api"\n');
    await fsExtra.ensureDir(path.join(apiPath, '.venv'));

    await fsExtra.ensureDir(path.join(webPath, 'app'));
    await fsExtra.writeJSON(path.join(webPath, 'package.json'), {
      name: 'web',
      version: '1.0.0',
      dependencies: {
        next: '15.0.0',
        react: '19.0.0',
      },
    });
    await fsExtra.writeFile(path.join(webPath, 'next.config.ts'), 'export default {};\n');
    await fsExtra.ensureDir(path.join(webPath, 'node_modules', 'next'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.5.4', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.5.4', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.projects.map((p: { name: string }) => p.name).sort()).toEqual(['api', 'web']);
      expect(payload.projects.map((p: { path: string }) => p.path)).not.toContain(workspacePath);
      expect(payload.projects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'web',
            framework: 'Next.js',
            runtimeFamily: 'node',
            projectKind: 'frontend',
          }),
          expect.objectContaining({
            name: 'api',
            runtimeFamily: 'python',
          }),
        ])
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should cache workspace project scans and write evidence on repeat runs', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-cache-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const apiPath = path.join(workspacePath, 'saas-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(apiPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(apiPath, '.rapidkit', 'project.json'), {
      name: 'saas-api',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(apiPath, 'pyproject.toml'),
      '[tool.poetry]\nname = "saas-api"\n'
    );
    await fsExtra.ensureDir(path.join(apiPath, '.venv'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-c' && String(args?.[1] || '').includes('rapidkit_core')) {
          return { stdout: '0.3.8', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-c' && String(args?.[1] || '').includes('fastapi')) {
          return { stdout: '', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx') {
        if (args?.[0] === '--version') {
          return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.8', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');

      await runDoctor({ workspace: true, json: true });
      const cachePath = path.join(
        workspacePath,
        '.workspai',
        'reports',
        'doctor-workspace-cache.json'
      );
      const firstCache = await fsExtra.readJSON(cachePath);
      firstCache.projects[0].fixCommands = [
        'https://example.com/install-tool',
        'npx workspai doctor project --json',
      ];
      await fsExtra.writeJSON(cachePath, firstCache, { spaces: 2 });
      logSpy.mockClear();

      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.cache.projectScan).toBe(true);
      expect(payload.cache.evidencePath).toContain('doctor-last-run.json');
      expect(payload.projects[0].fixCommands).toEqual(['npx workspai doctor project --json']);
      expect(
        await fsExtra.pathExists(
          path.join(workspacePath, '.workspai', 'reports', 'doctor-workspace-cache.json')
        )
      ).toBe(true);
      expect(
        await fsExtra.pathExists(
          path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json')
        )
      ).toBe(true);

      const workspaceCache = await fsExtra.readJSON(
        path.join(workspacePath, '.workspai', 'reports', 'doctor-workspace-cache.json')
      );
      const workspaceEvidence = await fsExtra.readJSON(
        path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json')
      );
      expect(workspaceCache.schemaVersion).toBe('doctor-workspace-cache-v2');
      expect(workspaceEvidence.schemaVersion).toBe('doctor-workspace-evidence-v1');
      expect(workspaceEvidence.evidenceType).toBe('workspace');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should count advisory warnings from env/security in workspace health score', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-advisory-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const nodeProjectPath = path.join(workspacePath, 'rapidkit-front-pro');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(nodeProjectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(nodeProjectPath, '.rapidkit', 'project.json'), {
      name: 'rapidkit-front-pro',
      kit_name: 'generic.imported',
      runtime: 'unknown',
    });
    await fsExtra.writeJSON(path.join(nodeProjectPath, 'package.json'), {
      name: 'rapidkit-front-pro',
      version: '1.0.0',
      dependencies: {
        '@nestjs/core': '^10.0.0',
      },
    });
    await fsExtra.ensureDir(path.join(nodeProjectPath, 'node_modules', '@nestjs'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({
            metadata: {
              vulnerabilities: {
                info: 0,
                low: 1,
                moderate: 2,
                high: 1,
                critical: 0,
                total: 4,
              },
            },
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.summary.totalIssues).toBe(0);
      expect(payload.summary.projectAdvisoryWarningProjects).toBe(1);
      expect(payload.summary.projectAdvisoryWarnings).toBeGreaterThanOrEqual(1);
      expect(payload.healthScore.warnings).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should detect Next.js projects without mislabeling as NestJS', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-nextjs-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'web-app');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'web-app',
      kit_name: 'generic.imported',
      runtime: 'unknown',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'web-app',
      version: '1.0.0',
      dependencies: {
        next: '14.2.0',
      },
    });
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', 'next'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.contract?.version).toBe('doctor-evidence-v1');
      expect(payload.contract?.scoringPolicyVersion).toBe('doctor-score-policy-v2');
      expect(payload.projects[0].framework).toBe('Next.js');
      expect(payload.projects[0].framework).not.toBe('NestJS');
      expect(payload.projects[0].runtimeFamily).toBe('node');
      expect(payload.projects[0].projectKind).toBe('frontend');
      expect(payload.projects[0].supportTier).toBe('extended');
      expect(payload.projects[0].frameworkConfidence).toBe('high');
      expect(payload.scoreBreakdown[0].policyRuleId).toBeDefined();
      expect(payload.summary.scopeProvenance).toBeDefined();
      expect(payload.summary.scopeProvenance.aggregatedCount).toBeGreaterThan(0);
      expect(payload.driftDelta).toBeDefined();
      expect(payload.driftDelta.baselineAvailable).toBe(false);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should include frontend enterprise probes for Next.js doctor project scope', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-nextjs-project-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'catalog-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'catalog-api',
      kit_name: 'frontend.nextjs',
      framework: 'nextjs',
      runtime: 'node',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'catalog-api',
      version: '1.0.0',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        lint: 'next lint',
      },
      dependencies: {
        next: '14.2.0',
      },
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package-lock.json'), {});
    await fsExtra.writeJSON(path.join(projectPath, 'tsconfig.json'), {
      compilerOptions: { strict: true },
    });
    await fsExtra.writeFile(path.join(projectPath, 'next.config.ts'), 'export default {}');
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', 'next'));
    await fsExtra.ensureDir(path.join(projectPath, 'app'));
    await fsExtra.writeFile(
      path.join(projectPath, 'app', 'page.tsx'),
      'export default function Page() { return null; }'
    );
    await fsExtra.writeFile(path.join(projectPath, 'eslint.config.mjs'), 'export default []');
    await fsExtra.ensureDir(path.join(projectPath, 'src', 'components'));
    await fsExtra.writeFile(
      path.join(projectPath, 'src', 'components', 'Button.test.tsx'),
      'export {}'
    );

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { high: 1, critical: 0, moderate: 1 } },
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.project.framework).toBe('Next.js');
      expect(payload.project.projectKind).toBe('frontend');
      expect(payload.project.frameworkKey).toBe('nextjs');
      expect(payload.project.hasCodeQuality).toBe(true);
      expect(payload.project.hasTests).toBe(true);
      const probeIds = (payload.project.probes ?? []).map((probe: { id: string }) => probe.id);
      expect(probeIds).toEqual(
        expect.arrayContaining([
          'frontend-lockfile-integrity',
          'frontend-typescript-surface',
          'frontend-framework-config',
          'frontend-script-dev',
          'frontend-script-build',
          'frontend-source-tree',
        ])
      );
      const testProbe = payload.project.probes.find(
        (probe: { id: string }) => probe.id === 'frontend-script-test'
      );
      expect(testProbe.repairCapability).toMatchObject({
        issueId: 'frontend-script-test',
        fixKind: 'package-json-script',
        status: 'available',
        canAutoFix: true,
        canEditFiles: true,
      });
      expect(payload.project.repairCapabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueId: 'frontend-script-test',
            fixKind: 'package-json-script',
          }),
        ])
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should apply safe package.json script repairs from doctor workspace fix', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-script-repair-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'next-app');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'next-app',
      kit_name: 'frontend.nextjs',
      framework: 'nextjs',
      runtime: 'node',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'next-app',
      version: '1.0.0',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        lint: 'next lint',
      },
      dependencies: {
        next: '15.0.0',
        react: '19.0.0',
      },
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package-lock.json'), {});
    await fsExtra.writeJSON(path.join(projectPath, 'tsconfig.json'), {
      compilerOptions: { strict: true },
    });
    await fsExtra.writeFile(path.join(projectPath, 'next.config.ts'), 'export default {}');
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', 'next'));
    await fsExtra.ensureDir(path.join(projectPath, 'app'));
    await fsExtra.writeFile(
      path.join(projectPath, 'app', 'page.tsx'),
      'export default function Page() { return null; }'
    );
    await fsExtra.writeFile(path.join(projectPath, 'eslint.config.mjs'), 'export default []');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.41.3', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 0 } },
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, fix: true, json: true });

      const packageJson = await fsExtra.readJSON(path.join(projectPath, 'package.json'));
      expect(packageJson.scripts.test).toBe('npm run lint');

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      const stringLogs = logSpy.mock.calls
        .map((call) => call[0])
        .filter((msg): msg is string => typeof msg === 'string');
      expect(stringLogs).toHaveLength(1);
      expect(stringLogs[0].trim().startsWith('{')).toBe(true);
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.remediationPlan).toEqual(
        expect.objectContaining({
          schemaVersion: 'doctor-remediation-plan-v2',
          policyProfile: 'local',
          totalSteps: expect.any(Number),
          executableSteps: expect.any(Number),
        })
      );
      expect(payload.remediationPlan.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectName: 'next-app',
            phase: 'command-contract',
            order: expect.any(Number),
            dependsOn: expect.any(Array),
            operation: expect.objectContaining({
              type: 'package-json-script',
              scriptName: 'test',
            }),
            preview: expect.objectContaining({
              changes: expect.any(Array),
            }),
            rollback: expect.objectContaining({
              available: true,
              strategy: 'snapshot',
            }),
            studioStatus: expect.objectContaining({
              state: expect.stringMatching(/^(ready|review-required)$/),
            }),
          }),
        ])
      );
      expect(payload.fixResult.appliedFixes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'package-json-script',
            outcome: 'applied',
            projectName: 'next-app',
          }),
        ])
      );
      expect(
        await fsExtra.pathExists(path.join(projectPath, '.workspai', 'reports', 'fix-snapshots'))
      ).toBe(true);
      expect(
        await fsExtra.pathExists(path.join(projectPath, '.rapidkit', 'reports', 'fix-snapshots'))
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should apply safe package.json script repairs from doctor project fix JSON mode', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-project-script-repair-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'next-app');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'next-app',
      kit_name: 'frontend.nextjs',
      framework: 'nextjs',
      runtime: 'node',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'next-app',
      version: '1.0.0',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        lint: 'next lint',
      },
      dependencies: {
        next: '15.0.0',
        react: '19.0.0',
      },
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package-lock.json'), {});
    await fsExtra.writeJSON(path.join(projectPath, 'tsconfig.json'), {
      compilerOptions: { strict: true },
    });
    await fsExtra.writeFile(path.join(projectPath, 'next.config.ts'), 'export default {}');
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', 'next'));
    await fsExtra.ensureDir(path.join(projectPath, 'app'));
    await fsExtra.writeFile(
      path.join(projectPath, 'app', 'page.tsx'),
      'export default function Page() { return null; }'
    );
    await fsExtra.writeFile(path.join(projectPath, 'eslint.config.mjs'), 'export default []');

    const workspaceFixResultPath = path.join(
      workspacePath,
      '.workspai',
      'reports',
      'doctor-fix-result-last-run.json'
    );
    await fsExtra.outputJSON(workspaceFixResultPath, {
      schemaVersion: 'rapidkit-doctor-fix-result-v1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      appliedFixes: [
        {
          path: workspacePath,
          action: 'workspace-sentinel',
          outcome: 'guidance',
          projectName: 'workspace',
          command: 'workspai doctor workspace --apply --json',
        },
      ],
      remainingBlockers: ['workspace: sentinel blocker'],
      verifyRecommended: 'npx workspai workspace verify --json',
    });

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.41.3', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 0 } },
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, fix: true, json: true });

      const packageJson = await fsExtra.readJSON(path.join(projectPath, 'package.json'));
      expect(packageJson.scripts.test).toBe('npm run lint');

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.remediationPlan).toEqual(
        expect.objectContaining({
          schemaVersion: 'doctor-remediation-plan-v2',
          totalSteps: expect.any(Number),
          executableSteps: expect.any(Number),
        })
      );
      expect(payload.remediationPlan.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectName: 'next-app',
            operation: expect.objectContaining({
              type: 'package-json-script',
              scriptName: 'test',
            }),
            verifyCommand: expect.any(String),
            refreshCommands: expect.arrayContaining(['npx workspai doctor project --json']),
            studioStatus: expect.objectContaining({
              reason: expect.any(String),
            }),
          }),
        ])
      );
      expect(
        payload.remediationPlan.steps.filter(
          (step: { operation?: { type?: string } }) => step.operation?.type === 'file-copy'
        )
      ).toHaveLength(0);
      expect(
        payload.remediationPlan.steps.some((step: { originalCommand?: string }) =>
          step.originalCommand?.includes('cp .env.example .env')
        )
      ).toBe(false);
      expect(payload.fixResult.appliedFixes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'package-json-script',
            outcome: 'applied',
            projectName: 'next-app',
          }),
        ])
      );
      expect(realpathForAssertion(payload.remediationPlanPath)).toBe(
        realpathForAssertion(
          path.join(projectPath, '.workspai', 'reports', 'doctor-remediation-plan-last-run.json')
        )
      );
      expect(realpathForAssertion(payload.fixResultPath)).toBe(
        realpathForAssertion(
          path.join(projectPath, '.workspai', 'reports', 'doctor-fix-result-last-run.json')
        )
      );
      await expect(
        fsExtra.pathExists(
          path.join(projectPath, '.workspai', 'reports', 'doctor-project-last-run.json')
        )
      ).resolves.toBe(true);
      await expect(
        fsExtra.pathExists(
          path.join(projectPath, '.workspai', 'reports', 'doctor-remediation-plan-last-run.json')
        )
      ).resolves.toBe(true);
      await expect(
        fsExtra.pathExists(
          path.join(projectPath, '.workspai', 'reports', 'doctor-fix-result-last-run.json')
        )
      ).resolves.toBe(true);
      await expect(fsExtra.readJSON(workspaceFixResultPath)).resolves.toEqual(
        expect.objectContaining({
          remainingBlockers: ['workspace: sentinel blocker'],
        })
      );
      expect(
        payload.project.repairCapabilities.some(
          (capability: { issueId?: string }) => capability.issueId === 'surface-env-contract'
        )
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('orders remediation plan steps so Studio can repair dependency baselines before command contracts', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-remediation-order-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'next-app');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'next-app',
      kit_name: 'frontend.nextjs',
      framework: 'nextjs',
      runtime: 'node',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'next-app',
      version: '1.0.0',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        lint: 'next lint',
      },
      dependencies: {
        next: '15.0.0',
        react: '19.0.0',
      },
    });
    await fsExtra.writeJSON(path.join(projectPath, 'tsconfig.json'), {
      compilerOptions: { strict: true },
    });
    await fsExtra.writeFile(path.join(projectPath, 'next.config.ts'), 'export default {}');
    await fsExtra.writeFile(path.join(projectPath, 'eslint.config.mjs'), 'export default []');
    await fsExtra.ensureDir(path.join(projectPath, 'app'));
    await fsExtra.writeFile(
      path.join(projectPath, 'app', 'page.tsx'),
      'export default function Page() { return null; }'
    );

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.41.3', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 0 } },
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({
        project: true,
        plan: true,
        json: true,
        profile: 'enterprise-strict',
      });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      const steps = payload.remediationPlan.steps as Array<{
        id: string;
        phase: string;
        order: number;
        dependsOn: string[];
      }>;
      const dependencyStep = steps.find((step) => step.phase === 'dependency-baseline');
      const commandStep = steps.find((step) => step.phase === 'command-contract');

      expect(payload.remediationPlan.policyProfile).toBe('enterprise-strict');
      expect(dependencyStep).toBeDefined();
      expect(commandStep).toBeDefined();
      expect(dependencyStep?.order).toBeLessThan(commandStep?.order ?? Number.MAX_SAFE_INTEGER);
      expect(commandStep?.dependsOn).toContain(dependencyStep?.id);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should apply project-scoped file repair capabilities from doctor project fix JSON mode', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-file-repair-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'next-app');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'next-app',
      kit_name: 'frontend.nextjs',
      framework: 'nextjs',
      runtime: 'node',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'next-app',
      version: '1.0.0',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        lint: 'next lint',
        test: 'npm run lint',
        audit: 'npm audit',
      },
      dependencies: {
        next: '15.0.0',
        react: '19.0.0',
      },
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package-lock.json'), {});
    await fsExtra.writeJSON(path.join(projectPath, 'tsconfig.json'), {
      compilerOptions: { strict: true },
    });
    await fsExtra.writeFile(path.join(projectPath, 'next.config.ts'), 'export default {}');
    await fsExtra.writeFile(
      path.join(projectPath, 'Dockerfile'),
      'FROM node:20-alpine\nCOPY . .\n'
    );
    await fsExtra.writeFile(path.join(projectPath, '.env.example'), 'NEXT_PUBLIC_APP_URL=\n');
    await fsExtra.writeFile(path.join(projectPath, '.gitignore'), 'node_modules\n');
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', 'next'));
    await fsExtra.ensureDir(path.join(projectPath, 'app'));
    await fsExtra.writeFile(
      path.join(projectPath, 'app', 'page.tsx'),
      'export default function Page() { return null; }'
    );
    await fsExtra.writeFile(path.join(projectPath, 'eslint.config.mjs'), 'export default []');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.41.3', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 0 } },
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, fix: true, json: true });
      const realProjectPath = fsExtra.realpathSync(projectPath);

      await expect(fsExtra.pathExists(path.join(projectPath, '.dockerignore'))).resolves.toBe(true);
      await expect(
        fsExtra.readFile(path.join(projectPath, '.dockerignore'), 'utf8')
      ).resolves.toContain('node_modules');
      await expect(
        fsExtra.readFile(path.join(projectPath, '.gitignore'), 'utf8')
      ).resolves.toContain('!.env.example');
      // .env.example is the portable configuration contract. Doctor must not
      // materialize a local, potentially secret-bearing .env implicitly.
      await expect(fsExtra.pathExists(path.join(projectPath, '.env'))).resolves.toBe(false);

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.remediationPlan).toEqual(
        expect.objectContaining({
          schemaVersion: 'doctor-remediation-plan-v2',
          totalSteps: expect.any(Number),
          executableSteps: expect.any(Number),
        })
      );
      expect(payload.remediationPlan.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectName: 'next-app',
            files: expect.arrayContaining([path.join(realProjectPath, '.dockerignore')]),
            operation: expect.objectContaining({
              type: 'file-create',
            }),
            preview: expect.objectContaining({
              title: expect.any(String),
              summary: expect.any(String),
              changes: expect.any(Array),
            }),
            rollback: expect.objectContaining({
              available: true,
              strategy: 'snapshot',
            }),
          }),
          expect.objectContaining({
            projectName: 'next-app',
            files: expect.arrayContaining([path.join(realProjectPath, '.gitignore')]),
            operation: expect.objectContaining({
              type: 'file-append',
            }),
          }),
        ])
      );
      expect(
        payload.remediationPlan.steps.filter(
          (step: { operation?: { type?: string } }) => step.operation?.type === 'file-copy'
        )
      ).toHaveLength(0);
      expect(
        payload.remediationPlan.steps.some((step: { originalCommand?: string }) =>
          step.originalCommand?.includes('cp .env.example .env')
        )
      ).toBe(false);
      expect(payload.fixResult.appliedFixes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'file-create',
            outcome: 'applied',
            projectName: 'next-app',
          }),
          expect.objectContaining({
            action: 'file-append',
            outcome: 'applied',
            projectName: 'next-app',
          }),
        ])
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should apply runtime command contract repairs without Makefile target conflicts', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-runtime-command-repair-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'go-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'go-api',
      kit_name: 'gofiber.standard',
      framework: 'gofiber',
      runtime: 'go',
    });
    await fsExtra.writeFile(path.join(projectPath, 'go.mod'), 'module example.com/go-api\n');
    await fsExtra.writeFile(path.join(projectPath, 'go.sum'), '');
    await fsExtra.writeFile(path.join(projectPath, '.gitignore'), '.env\n.env.*\n!.env.example\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.41.3', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, fix: true, json: true });
      const realProjectPath = fsExtra.realpathSync(projectPath);

      const makefile = await fsExtra.readFile(path.join(projectPath, 'Makefile'), 'utf8');
      expect(makefile).toContain('test:');
      expect(makefile).toContain('\tgo test ./...');
      expect(makefile).toContain('quality:');
      expect(makefile).toContain('\tgofmt -w .');
      expect(makefile).toContain('security:');
      expect(makefile).toContain('\tgovulncheck ./...');

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      const stepIds = payload.remediationPlan.steps.map((step: { id: string }) => step.id);
      expect(new Set(stepIds).size).toBe(stepIds.length);
      expect(payload.remediationPlan.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueId: 'surface-test-contract',
            operation: expect.objectContaining({
              type: 'makefile-target',
              path: path.join(realProjectPath, 'Makefile'),
              target: 'test',
            }),
          }),
          expect.objectContaining({
            issueId: 'runtime-quality-tooling',
            operation: expect.objectContaining({
              type: 'makefile-target',
              path: path.join(realProjectPath, 'Makefile'),
              target: 'quality',
            }),
          }),
          expect.objectContaining({
            issueId: 'runtime-security-tooling',
            operation: expect.objectContaining({
              type: 'makefile-target',
              path: path.join(realProjectPath, 'Makefile'),
              target: 'security',
            }),
          }),
        ])
      );
      expect(payload.fixResult.appliedFixes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'makefile-target',
            outcome: 'applied',
            projectName: 'go-api',
          }),
        ])
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should include explicit doctor policy profile metadata in project JSON output', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-profile-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'next-app');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'next-app',
      kit_name: 'frontend.nextjs',
      framework: 'nextjs',
      runtime: 'node',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'next-app',
      version: '1.0.0',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        lint: 'next lint',
      },
      dependencies: {
        next: '15.0.0',
        react: '19.0.0',
      },
    });

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.41.3', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 0 } },
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      const exitCode = await runDoctor({
        project: true,
        json: true,
        profile: 'enterprise-strict',
      });

      expect(exitCode).toBe(1);
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.policyProfile).toMatchObject({
        name: 'enterprise-strict',
        exitOnWarnings: true,
        advisoryWarningsBlockRelease: true,
      });
      expect(payload.evidenceFreshness).toMatchObject({
        status: 'fresh',
      });
      expect(payload.evidenceFreshness.verifyBeforeUseProbeCount).toBeGreaterThan(0);
      expect(payload.project.probes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'frontend-script-test',
            issueClass: 'test',
            operationalImpact: 'ci-risk',
            freshness: expect.objectContaining({
              category: 'verification',
              status: 'fresh',
              verifyBeforeUse: true,
            }),
            repairIntent: expect.objectContaining({
              mode: 'edit-file',
              confidence: 'high',
              primaryActionLabel: 'Apply file fix',
              requiresApproval: true,
            }),
          }),
        ])
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should include adopted external projects from the workspace registry', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-adopted-'));
    const workspacePath = path.join(tempRoot, 'default-workspace');
    const projectPath = path.join(tempRoot, 'external-next-app');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'default-workspace',
      version: '1.0',
    });
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit', 'imported-projects.json'), {
      version: 1,
      updatedAt: '2026-06-15T00:00:00.000Z',
      projects: [
        {
          name: 'external-next-app',
          path: projectPath,
          relativePath: '../external-next-app',
          relationship: 'adopted',
          stack: 'nextjs',
          runtime: 'node',
          framework: 'nextjs',
          frameworkDisplayName: 'Next.js',
          supportTier: 'extended',
          moduleSupport: false,
          confidence: 'high',
          source: 'adopted-local',
          importedAt: '2026-06-15T00:00:00.000Z',
        },
      ],
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'external-next-app',
      kit_name: 'adopted.nextjs',
      runtime: 'node',
      framework: 'nextjs',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'external-next-app',
      version: '1.0.0',
      dependencies: {
        next: '15.0.0',
        react: '19.0.0',
      },
    });
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', 'next'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.summary.totalProjects).toBe(1);
      expect(payload.projects).toEqual([
        expect.objectContaining({
          name: 'external-next-app',
          path: projectPath,
          framework: 'Next.js',
          runtimeFamily: 'node',
          projectKind: 'frontend',
        }),
      ]);
      expect(await fsExtra.pathExists(path.join(workspacePath, '.workspai', 'reports'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('treats registered project boundaries as canonical and keeps passing probes non-actionable', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-boundary-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'atlas-api');

    await fsExtra.outputJson(path.join(workspacePath, '.workspai-workspace'), {
      signature: 'RAPIDKIT_WORKSPACE',
      name: 'workspace',
    });
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      projects: [{ slug: 'atlas-api', relativePath: 'atlas-api', framework: 'dotnet' }],
    });
    await fsExtra.outputJson(path.join(projectPath, '.workspai', 'project.json'), {
      name: 'atlas-api',
      runtime: 'dotnet',
      framework: 'dotnet',
      kit_name: 'dotnet.webapi.clean',
    });
    await fsExtra.outputFile(
      path.join(projectPath, 'atlas-api.sln'),
      'Microsoft Visual Studio Solution File\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'atlas-api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Web" />\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'tests', 'atlas-api.Tests.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk" />\n'
    );
    await fsExtra.outputFile(path.join(projectPath, '.env.example'), 'PORT=8080\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if ((cmd === 'python3' || cmd === 'python') && args?.[0] === '--version') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.6.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 1 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((message) => typeof message === 'string' && message.trim().startsWith('{')) as
        string | undefined;
      const payload = JSON.parse(jsonLine as string);
      expect(payload.summary.totalProjects).toBe(1);
      expect(payload.projects).toHaveLength(1);
      expect(payload.projects[0]).toMatchObject({
        name: 'atlas-api',
        runtimeFamily: 'dotnet',
        runtimeFamilies: ['dotnet'],
      });
      expectSameFilesystemEntry(payload.projects[0].path, projectPath);
      expect(
        payload.projects[0].probes.find(
          (probe: { id: string }) => probe.id === 'surface-env-contract'
        )
      ).toMatchObject({ status: 'pass', repairIntent: { mode: 'none' } });
      expect(
        payload.projects[0].probes.find(
          (probe: { id: string }) => probe.id === 'surface-env-contract'
        )
      ).not.toHaveProperty('repairCapability');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should skip go mod tidy fix when go toolchain is missing', async () => {
    // Exercise the PowerShell Set-Location remediation command even on the
    // Linux developer gate so Windows parser drift cannot wait for CI.
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-go-skip-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const goApiPath = path.join(workspacePath, 'go-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(goApiPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(goApiPath, '.rapidkit', 'project.json'), {
      name: 'go-api',
      runtime: 'go',
      kit_name: 'gofiber.standard',
    });
    await fsExtra.writeFile(path.join(goApiPath, 'go.mod'), 'module example.com/go-api\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        throw new Error('go not found');
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, fix: true, json: true });

      expect(promptMock).not.toHaveBeenCalled();

      const executedCommands = mockedExeca.mock.calls.map(([cmd, args]) => ({ cmd, args }));
      expect(
        executedCommands.some(
          ({ cmd, args }) =>
            cmd === 'go' && Array.isArray(args) && args[0] === 'mod' && args[1] === 'tidy'
        )
      ).toBe(false);
      expect(
        executedCommands.some(({ cmd }) => typeof cmd === 'string' && cmd.includes('go mod tidy'))
      ).toBe(false);
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((value) => typeof value === 'string' && value.trim().startsWith('{')) as
        string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      const project = payload.projects.find((item: { name?: string }) => item.name === 'go-api');
      expect(project.issues).toContain('Go toolchain not found — install from https://go.dev/dl/');
      expect(project.fixCommands).not.toContain('https://go.dev/dl/');
      expect(
        payload.remediationPlan.steps.some(
          (step: { originalCommand?: string }) =>
            typeof step.originalCommand === 'string' && /^https?:\/\//.test(step.originalCommand)
        )
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      platformSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should support doctor project scope with JSON output', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-project-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'my-nest-services');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'my-nest-services',
      kit_name: 'nestjs.standard',
      runtime: 'node',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'my-nest-services',
      version: '1.0.0',
      dependencies: {
        '@nestjs/core': '^10.0.0',
      },
    });
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', '@nestjs', 'core'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.scope).toBe('project');
      expect(payload.contract?.version).toBe('doctor-evidence-v1');
      expect(payload.contract?.scoringPolicyVersion).toBe('doctor-score-policy-v2');
      expect(payload.project.probeSummary).toMatchObject({
        total: expect.any(Number),
        blockingFindings: expect.any(Number),
        advisoryFindings: expect.any(Number),
        verdict: expect.stringMatching(/^(passed|attention|blocked)$/),
      });
      expect(payload.healthScore.verdict).toMatch(/^(passed|attention|blocked)$/);
      expect(payload.healthScore.total).toBe(
        payload.healthScore.passed + payload.healthScore.warnings + payload.healthScore.errors
      );
      expect(payload.project.name).toBe('my-nest-services');
      expect(payload.project.framework).toBe('NestJS');
      expect(payload.project.frameworkKey).toBe('nestjs');
      expect(payload.project.importStack).toBe('nestjs');
      expect(payload.summary.totalProjects).toBe(1);
      expect(payload.evidencePath).toContain('doctor-project-last-run.json');
      expect(Array.isArray(payload.project.probes)).toBe(true);
      expect(Array.isArray(payload.scoreBreakdown)).toBe(true);
      expect(payload.scoreBreakdown.length).toBeGreaterThan(0);
      expect(payload.scoreBreakdown[0].policyRuleId).toBeDefined();
      expect(payload.summary.scopeProvenance).toBeDefined();
      expect(payload.summary.scopeProvenance.scopedCount).toBeGreaterThan(0);
      expect(payload.driftDelta).toBeDefined();
      expect(payload.driftDelta.baselineAvailable).toBe(false);

      const projectEvidence = await fsExtra.readJSON(
        path.join(workspacePath, '.workspai', 'reports', 'doctor-project-last-run.json')
      );
      expect(projectEvidence.schemaVersion).toBe('doctor-project-evidence-v1');
      expect(projectEvidence.evidenceType).toBe('project');
      const namespacedEvidenceFiles = await fsExtra.readdir(
        path.join(workspacePath, '.workspai', 'reports', 'projects')
      );
      expect(namespacedEvidenceFiles).toHaveLength(1);
      expect(namespacedEvidenceFiles[0]).toMatch(/^my-nest-services--[a-f0-9]{12}$/);
      const namespacedEvidence = await fsExtra.readJSON(
        path.join(
          workspacePath,
          '.workspai',
          'reports',
          'projects',
          namespacedEvidenceFiles[0] as string,
          'doctor-project-last-run.json'
        )
      );
      expect(namespacedEvidence).toEqual(projectEvidence);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('classifies cross-language platforms without service-only false warnings', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-platform-'));
    const projectPath = path.join(tempRoot, 'polyglot-core');
    await fsExtra.ensureDir(path.join(projectPath, 'src'));
    await fsExtra.ensureDir(path.join(projectPath, 'include'));
    await fsExtra.ensureDir(path.join(projectPath, 'bindings'));
    await fsExtra.writeFile(path.join(projectPath, 'CMakeLists.txt'), 'project(polyglot_core)\n');
    await fsExtra.writeFile(
      path.join(projectPath, 'src', 'core.cpp'),
      'int core() { return 1; }\n'
    );
    await fsExtra.writeFile(path.join(projectPath, 'go.mod'), 'module example.test/polyglot\n');
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      '[project]\nname="polyglot"\n'
    );
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'polyglot-bindings',
      version: '1.0.0',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((message) => typeof message === 'string' && message.trim().startsWith('{')) as string;
      const payload = JSON.parse(jsonLine);
      expect(payload.project.projectArchetype).toBe('platform');
      for (const probeId of [
        'surface-env-contract',
        'migration-surface',
        'runtime-health-surface',
        'adapter-cpp-boot-entrypoint',
      ]) {
        const probe = payload.project.probes.find(
          (candidate: { id?: string }) => candidate.id === probeId
        );
        if (probe) {
          expect(probe.applicability).toBe('not-applicable');
          expect(probe.status).toBe('pass');
        }
      }
      expect(
        payload.project.probes.filter((probe: { id?: string }) => probe.id === 'config-surface')
      ).toHaveLength(0);
      expect(payload.healthScore.presentation.policy).toBe('doctor-multi-axis-v1');
      expect(payload.healthScore.presentation.notApplicableChecks).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('uses nested runtime manifests for an adopted polyglot SDK boundary', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-sdk-'));
    const projectPath = path.join(tempRoot, 'polyglot-sdk');
    await fsExtra.outputFile(
      path.join(projectPath, 'dotnet', 'src', 'Sdk.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk" />\n'
    );
    await fsExtra.outputFile(path.join(projectPath, 'go', 'go.mod'), 'module example.test/sdk\n');
    await fsExtra.outputFile(
      path.join(projectPath, 'java', 'pom.xml'),
      '<project><modelVersion>4.0.0</modelVersion></project>\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'nodejs', 'package.json'),
      JSON.stringify({ name: 'example-sdk', version: '1.0.0' })
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'python', 'pyproject.toml'),
      '[project]\nname="example-sdk"\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'rust', 'Cargo.toml'),
      '[package]\nname="example-sdk"\nversion="1.0.0"\n'
    );
    await fsExtra.outputJSON(path.join(projectPath, '.workspai', 'project.json'), {
      schema_version: '1.0',
      name: 'polyglot-sdk',
      managed_by: 'workspai',
      relationship: 'adopted',
      runtime: 'dotnet',
      framework: 'dotnet',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((message) => typeof message === 'string' && message.trim().startsWith('{')) as string;
      const payload = JSON.parse(jsonLine);
      expect(payload.project.runtimeFamilies).toEqual([
        'go',
        'rust',
        'java',
        'dotnet',
        'node',
        'python',
      ]);
      expect(payload.project.projectArchetype).toBe('platform');
      expect(payload.project.diagnosis.project.runtimeFamilies).toHaveLength(6);
      expect(
        payload.project.diagnosis.unknowns.filter((item: { id?: string }) =>
          item.id?.startsWith('unknown:runtime:')
        )
      ).toHaveLength(5);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should accept RapidKit FastAPI src/main.py as Python boot entrypoint', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-fastapi-entrypoint-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'orbit-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.workspai'));
    await fsExtra.writeJSON(path.join(workspacePath, '.workspai-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.writeJSON(path.join(projectPath, '.workspai', 'project.json'), {
      name: 'orbit-api',
      kit_name: 'fastapi.standard',
      runtime: 'python',
    });
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      [
        '[tool.poetry]',
        'name = "orbit-api"',
        'version = "0.1.0"',
        '',
        '[tool.poetry.dependencies]',
        'python = "^3.10"',
        'fastapi = "^0.139.0"',
        '',
      ].join('\n')
    );
    await fsExtra.ensureDir(path.join(projectPath, 'src'));
    await fsExtra.writeFile(
      path.join(projectPath, 'src', 'main.py'),
      ['from fastapi import FastAPI', '', 'app = FastAPI(title="orbit-api")', ''].join('\n')
    );

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if ((cmd === 'python3' || cmd === 'python') && args?.[0] === '--version') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.5.5', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      const bootProbe = payload.project.probes.find(
        (probe: { id?: string }) => probe.id === 'adapter-python-boot-entrypoint'
      );
      expect(bootProbe).toBeDefined();
      expect(bootProbe.status).toBe('pass');
      expect(bootProbe.reason).toBe('Python application entrypoint markers detected.');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it.each([
    {
      name: 'go-fiber',
      kitName: 'go.fiber.standard',
      runtime: 'go',
      files: {
        'go.mod': 'module example.com/go-fiber\n\ngo 1.22\n',
        'go.sum': '',
        'cmd/server/main.go': 'package main\n\nfunc main() {}\n',
      },
      probeId: 'adapter-go-boot-entrypoint',
      passReason: 'Go application entrypoint markers detected.',
    },
    {
      name: 'orders-service',
      kitName: 'springboot.standard',
      runtime: 'java',
      files: {
        'pom.xml': '<project></project>\n',
        mvnw: '#!/usr/bin/env sh\n',
        'src/main/java/com/workspai/apps/orders/service/OrdersServiceApplication.java':
          'package com.workspai.apps.orders.service;\n\nclass OrdersServiceApplication {}\n',
      },
      probeId: 'adapter-java-boot-entrypoint',
      passReason: 'Java application entrypoint markers detected.',
    },
  ])('should accept canonical $runtime boot entrypoint markers', async (canary) => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), `rapidkit-doctor-${canary.runtime}-entrypoint-`)
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, canary.name);

    await fsExtra.ensureDir(path.join(workspacePath, '.workspai'));
    await fsExtra.writeJSON(path.join(workspacePath, '.workspai-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.writeJSON(path.join(projectPath, '.workspai', 'project.json'), {
      name: canary.name,
      kit_name: canary.kitName,
      runtime: canary.runtime,
    });
    for (const [relativePath, content] of Object.entries(canary.files)) {
      await fsExtra.outputFile(path.join(projectPath, relativePath), content);
    }

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if ((cmd === 'python3' || cmd === 'python') && args?.[0] === '--version') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.5.5', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'java' && args?.[0] === '-version') {
        return { stdout: '', stderr: 'openjdk version "21.0.1"', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      const bootProbe = payload.project.probes.find(
        (probe: { id?: string }) => probe.id === canary.probeId
      );
      expect(bootProbe).toBeDefined();
      expect(bootProbe.status).toBe('pass');
      expect(bootProbe.reason).toBe(canary.passReason);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should report command capabilities for nested ASP.NET Core project files', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-dotnet-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'orders-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'orders-api',
      kit_name: 'dotnet.webapi.clean',
      runtime: 'dotnet',
      module_support: false,
    });
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'context.json'), {
      engine: 'npm',
      runtime: 'dotnet',
    });
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'orders-api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'Program.cs'),
      'Console.WriteLine("ok");\n'
    );
    await fsExtra.ensureDir(path.join(projectPath, 'src', 'obj'));
    await fsExtra.outputFile(path.join(projectPath, 'tests', 'orders-api.Tests.csproj'), '');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.project.projectKind).toBe('backend');
      expect(payload.project.frameworkKey).toBe('dotnet');
      expect(payload.project.runtimeFamily).toBe('dotnet');
      expect(payload.project.commandCapabilities.runtime).toBe('dotnet');
      expect(payload.project.commandCapabilities.moduleSupport).toBe(false);
      expect(payload.project.commandCapabilities.commandMap.build).toMatchObject({
        status: 'supported',
        owner: 'runtime',
      });
      expect(payload.project.commandCapabilities.commandMap.modules).toMatchObject({
        status: 'unsupported',
        owner: 'none',
      });
      const bootProbe = payload.project.probes.find(
        (probe: { id?: string }) => probe.id === 'adapter-dotnet-boot-entrypoint'
      );
      expect(bootProbe).toBeDefined();
      expect(bootProbe.status).toBe('pass');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should detect Rust project in doctor project mode', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-rust-'));
    const projectPath = path.join(tempRoot, 'ledger-service');

    await fsExtra.ensureDir(projectPath);
    await fsExtra.writeFile(
      path.join(projectPath, 'Cargo.toml'),
      '[package]\nname = "ledger-service"\nversion = "0.1.0"\n'
    );
    await fsExtra.writeFile(path.join(projectPath, 'Cargo.lock'), '# lockfile');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.project.framework).toBe('Rust');
      expect(payload.project.frameworkKey).toBe('rust');
      expect(payload.project.importStack).toBe('unknown');
      expect(payload.project.runtimeFamily).toBe('rust');
      expect(payload.project.depsInstalled).toBe(true);
      expect(Array.isArray(payload.project.probes)).toBe(true);
      expect(payload.project.probes.some((p: { id: string }) => p.id === 'migration-surface')).toBe(
        true
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should detect Deno project contract metadata in doctor project mode', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-deno-'));
    const projectPath = path.join(tempRoot, 'edge-deno-service');

    await fsExtra.ensureDir(projectPath);
    await fsExtra.writeJSON(path.join(projectPath, 'deno.json'), {
      tasks: {
        dev: 'deno run --watch src/main.ts',
      },
    });

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.project.framework).toBe('Deno');
      expect(payload.project.frameworkKey).toBe('deno');
      expect(payload.project.importStack).toBe('unknown');
      expect(payload.project.runtimeFamily).toBe('deno');
      expect(payload.project.projectKind).toBe('backend');
      expect(payload.project.supportTier).toBe('extended');
      expect(payload.project.frameworkConfidence).toBe('high');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should resolve nearest parent backend project when doctor project runs in nested directory', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-nested-parent-')
    );
    const projectPath = path.join(tempRoot, 'my-node-service');
    const nestedPath = path.join(projectPath, 'src', 'modules');

    await fsExtra.ensureDir(nestedPath);
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'my-node-service',
      version: '1.0.0',
      dependencies: {
        express: '^4.19.0',
      },
    });
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', 'express'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(nestedPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.scope).toBe('project');
      expect(payload.project.path).toBe(projectPath);
      expect(payload.project.name).toBe('my-node-service');
      expect(payload.project.runtimeFamily).toBe('node');
      expect(payload.project.framework).not.toBe('Unknown');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should return a JSON scope error when project doctor runs from a workspace shell', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-project-scope-guard-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const nestedPath = path.join(workspacePath, 'tests', 'fixtures');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });
    await fsExtra.writeFile(
      path.join(workspacePath, 'pyproject.toml'),
      '[tool.poetry]\nname = "workspace-shell"\n'
    );
    await fsExtra.ensureDir(nestedPath);

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__EXIT__${code ?? 0}`);
    }) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const originalCwd = process.cwd();

    try {
      process.chdir(nestedPath);
      const { runDoctor } = await import('../doctor.js');
      await expect(runDoctor({ project: true, json: true })).resolves.toBe(1);
      expect(exitSpy).not.toHaveBeenCalled();
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.scope).toBe('project');
      expect(payload.status).toBe('error');
      expect(fsExtra.realpathSync(payload.workspace.path)).toBe(
        fsExtra.realpathSync(workspacePath)
      );
      expect(payload.project).toBeNull();
      expect(payload.error.code).toBe('doctor.project.scope.not_found_in_workspace');
      expect(payload.error.relatedCommands).toContain('npx workspai doctor workspace --json');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      exitSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should accept workspace mode when .rapidkit-workspace marker exists without .rapidkit dir', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-workspace-guard-')
    );

    await fsExtra.writeJSON(path.join(tempRoot, '.rapidkit-workspace'), {
      name: 'invalid-workspace',
      version: '1.0',
    });

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(fsExtra.realpathSync(payload.workspace.path)).toBe(fsExtra.realpathSync(tempRoot));
      expect(payload.summary.totalProjects).toBe(0);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should accept workspace mode when only Workspai workspace markers exist', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-doctor-workspace-guard-')
    );

    await fsExtra.writeJSON(path.join(tempRoot, '.workspai-workspace'), {
      name: 'workspai-workspace',
      version: '1.0',
    });
    await fsExtra.ensureDir(path.join(tempRoot, '.workspai'));
    await fsExtra.writeJSON(path.join(tempRoot, '.workspai', 'workspace.json'), {
      name: 'workspai-workspace',
      profile: 'node-only',
    });

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(fsExtra.realpathSync(payload.workspace.path)).toBe(fsExtra.realpathSync(tempRoot));
      expect(payload.summary.totalProjects).toBe(0);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should load custom adapter checks from doctor.adapters.json', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-adapter-contract-')
    );
    const projectPath = path.join(tempRoot, 'adapter-node-service');

    await fsExtra.ensureDir(path.join(projectPath, 'src'));
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      name: 'adapter-node-service',
      version: '1.0.0',
      dependencies: {
        express: '^4.19.0',
      },
    });
    await fsExtra.ensureDir(path.join(projectPath, 'node_modules', 'express'));
    await fsExtra.writeJSON(path.join(projectPath, 'doctor.adapters.json'), {
      checks: [
        {
          id: 'boot-probe-contract',
          label: 'Boot probe contract',
          severity: 'error',
          runtimes: ['node'],
          anyOfPaths: ['src/main.ts'],
          recommendation: 'Add src/main.ts bootstrap entrypoint.',
        },
      ],
    });

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      const adapterProbe = payload.project.probes.find(
        (p: { id: string }) => p.id === 'boot-probe-contract'
      );
      expect(adapterProbe).toBeDefined();
      expect(adapterProbe.status).toBe('fail');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should accept legacy workspace evidence without schemaVersion when computing drift', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-legacy-evidence-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const nodeProjectPath = path.join(workspacePath, 'legacy-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.workspai', 'reports'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(nodeProjectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(nodeProjectPath, '.rapidkit', 'project.json'), {
      name: 'legacy-api',
      kit_name: 'generic.imported',
      runtime: 'unknown',
    });
    await fsExtra.writeJSON(path.join(nodeProjectPath, 'package.json'), {
      name: 'legacy-api',
      version: '1.0.0',
      dependencies: {
        express: '^4.19.2',
      },
    });
    await fsExtra.ensureDir(path.join(nodeProjectPath, 'node_modules', 'express'));

    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        generatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        workspacePath,
        healthScore: {
          total: 5,
          passed: 4,
          warnings: 1,
          errors: 0,
        },
        projects: [
          {
            name: 'legacy-api',
            path: nodeProjectPath,
            issues: [],
          },
        ],
        summary: {
          totalIssues: 0,
        },
        system: {
          python: { status: 'ok', message: 'Python 3.11.0' },
          poetry: { status: 'ok', message: 'Poetry 2.3.2' },
          pipx: { status: 'ok', message: 'pipx 1.8.0' },
          go: { status: 'warn', message: 'Go not installed' },
          rapidkitCore: { status: 'ok', message: 'RapidKit Core 0.3.9' },
        },
      }
    );

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.driftDelta).toBeDefined();
      expect(payload.driftDelta.baselineAvailable).toBe(true);
      expect(payload.cache.evidencePath).toContain('doctor-last-run.json');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should invalidate unknown workspace evidence schema safely and treat baseline as unavailable', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-unknown-schema-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const nodeProjectPath = path.join(workspacePath, 'unknown-schema-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.workspai', 'reports'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(nodeProjectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(nodeProjectPath, '.rapidkit', 'project.json'), {
      name: 'unknown-schema-api',
      kit_name: 'generic.imported',
      runtime: 'unknown',
    });
    await fsExtra.writeJSON(path.join(nodeProjectPath, 'package.json'), {
      name: 'unknown-schema-api',
      version: '1.0.0',
      dependencies: {
        express: '^4.19.2',
      },
    });
    await fsExtra.ensureDir(path.join(nodeProjectPath, 'node_modules', 'express'));

    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        schemaVersion: 'doctor-workspace-evidence-v999',
        evidenceType: 'workspace',
        generatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        workspacePath,
        healthScore: {
          total: 5,
          passed: 5,
          warnings: 0,
          errors: 0,
        },
        projects: [],
        summary: {
          totalIssues: 0,
        },
        system: {
          python: { status: 'ok', message: 'Python 3.11.0' },
          poetry: { status: 'ok', message: 'Poetry 2.3.2' },
          pipx: { status: 'ok', message: 'pipx 1.8.0' },
          go: { status: 'warn', message: 'Go not installed' },
          rapidkitCore: { status: 'ok', message: 'RapidKit Core 0.3.9' },
        },
      }
    );

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.driftDelta).toBeDefined();
      expect(payload.driftDelta.baselineAvailable).toBe(false);
      expect(payload.cache.evidencePath).toContain('doctor-last-run.json');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should emit remediationPlan in workspace json output when plan mode is enabled', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-plan-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const nodeProjectPath = path.join(workspacePath, 'node-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(nodeProjectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(nodeProjectPath, '.rapidkit', 'project.json'), {
      name: 'node-api',
      runtime: 'node',
      framework: 'nestjs',
    });
    await fsExtra.writeJSON(path.join(nodeProjectPath, 'package.json'), {
      name: 'node-api',
      version: '1.0.0',
      dependencies: {
        express: '^4.19.2',
      },
    });
    await fsExtra.writeFile(path.join(nodeProjectPath, '.env.example'), 'PORT=3000\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, json: true, plan: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.remediationPlan).toBeDefined();
      expect(payload.remediationPlan.schemaVersion).toBe('doctor-remediation-plan-v2');
      expect(payload.remediationPlan.totalSteps).toBeGreaterThan(0);
      expect(Array.isArray(payload.remediationPlan.steps)).toBe(true);
      expect(payload.remediationPlan.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            projectName: 'node-api',
            preview: expect.objectContaining({
              title: expect.any(String),
              changes: expect.any(Array),
            }),
            rollback: expect.objectContaining({
              available: expect.any(Boolean),
              strategy: expect.any(String),
            }),
            studioStatus: expect.objectContaining({
              state: expect.any(String),
              reason: expect.any(String),
            }),
            refreshCommands: expect.any(Array),
          }),
        ])
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should use poetry install as the Python venv remediation path', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-python-venv-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'harbor-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'harbor-api',
      kit_name: 'fastapi.standard',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      [
        '[tool.poetry]',
        'name = "harbor-api"',
        'version = "0.1.0"',
        'packages = [{ include = "src" }]',
        '',
        '[tool.poetry.dependencies]',
        'python = "^3.10"',
        'fastapi = "^0.128.0"',
        '',
        '[build-system]',
        'requires = ["poetry-core"]',
        'build-backend = "poetry.core.masonry.api"',
        '',
      ].join('\n'),
      'utf8'
    );
    await fsExtra.ensureDir(path.join(projectPath, 'src'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ json: true, plan: true });

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;

      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      const commands = payload.remediationPlan.steps.map(
        (step: { originalCommand: string }) => step.originalCommand
      );
      expect(commands.some((command: string) => command.includes('poetry install --no-root'))).toBe(
        true
      );
      expect(commands.some((command: string) => command.includes('rapidkit init'))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should preserve an existing external Poetry environment when applying dependency remediation', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-python-apply-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'harbor-api');
    const poetryEnvironmentPath = path.join(tempRoot, 'poetry-env');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'harbor-api',
      kit_name: 'fastapi.standard',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      [
        '[tool.poetry]',
        'name = "harbor-api"',
        'version = "0.1.0"',
        'packages = [{ include = "src" }]',
        '',
        '[tool.poetry.dependencies]',
        'python = "^3.10"',
        'fastapi = "^0.128.0"',
        '',
        '[build-system]',
        'requires = ["poetry-core"]',
        'build-backend = "poetry.core.masonry.api"',
        '',
      ].join('\n'),
      'utf8'
    );
    await fsExtra.ensureDir(path.join(projectPath, 'src'));
    await fsExtra.ensureDir(path.join(poetryEnvironmentPath, 'bin'));
    await fsExtra.writeFile(path.join(poetryEnvironmentPath, 'bin', 'python'), '', 'utf8');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        if (Array.isArray(args) && args.join(' ') === 'env info --path') {
          return { stdout: poetryEnvironmentPath, stderr: '', exitCode: 0 } as any;
        }
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === path.join(poetryEnvironmentPath, 'bin', 'python')) {
        if (Array.isArray(args) && args[0] === '-c' && args[1] === 'import fastapi') {
          return { stdout: '', stderr: 'ModuleNotFoundError', exitCode: 1 } as any;
        }
        if (Array.isArray(args) && args[0] === '-m' && args[1] === 'pip') {
          return { stdout: '[]', stderr: '', exitCode: 0 } as any;
        }
        return { stdout: '', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    const originalAllowGuarded = process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS;

    try {
      process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS = '1';
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ json: true, apply: true });

      const poetryCalls = mockedExeca.mock.calls.filter(([cmd]) => cmd === 'poetry');
      expect(poetryCalls.map(([, args]) => args)).toContainEqual(['install', '--no-root']);
      expect(poetryCalls.map(([, args]) => args)).not.toContainEqual([
        'config',
        'virtualenvs.in-project',
        'true',
        '--local',
      ]);
      expect(
        poetryCalls.some(
          ([, args]) => Array.isArray(args) && args[0] === 'env' && args[1] === 'use'
        )
      ).toBe(false);
      const installCall = poetryCalls.find(([, args]) =>
        Array.isArray(args) ? args[0] === 'install' : false
      );
      expect(installCall?.[2]?.env?.POETRY_VIRTUALENVS_IN_PROJECT).toBeUndefined();
      expect(installCall?.[2]?.env?.POETRY_CACHE_DIR).toBe(
        path.join(fsExtra.realpathSync(projectPath), '.workspai', 'cache', 'python', 'poetry')
      );
    } finally {
      process.chdir(originalCwd);
      if (originalAllowGuarded === undefined) {
        delete process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS;
      } else {
        process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS = originalAllowGuarded;
      }
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should record Python dependency remediation as guidance without guarded opt-in', async () => {
    const tempRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-doctor-python-guidance-')
    );
    const workspacePath = path.join(tempRoot, 'workspace');
    const projectPath = path.join(workspacePath, 'harbor-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });
    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'harbor-api',
      kit_name: 'fastapi.standard',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      [
        '[tool.poetry]',
        'name = "harbor-api"',
        'version = "0.1.0"',
        'packages = [{ include = "src" }]',
        '',
        '[tool.poetry.dependencies]',
        'python = "^3.10"',
        'fastapi = "^0.128.0"',
        '',
        '[build-system]',
        'requires = ["poetry-core"]',
        'build-backend = "poetry.core.masonry.api"',
        '',
      ].join('\n'),
      'utf8'
    );
    await fsExtra.ensureDir(path.join(projectPath, 'src'));

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if ((cmd === 'python3' || cmd === 'python') && args?.[0] === '--version') {
        return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    const originalAllowGuarded = process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS;
    const originalAllowDependencySync = process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_DEPENDENCY_SYNC;

    try {
      delete process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS;
      delete process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_DEPENDENCY_SYNC;
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      const exitCode = await runDoctor({ json: true, apply: true });

      expect(exitCode).toBe(1);
      const poetryCalls = mockedExeca.mock.calls.filter(([cmd]) => cmd === 'poetry');
      expect(poetryCalls.map(([, args]) => args)).not.toContainEqual(['install', '--no-root']);

      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      const payload = JSON.parse(jsonLine as string);
      expect(payload.fixResult.appliedFixes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'dependency-sync',
            outcome: 'guidance',
            projectName: 'harbor-api',
          }),
        ])
      );
    } finally {
      process.chdir(originalCwd);
      if (originalAllowGuarded === undefined) {
        delete process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS;
      } else {
        process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS = originalAllowGuarded;
      }
      if (originalAllowDependencySync === undefined) {
        delete process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_DEPENDENCY_SYNC;
      } else {
        process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_DEPENDENCY_SYNC = originalAllowDependencySync;
      }
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('should apply remediation without prompt when apply mode is enabled', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-apply-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const nodeProjectPath = path.join(workspacePath, 'node-api');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit-workspace'), {
      name: 'workspace',
      version: '1.0',
    });

    await fsExtra.ensureDir(path.join(nodeProjectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(nodeProjectPath, '.rapidkit', 'project.json'), {
      name: 'node-api',
      runtime: 'node',
      framework: 'nestjs',
    });
    await fsExtra.writeJSON(path.join(nodeProjectPath, 'package.json'), {
      name: 'node-api',
      version: '1.0.0',
      dependencies: {
        express: '^4.19.2',
      },
    });
    await fsExtra.writeFile(path.join(nodeProjectPath, '.env.example'), 'PORT=3000\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
          return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx' && args?.[0] === '--version') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.3.9', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'audit') {
        return {
          stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      if (cmd === 'npm' && Array.isArray(args) && (args[0] === 'install' || args[0] === 'ci')) {
        return {
          stdout: 'dependencies installed',
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ workspace: true, apply: true });

      expect(promptMock).not.toHaveBeenCalled();
      expect(mockedExeca.mock.calls.length).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('continues past an old Python candidate and reads py -3 version output from stderr', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python' && args?.[0] === '--version') {
        return { stdout: '', stderr: 'Python 3.8.10', exitCode: 0 } as any;
      }
      if (cmd === 'py' && args?.[0] === '-3' && args?.[1] === '--version') {
        return { stdout: '', stderr: 'Python 3.12.4', exitCode: 0 } as any;
      }
      if (cmd === 'poetry' && args?.[0] === '--version') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 windows/amd64', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: 'not found', exitCode: 1 } as any;
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      expect(JSON.parse(jsonLine).system.python).toMatchObject({
        status: 'ok',
        message: 'Python 3.12.4',
        details: 'Using py -3',
      });
      expect(mockedExeca).toHaveBeenCalledWith(
        'py',
        ['-3', '--version'],
        expect.objectContaining({ reject: false })
      );
    } finally {
      logSpy.mockRestore();
      platformSpy.mockRestore();
    }
  });

  it('uses interpreter pip metadata for a Windows-layout project venv', async () => {
    const tempRoot = await fsExtra.realpath(
      await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-win-venv-'))
    );
    const interpreter = path.join(tempRoot, '.venv', 'Scripts', 'python.exe');
    await fsExtra.ensureDir(path.dirname(interpreter));
    await fsExtra.writeFile(interpreter, '', 'utf8');
    await fsExtra.ensureDir(path.join(tempRoot, '.rapidkit'));
    await fsExtra.writeJSON(path.join(tempRoot, '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(path.join(tempRoot, 'pyproject.toml'), '[project]\nname = "api"\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'py' && args?.[0] === '-3' && args?.[1] === '--version') {
        return { stdout: 'Python 3.12.4', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === interpreter && args?.[0] === '-m' && args?.[1] === 'pip') {
        return {
          stdout: '[{"name":"fastapi","version":"0.115.0"}]',
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 1 } as any;
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      const payload = JSON.parse(jsonLine);
      expect(payload.project.venvActive).toBe(true);
      expect(payload.project.depsInstalled).toBe(true);
      expect(payload.project.issues).not.toContain('Dependencies not installed');
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('resolves a Poetry project environment through the user-local executable fallback', async () => {
    const tempRoot = await fsExtra.realpath(
      await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-poetry-fallback-'))
    );
    const fakeHome = path.join(tempRoot, 'home');
    const projectPath = path.join(tempRoot, 'api');
    const environmentPath = path.join(tempRoot, 'poetry-environment');
    const poetryExecutable = path.join(
      fakeHome,
      '.local',
      'bin',
      process.platform === 'win32' ? 'poetry.exe' : 'poetry'
    );
    const interpreterCandidates = [
      path.join(environmentPath, 'bin', 'python'),
      path.join(environmentPath, 'Scripts', 'python.exe'),
    ];
    await fsExtra.outputFile(poetryExecutable, 'poetry', 'utf8');
    await Promise.all(
      interpreterCandidates.map((interpreter) => fsExtra.outputFile(interpreter, '', 'utf8'))
    );
    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.writeJSON(path.join(projectPath, '.workspai', 'project.json'), {
      name: 'api',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      '[tool.poetry]\nname = "api"\nversion = "0.1.0"\n'
    );

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === poetryExecutable && args?.join(' ') === 'env info --path') {
        return { stdout: environmentPath, stderr: '', exitCode: 0 } as any;
      }
      if (interpreterCandidates.includes(cmd) && args?.[0] === '-c') {
        return {
          stdout: '',
          stderr: '',
          exitCode: String(args?.[1] ?? '').includes('import fastapi') ? 0 : 1,
        } as any;
      }
      if (cmd === 'python3' && args?.[0] === '--version') {
        return { stdout: 'Python 3.12.0', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: 'not found', exitCode: 1 } as any;
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;

    try {
      process.env.HOME = fakeHome;
      process.env.USERPROFILE = fakeHome;
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      const payload = JSON.parse(jsonLine);
      expect(payload.project.venvActive).toBe(true);
      expect(payload.project.depsInstalled).toBe(true);
      expect(payload.project.issues).not.toContain('Virtual environment not created');
      expect(mockedExeca).toHaveBeenCalledWith(
        poetryExecutable,
        ['env', 'info', '--path'],
        expect.objectContaining({ cwd: projectPath, reject: false })
      );
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('publishes a local venv materialization transaction for standard Python projects', async () => {
    const tempRoot = await fsExtra.realpath(
      await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-python-venv-'))
    );
    await fsExtra.ensureDir(path.join(tempRoot, '.workspai'));
    await fsExtra.writeJSON(path.join(tempRoot, '.workspai', 'project.json'), {
      name: 'catalog-api',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(path.join(tempRoot, 'requirements.txt'), 'fastapi>=0.116\n');
    await fsExtra.outputFile(path.join(tempRoot, 'src', '__init__.py'), '');
    const expectedVenvInvocation =
      process.platform === 'win32'
        ? {
            command: 'py -3 -m venv .venv',
            executable: 'py',
            args: ['-3', '-m', 'venv', '.venv'],
          }
        : {
            command: 'python3 -m venv .venv',
            executable: 'python3',
            args: ['-m', 'venv', '.venv'],
          };

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' && args?.[0] === '--version') {
        return { stdout: 'Python 3.12.0', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: 'not found', exitCode: 1 } as any;
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      const project = JSON.parse(jsonLine).project;
      expect(project.issues).toContain('Virtual environment not created');
      expect(project.repairCapabilities).toContainEqual(
        expect.objectContaining({
          id: 'runtime-dependency-materialization.dependency-materialization',
          command: expect.stringContaining(expectedVenvInvocation.command),
          invocation: expect.objectContaining({
            cwd: tempRoot,
            executable: expectedVenvInvocation.executable,
            args: expectedVenvInvocation.args,
          }),
          transaction: expect.objectContaining({
            kind: 'dependency-materialization',
            ecosystem: 'python',
            requiredStages: ['reconcile', 'test', 'build'],
          }),
        })
      );
      expect(project.repairCapabilities).not.toContainEqual(
        expect.objectContaining({ command: expect.stringContaining('poetry install') })
      );
      expect(project.diagnosis.findings).toContainEqual(
        expect.objectContaining({
          status: 'blocking',
          issueClass: 'dependency',
          repair: expect.objectContaining({
            capabilityId: 'runtime-dependency-materialization.dependency-materialization',
            disposition: 'approval-required',
          }),
        })
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('publishes a typed materialization transaction when a Node dependency tree is missing', async () => {
    const tempRoot = await fsExtra.realpath(
      await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-node-materialization-'))
    );
    await fsExtra.ensureDir(path.join(tempRoot, '.workspai'));
    await fsExtra.writeJSON(path.join(tempRoot, '.workspai', 'project.json'), {
      name: 'catalog-api',
      runtime: 'node',
      framework: 'nestjs',
    });
    await fsExtra.writeJSON(path.join(tempRoot, 'package.json'), {
      name: 'catalog-api',
      packageManager: 'npm@11.5.1',
      scripts: { test: 'vitest run', build: 'tsc --noEmit' },
      dependencies: { '@nestjs/core': '^11.0.0' },
    });
    await fsExtra.writeJSON(path.join(tempRoot, 'package-lock.json'), {
      name: 'catalog-api',
      lockfileVersion: 3,
      packages: {},
    });

    mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      const project = JSON.parse(jsonLine).project;
      expect(project.issues).toContain(
        'Dependencies not installed (node_modules empty or missing)'
      );
      expect(project.repairCapabilities).toContainEqual(
        expect.objectContaining({
          id: 'runtime-dependency-materialization.dependency-materialization',
          fixKind: 'dependency-sync',
          command: expect.stringContaining('npm install'),
          invocation: expect.objectContaining({ executable: 'npm', args: ['install'] }),
          transaction: expect.objectContaining({
            kind: 'dependency-materialization',
            sourceMutationRequired: false,
            observableState: 'runtime-dependency-tree',
            requiredStages: ['reconcile', 'test', 'build'],
          }),
        })
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('does not claim global Core or print internal repair tokens in human output', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-human-'));
    await fsExtra.ensureDir(path.join(tempRoot, '.rapidkit'));
    await fsExtra.writeJSON(path.join(tempRoot, '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(tempRoot, 'pyproject.toml'),
      '[tool.poetry]\nname = "api"\nversion = "0.1.0"\n'
    );
    await fsExtra.writeFile(path.join(tempRoot, 'Dockerfile'), 'FROM python:3.12\n');

    mockedExeca.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'python3' && args?.[0] === '--version') {
        return { stdout: 'Python 3.12.4', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: 'not found', exitCode: 1 } as any;
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true });
      const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(output).toContain('RapidKit Core: Not detected locally or globally');
      expect(output).not.toContain('Using global installation');
      expect(output).not.toContain('rapidkit:doctor:repair');
      expect(output).not.toMatch(/^\s*\$\s/m);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });

  it('keeps Electron projects in the desktop taxonomy instead of applying Vite frontend gates', async () => {
    const tempRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-electron-'));
    await fsExtra.ensureDir(path.join(tempRoot, '.workspai'));
    await fsExtra.writeJSON(path.join(tempRoot, '.workspai', 'project.json'), {
      name: 'desktop-app',
      runtime: 'node',
      framework: 'electron',
      kit_name: 'desktop.electron',
      kind: 'desktop',
    });
    await fsExtra.writeJSON(path.join(tempRoot, 'package.json'), {
      name: 'desktop-app',
      version: '1.0.0',
      main: '.vite/build/main.js',
      scripts: {
        start: 'electron-forge start',
        package: 'electron-forge package',
        make: 'electron-forge make',
        lint: 'eslint .',
      },
      devDependencies: {
        '@electron-forge/cli': '^7.0.0',
        '@electron-forge/plugin-vite': '^7.0.0',
        electron: '^40.0.0',
        vite: '^7.0.0',
      },
    });
    await fsExtra.writeFile(path.join(tempRoot, 'package-lock.json'), '{}\n');
    await fsExtra.ensureDir(path.join(tempRoot, 'node_modules', 'electron'));
    await fsExtra.ensureDir(path.join(tempRoot, 'src'));
    await fsExtra.writeFile(path.join(tempRoot, 'src', 'main.ts'), 'export {};\n');

    mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({ project: true, json: true });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string;
      const payload = JSON.parse(jsonLine);
      expect(payload.project).toMatchObject({
        framework: 'Electron',
        frameworkKey: 'electron',
        runtimeFamily: 'node',
        projectKind: 'desktop',
      });
      expect(payload.project.probes.map((probe: { id: string }) => probe.id)).not.toEqual(
        expect.arrayContaining(['frontend-vite-config', 'frontend-script-dev'])
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      await fsExtra.remove(tempRoot);
    }
  });
});
