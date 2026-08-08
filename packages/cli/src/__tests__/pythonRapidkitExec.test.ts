import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fsExtra from 'fs-extra';
import { execa } from 'execa';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra');
  return {
    ...actual,
    pathExists: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    ensureDir: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

const mockExeca = execa as unknown as Mock;
const mockFs = fsExtra as unknown as {
  pathExists: Mock;
  readJson: Mock;
  writeJson: Mock;
  ensureDir: Mock;
};

describe('bridge internals', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  afterEach(() => {
    delete process.env.RAPIDKIT_DEBUG;
    delete process.env.RAPIDKIT_BRIDGE_FORCE_VENV;
    delete process.env.RAPIDKIT_BRIDGE_PYTHON;
    delete process.env.RAPIDKIT_PYTHON_CMD;
    delete process.env.POETRY_PYTHON;
    delete process.env.RAPIDKIT_CORE_PYTHON_PACKAGE;
  });

  describe('parseCoreCommandsFromHelp', () => {
    it('parses Commands section', () => {
      const help = `
Commands:
  list     List kits
  run      Run kit
`;
      const res = bridge.__test__.parseCoreCommandsFromHelp(help);
      expect([...res]).toEqual(['list', 'run']);
    });

    it('parses explicit rapidkit <cmd>', () => {
      const help = `rapidkit deploy`;
      const res = bridge.__test__.parseCoreCommandsFromHelp(help);
      expect(res.has('deploy')).toBe(true);
    });

    it('returns empty set if nothing found', () => {
      const res = bridge.__test__.parseCoreCommandsFromHelp('nothing here');
      expect(res.size).toBe(0);
    });

    it('ignores section headers/options and keeps command names', () => {
      const help = `
Usage: rapidkit [OPTIONS] COMMAND [ARGS]...

Commands:
  list      list kits
  --help    show help
Options:
  -h, --help  Show this message and exit.
rapidkit deploy
`;
      const res = bridge.__test__.parseCoreCommandsFromHelp(help);
      expect(res.has('list')).toBe(true);
      expect(res.has('--help')).toBe(false);
      expect(res.has('Options')).toBe(false);
    });
  });

  describe('PEP 440 compatible version constraints', () => {
    it.each([
      ['1.2.3', '==1.2.3', true],
      ['1.2.4', '==1.2.3', false],
      ['1.2.3', '>=1.2,<2.0', true],
      ['1.1.9', '>=1.2', false],
      ['2.1', '<=2.0', false],
      ['2.0', '<=2.0', true],
      ['2.0', '>2.0', false],
      ['2.0.1', '>2.0', true],
      ['2.0', '<2.0', false],
      ['1.9', '<2.0', true],
      ['1.4.9', '~=1.4', true],
      ['2.0', '~=1.4', false],
      ['1.4.9', '~=1.4.5', true],
      ['1.5.0', '~=1.4.5', false],
      ['1.2.3rc1', '>=1.2.3', true],
    ])('%s against %s => %s', (version, constraint, expected) => {
      expect(bridge.__test__.isVersionSatisfyingConstraint(version, constraint)).toBe(expected);
    });

    it('rejects malformed versions and constraints', () => {
      for (const [version, constraint] of [
        ['', '>=1'],
        ['latest', '>=1'],
        ['1.0', ''],
        ['1.0', '^1.0'],
        ['1.0', '>=bad'],
      ]) {
        expect(bridge.__test__.isVersionSatisfyingConstraint(version, constraint)).toBe(false);
      }
    });
  });

  describe('pickSystemPython', () => {
    it('returns the first available Python candidate', async () => {
      mockExeca.mockResolvedValueOnce({ exitCode: 0 });
      const res = await bridge.__test__.pickSystemPython();
      expect(res).toBe(bridge.__test__.pythonCommandCandidates()[0]);
    });

    it('falls back to the next Python candidate', async () => {
      mockExeca
        .mockRejectedValueOnce(new Error('first candidate unavailable'))
        .mockResolvedValueOnce({ exitCode: 0 });
      const res = await bridge.__test__.pickSystemPython();
      expect(res).toBe(bridge.__test__.pythonCommandCandidates()[1]);
    });

    it('rejects a nonzero Windows Store alias and probes py with Python 3', async () => {
      process.env.RAPIDKIT_BRIDGE_PYTHON = 'python';
      process.env.RAPIDKIT_PYTHON_CMD = 'py';
      mockExeca
        .mockResolvedValueOnce({ exitCode: 9009, stderr: 'Python was not found' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Python 3.12.4' });

      const res = await bridge.__test__.pickSystemPython();

      expect(res).toBe('py');
      expect(mockExeca).toHaveBeenNthCalledWith(2, 'py', ['-3', '--version'], expect.any(Object));
    });

    it('returns null if none found', async () => {
      mockExeca.mockRejectedValue(new Error('no python'));
      const res = await bridge.__test__.pickSystemPython();
      expect(res).toBeNull();
    });

    it('prefers explicit bridge Python override before generic candidates', () => {
      process.env.RAPIDKIT_BRIDGE_PYTHON = '/opt/python/bin/python';
      const candidates = bridge.__test__.pythonCommandCandidates();
      expect(candidates[0]).toBe('/opt/python/bin/python');
      expect(new Set(candidates).size).toBe(candidates.length);
    });
  });

  describe('tryRapidkit', () => {
    it('returns true if import probe succeeds', async () => {
      // 1️⃣ interpreter-specific script probe
      mockExeca.mockResolvedValueOnce({
        stdout: '',
        exitCode: 0,
      });

      // 2️⃣ importlib.find_spec probe
      mockExeca.mockResolvedValueOnce({
        stdout: '1',
        exitCode: 0,
      });

      const ok = await bridge.__test__.tryRapidkit('python3');
      expect(ok).toBe(true);
    });

    it('returns false if all probes fail', async () => {
      mockExeca.mockResolvedValue({
        stdout: '0',
        exitCode: 1,
      });
      mockFs.pathExists.mockResolvedValue(false);

      const ok = await bridge.__test__.tryRapidkit('python3');
      expect(ok).toBe(false);
    });
  });

  describe('ensureBridgeVenv', () => {
    it('returns existing python if venv already exists', async () => {
      // Mock that venv python already exists
      mockFs.pathExists.mockResolvedValue(true);
      // Mock probe check: rapidkit is installed in venv
      mockExeca.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '1',
        stderr: '',
      } as any);

      const py = await bridge.__test__.ensureBridgeVenv('python3');
      expect(py).toContain('python');
    });

    it('throws BridgeError on bootstrap failure', async () => {
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.ensureDir.mockResolvedValue(undefined);

      mockExeca.mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'fail',
        stderr: 'boom',
      });

      await expect(bridge.__test__.ensureBridgeVenv('python3')).rejects.toMatchObject({
        code: 'BRIDGE_VENV_CREATE_FAILED',
      });
    });

    it('continues to the next Python candidate when one cannot create a venv', async () => {
      process.env.RAPIDKIT_BRIDGE_PYTHON = 'bad-python';
      process.env.RAPIDKIT_PYTHON_CMD = 'good-python';

      mockFs.pathExists.mockResolvedValue(false);
      mockFs.ensureDir.mockResolvedValue(undefined);

      mockExeca
        // candidate 1 exists
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Python 3.13', stderr: '' })
        // candidate 1 venv creation fails (e.g. missing ensurepip/python3-venv)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ensurepip missing' })
        // candidate 2 exists
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Python 3.10', stderr: '' })
        // candidate 2 venv creation succeeds
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
        // pip check succeeds
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'pip 24', stderr: '' })
        // core install succeeds
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

      const py = await bridge.__test__.ensureBridgeVenvFromCandidates();
      expect(py).toContain('python');
      expect(mockExeca).toHaveBeenCalledWith(
        'good-python',
        expect.arrayContaining(['-m', 'venv']),
        expect.any(Object)
      );
    });

    it('does not bootstrap with a candidate whose version probe exits nonzero', async () => {
      process.env.RAPIDKIT_BRIDGE_PYTHON = 'store-python';
      process.env.RAPIDKIT_PYTHON_CMD = 'working-python';
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockExeca
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Python was not found' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Python 3.12', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'pip 24', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

      await bridge.__test__.ensureBridgeVenvFromCandidates();

      expect(mockExeca).not.toHaveBeenCalledWith(
        'store-python',
        expect.arrayContaining(['-m', 'venv']),
        expect.any(Object)
      );
      expect(mockExeca).toHaveBeenCalledWith(
        'working-python',
        expect.arrayContaining(['-m', 'venv']),
        expect.any(Object)
      );
    });

    it('reports PYTHON_NOT_FOUND when execa cannot launch any candidate', async () => {
      mockExeca.mockResolvedValue({
        exitCode: undefined,
        failed: true,
        stdout: '',
        stderr: '',
        shortMessage: 'Command failed with ENOENT',
      });

      await expect(bridge.__test__.ensureBridgeVenvFromCandidates()).rejects.toMatchObject({
        code: 'PYTHON_NOT_FOUND',
      });
    });
  });
});

