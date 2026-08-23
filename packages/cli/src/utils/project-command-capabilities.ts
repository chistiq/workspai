import fs from 'fs';
import path from 'path';

import {
  detectBackendFrameworkFromProject,
  detectNestedRuntimeCandidatesFromProject,
  detectRuntimeCandidatesFromProject,
  type BackendFrameworkDetection,
} from './backend-framework-contract.js';
import { getRuntimeAdapter } from './runtime-adapters.js';
import { readProjectMetadata, type ProjectMetadata } from './project-metadata.js';
import { projectMetadataCandidates } from './workspace-paths.js';
import {
  getFrameworkSupportTier,
  getRuntimeSupport,
  type RapidKitSupportTier,
} from './support-matrix.js';
import { isCoreDelegatedProjectCommand, hasNpmRuntimeExecutor } from './runtime-executors.js';
import { WORKSPACE_RUN_STAGES, type WorkspaceRunStageName } from './cli-lifecycle-contract.js';
import {
  buildProjectAwareRuntimeCommandSupport,
  isRuntimeLifecycleCommandAvailable,
  type LifecycleProbeCommand,
} from './runtime-lifecycle-probes.js';

export type CommandExecutionScope =
  'universal' | 'global' | 'local-only' | 'fleet' | 'core-delegated';

export type CommandCapabilityStatus = 'supported' | 'unsupported' | 'global';
export type CommandCapabilityOwner = 'npm' | 'core' | 'runtime' | 'none';

export interface CommandCapability {
  command: string;
  owner: CommandCapabilityOwner;
  status: CommandCapabilityStatus;
  reason?: string;
  executionScope?: CommandExecutionScope;
  fleetEligible?: boolean;
}

export interface ProjectCommandCapabilities {
  schemaVersion: 1;
  scope: 'project';
  projectRoot: string | null;
  engine: 'npm' | 'pip' | 'python' | 'unknown';
  runtime: string;
  runtimeCandidates: string[];
  compositeRuntime: boolean;
  lifecycleCoverage: 'complete' | 'primary-runtime-only';
  framework: string;
  frameworkDisplayName: string;
  frameworkConfidence: string;
  frameworkSupportTier: RapidKitSupportTier;
  runtimeSupportTier: RapidKitSupportTier;
  runtimeDoctorSupport: 'full' | 'readiness' | 'observed';
  moduleSupport: boolean;
  fleetStages: WorkspaceRunStageName[];
  localOnlyCommands: string[];
  commandMap: Record<string, CommandCapability>;
  supportedCommands: string[];
  unsupportedCommands: string[];
  globalCommands: string[];
}

const UNIVERSAL_COMMANDS = ['version', 'commands', 'doctor', 'project', 'help'] as const;

const RUNTIME_COMMANDS = ['init', 'dev', 'start', 'build', 'test', 'lint', 'format'] as const;

const CORE_PROJECT_COMMANDS = ['docs'] as const;

const CORE_MODULE_COMMANDS = [
  'add',
  'modules',
  'upgrade',
  'diff',
  'merge',
  'reconcile',
  'rollback',
  'uninstall',
  'checkpoint',
  'snapshot',
  'optimize',
] as const;

const ENGINE_GLOBAL_COMMANDS = ['create', 'list', 'info', 'frameworks', 'license'] as const;

export const PROJECT_CAPABILITY_COMMANDS = [
  ...UNIVERSAL_COMMANDS,
  ...RUNTIME_COMMANDS,
  ...CORE_PROJECT_COMMANDS,
  ...CORE_MODULE_COMMANDS,
  ...ENGINE_GLOBAL_COMMANDS,
] as const;

