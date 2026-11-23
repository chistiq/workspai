import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fsExtra from 'fs-extra';
import { execa } from 'execa';

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

const mockExeca = execa as unknown as Mock;
const mockFs = fsExtra as unknown as {
  pathExists: Mock;
  readJson: Mock;
  writeJson: Mock;
  ensureDir: Mock;
};

/**
 * Helper: mock execa so that resolveRapidkitRunner probes succeed,
 * and the actual 'modules' commands return controlled responses.
 */
function mockExecaForCatalog(
  responses: Array<{ stdout: string; stderr?: string; exitCode: number }>
) {
  let responseIndex = 0;
  mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
    if (args?.at(-1) === '--version') return { stdout: 'Python 3.11', exitCode: 0 };
    if (args?.includes('--version') && args?.includes('--json')) {
      return { stdout: '{"schema_version":1,"version":"0.6.3"}', exitCode: 0 };
    }
    // Actual module command calls
    if (args?.some((a: string) => a === 'modules')) {
      const r = responses[responseIndex] ?? { stdout: '', stderr: 'no more', exitCode: 1 };
      responseIndex++;
      return r;
    }
    // Default: success (for resolveRapidkitRunner)
    return { stdout: '1', stderr: '', exitCode: 0 };
  });
}

describe('getModulesCatalog', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  afterEach(() => {
    delete process.env.RAPIDKIT_DEBUG;
  });

  it('returns cached catalog when fresh', async () => {
    const now = Date.now();
    const cachedData = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      filters: { category: null, tag: null, detailed: false },
      stats: { total: 2, returned: 2, invalid: 0 },
      modules: [{ name: 'mod1' }, { name: 'mod2' }],
      fetched_at: now - 1000,
    };

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readJson.mockResolvedValue(cachedData);

    const result = await bridge.getModulesCatalog();
    expect(result).not.toBeNull();
    expect(result?.modules).toHaveLength(2);
    expect(result?.fetched_at).toBe(cachedData.fetched_at);
  });

  it('fetches fresh catalog when cache is expired', async () => {
    const now = Date.now();
    const oldCache = {
      schema_version: 1,
      modules: [{ name: 'old_mod' }],
      fetched_at: now - 60 * 60 * 1000,
    };

    const freshData = {
      schema_version: 1,
      modules: [{ name: 'new1' }, { name: 'new2' }, { name: 'new3' }],
    };

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readJson.mockResolvedValue(oldCache);
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.writeJson.mockResolvedValue(undefined);

    mockExecaForCatalog([{ stdout: JSON.stringify(freshData), stderr: '', exitCode: 0 }]);

    const result = await bridge.getModulesCatalog();
    expect(result).not.toBeNull();
    expect(result?.modules).toHaveLength(3);
    expect(mockFs.writeJson).toHaveBeenCalled();
  });

  it('returns null when cache is missing and command fails', async () => {
    mockFs.pathExists.mockResolvedValue(false);

    mockExecaForCatalog([
      { stdout: '', stderr: 'error', exitCode: 1 },
      { stdout: '', stderr: 'error', exitCode: 1 },
    ]);

    const result = await bridge.getModulesCatalog();
    expect(result).toBeNull();
  });

  it('falls back to legacy JSON format', async () => {
    const legacyModules = [
      { name: 'legacy1', version: '1.0' },
      { name: 'legacy2', version: '2.0' },
    ];

    mockFs.pathExists.mockResolvedValue(false);
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.writeJson.mockResolvedValue(undefined);

    mockExecaForCatalog([
      { stdout: '', stderr: 'fail', exitCode: 1 },
      { stdout: JSON.stringify(legacyModules), stderr: '', exitCode: 0 },
    ]);

    const result = await bridge.getModulesCatalog();
    expect(result).not.toBeNull();
    expect(result?.schema_version).toBe(1);
    expect(result?.source).toBe('legacy-json');
    expect(result?.modules).toHaveLength(2);
    expect(mockFs.writeJson).toHaveBeenCalled();
  });

  it('returns stale cache when fresh fetch fails', async () => {
    const now = Date.now();
    const staleCache = {
      schema_version: 1,
      modules: [{ name: 'stale_mod' }],
      fetched_at: now - 60 * 60 * 1000,
    };

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readJson.mockResolvedValue(staleCache);

    mockExecaForCatalog([
      { stdout: '', stderr: 'error', exitCode: 1 },
      { stdout: '', stderr: 'error', exitCode: 1 },
    ]);

    const result = await bridge.getModulesCatalog();
    expect(result).not.toBeNull();
    expect(result?.modules[0]).toEqual({ name: 'stale_mod' });
  });

  it('passes category and tag options', async () => {
    const freshData = { schema_version: 1, modules: [{ name: 'filtered' }] };

    mockFs.pathExists.mockResolvedValue(false);
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.writeJson.mockResolvedValue(undefined);

    mockExecaForCatalog([{ stdout: JSON.stringify(freshData), stderr: '', exitCode: 0 }]);

    const result = await bridge.getModulesCatalog({
      category: 'data',
      tag: 'ml',
      detailed: true,
    });
    expect(result).not.toBeNull();
    expect(mockExeca).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['modules', 'list', '--json-schema', '1', '--json']),
      expect.any(Object)
    );
  });

  it('uses custom TTL', async () => {
    const now = Date.now();
    const recentCache = {
      schema_version: 1,
      modules: [{ name: 'cached' }],
      fetched_at: now - 5000,
    };

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readJson.mockResolvedValue(recentCache);

    mockExecaForCatalog([
      { stdout: '', stderr: 'fail', exitCode: 1 },
      { stdout: '', stderr: 'fail', exitCode: 1 },
    ]);

    // With ttlMs=1, 5-second-old cache is expired → fetch fails → returns stale
    const result = await bridge.getModulesCatalog({ ttlMs: 1 });
    expect(result).not.toBeNull();
  });

  it('handles invalid JSON from new format gracefully', async () => {
    mockFs.pathExists.mockResolvedValue(false);

    mockExecaForCatalog([
      { stdout: '{not json', stderr: '', exitCode: 0 },
      { stdout: 'not json either', stderr: '', exitCode: 0 },
    ]);

    const result = await bridge.getModulesCatalog();
    expect(result).toBeNull();
  });

  it('handles cache read errors gracefully', async () => {
    mockFs.pathExists.mockResolvedValueOnce(true);
    mockFs.readJson.mockRejectedValueOnce(new Error('corrupt file'));
    mockFs.pathExists.mockResolvedValue(false);

    mockExecaForCatalog([
      { stdout: '', stderr: 'err', exitCode: 1 },
      { stdout: '', stderr: 'err', exitCode: 1 },
    ]);

    const result = await bridge.getModulesCatalog();
    expect(result).toBeNull();
  });
});

