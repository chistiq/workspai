import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import {
  detectPlatformKind,
  isWindowsPlatform,
  shouldUseShellExecution,
  getDefaultPythonCommand,
  getPythonCommandCandidates,
  getPythonVersionProbeCandidates,
  getVenvBinDirectory,
  getVenvPythonPath,
  getVenvRapidkitPath,
  getVenvActivateScriptPath,
  getRapidkitLocalScriptCandidates,
  getWorkspaceRegistryFileCandidates,
  getWorkspaceRegistryDirectory,
  getLegacyWorkspaceRegistryDirectory,
  getUserLocalBinCandidates,
} from '../utils/platform-capabilities.js';

describe('platform-capabilities', () => {
  describe('detectPlatformKind', () => {
    it('returns windows for win32', () => {
      expect(detectPlatformKind('win32')).toBe('windows');
    });

    it('returns linux for linux', () => {
      expect(detectPlatformKind('linux')).toBe('linux');
    });

    it('returns macos for darwin', () => {
      expect(detectPlatformKind('darwin')).toBe('macos');
    });

    it('returns other for unknown platform', () => {
      expect(detectPlatformKind('freebsd' as NodeJS.Platform)).toBe('other');
    });
  });

  describe('isWindowsPlatform / shouldUseShellExecution', () => {
    it('returns true on win32', () => {
      expect(isWindowsPlatform('win32')).toBe(true);
      expect(shouldUseShellExecution('win32')).toBe(true);
    });

    it('returns false on linux', () => {
      expect(isWindowsPlatform('linux')).toBe(false);
      expect(shouldUseShellExecution('linux')).toBe(false);
    });
  });

  describe('getDefaultPythonCommand', () => {
    it('returns python on windows', () => {
      expect(getDefaultPythonCommand('win32')).toBe('python');
    });

    it('returns python3 on linux', () => {
      expect(getDefaultPythonCommand('linux')).toBe('python3');
    });
  });

  describe('getPythonCommandCandidates', () => {
    it('returns windows candidates first on win32', () => {
      const candidates = getPythonCommandCandidates('win32');
      expect(candidates[0]).toBe('python');
      expect(candidates).toContain('py');
    });

    it('returns unix candidates first on linux', () => {
      const candidates = getPythonCommandCandidates('linux');
      expect(candidates[0]).toBe('python3');
    });
  });

  describe('getPythonVersionProbeCandidates', () => {
    it('returns py launcher probes on windows', () => {
      const probes = getPythonVersionProbeCandidates(14, 10, 'win32');
      const pyProbes = probes.filter((p) => p.command === 'py');
      expect(pyProbes.length).toBeGreaterThan(0);
      expect(pyProbes[0].args[0]).toMatch(/^-3\.\d+$/);
      // Last py probe: py -3 --version
      expect(probes.some((p) => p.command === 'py' && p.args[0] === '-3')).toBe(true);
      expect(probes.some((p) => p.command === 'python')).toBe(true);
    });

    it('returns versioned python3.N probes on linux', () => {
      const probes = getPythonVersionProbeCandidates(14, 10, 'linux');
      expect(probes[0].command).toBe('python3.14');
      expect(probes.some((p) => p.command === 'python3')).toBe(true);
      expect(probes.some((p) => p.command === 'python')).toBe(true);
    });
  });

  describe('getVenvBinDirectory', () => {
    it('returns Scripts directory on windows', () => {
      expect(getVenvBinDirectory('/venv', 'win32')).toBe(path.join('/venv', 'Scripts'));
    });

    it('returns bin directory on linux', () => {
      expect(getVenvBinDirectory('/venv', 'linux')).toBe(path.join('/venv', 'bin'));
    });
  });

  describe('getVenvPythonPath', () => {
    it('returns python.exe on windows', () => {
      expect(getVenvPythonPath('/venv', 'win32')).toBe(path.join('/venv', 'Scripts', 'python.exe'));
    });

    it('returns bin/python on linux', () => {
      expect(getVenvPythonPath('/venv', 'linux')).toBe(path.join('/venv', 'bin', 'python'));
    });
  });

  describe('getVenvRapidkitPath', () => {
    it('returns rapidkit.exe on windows', () => {
      expect(getVenvRapidkitPath('/venv', 'win32')).toBe(
        path.join('/venv', 'Scripts', 'rapidkit.exe')
      );
    });

    it('returns bin/rapidkit on linux', () => {
      expect(getVenvRapidkitPath('/venv', 'linux')).toBe(path.join('/venv', 'bin', 'rapidkit'));
    });
  });

  describe('getVenvActivateScriptPath', () => {
    it('returns Scripts/activate on windows', () => {
      expect(getVenvActivateScriptPath('/venv', 'win32')).toBe(
        path.join('/venv', 'Scripts', 'activate')
      );
    });

    it('returns bin/activate on linux', () => {
      expect(getVenvActivateScriptPath('/venv', 'linux')).toBe(
        path.join('/venv', 'bin', 'activate')
      );
    });
  });

  describe('getRapidkitLocalScriptCandidates', () => {
    it('returns .cmd paths on windows', () => {
      const candidates = getRapidkitLocalScriptCandidates('/project', 'win32');
      expect(candidates[0]).toBe(path.join('/project', 'workspai.cmd'));
      expect(candidates[1]).toBe(path.join('/project', '.workspai', 'rapidkit.cmd'));
    });

    it('returns unix paths on linux', () => {
      const candidates = getRapidkitLocalScriptCandidates('/project', 'linux');
      expect(candidates[0]).toBe(path.join('/project', 'workspai'));
      expect(candidates[1]).toBe(path.join('/project', '.workspai', 'rapidkit'));
    });
  });

  describe('getWorkspaceRegistryDirectory', () => {
    it('returns home-based canonical path on windows using USERPROFILE', () => {
      const dir = getWorkspaceRegistryDirectory(
        { USERPROFILE: 'C:\\Users\\user', APPDATA: 'C:\\Users\\user\\AppData\\Roaming' },
        'win32'
      );
      expect(dir).toBe(path.join('C:\\Users\\user', '.workspai'));
    });

    it('keeps APPDATA registry files as windows compatibility candidates', () => {
      const candidates = getWorkspaceRegistryFileCandidates(
        {
          USERPROFILE: 'C:\\Users\\user',
          APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
        },
        'win32'
      );
      expect(candidates).toEqual(
        expect.arrayContaining([
          path.join('C:\\Users\\user', '.workspai', 'workspaces.json'),
          path.join('C:\\Users\\user', '.rapidkit', 'workspaces.json'),
          path.join('C:\\Users\\user\\AppData\\Roaming', 'workspai', 'workspaces.json'),
          path.join('C:\\Users\\user\\AppData\\Roaming', 'rapidkit', 'workspaces.json'),
        ])
      );
    });

    it('returns .workspai under home on linux', () => {
      const dir = getWorkspaceRegistryDirectory({}, 'linux');
      expect(dir).toBe(path.join(os.homedir(), '.workspai'));
    });

    it('honors HOME for both canonical and legacy registries', () => {
      expect(getWorkspaceRegistryDirectory({ HOME: '/srv/user' }, 'linux')).toBe(
        path.join('/srv/user', '.workspai')
      );
      expect(getLegacyWorkspaceRegistryDirectory({ HOME: '/srv/user' }, 'linux')).toBe(
        path.join('/srv/user', '.rapidkit')
      );
    });

    it('supports an absolute task-scoped state directory without replacing HOME', () => {
      expect(
        getWorkspaceRegistryDirectory(
          { HOME: '/srv/user', WORKSPAI_STATE_DIR: '/tmp/workspai-task-state' },
          'linux'
        )
      ).toBe(path.normalize('/tmp/workspai-task-state'));
    });

    it('keeps canonical and legacy registry candidates inside an isolated state boundary', () => {
      const isolatedStateDirectory = path.join(os.tmpdir(), 'workspai-task-state');
      const candidates = getWorkspaceRegistryFileCandidates(
        {
          HOME: '/srv/user',
          XDG_CONFIG_HOME: '/srv/user/.config',
          APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
          WORKSPAI_STATE_DIR: isolatedStateDirectory,
        },
        'win32'
      );

      expect(candidates).toEqual([
        path.join(isolatedStateDirectory, 'workspaces.json'),
        path.join(isolatedStateDirectory, 'legacy', 'workspaces.json'),
      ]);
      expect(
        candidates.every((candidate) => {
          const relative = path.relative(isolatedStateDirectory, candidate);
          return (
            relative.length > 0 &&
            relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          );
        })
      ).toBe(true);
    });

    it('ignores a relative task-scoped state directory', () => {
      expect(
        getWorkspaceRegistryDirectory(
          { HOME: '/srv/user', WORKSPAI_STATE_DIR: 'relative-state' },
          'linux'
        )
      ).toBe(path.join('/srv/user', '.workspai'));
    });

    it('uses XDG_CONFIG_HOME ahead of APPDATA for Windows compatibility candidates', () => {
      const candidates = getWorkspaceRegistryFileCandidates(
        {
          USERPROFILE: 'C:\\Users\\user',
          XDG_CONFIG_HOME: 'D:\\xdg',
          APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
        },
        'win32'
      );
      expect(candidates).toContain(path.join('D:\\xdg', 'workspai', 'workspaces.json'));
      expect(candidates).not.toContain(
        path.join('C:\\Users\\user\\AppData\\Roaming', 'workspai', 'workspaces.json')
      );
    });
  });

  describe('getUserLocalBinCandidates', () => {
    it('returns windows-specific bin paths when USERPROFILE, APPDATA, LOCALAPPDATA are set', () => {
      const env = {
        USERPROFILE: 'C:\\Users\\user',
        APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local',
      };
      const candidates = getUserLocalBinCandidates(env, 'win32');
      expect(candidates).toContain(path.join('C:\\Users\\user', '.local', 'bin'));
      expect(candidates).toContain(
        path.join('C:\\Users\\user\\AppData\\Roaming', 'Python', 'Scripts')
      );
      expect(candidates).toContain(
        path.join('C:\\Users\\user\\AppData\\Local', 'Programs', 'Python', 'Scripts')
      );
    });

    it('returns only .local/bin on linux', () => {
      const candidates = getUserLocalBinCandidates({}, 'linux');
      expect(candidates).toEqual([path.join(os.homedir(), '.local', 'bin')]);
    });

    it('returns empty windows candidates when env vars are absent', () => {
      const candidates = getUserLocalBinCandidates({}, 'win32');
      expect(candidates).toHaveLength(0);
    });
  });
});