/** Command groups mirrored in contracts/runtime-command-surface.v1.json */
export const RUNTIME_SURFACE_LIFECYCLE_COMMANDS = [...RUNTIME_COMMANDS, 'help'] as const;
export const RUNTIME_SURFACE_UNIVERSAL_COMMANDS = UNIVERSAL_COMMANDS.filter(
  (command) => command !== 'help'
);
export const RUNTIME_SURFACE_MODULE_MUTATION_COMMANDS = [...CORE_MODULE_COMMANDS];
export const RUNTIME_SURFACE_GLOBAL_COMMANDS = [...ENGINE_GLOBAL_COMMANDS];
export const RUNTIME_SURFACE_CORE_PROJECT_COMMANDS = [...CORE_PROJECT_COMMANDS];

export function findRapidkitProjectRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    const hasProjectMetadata = [
      ...projectMetadataCandidates(current, 'project.json'),
      ...projectMetadataCandidates(current, 'context.json'),
    ].some((candidate) => fs.existsSync(candidate));
    if (hasProjectMetadata) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function capability(command: string, data: Omit<CommandCapability, 'command'>): CommandCapability {
  return { command, ...data };
}

const LOCAL_ONLY_RUNTIME_COMMANDS = new Set<string>(['dev', 'lint', 'format']);
const FLEET_STAGE_COMMANDS = new Set<string>(WORKSPACE_RUN_STAGES);

function resolveRuntimeCommandExecutionScope(
  command: (typeof RUNTIME_COMMANDS)[number],
  runtimeSupported: boolean
): { executionScope: CommandExecutionScope; fleetEligible: boolean } {
  if (!runtimeSupported) {
    return { executionScope: 'local-only', fleetEligible: false };
  }
  if (FLEET_STAGE_COMMANDS.has(command)) {
    return { executionScope: 'fleet', fleetEligible: true };
  }
  if (LOCAL_ONLY_RUNTIME_COMMANDS.has(command)) {
    return { executionScope: 'local-only', fleetEligible: false };
  }
  return { executionScope: 'local-only', fleetEligible: false };
}

function resolveRuntimeCommandOwner(
  command: (typeof RUNTIME_COMMANDS)[number],
  detection: BackendFrameworkDetection
): CommandCapabilityOwner {
  if (isCoreDelegatedProjectCommand(detection.runtime, command)) {
    return 'core';
  }
  return 'runtime';
}

function isRuntimeLifecycleCommandSupported(
  projectRoot: string | null,
  command: (typeof RUNTIME_COMMANDS)[number],
  detection: BackendFrameworkDetection,
  runtimeCommandSupport: ReturnType<typeof buildProjectAwareRuntimeCommandSupport>
): boolean {
  if (!projectRoot) return false;
  if (!runtimeCommandSupport.lifecycleCommands.includes(command)) return false;

  return isRuntimeLifecycleCommandAvailable(
    projectRoot,
    detection.runtime,
    command as LifecycleProbeCommand,
    detection.key
  );
}

function resolveDocsCapability(
  projectRoot: string | null,
  detection: BackendFrameworkDetection
): CommandCapability {
  const supported =
    !!projectRoot &&
    (detection.runtime === 'python' ||
      (hasNpmRuntimeExecutor(detection.runtime) &&
        isRuntimeLifecycleCommandAvailable(
          projectRoot,
          detection.runtime,
          'build',
          detection.key
        )));

  return capability('docs', {
    owner: detection.runtime === 'python' ? 'core' : 'runtime',
    status: supported ? 'supported' : 'unsupported',
    reason: supported
      ? detection.runtime === 'python'
        ? 'Documentation generation is delegated to Python Core for this project.'
        : 'Project documentation commands are available through the npm wrapper for this runtime.'
      : 'Documentation commands require a supported Python or npm-executor project manifest.',
  });
}

function resolveCapabilityProjectRoot(start: string): string | null {
  const explicitPath = path.resolve(start);
  const metadataRoot = findRapidkitProjectRoot(start);
  if (metadataRoot) {
    return metadataRoot;
  }
  if (detectRuntimeCandidatesFromProject(explicitPath).length > 0) {
    return explicitPath;
  }
  return null;
}