describe('public API', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  it('runCoreRapidkitCapture returns stdout/stderr', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: '{"version":"1.0.0"}',
      stderr: '',
    });

    const res = await bridge.runCoreRapidkitCapture(['version']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('version');
  });

  it('runCoreRapidkit returns 1 on error', async () => {
    mockExeca.mockRejectedValue(new Error('boom'));

    const code = await bridge.runCoreRapidkit(['list']);
    expect(code).toBe(1);
  });

  it('runCoreRapidkitStreamed maps known RapidKitError to friendly message', async () => {
    mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
      if (args?.[0] === '--version') return { exitCode: 0, stdout: 'Python 3.11', stderr: '' };
      if (args?.[0] === '-c' && args?.[1]?.includes('sysconfig'))
        return { exitCode: 0, stdout: '', stderr: '' };
      if (args?.[0] === '-c' && args?.[1]?.includes("find_spec('rapidkit')"))
        return { exitCode: 0, stdout: '1', stderr: '' };
      if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
        return { exitCode: 0, stdout: '{"version":"1.0.0"}', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    mockFs.pathExists.mockResolvedValue(false);

    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    spawnMock.mockImplementation(() => {
      setImmediate(() => {
        child.stderr.emit(
          'data',
          Buffer.from("RapidKitError: Directory '/tmp/demo' exists and force is not set")
        );
        child.emit('close', 2);
      });
      return child;
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await bridge.runCoreRapidkitStreamed(['create', 'demo']);
    expect(code).toBe(2);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Directory "demo" already exists')
    );

    stderrSpy.mockRestore();
  });

  it('runCoreRapidkitStreamed returns 1 when spawn emits error', async () => {
    mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
      if (args?.[0] === '--version') return { exitCode: 0, stdout: 'Python 3.11', stderr: '' };
      if (args?.[0] === '-c' && args?.[1]?.includes('sysconfig'))
        return { exitCode: 0, stdout: '', stderr: '' };
      if (args?.[0] === '-c' && args?.[1]?.includes("find_spec('rapidkit')"))
        return { exitCode: 0, stdout: '1', stderr: '' };
      if (args?.[0] === '-m' && args?.[1] === 'rapidkit') {
        return { exitCode: 0, stdout: '{"version":"1.0.0"}', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    mockFs.pathExists.mockResolvedValue(false);

    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    spawnMock.mockImplementation(() => {
      setImmediate(() => {
        child.emit('error', new Error('spawn failed'));
      });
      return child;
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await bridge.runCoreRapidkitStreamed(['list']);
    expect(code).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed to run the Python core engine: spawn failed')
    );

    stderrSpy.mockRestore();
  });
});

describe('resolveRapidkitPython', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  it('returns system python when tryRapidkit succeeds', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 }) // script probe
      .mockResolvedValueOnce({ stdout: '1', exitCode: 0 }); // import probe

    const res = await bridge.resolveRapidkitPython();
    expect(res.kind).toBe('system');
    if (res.kind === 'system') {
      expect(res.cmd).toBe(bridge.__test__.pythonCommandCandidates()[0]);
    }
  });

  it('bootstraps venv when system python has no rapidkit', async () => {
    process.env.RAPIDKIT_BRIDGE_FORCE_VENV = '1';
    mockFs.pathExists.mockResolvedValue(false);
    mockFs.ensureDir.mockResolvedValue(undefined);

    mockExeca
      // candidate exists
      .mockResolvedValueOnce({ stdout: 'Python 3.11', stderr: '', exitCode: 0 } as any)
      // venv creation succeeds
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any)
      // pip check succeeds
      .mockResolvedValueOnce({ stdout: 'pip 24', stderr: '', exitCode: 0 } as any)
      // core install succeeds
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

    const res = await bridge.resolveRapidkitPython();
    expect(res.kind).toBe('venv');
    if (res.kind === 'venv') {
      expect(res.pythonPath).toContain('python');
    }
  });
});

