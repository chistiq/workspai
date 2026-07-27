import type { BackendRuntimeFamily } from './backend-framework-contract.js';
import type { RuntimeCommand } from './runtime-adapters.js';
import { getRuntimeSupport } from './support-matrix.js';

/** Runtimes with npm-owned execution adapters in `src/runtime-adapters/`. */
export const NPM_EXECUTOR_RUNTIMES = [
  'python',
  'node',
  'go',
  'java',
  'dotnet',
  'rust',
  'php',
] as const;

export type NpmExecutorRuntime = (typeof NPM_EXECUTOR_RUNTIMES)[number];

export function hasNpmRuntimeExecutor(runtime: string | undefined): runtime is NpmExecutorRuntime {
  return !!runtime && (NPM_EXECUTOR_RUNTIMES as readonly string[]).includes(runtime);
}

/** Commands delegated to Python Core when npm wrapper cannot execute them locally. */
export function isCoreDelegatedProjectCommand(
  runtime: string | undefined,
  command: RuntimeCommand | string
): boolean {
  if (command !== 'lint' && command !== 'format' && command !== 'docs') {
    return false;
  }
  return runtime === 'python';
}

export function getCatalogLifecycleCommands(runtime: string | undefined): RuntimeCommand[] {
  return getRuntimeSupport(runtime).lifecycleCommands;
}

export function resolveRuntimeCatalogEntry(runtime: BackendRuntimeFamily | string): {
  runtime: string;
  displayName: string;
  lifecycleCommands: RuntimeCommand[];
  hasExecutor: boolean;
  packageManagers: string[];
  primaryFiles: string[];
  notes: string[];
} {
  const support = getRuntimeSupport(runtime);
  const hasExecutor = hasNpmRuntimeExecutor(support.runtime);
  const packageManagers = RUNTIME_PACKAGE_MANAGERS[support.runtime] ?? [];
  const primaryFiles = RUNTIME_PRIMARY_FILES[support.runtime] ?? [];

  return {
    runtime: support.runtime,
    displayName: support.displayName,
    lifecycleCommands: support.lifecycleCommands,
    hasExecutor,
    packageManagers,
    primaryFiles,
    notes: support.notes,
  };
}

const RUNTIME_PACKAGE_MANAGERS: Partial<Record<BackendRuntimeFamily, string[]>> = {
  python: ['poetry', 'pip', 'uv'],
  node: ['npm', 'pnpm', 'yarn', 'bun'],
  go: ['go'],
  java: ['maven', 'gradle'],
  dotnet: ['dotnet'],
  php: ['composer'],
  ruby: ['bundle'],
  rust: ['cargo'],
  elixir: ['mix'],
  kotlin: ['gradle'],
  deno: ['deno'],
  bun: ['bun'],
};

const RUNTIME_PRIMARY_FILES: Partial<Record<BackendRuntimeFamily, string[]>> = {
  python: ['pyproject.toml', 'requirements.txt', 'requirements.in'],
  node: ['package.json'],
  go: ['go.mod'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  dotnet: ['*.csproj', '*.sln'],
  php: ['composer.json'],
  ruby: ['Gemfile'],
  rust: ['Cargo.toml'],
  elixir: ['mix.exs'],
  kotlin: ['settings.gradle.kts'],
  deno: ['deno.json', 'deno.jsonc'],
  bun: ['package.json', 'bunfig.toml'],
};
