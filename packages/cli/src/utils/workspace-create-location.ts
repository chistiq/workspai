import path from 'path';
import { homedir } from 'node:os';
import process from 'node:process';
import fsExtra from 'fs-extra';

import { prompt } from '../cli-ui/prompts.js';
import { isCliJsonLogFormat } from '../observability/cli-log-format.js';
import { getCanonicalWorkspacesDirectory, resolveNewWorkspacePath } from './workspace-paths.js';

export type WorkspaceCreateLocationChoice = {
  value: 'managed' | 'here';
  label: string;
  hint: string;
};

export class NestedWorkspaceCreationError extends Error {
  readonly code = 'WORKSPACE_NESTING_NOT_SUPPORTED';

  constructor(
    readonly targetPath: string,
    readonly containingWorkspacePath: string
  ) {
    super(
      [
        'Workspai workspaces cannot be nested.',
        `Target: ${targetPath}`,
        `Containing workspace: ${containingWorkspacePath}`,
        'Choose Managed home or pass --output <path> with a location outside the current workspace.',
      ].join('\n')
    );
    this.name = 'NestedWorkspaceCreationError';
  }
}

async function workspaceBoundaryExists(markerPath: string): Promise<boolean> {
  try {
    return Boolean(await fsExtra.stat(markerPath));
  } catch {
    return false;
  }
}

export function readArgvFlagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index >= 0 && index + 1 < argv.length) {
    return argv[index + 1];
  }
  const equalsForm = argv.find((token) => token.startsWith(`${flag}=`));
  if (equalsForm) {
    return equalsForm.slice(flag.length + 1);
  }
  return undefined;
}

export function hasWorkspaceHereFlag(argv: readonly string[]): boolean {
  return argv.includes('--here');
}

export async function findContainingWorkspaceRoot(startPath: string): Promise<string | undefined> {
  let currentPath = path.resolve(startPath);

  while (true) {
    const markerPaths = [
      path.join(currentPath, '.workspai-workspace'),
      path.join(currentPath, '.rapidkit-workspace'),
      path.join(currentPath, '.workspai', 'workspace.json'),
      path.join(currentPath, '.rapidkit', 'workspace.json'),
    ];
    if ((await Promise.all(markerPaths.map(workspaceBoundaryExists))).some(Boolean)) {
      return currentPath;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }
    currentPath = parentPath;
  }
}

export async function assertIndependentWorkspaceTarget(targetPath: string): Promise<void> {
  const resolvedTarget = path.resolve(targetPath);
  const containingWorkspacePath = await findContainingWorkspaceRoot(path.dirname(resolvedTarget));
  if (containingWorkspacePath) {
    throw new NestedWorkspaceCreationError(resolvedTarget, containingWorkspacePath);
  }
}

export async function buildWorkspaceCreateLocationChoices(
  workingDirectory: string,
  homeDir: string = homedir()
): Promise<WorkspaceCreateLocationChoice[]> {
  const managedRoot = getCanonicalWorkspacesDirectory(homeDir);
  const choices: WorkspaceCreateLocationChoice[] = [
    {
      value: 'managed',
      label: 'Managed home',
      hint: managedRoot,
    },
  ];

  if (!(await findContainingWorkspaceRoot(workingDirectory))) {
    choices.push({
      value: 'here',
      label: 'Current directory',
      hint: workingDirectory,
    });
  }

  return choices;
}

export function resolveWorkspaceParentFromArgs(
  argv: readonly string[],
  workingDirectory: string = process.cwd()
): string | undefined {
  if (hasWorkspaceHereFlag(argv)) {
    return path.resolve(workingDirectory);
  }

  const outputDir = readArgvFlagValue(argv, '--output');
  if (outputDir) {
    return path.resolve(outputDir);
  }

  return undefined;
}

export function formatWorkspaceCdCommand(
  workspacePath: string,
  workingDirectory: string = process.cwd()
): string {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedCwd = path.resolve(workingDirectory);
  const relativePath = path.relative(resolvedCwd, resolvedWorkspace);

  if (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return `cd ${relativePath}`;
  }

  return `cd ${resolvedWorkspace}`;
}

export function resolveWorkspaceTargetPath(
  workspaceName: string,
  options: {
    argv?: readonly string[];
    outputParent?: string;
    homeDir?: string;
  } = {}
): string {
  const argv = options.argv ?? [];
  const outputParent = options.outputParent ?? resolveWorkspaceParentFromArgs(argv, process.cwd());

  return resolveNewWorkspacePath(workspaceName.trim(), {
    homeDir: options.homeDir,
    outputDir: outputParent,
  });
}

export function shouldBlockExistingWorkspaceName(
  existingWorkspacePath: string | undefined,
  targetPath: string,
  options: {
    outputParent?: string;
  } = {}
): boolean {
  if (!existingWorkspacePath) {
    return false;
  }

  if (path.resolve(existingWorkspacePath) === path.resolve(targetPath)) {
    return true;
  }

  return options.outputParent === undefined;
}

export async function resolveWorkspaceOutputParent(
  argv: readonly string[],
  options: {
    hasYes?: boolean;
    cwd?: string;
    homeDir?: string;
    interactive?: boolean;
  } = {}
): Promise<string | undefined> {
  const workingDirectory = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const fromArgs = resolveWorkspaceParentFromArgs(argv, workingDirectory);
  if (fromArgs !== undefined) {
    return fromArgs;
  }

  const hasYes = options.hasYes ?? (argv.includes('--yes') || argv.includes('-y'));
  const shouldPrompt =
    options.interactive ?? (!hasYes && !!process.stdin.isTTY && !isCliJsonLogFormat());

  if (!shouldPrompt) {
    return undefined;
  }

  const choices = await buildWorkspaceCreateLocationChoices(workingDirectory, homeDir);
  if (choices.length === 1) {
    return undefined;
  }

  const { location } = (await prompt([
    {
      type: 'rawlist',
      name: 'location',
      message: 'Where should the workspace be created?',
      choices,
      default: 0,
    },
  ])) as { location: 'managed' | 'here' };

  if (location === 'here') {
    return path.resolve(workingDirectory);
  }

  return undefined;
}