describe('resolveRapidkitRunner', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  it('uses workspace .venv rapidkit cli when available', async () => {
    mockFs.pathExists.mockResolvedValue(true);

    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: '{"version":"1.0.0"}',
    });

    const runner = await bridge.runCoreRapidkitCapture(['list'], {
      cwd: '/fake/project',
    });

    expect(runner.exitCode).toBe(0);
  });

  it('finds user-local pipx rapidkit when it is not on PATH', async () => {
    const userLocalRapidkit =
      process.platform === 'win32'
        ? path.join(os.homedir(), '.local', 'bin', 'rapidkit.exe')
        : path.join(os.homedir(), '.local', 'bin', 'rapidkit');

    mockFs.pathExists.mockImplementation(
      async (candidate: string) => candidate === userLocalRapidkit
    );
    mockExeca.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === userLocalRapidkit && args?.join(' ') === '--version --json') {
        return { exitCode: 0, stdout: '{"version":"0.5.4"}', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const runner = await bridge.__test__.findUserLocalRapidkitRunner();

    expect(runner).toEqual({ cmd: userLocalRapidkit, baseArgs: [] });
  });

  it.each([
    {
      platform: 'win32' as NodeJS.Platform,
      env: {
        USERPROFILE: 'C:/Users/Admin',
        APPDATA: 'C:/Users/Admin/AppData/Roaming',
        LOCALAPPDATA: 'C:/Users/Admin/AppData/Local',
      },
      expected: path.join('C:/Users/Admin', '.local', 'bin', 'rapidkit.exe'),
    },
    {
      platform: 'linux' as NodeJS.Platform,
      env: {},
      expected: path.join(os.homedir(), '.local', 'bin', 'rapidkit'),
    },
    {
      platform: 'darwin' as NodeJS.Platform,
      env: {},
      expected: path.join(os.homedir(), '.local', 'bin', 'rapidkit'),
    },
  ])(
    'resolves user-local core paths consistently on $platform',
    async ({ platform, env, expected }) => {
      mockFs.pathExists.mockImplementation(async (candidate: string) => candidate === expected);
      mockExeca.mockImplementation(async (cmd: string, args?: string[]) => {
        if (cmd === expected && args?.join(' ') === '--version --json') {
          return { exitCode: 0, stdout: '{"version":"0.5.4"}', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: '' };
      });

      const runner = await bridge.__test__.findUserLocalRapidkitRunner(
        platform,
        env as NodeJS.ProcessEnv
      );

      expect(runner).toEqual({ cmd: expected, baseArgs: [] });
    }
  );

  it('uses only schema-tagged RapidKit Core executables from PATH fallback', async () => {
    const pathA = '/tmp/npm-bin';
    const pathB = '/tmp/core-bin';
    const npmWrapper = path.join(pathA, 'rapidkit');
    const coreRunner = path.join(pathB, 'rapidkit');

    mockFs.pathExists.mockImplementation(
      async (candidate: string) => candidate === npmWrapper || candidate === coreRunner
    );
    mockExeca.mockImplementation(async (cmd: string, args?: string[]) => {
      if (args?.join(' ') !== '--version --json') {
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      if (cmd === npmWrapper) {
        return {
          exitCode: 0,
          stdout: '{"schemaVersion":"rapidkit-version-v1","cli":"workspai","version":"0.43.0"}',
          stderr: '',
        };
      }
      if (cmd === coreRunner) {
        return { exitCode: 0, stdout: '{"schema_version":1,"version":"0.5.4"}', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const runner = await bridge.__test__.findPathRapidkitRunner('linux', {
      PATH: [pathA, pathB].join(path.delimiter),
    } as NodeJS.ProcessEnv);

    expect(runner).toEqual({ cmd: coreRunner, baseArgs: [] });
  });
});

describe('getCachedCoreTopLevelCommands', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  it('returns null if cache is missing', async () => {
    mockFs.pathExists.mockResolvedValue(false);

    const res = await bridge.getCachedCoreTopLevelCommands();
    expect(res).toBeNull();
  });

  it('returns cached commands if fresh', async () => {
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readJson.mockResolvedValue({
      schema_version: 1,
      fetched_at: Date.now(),
      commands: ['list', 'run'],
    });

    const res = await bridge.getCachedCoreTopLevelCommands();
    expect(res?.has('list')).toBe(true);
  });

  it('returns null when cache is stale', async () => {
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readJson.mockResolvedValue({
      schema_version: 1,
      fetched_at: Date.now() - 25 * 60 * 60 * 1000,
      commands: ['list'],
    });

    const res = await bridge.getCachedCoreTopLevelCommands();
    expect(res).toBeNull();
  });

  it('returns null when cache has empty commands', async () => {
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readJson.mockResolvedValue({
      schema_version: 1,
      fetched_at: Date.now(),
      commands: [],
    });

    const res = await bridge.getCachedCoreTopLevelCommands();
    expect(res).toBeNull();
  });
});

describe('getCoreTopLevelCommands', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  it('falls back to non-empty command set if help command fails', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'fail',
    });

    const res = await bridge.getCoreTopLevelCommands();

    expect(res.size).toBeGreaterThan(0);

    // sanity check: commands are strings
    for (const cmd of res) {
      expect(typeof cmd).toBe('string');
    }
  });

  it('prefers commands JSON when available', async () => {
    mockFs.pathExists.mockResolvedValue(false);
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ schema_version: 1, commands: ['create', 'list'] }),
      stderr: '',
    });

    const res = await bridge.getCoreTopLevelCommands();
    expect(res.has('create')).toBe(true);
    expect(res.has('list')).toBe(true);
  });

  it('parses commands from --help output', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: `
Commands:
  list
  run
`,
    });

    const res = await bridge.getCoreTopLevelCommands();
    expect(res.has('list')).toBe(true);
    expect(res.has('run')).toBe(true);
  });

  it('handles empty commands response', async () => {
    mockFs.pathExists.mockResolvedValue(false);
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    const res = await bridge.getCoreTopLevelCommands();
    expect(res).toBeDefined();
    expect(res.size).toBeGreaterThanOrEqual(0);
  });

  it('handles malformed JSON in commands response', async () => {
    mockFs.pathExists.mockResolvedValue(false);
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: '{invalid json}',
      stderr: '',
    });

    const res = await bridge.getCoreTopLevelCommands();
    expect(res).toBeDefined();
  });

  it('handles timeout in getting commands', async () => {
    mockFs.pathExists.mockResolvedValue(false);
    mockExeca.mockRejectedValue(new Error('Timeout'));

    const res = await bridge.getCoreTopLevelCommands();
    expect(res).toBeDefined();
    expect(res.size).toBeGreaterThan(0);
  });

  it('handles multiple command formats', async () => {
    mockFs.pathExists.mockResolvedValue(false);
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: `
rapidkit create
rapidkit deploy
Commands:
  list
  run
`,
    });

    const res = await bridge.getCoreTopLevelCommands();
    expect(res.has('create')).toBe(true);
    expect(res.has('deploy')).toBe(true);
    expect(res.has('list')).toBe(true);
    expect(res.has('run')).toBe(true);
  });
});
