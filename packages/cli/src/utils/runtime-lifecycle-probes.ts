import fs from 'fs';
import path from 'path';

import type { BackendRuntimeFamily } from './backend-framework-contract.js';
import type { RuntimeCommand } from './runtime-adapters.js';
import { isCoreDelegatedProjectCommand, hasNpmRuntimeExecutor } from './runtime-executors.js';
import { buildRuntimeCommandSupport } from './support-matrix.js';
import {
  isNodeInitSupported,
  resolveNodeLifecycleScript,
  type NodeLifecycleCommand,
} from './node-lifecycle-scripts.js';
import { resolveGoRunTarget } from './go-lifecycle.js';
import { hasMakefileTarget } from './lifecycle-makefile.js';

export type LifecycleProbeCommand = Exclude<RuntimeCommand, 'help'>;

function pathExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function readTextIfExists(target: string): string {
  try {
    if (!pathExists(target)) return '';
    return fs.readFileSync(target, 'utf8');
  } catch {
    return '';
  }
}

function hasNestedCsproj(projectRoot: string): boolean {
  const queue = [projectRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.endsWith('.csproj')) {
        return true;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }
  return false;
}

function probePython(projectRoot: string, command: LifecycleProbeCommand): boolean {
  const hasPyProject = pathExists(path.join(projectRoot, 'pyproject.toml'));
  const hasRequirements =
    pathExists(path.join(projectRoot, 'requirements.txt')) ||
    pathExists(path.join(projectRoot, 'requirements.in'));
  const hasManagePy = pathExists(path.join(projectRoot, 'manage.py'));

  switch (command) {
    case 'init':
      return hasPyProject || hasRequirements;
    case 'dev':
    case 'start':
      return hasPyProject || hasManagePy || hasRequirements;
    case 'test':
      return hasPyProject || hasRequirements || pathExists(path.join(projectRoot, 'tests'));
    case 'build':
      return hasPyProject || hasRequirements;
    case 'lint':
    case 'format':
      return (
        hasPyProject ||
        hasRequirements ||
        hasManagePy ||
        pathExists(path.join(projectRoot, 'setup.py')) ||
        pathExists(path.join(projectRoot, 'setup.cfg'))
      );
    default:
      return false;
  }
}

function probeGo(projectRoot: string, command: LifecycleProbeCommand): boolean {
  const hasGoMod = pathExists(path.join(projectRoot, 'go.mod'));
  if (!hasGoMod) return false;

  switch (command) {
    case 'init':
      return true;
    case 'dev':
      return hasMakefileTarget(projectRoot, 'run') || resolveGoRunTarget(projectRoot) !== null;
    case 'test':
      return true;
    case 'build':
      return true;
    case 'start':
      return hasMakefileTarget(projectRoot, 'run') || resolveGoRunTarget(projectRoot) !== null;
    case 'lint':
      return (
        pathExists(path.join(projectRoot, '.golangci.yml')) ||
        pathExists(path.join(projectRoot, '.golangci.yaml')) ||
        hasMakefileTarget(projectRoot, 'lint')
      );
    case 'format':
      return true;
    default:
      return false;
  }
}