export function resolveProjectCommandCapabilities(
  start: string = process.cwd()
): ProjectCommandCapabilities {
  const projectRoot = resolveCapabilityProjectRoot(start);
  const metadata: ProjectMetadata | null = projectRoot ? readProjectMetadata(projectRoot) : null;
  const detection =
    metadata?.detection ?? detectBackendFrameworkFromProject(start, metadata?.projectJson ?? null);
  const moduleSupport = metadata?.moduleSupport ?? false;
  const engine = metadata?.engine ?? 'unknown';
  const runtimeAdapter = getRuntimeAdapter(detection.runtime);
  const runtimeSupport = getRuntimeSupport(detection.runtime);
  const detectedRuntimeCandidates = projectRoot
    ? detectNestedRuntimeCandidatesFromProject(projectRoot)
    : [];
  const runtimeCandidates = [
    detection.runtime,
    ...detectedRuntimeCandidates.filter((runtime) => runtime !== detection.runtime),
  ].filter((runtime, index, values) => runtime !== 'unknown' && values.indexOf(runtime) === index);
  if (runtimeCandidates.length === 0) runtimeCandidates.push('unknown');
  const compositeRuntime = runtimeCandidates.filter((runtime) => runtime !== 'unknown').length > 1;
  const runtimeCommandSupport = buildProjectAwareRuntimeCommandSupport({
    runtime: detection.runtime,
    moduleSupport,
    projectPath: projectRoot ?? undefined,
    framework: detection.key,
  });
  const commandMap: Record<string, CommandCapability> = {};

  for (const command of UNIVERSAL_COMMANDS) {
    commandMap[command] = capability(command, {
      owner: command === 'project' ? 'core' : 'npm',
      status: 'supported',
      reason:
        command === 'project'
          ? 'Project detection is a Core contract; workspace project lifecycle remains npm-owned.'
          : command === 'help'
            ? 'Help is available for every Workspai project through the npm CLI.'
            : 'Universal command available across Workspai project types.',
    });
  }

  for (const command of RUNTIME_COMMANDS) {
    const runtimeSupported = isRuntimeLifecycleCommandSupported(
      projectRoot,
      command,
      detection,
      runtimeCommandSupport
    );
    const owner = resolveRuntimeCommandOwner(command, detection);
    const execution = resolveRuntimeCommandExecutionScope(command, runtimeSupported);
    commandMap[command] = capability(command, {
      owner,
      status: runtimeSupported ? 'supported' : 'unsupported',
      executionScope: execution.executionScope,
      fleetEligible: execution.fleetEligible,
      reason: runtimeSupported
        ? owner === 'core'
          ? `Delegated to Python Core for ${detection.displayName} projects.`
          : execution.fleetEligible
            ? `Handled by runtime adapter and eligible for workspace fleet stages (${command}).`
            : command === 'dev'
              ? `Local development command only; workspace fleet excludes dev by design.`
              : detection.runtime === 'node'
                ? `Handled by npm/pnpm/yarn via the resolved ${command} script in package.json.`
                : `Handled by the ${runtimeAdapter?.displayName ?? detection.displayName} runtime adapter for local project execution.`
        : !projectRoot
          ? 'No Workspai project was detected.'
          : detection.runtime === 'node'
            ? `No ${command} script was found in package.json for this ${detection.displayName} project.`
            : !hasNpmRuntimeExecutor(detection.runtime)
              ? `${detection.displayName} is tracked as an observed runtime; ${command} requires project manifests or explicit scripts.`
              : `The ${detection.displayName} runtime is tracked, but ${command} is not available from detected project manifests.`,
    });
  }

  if (compositeRuntime) {
    for (const command of RUNTIME_COMMANDS) {
      const entry = commandMap[command];
      if (!entry) continue;
      entry.reason =
        `Composite runtime boundary detected (${runtimeCandidates.join(', ')}). This capability describes only the primary ${detection.runtime} adapter; nested runtime lifecycle coverage requires explicit project boundaries or command contracts. ${entry.reason ?? ''}`.trim();
    }
  }

  commandMap.docs = resolveDocsCapability(projectRoot, detection);

  for (const command of CORE_MODULE_COMMANDS) {
    commandMap[command] = capability(command, {
      owner: moduleSupport ? 'core' : 'none',
      status: moduleSupport ? 'supported' : 'unsupported',
      reason: moduleSupport
        ? 'Core module/template command supported for this project.'
        : `Core module/template commands are not available for ${detection.displayName} projects.`,
    });
  }

  for (const command of ENGINE_GLOBAL_COMMANDS) {
    commandMap[command] = capability(command, {
      owner: command === 'create' ? 'npm' : 'core',
      status: 'global',
      reason:
        command === 'create'
          ? 'Create is orchestrated by npm for multi-language workspace support.'
          : 'Engine catalog command; not specific to the selected project runtime.',
    });
  }

  const entries = Object.values(commandMap);
  const supportedRuntimeCommands = entries
    .filter((entry) =>
      RUNTIME_COMMANDS.includes(entry.command as (typeof RUNTIME_COMMANDS)[number])
    )
    .filter((entry) => entry.status === 'supported');
  const fleetStages = WORKSPACE_RUN_STAGES.filter((stage) =>
    supportedRuntimeCommands.some(
      (entry) => entry.fleetEligible === true && entry.command === stage
    )
  );
  const localOnlyCommands = supportedRuntimeCommands
    .filter((entry) => entry.executionScope === 'local-only')
    .map((entry) => entry.command)
    .sort();

  return {
    schemaVersion: 1,
    scope: 'project',
    projectRoot,
    engine,
    runtime: detection.runtime,
    runtimeCandidates,
    compositeRuntime,
    lifecycleCoverage: compositeRuntime ? 'primary-runtime-only' : 'complete',
    framework: detection.key,
    frameworkDisplayName: detection.displayName,
    frameworkConfidence: detection.confidence,
    frameworkSupportTier: getFrameworkSupportTier(detection.key),
    runtimeSupportTier: runtimeSupport.tier,
    runtimeDoctorSupport: runtimeSupport.doctorSupport,
    moduleSupport,
    fleetStages,
    localOnlyCommands,
    commandMap,
    supportedCommands: entries
      .filter((entry) => entry.status === 'supported')
      .map((entry) => entry.command)
      .sort(),
    unsupportedCommands: entries
      .filter((entry) => entry.status === 'unsupported')
      .map((entry) => entry.command)
      .sort(),
    globalCommands: entries
      .filter((entry) => entry.status === 'global')
      .map((entry) => entry.command)
      .sort(),
  };
}

export function getProjectCommandCapability(
  args: readonly string[],
  start: string = process.cwd()
): CommandCapability | null {
  const command = args[0];
  if (!command) return null;
  const capabilities = resolveProjectCommandCapabilities(start);
  return capabilities.commandMap[command] ?? null;
}

export function isProjectCapabilityRequest(args: readonly string[]): boolean {
  if (args[0] === 'project' && args[1] === 'commands') return true;
  if (args[0] === 'commands' && args.includes('--scope')) {
    const idx = args.indexOf('--scope');
    return args[idx + 1] === 'project';
  }
  return args.some((arg) => arg === '--scope=project') && args[0] === 'commands';
}

export function formatUnsupportedProjectCommand(
  command: CommandCapability,
  capabilities: ProjectCommandCapabilities
): string {
  const lines = [
    `Workspai command not supported for this project: ${command.command}`,
    '',
    `Project: ${capabilities.projectRoot ?? 'not detected'}`,
    `Runtime: ${capabilities.runtime}`,
    `Framework: ${capabilities.frameworkDisplayName}`,
    `Reason: ${command.reason ?? 'Unsupported for this project type.'}`,
    '',
    'Run `workspai project commands` to inspect supported commands for this project.',
  ];
  return lines.join('\n');
}
