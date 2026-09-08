import fs from 'fs';
import path from 'path';

import {
  getFrontendLifecycleScriptCandidates,
  normalizeFrontendFrameworkLabel,
} from './frontend-framework-contract.js';

export type NodeLifecycleCommand = 'dev' | 'start' | 'build' | 'test' | 'lint' | 'format';

export type NodeLifecycleScriptResolution = {
  scriptName: string;
  source: 'package.json' | 'framework-candidate' | 'generic-candidate';
};

const NODE_LIFECYCLE_COMMANDS: NodeLifecycleCommand[] = [
  'dev',
  'start',
  'build',
  'test',
  'lint',
  'format',
];

const GENERIC_SCRIPT_CANDIDATES: Record<NodeLifecycleCommand, string[]> = {
  dev: ['dev', 'start:dev', 'watch'],
  start: ['start', 'start:prod', 'preview'],
  build: ['build', 'compile'],
  test: ['test', 'test:unit', 'test:ci'],
  lint: ['lint', 'eslint'],
  format: ['format', 'prettier'],
};

const BACKEND_NODE_LIFECYCLE_CANDIDATES: Partial<
  Record<string, Partial<Record<NodeLifecycleCommand, string[]>>>
> = {
  nestjs: {
    dev: ['dev', 'start:dev'],
    start: ['start', 'start:prod'],
    build: ['build'],
    test: ['test', 'test:e2e'],
    lint: ['lint'],
    format: ['format'],
  },
  express: {
    dev: ['dev', 'start:dev'],
    start: ['start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  fastify: {
    dev: ['dev', 'start:dev'],
    start: ['start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  koa: {
    dev: ['dev', 'start:dev'],
    start: ['start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
};

export function readPackageScripts(projectPath: string): Record<string, string> {
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = packageJson.scripts ?? {};
    return Object.fromEntries(
      Object.entries(scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
}

function collectScriptCandidates(command: NodeLifecycleCommand, framework?: string): string[] {
  const normalizedFramework = framework ? normalizeFrontendFrameworkLabel(framework) : 'unknown';
  const frameworkCandidates =
    normalizedFramework !== 'unknown'
      ? getFrontendLifecycleScriptCandidates(normalizedFramework, command)
      : [];
  const backendCandidates = framework
    ? (BACKEND_NODE_LIFECYCLE_CANDIDATES[framework]?.[command] ?? [])
    : [];
  const genericCandidates = GENERIC_SCRIPT_CANDIDATES[command] ?? [];

  const ordered = [...frameworkCandidates, ...backendCandidates, ...genericCandidates];
  return [...new Set(ordered)];
}

export function resolveNodeLifecycleScript(
  projectPath: string,
  command: NodeLifecycleCommand,
  options?: { framework?: string }
): NodeLifecycleScriptResolution | null {
  const scripts = readPackageScripts(projectPath);
  const scriptNames = new Set(Object.keys(scripts));

  if (scriptNames.has(command)) {
    return { scriptName: command, source: 'package.json' };
  }

  for (const candidate of collectScriptCandidates(command, options?.framework)) {
    if (scriptNames.has(candidate)) {
      return {
        scriptName: candidate,
        source:
          getFrontendLifecycleScriptCandidates(
            normalizeFrontendFrameworkLabel(options?.framework ?? 'unknown'),
            command
          ).includes(candidate) ||
          BACKEND_NODE_LIFECYCLE_CANDIDATES[options?.framework ?? '']?.[command]?.includes(
            candidate
          )
            ? 'framework-candidate'
            : 'generic-candidate',
      };
    }
  }

  return null;
}

export function listSupportedNodeLifecycleCommands(
  projectPath: string,
  options?: { framework?: string }
): NodeLifecycleCommand[] {
  return NODE_LIFECYCLE_COMMANDS.filter(
    (command) => resolveNodeLifecycleScript(projectPath, command, options) !== null
  );
}

export function isNodeInitSupported(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, 'package.json'));
}