function probeJava(
  projectRoot: string,
  command: LifecycleProbeCommand,
  framework?: string
): boolean {
  const hasMaven = pathExists(path.join(projectRoot, 'pom.xml'));
  const hasGradle =
    pathExists(path.join(projectRoot, 'build.gradle')) ||
    pathExists(path.join(projectRoot, 'build.gradle.kts'));
  if (!hasMaven && !hasGradle) return false;
  const pom = readTextIfExists(path.join(projectRoot, 'pom.xml'));
  const gradle = [
    readTextIfExists(path.join(projectRoot, 'build.gradle')),
    readTextIfExists(path.join(projectRoot, 'build.gradle.kts')),
  ].join('\n');
  const hasSpringBootRunner =
    framework === 'springboot' ||
    pom.includes('spring-boot-maven-plugin') ||
    /org\.springframework\.boot|id\s*\(?\s*['"]org\.springframework\.boot['"]/u.test(gradle);
  const hasRunnableJar =
    hasSpringBootRunner ||
    /<mainClass>\s*[^<]+\s*<\/mainClass>/iu.test(pom) ||
    /\bmainClass(?:Name)?\s*(?:=|\.)/u.test(gradle);

  switch (command) {
    case 'init':
    case 'test':
    case 'build':
      return true;
    case 'dev':
      return hasSpringBootRunner;
    case 'start':
      return hasRunnableJar;
    case 'lint':
      return (
        hasMakefileTarget(projectRoot, 'lint') ||
        pom.includes('checkstyle') ||
        pom.includes('spotless-maven-plugin') ||
        gradle.includes('checkstyle') ||
        gradle.includes('spotless')
      );
    case 'format':
      return (
        hasMakefileTarget(projectRoot, 'format') ||
        pom.includes('spotless-maven-plugin') ||
        gradle.includes('spotless')
      );
    default:
      return false;
  }
}

function probeDotnet(projectRoot: string, command: LifecycleProbeCommand): boolean {
  const hasProjectFile = hasNestedCsproj(projectRoot);
  if (!hasProjectFile) return false;

  switch (command) {
    case 'init':
    case 'dev':
    case 'test':
    case 'build':
    case 'start':
      return true;
    case 'lint':
      return (
        hasMakefileTarget(projectRoot, 'lint') ||
        readTextIfExists(path.join(projectRoot, 'Directory.Build.props')).includes(
          'EnforceCodeStyleInBuild'
        )
      );
    case 'format':
      return (
        hasMakefileTarget(projectRoot, 'format') ||
        pathExists(path.join(projectRoot, '.editorconfig'))
      );
    default:
      return false;
  }
}

function probeNode(
  projectRoot: string,
  command: LifecycleProbeCommand,
  framework?: string
): boolean {
  if (command === 'init') {
    return isNodeInitSupported(projectRoot);
  }

  return (
    resolveNodeLifecycleScript(projectRoot, command as NodeLifecycleCommand, { framework }) !== null
  );
}

function probeManifestRuntime(
  projectRoot: string,
  runtime: BackendRuntimeFamily,
  command: LifecycleProbeCommand
): boolean {
  switch (runtime) {
    case 'php':
      return command === 'init' && pathExists(path.join(projectRoot, 'composer.json'));
    case 'ruby':
      return command === 'init' && pathExists(path.join(projectRoot, 'Gemfile'));
    case 'rust':
      if (!pathExists(path.join(projectRoot, 'Cargo.toml'))) return false;
      return command === 'init' || command === 'test' || command === 'build' || command === 'start';
    case 'elixir':
      return command === 'init' && pathExists(path.join(projectRoot, 'mix.exs'));
    case 'deno':
      if (
        pathExists(path.join(projectRoot, 'deno.json')) ||
        pathExists(path.join(projectRoot, 'deno.jsonc'))
      ) {
        return command === 'init' || command === 'dev' || command === 'test' || command === 'start';
      }
      return command === 'init' && pathExists(path.join(projectRoot, 'package.json'));
    case 'bun':
      if (
        pathExists(path.join(projectRoot, 'bunfig.toml')) ||
        pathExists(path.join(projectRoot, '.bunfig.toml')) ||
        pathExists(path.join(projectRoot, 'bun.lock'))
      ) {
        return (
          command === 'init' ||
          command === 'dev' ||
          command === 'test' ||
          command === 'build' ||
          command === 'start'
        );
      }
      return command === 'init' && pathExists(path.join(projectRoot, 'package.json'));
    default:
      return false;
  }
}

function readComposerScripts(projectRoot: string): Set<string> {
  try {
    const manifest = JSON.parse(readTextIfExists(path.join(projectRoot, 'composer.json'))) as {
      scripts?: Record<string, unknown>;
    };
    return new Set(Object.keys(manifest.scripts ?? {}));
  } catch {
    return new Set();
  }
}

function probePhp(projectRoot: string, command: LifecycleProbeCommand): boolean {
  if (!pathExists(path.join(projectRoot, 'composer.json'))) return false;
  const scripts = readComposerScripts(projectRoot);
  const artisan = pathExists(path.join(projectRoot, 'artisan'));
  switch (command) {
    case 'init':
      return true;
    case 'dev':
      return artisan || scripts.has('dev');
    case 'start':
      return artisan || scripts.has('start');
    case 'test':
      return artisan || scripts.has('test');
    case 'build':
      return scripts.has('build');
    case 'lint':
      return scripts.has('lint') || scripts.has('analyse') || scripts.has('analyze');
    case 'format':
      return (
        scripts.has('format') ||
        scripts.has('fmt') ||
        pathExists(path.join(projectRoot, 'pint.json')) ||
        pathExists(path.join(projectRoot, 'vendor', 'bin', 'pint'))
      );
    default:
      return false;
  }
}

function probeRust(projectRoot: string, command: LifecycleProbeCommand): boolean {
  const manifestPath = path.join(projectRoot, 'Cargo.toml');
  if (!pathExists(manifestPath)) return false;

  if (command === 'dev' || command === 'start') {
    const manifest = readTextIfExists(manifestPath);
    const hasPackage = /^\s*\[package\]\s*$/m.test(manifest);
    if (!hasPackage) return false;

    const hasExplicitBinary = /^\s*\[\[bin\]\]\s*$/m.test(manifest);
    const autoBinariesDisabled = /^\s*autobins\s*=\s*false\s*(?:#.*)?$/m.test(manifest);
    const hasDefaultBinary =
      !autoBinariesDisabled && pathExists(path.join(projectRoot, 'src', 'main.rs'));
    return hasExplicitBinary || hasDefaultBinary;
  }

  return (
    command === 'init' ||
    command === 'build' ||
    command === 'test' ||
    command === 'lint' ||
    command === 'format'
  );
}

export function isRuntimeLifecycleCommandAvailable(
  projectRoot: string,
  runtime: BackendRuntimeFamily | string,
  command: LifecycleProbeCommand,
  framework?: string
): boolean {
  if (isCoreDelegatedProjectCommand(runtime, command)) {
    return probePython(projectRoot, command);
  }

  if (!hasNpmRuntimeExecutor(runtime)) {
    return probeManifestRuntime(projectRoot, runtime as BackendRuntimeFamily, command);
  }

  switch (runtime) {
    case 'node':
      return probeNode(projectRoot, command, framework);
    case 'bun':
      return probeNode(projectRoot, command, framework);
    case 'python':
      return probePython(projectRoot, command);
    case 'go':
      return probeGo(projectRoot, command);
    case 'java':
      return probeJava(projectRoot, command, framework);
    case 'dotnet':
      return probeDotnet(projectRoot, command);
    case 'rust':
      return probeRust(projectRoot, command);
    case 'php':
      return probePhp(projectRoot, command);
    default:
      return false;
  }
}

export function listAvailableRuntimeLifecycleCommands(
  projectRoot: string,
  runtime: BackendRuntimeFamily | string,
  framework?: string
): LifecycleProbeCommand[] {
  const candidates: LifecycleProbeCommand[] = [
    'init',
    'dev',
    'start',
    'build',
    'test',
    'lint',
    'format',
  ];
  return candidates.filter((command) =>
    isRuntimeLifecycleCommandAvailable(projectRoot, runtime, command, framework)
  );
}

export function buildProjectAwareRuntimeCommandSupport(input: {
  runtime: string;
  moduleSupport: boolean;
  projectPath?: string;
  framework?: string;
}): {
  lifecycleCommands: RuntimeCommand[];
  moduleCommands: boolean;
  unsupportedLifecycleCommands: RuntimeCommand[];
} {
  const base = buildRuntimeCommandSupport({
    runtime: input.runtime,
    moduleSupport: input.moduleSupport,
  });

  if (!input.projectPath) {
    return base;
  }

  const available = listAvailableRuntimeLifecycleCommands(
    input.projectPath,
    input.runtime,
    input.framework
  );
  const lifecycleCommands = new Set<RuntimeCommand>(['help']);

  for (const command of available) {
    if (base.lifecycleCommands.includes(command)) {
      lifecycleCommands.add(command);
    }
  }

  if (input.runtime === 'node' && isNodeInitSupported(input.projectPath)) {
    lifecycleCommands.add('init');
  }

  const resolvedLifecycleCommands = [...lifecycleCommands].sort();
  return {
    lifecycleCommands: resolvedLifecycleCommands,
    moduleCommands: base.moduleCommands,
    unsupportedLifecycleCommands: base.lifecycleCommands
      .filter((command) => !resolvedLifecycleCommands.includes(command))
      .sort(),
  };
}
