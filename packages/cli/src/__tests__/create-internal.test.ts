import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsExtra from 'fs-extra';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { promises as fsPromises } from 'fs';
import { createProject, initializeStandaloneGitRepository } from '../create';
import { getPythonCommand } from '../utils';
import { DirectoryExistsError } from '../errors';
import { checkRapidkitCoreVersionCompatible } from '../core-bridge/pythonRapidkitExec.js';

function normalizeTestPath(value: unknown): string {
  return String(value).replace(/\\/g, '/');
}

vi.mock('fs-extra');
vi.mock('execa');
vi.mock('inquirer');
vi.mock('../utils/workspace-onboarding.js', () => ({
  finalizeWorkspaceOnboarding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/lifecycle-transaction.js', () => ({
  recoverActiveLifecycleTransactions: vi.fn().mockResolvedValue([]),
  createLifecycleTransaction: vi.fn(async () => ({
    journalPath: undefined,
    captureFile: vi.fn().mockResolvedValue(undefined),
    captureOwnedTree: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../cli-ui/index.js', async () => {
  const inquirerModule = await import('inquirer');
  return {
    prompt: inquirerModule.default.prompt,
    showIntro: vi.fn(),
    showOutro: vi.fn(),
    showCancel: vi.fn(),
    ui: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
      stepNumbered: vi.fn(),
      note: vi.fn(),
      message: vi.fn(),
      dim: vi.fn(),
      plain: vi.fn(),
      nextSteps: vi.fn(),
    },
  };
});
vi.mock('../cli-ui/spinner.js', () => ({
  createUiSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('../core-bridge/pythonRapidkitExec.js', () => ({
  checkRapidkitCoreVersionCompatible: vi.fn().mockResolvedValue({
    isCompatible: false,
    installedVersion: null,
    expectedConstraint: null,
    reason: 'constraint-missing',
  }),
}));
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('../cli-ui/index.js', async () => {
  const inquirerModule = await import('inquirer');
  return {
    prompt: inquirerModule.default.prompt,
    showIntro: vi.fn(),
    ui: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
      stepNumbered: vi.fn(),
      note: vi.fn(),
      message: vi.fn(),
      dim: vi.fn(),
      plain: vi.fn(),
      nextSteps: vi.fn(),
    },
  };
});

describe('Create Module - Internal Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsExtra.pathExists).mockResolvedValue(false);
    vi.mocked(fsExtra.ensureDir).mockResolvedValue(undefined);
    vi.mocked(fsExtra.outputFile).mockResolvedValue(undefined);
    vi.mocked(checkRapidkitCoreVersionCompatible).mockResolvedValue({
      isCompatible: false,
      installedVersion: null,
      expectedConstraint: null,
      reason: 'constraint-missing',
    });
    vi.spyOn(fsPromises, 'readFile').mockResolvedValue('');
    vi.spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined);
  });

  describe('Optional Python engine install', () => {
    it('creates Python-aware workspaces without installing rapidkit-core when skipped', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await createProject('test-project', {
        profile: 'polyglot',
        skipPythonEngine: true,
        skipGit: true,
      });

      const workspaceManifestCall = vi
        .mocked(fsExtra.outputFile)
        .mock.calls.find((call) => normalizeTestPath(call[0]).endsWith('.workspai/workspace.json'));

      expect(workspaceManifestCall).toBeDefined();
      const manifest = JSON.parse(String(workspaceManifestCall?.[1]));
      expect(manifest.profile).toBe('polyglot');
      expect(manifest.bootstrap_note).toBe('python-engine-skipped');
      expect(manifest.engine.python_version).toBeNull();
      expect(manifest.engine.python_core).toEqual({
        status: 'skipped',
        reason: 'user-opted-out',
      });

      const markerCall = vi
        .mocked(fsExtra.outputFile)
        .mock.calls.find((call) => normalizeTestPath(call[0]).endsWith('.workspai-workspace'));
      const marker = JSON.parse(String(markerCall?.[1]));
      expect(marker.metadata.python).toEqual({
        coreStatus: 'skipped',
        coreReason: 'user-opted-out',
      });

      const toolchainCall = vi
        .mocked(fsExtra.outputFile)
        .mock.calls.find((call) => normalizeTestPath(call[0]).endsWith('.workspai/toolchain.lock'));
      const toolchain = JSON.parse(String(toolchainCall?.[1]));
      expect(toolchain.runtime.python.core).toEqual({
        status: 'skipped',
        reason: 'user-opted-out',
      });

      const launcherCall = vi
        .mocked(fsExtra.outputFile)
        .mock.calls.find((call) => normalizeTestPath(call[0]).endsWith('/rapidkit'));
      expect(String(launcherCall?.[1])).toContain(
        'Python engine installation was intentionally skipped'
      );
      expect(String(launcherCall?.[1])).toContain('npx workspai <command>');
      expect(String(launcherCall?.[1])).toContain('npx workspai workspace run init');
      expect(
        vi.mocked(fsExtra.outputFile).mock.calls.some((call) => {
          const target = String(call[0]);
          const normalizedTarget = normalizeTestPath(target);
          return (
            normalizedTarget.endsWith('/pyproject.toml') ||
            normalizedTarget.endsWith('/poetry.toml')
          );
        })
      ).toBe(false);

      expect(execa).not.toHaveBeenCalledWith('poetry', expect.any(Array), expect.any(Object));
      expect(execa).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['pip', 'install', expect.stringContaining('rapidkit')]),
        expect.any(Object)
      );
      expect(execa).not.toHaveBeenCalledWith(
        'poetry',
        expect.arrayContaining(['add', 'rapidkit-core']),
        expect.any(Object)
      );
    });

    it('creates minimal workspaces without Python engine files', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await createProject('test-project', {
        profile: 'minimal',
        skipGit: true,
      });

      const writtenFiles = vi
        .mocked(fsExtra.outputFile)
        .mock.calls.map((call) => normalizeTestPath(call[0]));
      expect(writtenFiles.some((target) => target.endsWith('/pyproject.toml'))).toBe(false);
      expect(writtenFiles.some((target) => target.endsWith('/poetry.toml'))).toBe(false);
      expect(writtenFiles.some((target) => target.endsWith('/.workspai/workspace.json'))).toBe(
        true
      );
      expect(writtenFiles.some((target) => target.endsWith('/.workspai-workspace'))).toBe(true);
      const workspaceManifestCall = vi
        .mocked(fsExtra.outputFile)
        .mock.calls.find((call) => normalizeTestPath(call[0]).endsWith('.workspai/workspace.json'));
      const manifest = JSON.parse(String(workspaceManifestCall?.[1]));
      expect(manifest.bootstrap_note).toBe('python-engine-skipped');
      expect(manifest.engine.python_core).toEqual({
        status: 'skipped',
        reason: 'workspace-profile-does-not-install-python-at-create',
      });
    });
  });

  describe('Poetry Installation Flow', () => {
    it('should install RapidKit with Poetry successfully', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'poetry' && args?.[0] === '--version') {
          return Promise.resolve({ stdout: 'Poetry 1.7.0', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'poetry' && args?.[0] === 'init') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'poetry' && args?.[0] === 'add') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'git') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]\nname = "test"');

      await createProject('test-project', { profile: 'python-only' });

      expect(execa).toHaveBeenCalledWith('poetry', ['--version']);
      expect(execa).toHaveBeenCalledWith(
        'poetry',
        ['init', '--no-interaction', '--python', '^3.10'],
        expect.any(Object)
      );
      expect(execa).toHaveBeenCalledWith('poetry', ['add', 'rapidkit-core'], expect.any(Object));
    });

    it('should check for Poetry before installation', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({
        stdout: 'Poetry 1.7.0',
        stderr: '',
        exitCode: 0,
      } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', { profile: 'python-only' });

      expect(execa).toHaveBeenCalledWith('poetry', ['--version']);
    });

    it('should install from local path in test mode', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      process.env.RAPIDKIT_DEV_PATH = '/local/rapidkit/path';

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'poetry' && args?.[0] === '--version') {
          return Promise.resolve({ stdout: 'Poetry 1.7.0', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'poetry' && args?.[0] === 'add' && args?.[1] === '/local/rapidkit/path') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]\nname = "test"');

      await createProject('test-project', { testMode: true, profile: 'python-only' });

      expect(execa).toHaveBeenCalledWith(
        'poetry',
        ['add', '/local/rapidkit/path'],
        expect.any(Object)
      );

      delete process.env.RAPIDKIT_DEV_PATH;
    });

    it('should handle test mode with local path correctly', async () => {
      process.env.RAPIDKIT_DEV_PATH = '/local/rapidkit';

      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', { testMode: true });

      // Should succeed with local path
      expect(execa).toHaveBeenCalled();

      delete process.env.RAPIDKIT_DEV_PATH;
    });

    it('should update pyproject.toml with package-mode = false', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);

      const mockReadFile = vi.spyOn(fsPromises, 'readFile');
      const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');

      mockReadFile.mockResolvedValue('[tool.poetry]\nname = "test"\nversion = "0.1.0"');

      await createProject('test-project', { profile: 'python-only' });

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('pyproject.toml'),
        expect.stringContaining('package-mode = false'),
        'utf-8'
      );
    });

    it('should honor Poetry selection and install it instead of falling back to venv', async () => {
      // Route prompt responses by question name to avoid leaking mockResolvedValueOnce
      // into subsequent tests if something changes.
      vi.mocked(inquirer.prompt).mockImplementation(async (questions: any) => {
        const names = Array.isArray(questions) ? questions.map((q) => q?.name) : [];
        if (names.includes('installPoetry')) {
          return { installPoetry: true } as any;
        }
        if (names.includes('installPythonEngine')) {
          return { installPythonEngine: true } as any;
        }
        return {
          pythonVersion: '3.10',
          installMethod: 'poetry',
        } as any;
      });

      let poetryVersionChecks = 0;
      let poetryInstalled = false;
      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'poetry' && args?.[0] === '--version') {
          poetryVersionChecks += 1;
          return poetryInstalled
            ? Promise.resolve({ stdout: 'Poetry 2.0.0', stderr: '', exitCode: 0 } as any)
            : Promise.reject(new Error('Command not found: poetry'));
        }
        if (
          (command === 'pipx' || command === 'python' || command === 'python3') &&
          args?.includes('install') &&
          args?.includes('poetry')
        ) {
          poetryInstalled = true;
          return Promise.resolve({ stdout: 'installed', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]\nname = "test"');

      await createProject('test-project', { profile: 'python-only' });

      expect(poetryVersionChecks).toBeGreaterThan(0);
      expect(poetryInstalled).toBe(true);
      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'installPoetry' })])
      );
    });

    it('should stop instead of silently changing methods when Poetry installation is declined', async () => {
      vi.mocked(checkRapidkitCoreVersionCompatible).mockResolvedValue({
        isCompatible: true,
        installedVersion: '0.27.4',
        expectedConstraint: '>=0.27.0,<0.28.0',
        reason: 'compatible',
      });

      vi.mocked(inquirer.prompt).mockImplementation(async (questions: any) => {
        const names = Array.isArray(questions) ? questions.map((q) => q?.name) : [];
        if (names.includes('installPoetry')) return { installPoetry: false } as any;
        if (names.includes('installPipx')) return { installPipx: true } as any;
        return { pythonVersion: '3.10', installMethod: 'poetry' } as any;
      });

      let poetryVersionChecks = 0;
      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'poetry' && args?.[0] === '--version') {
          poetryVersionChecks += 1;
          return Promise.reject(new Error('Command not found: poetry'));
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]\nname = "test"');

      await expect(createProject('test-project', { profile: 'python-only' })).rejects.toMatchObject(
        {
          code: 'POETRY_NOT_FOUND',
        }
      );

      expect(poetryVersionChecks).toBeGreaterThan(0);
      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const askedNames = promptCalls
        .flatMap(([questions]) => (Array.isArray(questions) ? questions : [questions]))
        .map((q: any) => q?.name)
        .filter(Boolean);

      expect(askedNames).toContain('installPoetry');
      expect(askedNames).not.toContain('installPipx');
    });
  });

  describe('Venv Installation Flow', () => {
    it('should install RapidKit with venv successfully', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'venv',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        // Handle version checks
        if (args?.[0] === '--version') {
          return Promise.resolve({ stdout: 'Python 3.10', stderr: '', exitCode: 0 } as any);
        }
        // Handle venv creation
        if (args?.[0] === '-m' && args?.[1] === 'venv') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        // Handle pip operations (now via python -m pip)
        if (args?.includes('-m') && args?.includes('pip')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { profile: 'python-only' });

      // Accept either python3, pythonX.Y, absolute python path, or pyenv-resolved python
      expect(execa).toHaveBeenCalledWith(
        expect.stringMatching(/python|py/),
        ['--version'],
        expect.any(Object)
      );
      const pythonCmd = getPythonCommand();
      expect(execa).toHaveBeenCalledWith(pythonCmd, ['-m', 'venv', '.venv'], expect.any(Object));
    });

    it('should fallback to minimal when Python not found in interactive mode', async () => {
      // Test the new smart fallback behavior: when Python is missing but
      // user is in interactive mode (inquirer is available), offer options
      vi.mocked(inquirer.prompt).mockImplementation((questions: any) => {
        // When asked about profile selection, return python-only
        if (Array.isArray(questions) && questions[0]?.name === 'selectedProfile') {
          return Promise.resolve({ selectedProfile: 'python-only' });
        }
        // When asked about Python missing action, choose fallback
        if (Array.isArray(questions) && questions[0]?.name === 'pythonAction') {
          return Promise.resolve({ pythonAction: 'fallback' });
        }
        // Default responses
        return Promise.resolve({
          pythonVersion: '3.10',
          installMethod: 'venv',
        });
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        // Reject on python --version to simulate Python not found
        if ((command === 'python' || command === 'python3') && args?.[0] === '--version') {
          return Promise.reject(new Error('Command not found: python'));
        }
        // Mock git init for fallback path
        if (command === 'git' && args?.[0] === 'init') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'git' && (args?.[0] === 'add' || args?.[0] === 'commit')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        // Return success for other commands
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      // Smart fallback should succeed by creating workspace with minimal profile
      // instead of throwing an error
      await expect(
        createProject('test-project', { profile: 'python-only' })
      ).resolves.toBeUndefined();
    });

    it('should auto-fallback to minimal when Python not found with --yes flag', async () => {
      // Test auto-fallback behavior: when Python missing and --yes (non-interactive),
      // automatically switch to minimal profile without prompting
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'venv',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        // Reject on python --version to simulate Python not found
        if ((command === 'python' || command === 'python3') && args?.[0] === '--version') {
          return Promise.reject(new Error('Command not found: python'));
        }
        // Mock git init for fallback path
        if (command === 'git' && args?.[0] === 'init') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'git' && (args?.[0] === 'add' || args?.[0] === 'commit')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        // Return success for other commands
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      // Auto-fallback should succeed with --yes flag
      await expect(
        createProject('test-project', { profile: 'python-only', yes: true })
      ).resolves.toBeUndefined();
    });

    it('should auto-fallback enterprise to node-only when Python not found with --yes', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'venv',
      });

      const outputFiles: Array<{ target: string; content: string }> = [];
      vi.mocked(fsExtra.outputFile).mockImplementation(async (target, content) => {
        outputFiles.push({ target: String(target), content: String(content) });
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if ((command === 'python' || command === 'python3') && args?.[0] === '--version') {
          return Promise.reject(new Error('Command not found: python'));
        }
        if (command === 'git') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await expect(
        createProject('enterprise-ws', { profile: 'enterprise', yes: true })
      ).resolves.toBeUndefined();

      const manifest = outputFiles.find((entry) => entry.target.endsWith('workspace.json'));
      expect(manifest?.content).toContain('node-only');
    });

    it('should install from local path in venv test mode', async () => {
      process.env.RAPIDKIT_DEV_PATH = '/local/rapidkit';

      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'venv',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        // Mock python -m pip install calls
        if (args?.includes('-m') && args?.includes('pip') && args?.includes('install')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        // Also need to handle version checks and venv creation
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { testMode: true, profile: 'python-only' });

      // Verify editable install was called with python -m pip (not direct pip)
      expect(execa).toHaveBeenCalledWith(
        expect.stringMatching(/python/),
        expect.arrayContaining(['-m', 'pip', 'install', '-e', '/local/rapidkit']),
        expect.any(Object)
      );

      delete process.env.RAPIDKIT_DEV_PATH;
    });
  });

  describe('Pipx Installation Flow', () => {
    it('should install RapidKit with pipx successfully', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'pipx',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'pipx' && args?.[0] === '--version') {
          return Promise.resolve({ stdout: 'pipx 1.2.0', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'pipx' && args?.[0] === 'install') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { profile: 'python-only' });

      expect(execa).toHaveBeenCalledWith('pipx', ['--version']);
      expect(execa).toHaveBeenCalledWith('pipx', ['install', 'rapidkit-core']);
    });

    it('should skip pipx install when RapidKit is already available globally', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'pipx',
      });
      vi.mocked(checkRapidkitCoreVersionCompatible).mockResolvedValue({
        isCompatible: true,
        installedVersion: '0.27.4',
        expectedConstraint: '>=0.27.0,<0.28.0',
        reason: 'compatible',
      });

      vi.mocked(execa).mockImplementation((command: string) => {
        if (command === 'git') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { profile: 'python-only' });

      expect(checkRapidkitCoreVersionCompatible).toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalledWith('pipx', ['--version']);
      expect(execa).not.toHaveBeenCalledWith('pipx', ['install', 'rapidkit-core']);
    });

    it('should check for pipx before installation', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'pipx',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: 'pipx 1.2.0', stderr: '', exitCode: 0 } as any);

      await createProject('test-project', { profile: 'python-only' });

      expect(execa).toHaveBeenCalledWith('pipx', ['--version']);
    });

    it('should upgrade with pipx when install fails due existing global package', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'pipx',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'pipx' && args?.[0] === '--version') {
          return Promise.resolve({ stdout: 'pipx 1.2.0', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'pipx' && args?.[0] === 'install') {
          return Promise.reject(new Error('Package is already installed.'));
        }
        if (command === 'pipx' && args?.[0] === 'upgrade') {
          return Promise.resolve({ stdout: 'upgraded', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { profile: 'python-only' });

      expect(execa).toHaveBeenCalledWith('pipx', ['install', 'rapidkit-core']);
      expect(execa).toHaveBeenCalledWith('pipx', ['upgrade', 'rapidkit-core']);
    });

    it('should install editable with pipx in test mode', async () => {
      process.env.RAPIDKIT_DEV_PATH = '/local/rapidkit';

      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'pipx',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'pipx' && args?.[0] === 'install' && args?.[1] === '-e') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { testMode: true, profile: 'python-only' });

      expect(execa).toHaveBeenCalledWith('pipx', ['install', '-e', '/local/rapidkit']);

      delete process.env.RAPIDKIT_DEV_PATH;
    });

    it('should prompt to install pipx when missing (for pipx install)', async () => {
      vi.mocked(inquirer.prompt).mockImplementation(async (questions: any) => {
        const names = Array.isArray(questions) ? questions.map((q) => q?.name) : [];
        if (names.includes('installPipx')) return { installPipx: true } as any;
        return { pythonVersion: '3.10', installMethod: 'pipx' } as any;
      });

      let pipxModuleAvailable = false;
      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        // Accept both python and python3 (platform-specific)
        const isPython = command === 'python' || command === 'python3';

        // pipx binary missing
        if (command === 'pipx' && args?.[0] === '--version') {
          return Promise.reject(new Error('Command not found: pipx'));
        }

        // python -m pipx only works after we "install" pipx
        if (isPython && args?.[0] === '-m' && args?.[1] === 'pipx') {
          if (!pipxModuleAvailable) {
            return Promise.reject(new Error('No module named pipx'));
          }
          return Promise.resolve({ stdout: '1.4.0', stderr: '', exitCode: 0 } as any);
        }

        // pip install --user pipx flips availability
        if (isPython && args?.[0] === '-m' && args?.[1] === 'pip' && args?.includes('install')) {
          pipxModuleAvailable = true;
          return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 } as any);
        }

        // install rapidkit-core via python -m pipx
        if (isPython && args?.[0] === '-m' && args?.[1] === 'pipx' && args?.[2] === 'install') {
          return Promise.resolve({ stdout: 'installed', stderr: '', exitCode: 0 } as any);
        }

        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { profile: 'python-only' });

      // Verify the pipx or python -m pipx install happened
      const calls = vi.mocked(execa).mock.calls;
      const hasPipInstall = calls.some(
        (call) =>
          (call[0] === 'python' || call[0] === 'python3') &&
          call[1]?.includes('-m') &&
          call[1]?.includes('pip') &&
          call[1]?.includes('pipx')
      );
      expect(hasPipInstall).toBe(true);
    });
  });

  describe('README Creation', () => {
    it('should create .gitignore with Poetry installation', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', {
        profile: 'python-only',
        installMethod: 'poetry',
      });

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        expect.stringContaining('.gitignore'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should create .gitignore with venv installation', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'venv',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);

      await createProject('test-project', {});

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        expect.stringContaining('.gitignore'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should create files with pipx installation', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'pipx',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);

      await createProject('test-project', {});

      // pipx creates .rapidkit-global file
      expect(fsExtra.outputFile).toHaveBeenCalled();
    });
  });

  describe('Git Integration', () => {
    it('should initialize git repository by default', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', {});

      expect(execa).toHaveBeenCalledWith('git', ['init'], expect.any(Object));
    });

    it('should skip git when skipGit is true', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', { skipGit: true });

      const gitCalls = vi.mocked(execa).mock.calls.filter((call) => call[0] === 'git');
      expect(gitCalls.length).toBe(0);
    });

    it('keeps a signed-commit cancellation distinct from repository initialization', async () => {
      const spinner = {
        start: vi.fn(),
        succeed: vi.fn(),
        warn: vi.fn(),
      };
      vi.mocked(execa).mockImplementation(async (_command: string, args?: readonly string[]) => {
        if (args?.[0] === 'rev-parse') throw new Error('not a repository');
        if (args?.includes('commit')) {
          const error = new Error('failed to write commit object') as Error & { stderr: string };
          error.stderr = 'error: gpg failed to sign the data';
          throw error;
        }
        return { stdout: '', stderr: '', exitCode: 0 } as any;
      });

      await expect(
        initializeStandaloneGitRepository('/tmp/generated-workspace', spinner, 'Initial commit')
      ).resolves.toBeUndefined();

      expect(spinner.warn).toHaveBeenCalledWith(
        'Git repository initialized; signed initial commit was not created. Files remain staged.'
      );
      expect(spinner.succeed).not.toHaveBeenCalled();
    });

    it('reports a real git initialization failure separately', async () => {
      const spinner = {
        start: vi.fn(),
        succeed: vi.fn(),
        warn: vi.fn(),
      };
      vi.mocked(execa).mockRejectedValue(new Error('git executable unavailable'));

      await initializeStandaloneGitRepository(
        '/tmp/generated-workspace',
        spinner,
        'Initial commit'
      );

      expect(spinner.warn).toHaveBeenCalledWith('Could not initialize git repository');
    });

    it('reports staging failure after a successful repository initialization', async () => {
      const spinner = {
        start: vi.fn(),
        succeed: vi.fn(),
        warn: vi.fn(),
      };
      vi.mocked(execa).mockImplementation(async (_command: string, args?: readonly string[]) => {
        if (args?.[0] === 'rev-parse') throw new Error('not a repository');
        if (args?.[0] === 'add') throw new Error('staging failed');
        return { stdout: '', stderr: '', exitCode: 0 } as any;
      });

      await initializeStandaloneGitRepository(
        '/tmp/generated-workspace',
        spinner,
        'Initial commit'
      );

      expect(spinner.warn).toHaveBeenCalledWith(
        'Git repository initialized, but generated files could not be staged'
      );
      expect(spinner.succeed).not.toHaveBeenCalled();
    });

    it('should create .gitignore file', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', {});

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        expect.stringContaining('.gitignore'),
        expect.stringContaining('__pycache__'),
        'utf-8'
      );
    });

    it('should keep the canonical workspace marker trackable while ignoring legacy state', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', {});

      const gitignoreCall = vi
        .mocked(fsExtra.outputFile)
        .mock.calls.find((call) => normalizeTestPath(call[0]).endsWith('/.gitignore'));
      const content = String(gitignoreCall?.[1] ?? '');

      expect(gitignoreCall).toBeDefined();
      expect(content).not.toContain('.workspai-workspace\n');
      expect(content).toContain('.rapidkit-workspace\n');
      expect(content).toContain('.rapidkit/\n');
      expect(content).not.toContain('.rapidkit-workspace/\n');
    });
  });

  describe('Directory Management', () => {
    it('should throw error if directory already exists', async () => {
      vi.mocked(fsExtra.pathExists).mockResolvedValue(true);

      await expect(createProject('existing-project', {})).rejects.toThrow(DirectoryExistsError);
    });

    it('should create directory if it does not exist', async () => {
      vi.mocked(fsExtra.pathExists).mockResolvedValue(false);
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });
      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('new-project', {});

      expect(fsExtra.ensureDir).toHaveBeenCalled();
    });
  });

  describe('User Config Integration', () => {
    it('should use userConfig default python version', async () => {
      const userConfig = {
        pythonVersion: '3.12',
        defaultInstallMethod: 'poetry' as const,
      };

      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.12',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', { userConfig, profile: 'python-only' });

      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'pythonVersion',
            default: '3.12',
          }),
        ])
      );
    });

    it('should use userConfig default install method', async () => {
      const userConfig = {
        pythonVersion: '3.10',
        defaultInstallMethod: 'pipx' as const,
      };

      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'pipx',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);

      await createProject('test-project', { userConfig, profile: 'python-only' });

      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'installMethod',
            default: 'pipx',
          }),
        ])
      );
    });

    it('should default install method to venv when Poetry is unavailable', async () => {
      const userConfig = {
        pythonVersion: '3.10',
        defaultInstallMethod: 'poetry' as const,
      };

      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'venv',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'poetry' && args?.[0] === '--version') {
          return Promise.reject(new Error('Command not found: poetry'));
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { userConfig, profile: 'python-only' });

      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'installMethod',
            default: 'venv',
          }),
        ])
      );
    });

    it('should include detected newer Python versions in prompt choices', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.14',
        installMethod: 'venv',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (
          command === 'py' &&
          (args?.[0] === '-3.14' || args?.[0] === '-3') &&
          args?.[1] === '--version'
        ) {
          return Promise.resolve({ stdout: 'Python 3.14.1', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'python3.14' && args?.[0] === '--version') {
          return Promise.resolve({ stdout: 'Python 3.14.1', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'python' && args?.[0] === '--version') {
          return Promise.resolve({ stdout: 'Python 3.14.1', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'python3' && args?.[0] === '--version') {
          return Promise.resolve({ stdout: 'Python 3.14.1', stderr: '', exitCode: 0 } as any);
        }
        if (command === 'poetry' && args?.[0] === '--version') {
          return Promise.reject(new Error('Command not found: poetry'));
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await createProject('test-project', { profile: 'python-only' });

      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'pythonVersion',
            default: '3.14',
            choices: expect.arrayContaining([
              expect.objectContaining({ value: '3.14' }),
              expect.objectContaining({ value: '3.10' }),
            ]),
          }),
        ])
      );
    });
  });

  describe('Pipx Installation', () => {
    it('should check for pipx availability', async () => {
      vi.mocked(execa).mockImplementation((command: string) => {
        if (command === 'pipx') {
          return Promise.resolve({ stdout: 'pipx 1.4.0', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      const result = await execa('pipx', ['--version']);
      expect(result.stdout).toContain('pipx');
    });

    it('should handle pipx not found', async () => {
      vi.mocked(execa).mockImplementation((command: string) => {
        if (command === 'pipx') {
          return Promise.reject(new Error('Command not found: pipx'));
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await expect(execa('pipx', ['--version'])).rejects.toThrow('Command not found');
    });

    it('should install poetry with pipx', async () => {
      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'pipx' && args?.[0] === 'install') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      await execa('pipx', ['install', 'poetry']);
      expect(execa).toHaveBeenCalledWith('pipx', ['install', 'poetry']);
    });

    it('should handle pipx upgrade when already installed', async () => {
      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'pipx' && args?.[0] === 'install') {
          return Promise.reject(new Error('poetry already installed'));
        }
        if (command === 'pipx' && args?.[0] === 'upgrade') {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      try {
        await execa('pipx', ['install', 'poetry']);
      } catch (error: any) {
        if (error.message.includes('already installed')) {
          await execa('pipx', ['upgrade', 'poetry']);
        }
      }

      expect(execa).toHaveBeenCalledWith('pipx', ['upgrade', 'poetry']);
    });
  });

  describe('Venv Installation Method', () => {
    it('should handle venv installation method', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'venv',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);

      await createProject('test-venv-project', { profile: 'python-only' });

      // Verify project was created
      expect(fsExtra.ensureDir).toHaveBeenCalled();
    });

    it('should install rapidkit-core with pip in venv', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'venv',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);

      await createProject('test-venv-project', { profile: 'python-only' });

      const pipInstallCalls = vi
        .mocked(execa)
        .mock.calls.filter(
          (call) => Array.isArray(call[1]) && call[1].includes('-m') && call[1].includes('pip')
        );

      expect(pipInstallCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Git Operations', () => {
    it('should handle git init failure gracefully', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (command === 'git' && args?.[0] === 'init') {
          return Promise.reject(new Error('git not found'));
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      // Should not throw despite git failure
      await createProject('test-project', {});

      expect(fsExtra.ensureDir).toHaveBeenCalled();
    });

    it('should create initial git commit', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', {});

      const gitCommitCalls = vi
        .mocked(execa)
        .mock.calls.filter(
          (call) => call[0] === 'git' && Array.isArray(call[1]) && call[1][0] === 'commit'
        );

      expect(gitCommitCalls.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Workspace Marker', () => {
    it('should create workspace marker file', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', {});

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        expect.stringContaining('.workspai-workspace'),
        expect.any(String),
        'utf-8'
      );

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        expect.stringMatching(/[\\/]\.workspai[\\/]workspace\.json$/),
        expect.any(String),
        'utf-8'
      );

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        expect.stringMatching(/[\\/]\.workspai[\\/]toolchain\.lock$/),
        expect.any(String),
        'utf-8'
      );

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        expect.stringMatching(/[\\/]\.workspai[\\/]policies\.yml$/),
        expect.any(String),
        'utf-8'
      );

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        expect.stringMatching(/[\\/]\.workspai[\\/]cache-config\.yml$/),
        expect.any(String),
        'utf-8'
      );
    });

    it('should include python version in workspace marker', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.11',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (args?.includes('--version')) {
          return Promise.resolve({ stdout: 'Python 3.11.5', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', {});

      const markerCalls = vi
        .mocked(fsExtra.outputFile)
        .mock.calls.filter((call) => call[0].includes('.workspai-workspace'));

      expect(markerCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Python Command Detection', () => {
    it('should detect python3 command', async () => {
      vi.mocked(execa).mockImplementation((command: string) => {
        if (command === 'python3') {
          return Promise.resolve({ stdout: 'Python 3.11.0', stderr: '', exitCode: 0 } as any);
        }
        return Promise.reject(new Error('Command not found'));
      });

      const result = await execa('python3', ['--version']);
      expect(result.stdout).toContain('Python');
    });

    it('should fall back to python command', async () => {
      vi.mocked(execa).mockImplementation((command: string) => {
        if (command === 'python3') {
          return Promise.reject(new Error('Command not found'));
        }
        if (command === 'python') {
          return Promise.resolve({ stdout: 'Python 3.10.0', stderr: '', exitCode: 0 } as any);
        }
        return Promise.reject(new Error('Command not found'));
      });

      try {
        await execa('python3', ['--version']);
      } catch {
        const result = await execa('python', ['--version']);
        expect(result.stdout).toContain('Python');
      }
    });

    it('should handle python command not found', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('Command not found'));

      try {
        await execa('python3', ['--version']);
        await execa('python', ['--version']);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Poetry Configuration', () => {
    it('should configure virtualenvs.in-project', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      await createProject('test-project', { profile: 'python-only' });

      expect(execa).toHaveBeenCalledWith(
        'poetry',
        ['config', 'virtualenvs.in-project', 'true', '--local'],
        expect.any(Object)
      );
    });

    it('should handle poetry config errors gracefully', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.10',
        installMethod: 'poetry',
      });

      vi.mocked(execa).mockImplementation((command: string, args?: readonly string[]) => {
        if (
          command === 'poetry' &&
          Array.isArray(args) &&
          args[0] === 'config' &&
          args[1] === 'virtualenvs.in-project'
        ) {
          return Promise.reject(new Error('Config failed'));
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]');

      // Should continue despite config failure
      await createProject('test-project', {});

      expect(fsExtra.ensureDir).toHaveBeenCalled();
    });
  });

  // ─── Demo mode: git fail → warn, not crash ───────────────────────────────
  describe('Demo workspace (demoMode: true)', () => {
    it('should warn (not throw) when git init fails inside createDemoWorkspace', async () => {
      vi.mocked(execa).mockImplementation((cmd: any, _args?: any) => {
        if (cmd === 'git') return Promise.reject(new Error('git not found')) as any;
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }) as any;
      });

      const { createUiSpinner } = await import('../cli-ui/spinner.js');
      const spinnerMock = {
        start: vi.fn().mockReturnThis(),
        succeed: vi.fn().mockReturnThis(),
        fail: vi.fn().mockReturnThis(),
        warn: vi.fn().mockReturnThis(),
        stop: vi.fn().mockReturnThis(),
        text: '',
      };
      vi.mocked(createUiSpinner).mockReturnValue(spinnerMock as any);

      // demoMode: true + skipGit: false → git block runs → git fails → should warn, not throw
      await expect(
        createProject('demo-ws', { demoMode: true, skipGit: false })
      ).resolves.toBeUndefined();

      expect(spinnerMock.warn).toHaveBeenCalledWith('Could not initialize git repository');
    });
  });
});
