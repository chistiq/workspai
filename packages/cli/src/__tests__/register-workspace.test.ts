import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerWorkspaceAtPath } from '../create.js';
import * as fsExtra from 'fs-extra';
import { execa } from 'execa';
import { finalizeWorkspaceOnboarding } from '../utils/workspace-onboarding.js';

vi.mock('fs-extra');
vi.mock('execa');
vi.mock('../utils/workspace-onboarding.js', () => ({
  finalizeWorkspaceOnboarding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/lifecycle-transaction.js', () => ({
  recoverActiveLifecycleTransactions: vi.fn().mockResolvedValue([]),
  createLifecycleTransaction: vi.fn(async () => ({
    journalPath: undefined,
    captureFile: vi.fn().mockResolvedValue(undefined),
    captureOwnedTree: vi.fn().mockResolvedValue(false),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  })),
}));
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

vi.mock('fs', () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
  },
}));

// Helper: build a fully-passing execa mock that succeeds for every call
function mockExecaSuccess() {
  vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
}

describe('registerWorkspaceAtPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsExtra.outputFile).mockResolvedValue(undefined);
    vi.mocked(fsExtra.ensureDir).mockResolvedValue(undefined);
    vi.mocked(fsExtra.pathExists).mockResolvedValue(false as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs via Poetry only when the optional Python engine is explicitly requested', async () => {
    mockExecaSuccess();

    const testPath = '/tmp/my-ws';
    await registerWorkspaceAtPath(testPath, {
      skipGit: true,
      installPythonEngine: true,
    });

    // marker
    expect(fsExtra.outputFile).toHaveBeenCalledWith(
      expect.stringContaining('.workspai-workspace'),
      expect.any(String),
      'utf-8'
    );

    // gitignore
    expect(fsExtra.outputFile).toHaveBeenCalledWith(
      expect.stringContaining('.gitignore'),
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

    // Poetry commands (default method after explicit Python-engine opt-in)
    expect(execa).toHaveBeenCalledWith('poetry', ['--version']);
    expect(execa).toHaveBeenCalledWith(
      'poetry',
      ['init', '--no-interaction', '--python', '^3.10'],
      { cwd: testPath }
    );
    expect(execa).toHaveBeenCalledWith(
      'poetry',
      ['config', 'virtualenvs.in-project', 'true', '--local'],
      {
        cwd: testPath,
      }
    );
    // Verify poetry add was called with the correct arguments
    // Note: The exact call sequence may vary due to Python discovery and other checks
    const allCalls = vi.mocked(execa).mock.calls as unknown as any[][];
    const addCalls = allCalls.filter(
      (call) => call[0] === 'poetry' && Array.isArray(call[1]) && call[1][0] === 'add'
    );
    expect(addCalls.length).toBeGreaterThan(0);
    // The first add call should have cwd and timeout
    expect(addCalls[0][0]).toBe('poetry');
    expect(addCalls[0][1]).toEqual(['add', 'rapidkit-core']);
    expect(addCalls[0][2]).toHaveProperty('cwd', testPath);
    expect(addCalls[0][2]).toHaveProperty('timeout');
  });

  it('registers a foundation-only workspace without probing or installing Python tooling', async () => {
    mockExecaSuccess();

    const testPath = '/tmp/my-ws-foundation-only';
    await registerWorkspaceAtPath(testPath, {
      skipGit: true,
      profile: 'minimal',
    });

    const commandCalls = vi.mocked(execa).mock.calls as unknown as any[][];
    expect(
      commandCalls.some(
        ([command, args]) =>
          command === 'poetry' ||
          String(command).includes('pipx') ||
          (Array.isArray(args) && (args.includes('venv') || args.includes('rapidkit-core')))
      )
    ).toBe(false);

    const workspaceManifestCall = vi
      .mocked(fsExtra.outputFile)
      .mock.calls.find(([filePath]) =>
        /[\\/]\.workspai[\\/]workspace\.json$/.test(String(filePath))
      );
    expect(workspaceManifestCall?.[1]).toEqual(expect.stringContaining('"status": "skipped"'));
    expect(workspaceManifestCall?.[1]).toEqual(
      expect.stringContaining('"reason": "project-workspace-foundation"')
    );
    expect(
      vi
        .mocked(fsExtra.outputFile)
        .mock.calls.some(([filePath]) => /[\\/]pyproject\.toml$/.test(String(filePath)))
    ).toBe(false);
    expect(finalizeWorkspaceOnboarding).toHaveBeenCalledWith(testPath, {
      workspaceName: 'my-ws-foundation-only',
      silent: false,
    });
  });

  // ─── Error path: git init fails → warn, not crash ────────────────────────
  it('should warn (not throw) when git init fails during workspace registration', async () => {
    mockExecaSuccess();
    // Make git init throw
    vi.mocked(execa).mockImplementation((cmd: any, _args: any, _opts?: any) => {
      if (cmd === 'git') throw new Error('git not found');
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }) as any;
    });

    const { createUiSpinner } = await import('../cli-ui/spinner.js');
    const spinnerMock = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      warn: vi.fn().mockReturnThis(),
      text: '',
    };
    vi.mocked(createUiSpinner).mockReturnValue(spinnerMock as any);

    // skipGit: false so git block IS entered
    await expect(
      registerWorkspaceAtPath('/tmp/my-ws-no-git', {
        skipGit: false,
        installPythonEngine: true,
        installMethod: 'poetry',
      })
    ).resolves.toBeUndefined();

    expect(spinnerMock.warn).toHaveBeenCalledWith('Could not initialize git repository');
  });

  // ─── Error path: poetry probe fails → auto-selects venv ──────────────────
  it('should fall back to venv when poetry --version probe fails', async () => {
    vi.mocked(execa).mockImplementation((cmd: any, args: any, _opts?: any) => {
      // poetry --version probe fails
      if (cmd === 'poetry' && Array.isArray(args) && args[0] === '--version') {
        return Promise.reject(new Error('poetry not found')) as any;
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }) as any;
    });

    // Should not throw — venv is the fallback
    await expect(
      registerWorkspaceAtPath('/tmp/my-ws-venv', {
        skipGit: true,
        installPythonEngine: true,
      })
    ).resolves.toBeUndefined();

    // venv path: python3 -m venv should have been called
    const allCalls = vi.mocked(execa).mock.calls as unknown as any[][];
    const venvCalls = allCalls.filter(
      (c) => Array.isArray(c[1]) && c[1].includes('-m') && c[1].includes('venv')
    );
    expect(venvCalls.length).toBeGreaterThan(0);
  });

  // ─── Error path: install method = pipx ───────────────────────────────────
  it('should use pipx install path when installMethod is pipx', async () => {
    mockExecaSuccess();

    await expect(
      registerWorkspaceAtPath('/tmp/my-ws-pipx', {
        skipGit: true,
        installPythonEngine: true,
        installMethod: 'pipx',
      })
    ).resolves.toBeUndefined();

    // pipx install should have been called
    const allCalls = vi.mocked(execa).mock.calls as unknown as any[][];
    const pipxCalls = allCalls.filter(
      (c) => typeof c[0] === 'string' && String(c[0]).includes('pipx')
    );
    expect(pipxCalls.length).toBeGreaterThan(0);
  });

  // ─── Error path: install fails → spinner.fail + rethrow ──────────────────
  it('should call spinner.fail and rethrow when the install step throws', async () => {
    const installError = new Error('poetry install exploded');

    vi.mocked(execa).mockImplementation((cmd: any, args: any, _opts?: any) => {
      // Let poetry --version succeed so poetry is chosen
      if (cmd === 'poetry' && Array.isArray(args) && args[0] === '--version') {
        return Promise.resolve({ stdout: 'Poetry 1.8.0', stderr: '', exitCode: 0 }) as any;
      }
      // Fail on anything else (init / add / etc.)
      return Promise.reject(installError) as any;
    });

    const { createUiSpinner } = await import('../cli-ui/spinner.js');
    const spinnerMock = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      warn: vi.fn().mockReturnThis(),
      text: '',
    };
    vi.mocked(createUiSpinner).mockReturnValue(spinnerMock as any);

    await expect(
      registerWorkspaceAtPath('/tmp/my-ws-fail', {
        skipGit: true,
        installPythonEngine: true,
        installMethod: 'poetry',
      })
    ).rejects.toThrow('poetry install exploded');

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to register workspace');
  });

  // ─── Happy path: git init succeeds with skipGit: false ──────────────────
  it('should initialize git repo and call spinner.succeed when git succeeds', async () => {
    mockExecaSuccess();

    const { createUiSpinner } = await import('../cli-ui/spinner.js');
    const spinnerMock = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      warn: vi.fn().mockReturnThis(),
      text: '',
    };
    vi.mocked(createUiSpinner).mockReturnValue(spinnerMock as any);

    await registerWorkspaceAtPath('/tmp/my-ws-git-ok', {
      skipGit: false,
      installPythonEngine: true,
      installMethod: 'poetry',
    });

    // git commit was called
    const allCalls = vi.mocked(execa).mock.calls as unknown as any[][];
    const commitCalls = allCalls.filter(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('commit')
    );
    expect(commitCalls.length).toBeGreaterThan(0);

    expect(spinnerMock.warn).not.toHaveBeenCalledWith('Could not initialize git repository');
  });

  it('should skip git init when target is already inside a git worktree', async () => {
    vi.mocked(execa).mockImplementation((cmd: any, args: any, opts?: any) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse') {
        return Promise.resolve({
          stdout: '/tmp/existing-parent-repo',
          stderr: '',
          exitCode: 0,
        }) as any;
      }
      if (cmd === 'poetry' && Array.isArray(args) && args[0] === '--version') {
        return Promise.resolve({ stdout: 'Poetry 1.8.0', stderr: '', exitCode: 0 }) as any;
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0, opts }) as any;
    });

    const { createUiSpinner } = await import('../cli-ui/spinner.js');
    const spinnerMock = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      warn: vi.fn().mockReturnThis(),
      text: '',
    };
    vi.mocked(createUiSpinner).mockReturnValue(spinnerMock as any);

    await registerWorkspaceAtPath('/tmp/existing-parent-repo/workspai', {
      skipGit: false,
      installPythonEngine: true,
      installMethod: 'poetry',
    });

    const gitCalls = vi
      .mocked(execa)
      .mock.calls.filter((call) => call[0] === 'git')
      .map((call) => call[1]);

    expect(gitCalls).toEqual([['rev-parse', '--show-toplevel']]);
    expect(spinnerMock.warn).toHaveBeenCalledWith(
      'Git initialization skipped because target is already inside a git worktree'
    );
  });

  it('should propagate strict onboarding failures', async () => {
    mockExecaSuccess();

    vi.mocked(finalizeWorkspaceOnboarding).mockRejectedValueOnce(
      new Error('registry module unavailable')
    );

    await expect(
      registerWorkspaceAtPath('/tmp/my-ws-no-registry', {
        skipGit: true,
        installPythonEngine: true,
        installMethod: 'poetry',
      })
    ).rejects.toThrow('registry module unavailable');
  });
});
