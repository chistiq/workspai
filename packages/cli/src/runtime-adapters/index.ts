import type { RuntimeAdapter, RuntimeName } from './types.js';
import { DotnetRuntimeAdapter } from './dotnet.js';
import { GoRuntimeAdapter } from './go.js';
import { JavaRuntimeAdapter } from './java.js';
import { NodeRuntimeAdapter } from './node.js';
import { PythonRuntimeAdapter } from './python.js';
import { PhpRuntimeAdapter } from './php.js';
import { RustRuntimeAdapter } from './rust.js';
import path from 'path';
import { getDefaultPythonCommand } from '../utils/platform-capabilities.js';

export type AdapterDeps = {
  runCommandInCwd: (command: string, args: string[], cwd: string) => Promise<number>;
  runCoreRapidkit: (
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv }
  ) => Promise<number>;
};

export function areRuntimeAdaptersEnabled(): boolean {
  return process.env.RAPIDKIT_ENABLE_RUNTIME_ADAPTERS === '1';
}

function buildPythonCoreEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  const rawPath = env.PATH || '';
  if (rawPath) {
    const sanitized = rawPath
      .split(path.delimiter)
      .filter((segment) => !segment.replace(/\\/g, '/').includes('/.pyenv/shims'))
      .join(path.delimiter);
    env.PATH = sanitized;
  }

  // Prefer system Python during Poetry interpreter discovery to avoid broken
  // pyenv shim invocations in mixed workspaces.
  env.PYENV_VERSION = 'system';
  env.POETRY_PYTHON = env.POETRY_PYTHON || getDefaultPythonCommand();

  // Keep workspace init/bootstrap fast by default. Core can still be forced to
  // perform lock sync via RAPIDKIT_SKIP_LOCK_SYNC=0 when needed.
  if (typeof env.RAPIDKIT_SKIP_LOCK_SYNC === 'undefined') {
    env.RAPIDKIT_SKIP_LOCK_SYNC = '1';
  }

  return env;
}

export function getRuntimeAdapter(runtime: RuntimeName, deps: AdapterDeps): RuntimeAdapter {
  if (runtime === 'go') {
    return new GoRuntimeAdapter((command, args, cwd) => deps.runCommandInCwd(command, args, cwd));
  }

  if (runtime === 'node') {
    return new NodeRuntimeAdapter((command, args, cwd) => deps.runCommandInCwd(command, args, cwd));
  }

  if (runtime === 'java') {
    return new JavaRuntimeAdapter((command, args, cwd) => deps.runCommandInCwd(command, args, cwd));
  }

  if (runtime === 'dotnet') {
    return new DotnetRuntimeAdapter((command, args, cwd) =>
      deps.runCommandInCwd(command, args, cwd)
    );
  }

  if (runtime === 'rust') {
    return new RustRuntimeAdapter((command, args, cwd) => deps.runCommandInCwd(command, args, cwd));
  }

  if (runtime === 'php') {
    return new PhpRuntimeAdapter((command, args, cwd) => deps.runCommandInCwd(command, args, cwd));
  }

  return new PythonRuntimeAdapter((args, cwd) =>
    deps.runCoreRapidkit(args, { cwd, env: buildPythonCoreEnv() })
  );
}