describe('checkRapidkitCoreAvailable', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  afterEach(() => {
    delete process.env.RAPIDKIT_DEBUG;
    delete process.env.PYENV_ROOT;
  });

  it('returns true when found via python3 import (Method 1)', async () => {
    mockExeca.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '1',
      stderr: '',
    });

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
  });

  it('returns true when found via pip show (Method 2)', async () => {
    // All Method 1 commands fail
    mockExeca
      .mockRejectedValueOnce(new Error('no python3'))
      .mockRejectedValueOnce(new Error('no python'))
      .mockRejectedValueOnce(new Error('no python3.10'))
      .mockRejectedValueOnce(new Error('no python3.11'))
      .mockRejectedValueOnce(new Error('no python3.12'))
      // Method 2: pip show succeeds
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Name: rapidkit-core\nVersion: 1.0.0',
        stderr: '',
      });

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
  });

  it('returns true when found via pip3 show (Method 3)', async () => {
    // All Method 1 fail
    mockExeca
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      // Method 2 both fail
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      // Method 3: pip fails, pip3 succeeds
      .mockRejectedValueOnce(new Error('no pip'))
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Name: rapidkit-core\nVersion: 1.0.0',
        stderr: '',
      });

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
  });

  it('returns false when not found anywhere', async () => {
    mockExeca.mockRejectedValue(new Error('not found'));
    mockFs.pathExists.mockResolvedValue(false);

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(false);
  });

  it('returns true when found via pipx (Method 6)', async () => {
    mockExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'pipx') {
        return { exitCode: 0, stdout: 'rapidkit-core 1.0.0', stderr: '' };
      }
      throw new Error('not found');
    });
    mockFs.pathExists.mockResolvedValue(false);

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
  });

  it('returns true when found via poetry (Method 7)', async () => {
    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'poetry' && args?.includes('show')) {
        return { exitCode: 0, stdout: 'rapidkit-core 1.0.0', stderr: '' };
      }
      throw new Error('not found');
    });
    mockFs.pathExists.mockResolvedValue(false);

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
  });

  it('returns true when found via conda (Method 8)', async () => {
    mockExeca.mockImplementation(async (cmd: string) => {
      if (cmd === 'conda') {
        return { exitCode: 0, stdout: 'rapidkit-core 1.0.0', stderr: '' };
      }
      throw new Error('not found');
    });
    mockFs.pathExists.mockResolvedValue(false);

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
  });

  it('works with debug mode enabled', async () => {
    process.env.RAPIDKIT_DEBUG = '1';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    mockExeca.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '1',
      stderr: '',
    });

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
    expect(stderrSpy).toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it('handles Method 1 returning wrong stdout', async () => {
    mockExeca.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args?.[0] === '-c') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      throw new Error('not found');
    });
    mockFs.pathExists.mockResolvedValue(false);

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(false);
  });

  it('returns true when found via user site-packages (Method 5)', async () => {
    mockExeca.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args?.includes('--user-site')) {
        return {
          exitCode: 0,
          stdout: '/home/user/.local/lib/python3.11/site-packages',
          stderr: '',
        };
      }
      throw new Error('not found');
    });

    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('rapidkit_core')) {
        return true;
      }
      return false;
    });

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
  });

  it('returns true when found via pyenv (Method 4)', async () => {
    process.env.PYENV_ROOT = '/home/user/.pyenv';
    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'pyenv' && args?.includes('--bare')) {
        return { exitCode: 0, stdout: '3.11.0\n3.12.0', stderr: '' };
      }
      if (typeof cmd === 'string' && cmd.includes('.pyenv') && cmd.includes('pip')) {
        return { exitCode: 0, stdout: 'Name: rapidkit-core', stderr: '' };
      }
      throw new Error('not found');
    });
    mockFs.pathExists.mockResolvedValue(false);

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(true);
  });

  it('handles Method 2 returning non-matching stdout', async () => {
    // Method 1 fails
    mockExeca
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      // Method 2: returns OK but wrong package name
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Name: some-other-package', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Name: some-other-package', stderr: '' })
      // Methods 3-8 fail
      .mockRejectedValue(new Error('fail'));
    mockFs.pathExists.mockResolvedValue(false);

    const result = await bridge.__test__.checkRapidkitCoreAvailable();
    expect(result).toBe(false);
  });
});

