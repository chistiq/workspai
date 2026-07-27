import path from 'path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  augmentPathWithNodeBin,
  buildLatestStableGeneratorEnv,
  buildPackageRunnerSubprocessEnv,
  resolvePackageRunnerInvocation,
  resolvePackageRunnerExecutable,
} from '../utils/platform-capabilities.js';

describe('platform-capabilities package runners', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves package runners as command-safe invocations', () => {
    const invocation = resolvePackageRunnerInvocation('npm');

    expect(invocation.command).toBeTruthy();

    if (invocation.command === process.execPath) {
      expect(invocation.prefixArgs[0]).toMatch(/npm-cli\.js$/);
    } else if (invocation.command === 'corepack') {
      expect(invocation.prefixArgs).toEqual(['npm']);
    } else {
      expect(path.basename(invocation.command)).toMatch(/^npm(?:\.cmd)?$/);
      expect(invocation.prefixArgs).toEqual([]);
    }
  });

  it('keeps the legacy executable helper compatible with invocation resolution', () => {
    const resolved = resolvePackageRunnerExecutable('npm');
    expect(resolved).toBe(resolvePackageRunnerInvocation('npm').command);
  });

  it('uses node and npm CLI JavaScript on Windows without losing spaced paths', () => {
    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const npmCli = 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
      const value = String(candidate);
      return value === npmCli || value.endsWith('npm.cmd');
    });

    const invocation = resolvePackageRunnerInvocation(
      'npm',
      'win32',
      { npm_execpath: npmCli },
      node
    );

    expect(invocation).toEqual({ command: node, prefixArgs: [npmCli] });
  });

  it('resolves npm and npx sibling CLI files from npm_execpath', () => {
    const node = '/opt/node/bin/node';
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) =>
      ['/opt/npm/bin/npm-cli.js', '/opt/npm/bin/npx-cli.js'].includes(String(candidate))
    );

    expect(
      resolvePackageRunnerInvocation(
        'npx',
        'linux',
        {
          npm_execpath: '/opt/npm/bin/npm-cli.js',
        },
        node
      )
    ).toEqual({ command: node, prefixArgs: ['/opt/npm/bin/npx-cli.js'] });
    expect(
      resolvePackageRunnerInvocation(
        'npm',
        'linux',
        {
          npm_execpath: '/opt/npm/bin/npx-cli.js',
        },
        node
      )
    ).toEqual({ command: node, prefixArgs: ['/opt/npm/bin/npm-cli.js'] });
  });

  it('uses well-known CLI locations, adjacent shims, and safe fallbacks in priority order', () => {
    const node = '/opt/node/bin/node';
    const existsSpy = vi.spyOn(fs, 'existsSync');

    existsSpy.mockImplementation((candidate) =>
      String(candidate).endsWith('/lib/node_modules/npm/bin/npm-cli.js')
    );
    expect(resolvePackageRunnerInvocation('npm', 'linux', {}, node)).toEqual({
      command: node,
      prefixArgs: ['/opt/node/lib/node_modules/npm/bin/npm-cli.js'],
    });

    existsSpy.mockImplementation((candidate) => String(candidate) === '/opt/node/bin/yarn');
    expect(resolvePackageRunnerInvocation('yarn', 'linux', {}, node)).toEqual({
      command: '/opt/node/bin/yarn',
      prefixArgs: [],
    });

    existsSpy.mockReturnValue(false);
    expect(resolvePackageRunnerInvocation('npm', 'linux', {}, node)).toEqual({
      command: 'corepack',
      prefixArgs: ['npm'],
    });
    expect(resolvePackageRunnerInvocation('pnpm', 'linux', {}, node)).toEqual({
      command: 'pnpm',
      prefixArgs: [],
    });
    expect(resolvePackageRunnerInvocation(' custom ', 'linux', {}, node)).toEqual({
      command: 'custom',
      prefixArgs: [],
    });
  });

  it('prepends the Node bin directory to PATH', () => {
    const delimiter = process.platform === 'win32' ? ';' : ':';
    const augmented = augmentPathWithNodeBin(['/usr/bin', '/bin'].join(delimiter));
    expect(augmented.startsWith(`${path.dirname(process.execPath)}${delimiter}`)).toBe(true);
    expect(augmented).toContain('/usr/bin');
  });

  it('does not duplicate an existing Node bin and supports Windows delimiters', () => {
    const nodeBin = path.dirname(process.execPath);
    const nativeDelimiter = process.platform === 'win32' ? ';' : ':';
    expect(
      augmentPathWithNodeBin(
        `${nodeBin}${nativeDelimiter}/usr/bin`,
        process.platform,
        process.execPath
      )
    ).toBe(`${nodeBin}${nativeDelimiter}/usr/bin`);

    const windowsNode = 'C:\\Program Files\\nodejs\\node.exe';
    expect(augmentPathWithNodeBin('C:\\Windows;C:\\Tools', 'win32', windowsNode)).toBe(
      'C:\\Program Files\\nodejs;C:\\Windows;C:\\Tools'
    );
  });

  it('strips parent npx --package pins from nested runner env', () => {
    const env = buildPackageRunnerSubprocessEnv({
      PATH: '/usr/bin',
      npm_config_package: 'file:/tmp/rapidkit-npm',
      npm_config__package: 'file:/tmp/rapidkit-npm',
      HOME: '/home/dev',
    });

    expect(env.npm_config_package).toBeUndefined();
    expect(env.npm_config__package).toBeUndefined();
    expect(env.HOME).toBe('/home/dev');
    expect(env.PATH?.split(process.platform === 'win32' ? ';' : ':')).toContain(
      path.dirname(process.execPath)
    );
  });

  it('preserves an explicit corepack cache and otherwise provisions a temporary one', () => {
    expect(
      buildPackageRunnerSubprocessEnv({ PATH: '', COREPACK_HOME: '/cache/corepack' }, 'linux')
        .COREPACK_HOME
    ).toBe('/cache/corepack');
    expect(buildPackageRunnerSubprocessEnv({ PATH: '' }, 'linux').COREPACK_HOME).toBe(
      path.join(os.tmpdir(), 'rapidkit-corepack')
    );
  });

  it('enforces upstream Node engine compatibility for latest-stable generators', () => {
    const env = buildLatestStableGeneratorEnv(
      {
        PATH: '/usr/bin',
        npm_config_package: 'file:/tmp/workspai',
      },
      'linux'
    );

    expect(env.npm_config_engine_strict).toBe('true');
    expect(env.npm_config_package).toBeUndefined();
    expect(env.PATH).toContain(path.dirname(process.execPath));
  });
});