describe('checkRapidkitCoreVersionCompatible', () => {
  let bridge: typeof import('../core-bridge/pythonRapidkitExec');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.RAPIDKIT_CORE_PYTHON_PACKAGE;
    bridge = await import('../core-bridge/pythonRapidkitExec');
  });

  afterEach(() => {
    delete process.env.RAPIDKIT_CORE_PYTHON_PACKAGE;
  });

  it('returns compatible=true when installed version satisfies explicit constraint', async () => {
    process.env.RAPIDKIT_CORE_PYTHON_PACKAGE = 'rapidkit-core>=0.27.0,<0.28.0';

    mockExeca.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args?.at(-1) === '--version') return { exitCode: 0, stdout: 'Python 3.11' };
      if (args?.includes('pip') && args.includes('show')) {
        return { exitCode: 0, stdout: 'Name: rapidkit-core\nVersion: 0.27.4', stderr: '' };
      }
      throw new Error('not found');
    });

    const result = await bridge.__test__.checkRapidkitCoreVersionCompatible();
    expect(result.isCompatible).toBe(true);
    expect(result.installedVersion).toBe('0.27.4');
    expect(result.expectedConstraint).toBe('>=0.27.0,<0.28.0');
    expect(result.reason).toBe('compatible');
  });

  it('returns compatible=false when installed version is outside explicit constraint', async () => {
    process.env.RAPIDKIT_CORE_PYTHON_PACKAGE = 'rapidkit-core>=0.27.0,<0.28.0';

    mockExeca.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args?.at(-1) === '--version') return { exitCode: 0, stdout: 'Python 3.11' };
      if (args?.includes('pip') && args.includes('show')) {
        return { exitCode: 0, stdout: 'Name: rapidkit-core\nVersion: 0.26.9', stderr: '' };
      }
      throw new Error('not found');
    });

    const result = await bridge.__test__.checkRapidkitCoreVersionCompatible();
    expect(result.isCompatible).toBe(false);
    expect(result.installedVersion).toBe('0.26.9');
    expect(result.expectedConstraint).toBe('>=0.27.0,<0.28.0');
    expect(result.reason).toBe('incompatible-version');
  });

  it('returns compatible=false when no explicit constraint is provided', async () => {
    process.env.RAPIDKIT_CORE_PYTHON_PACKAGE = 'rapidkit-core';

    const result = await bridge.__test__.checkRapidkitCoreVersionCompatible();
    expect(result.isCompatible).toBe(false);
    expect(result.expectedConstraint).toBeNull();
    expect(result.reason).toBe('constraint-missing');
  });
});
