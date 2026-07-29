import { spawn } from 'child_process';
import path from 'path';

import chalk from 'chalk';
import fsExtra from 'fs-extra';

import type {
  BackendPlatformKey,
  BackendRuntimeFamily,
} from './utils/backend-framework-contract.js';
import { buildCleanGitEnv } from './utils/git-worktree.js';
import {
  buildLatestStableGeneratorEnv,
  resolvePackageRunnerInvocation,
} from './utils/platform-capabilities.js';
import type { WorkspaceProjectCategory, WorkspaceProjectKind } from './utils/project-kind.js';
import { projectMetadataPath } from './utils/workspace-paths.js';
import { getVersion } from './update-checker.js';
import { validateProjectName } from './validation.js';
import { collectGeneratorVersionEvidence } from './utils/generator-version-evidence.js';

export type OfficialProjectGeneratorId = 'tauri' | 'electron' | 'vscode-extension' | 'laravel';

export interface OfficialProjectGeneratorDefinition {
  id: OfficialProjectGeneratorId;
  kitId: 'desktop.tauri' | 'desktop.electron' | 'extension.vscode' | 'php.laravel';
  aliases: string[];
  displayName: string;
  category: Extract<WorkspaceProjectCategory, 'backend' | 'desktop' | 'extension'>;
  kind: Extract<WorkspaceProjectKind, 'backend' | 'desktop' | 'extension'>;
  runtime: BackendRuntimeFamily;
  runtimeCandidates: BackendRuntimeFamily[];
  framework: BackendPlatformKey | 'tauri' | 'electron' | 'vscode-extension';
  supportTier: 'extended';
  versionPolicy: 'latest-stable';
  defaultPort?: number;
  officialSource: string;
  supportsSkipInstall: boolean;
  requiredTools: ToolRequirement[];
  recommendedTools?: ToolRequirement[];
  nodeSupport?: {
    requirement: string;
    ranges: Array<{ major?: number; minVersion: string }>;
    guidance: string;
  };
  commandDisplay: (name: string, options: GeneratorFlags) => string;
  commandExec: (name: string, options: GeneratorFlags) => CommandPlan;
  requiredArtifacts: string[];
}

type GeneratorFlags = {
  skipGit: boolean;
  skipInstall: boolean;
};

type CommandPlan = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

type ToolRequirement = {
  command: string;
  args: string[];
  label: string;
  guidance: string;
};

export interface CreateOfficialProjectResult {
  definition: OfficialProjectGeneratorDefinition;
  projectName: string;
  projectPath: string;
  dryRun: boolean;
  commandDisplay: string;
  commandExec: string[];
}

const OFFICIAL_PROJECT_GENERATORS: OfficialProjectGeneratorDefinition[] = [
  {
    id: 'tauri',
    kitId: 'desktop.tauri',
    aliases: ['desktop.tauri', 'tauri', 'tauri-app'],
    displayName: 'Tauri',
    category: 'desktop',
    kind: 'desktop',
    runtime: 'node',
    runtimeCandidates: ['node', 'rust'],
    framework: 'tauri',
    supportTier: 'extended',
    versionPolicy: 'latest-stable',
    defaultPort: 1420,
    officialSource: 'create-tauri-app',
    supportsSkipInstall: true,
    requiredTools: [
      {
        command: 'rustc',
        args: ['--version'],
        label: 'Rust toolchain',
        guidance: 'Install the current stable Rust toolchain from https://rustup.rs/ and retry.',
      },
      {
        command: 'cargo',
        args: ['--version'],
        label: 'Cargo',
        guidance: 'Install Cargo through the current stable Rust toolchain and retry.',
      },
    ],
    commandDisplay: (name) => `npm create tauri-app@latest ${name} -- --template vanilla-ts`,
    commandExec: (name) => ({
      command: 'npm',
      args: ['create', 'tauri-app@latest', name, '--', '--template', 'vanilla-ts'],
    }),
    requiredArtifacts: ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json'],
  },
  {
    id: 'electron',
    kitId: 'desktop.electron',
    aliases: ['desktop.electron', 'electron', 'electron-forge'],
    displayName: 'Electron Forge',
    category: 'desktop',
    kind: 'desktop',
    runtime: 'node',
    runtimeCandidates: ['node'],
    framework: 'electron',
    supportTier: 'extended',
    versionPolicy: 'latest-stable',
    officialSource: 'create-electron-app',
    supportsSkipInstall: false,
    requiredTools: [
      {
        command: 'git',
        args: ['--version'],
        label: 'Git',
        guidance: 'Install Git and make it available on PATH, then retry.',
      },
    ],
    commandDisplay: (name) => `npx create-electron-app@latest ${name} --template=vite-typescript`,
    commandExec: (name) => ({
      command: 'npx',
      args: ['--yes', 'create-electron-app@latest', name, '--template=vite-typescript'],
    }),
    requiredArtifacts: ['package.json'],
  },
  {
    id: 'vscode-extension',
    kitId: 'extension.vscode',
    aliases: ['extension.vscode', 'vscode', 'vscode-extension', 'visual-studio-code-extension'],
    displayName: 'VS Code Extension',
    category: 'extension',
    kind: 'extension',
    runtime: 'node',
    runtimeCandidates: ['node'],
    framework: 'vscode-extension',
    supportTier: 'extended',
    versionPolicy: 'latest-stable',
    officialSource: 'generator-code',
    supportsSkipInstall: false,
    nodeSupport: {
      requirement: '^22.22.2 || ^24.15.0 || >=26.0.0',
      ranges: [
        { major: 22, minVersion: '22.22.2' },
        { major: 24, minVersion: '24.15.0' },
        { minVersion: '26.0.0' },
      ],
      guidance:
        'Install Node.js 22.22.2+, 24.15.0+, or 26+ before running the latest stable VS Code Extension generator.',
    },
    requiredTools: [
      {
        command: 'git',
        args: ['--version'],
        label: 'Git',
        guidance:
          'Install Git to initialize source control, or create the project with --skip-git.',
      },
    ],
    commandDisplay: (name) =>
      `npx --package yo@latest --package generator-code@latest -- yo code ${name} --quick --extensionType ts --pkgManager npm --bundle esbuild`,
    commandExec: (name, options) => ({
      command: 'npx',
      args: [
        '--yes',
        '--package',
        'yo@latest',
        '--package',
        'generator-code@latest',
        '--',
        'yo',
        'code',
        name,
        '--quick',
        '--extensionType',
        'ts',
        '--extensionId',
        name,
        '--pkgManager',
        'npm',
        '--bundle',
        'esbuild',
        `--gitInit=${options.skipGit ? 'false' : 'true'}`,
      ],
    }),
    requiredArtifacts: ['package.json', 'src/extension.ts'],
  },
  {
    id: 'laravel',
    kitId: 'php.laravel',
    aliases: ['php.laravel', 'laravel', 'php-laravel'],
    displayName: 'Laravel',
    category: 'backend',
    kind: 'backend',
    runtime: 'php',
    runtimeCandidates: ['php', 'node'],
    framework: 'laravel',
    supportTier: 'extended',
    versionPolicy: 'latest-stable',
    defaultPort: 8000,
    officialSource: 'composer-create-project',
    supportsSkipInstall: false,
    requiredTools: [
      {
        command: 'php',
        args: ['--version'],
        label: 'PHP',
        guidance: 'Install a PHP version supported by the latest stable Laravel release and retry.',
      },
      {
        command: 'composer',
        args: ['--version'],
        label: 'Composer',
        guidance: 'Install the latest stable Composer release and retry.',
      },
    ],
    recommendedTools: [
      {
        command: 'npm',
        args: ['--version'],
        label: 'npm',
        guidance:
          'Install a supported Node.js LTS runtime when you want to build Laravel frontend assets.',
      },
    ],
    commandDisplay: (name) =>
      `composer create-project --no-interaction --prefer-dist --stability=stable laravel/laravel ${name}`,
    commandExec: (name) => ({
      command: 'composer',
      args: [
        'create-project',
        '--no-interaction',
        '--prefer-dist',
        '--stability=stable',
        'laravel/laravel',
        name,
      ],
    }),
    requiredArtifacts: ['composer.json', 'artisan'],
  },
];

const GENERATOR_BY_ALIAS = new Map<string, OfficialProjectGeneratorDefinition>();
for (const definition of OFFICIAL_PROJECT_GENERATORS) {
  GENERATOR_BY_ALIAS.set(definition.id, definition);
  GENERATOR_BY_ALIAS.set(definition.kitId, definition);
  for (const alias of definition.aliases) {
    GENERATOR_BY_ALIAS.set(alias.toLowerCase(), definition);
  }
}

export function listOfficialProjectGenerators(): OfficialProjectGeneratorDefinition[] {
  return [...OFFICIAL_PROJECT_GENERATORS];
}

export function resolveOfficialProjectGenerator(
  value: string | undefined
): OfficialProjectGeneratorDefinition | null {
  if (!value) return null;
  return GENERATOR_BY_ALIAS.get(value.trim().toLowerCase()) ?? null;
}

export function isOfficialProjectKit(value: string | undefined): boolean {
  return resolveOfficialProjectGenerator(value) !== null;
}

export function officialProjectCreateUsage(value?: string): string {
  const definition = resolveOfficialProjectGenerator(value);
  const kit = definition?.kitId ?? '<desktop.tauri|desktop.electron|extension.vscode|php.laravel>';
  return `workspai create project ${kit} <name> [--output <dir>] [--skip-git] [--skip-install] [--dry-run]`;
}

export async function createOfficialProject(args: string[]): Promise<CreateOfficialProjectResult> {
  if (args[0] !== 'create' || args[1] !== 'project') {
    throw new Error(
      'Official project create expects: create project <official.kit> <project-name>'
    );
  }
  const definition = resolveOfficialProjectGenerator(args[2]);
  if (!definition) {
    throw new Error(`Unknown official project generator: ${args[2] ?? '(missing)'}`);
  }
  const projectName = args[3];
  if (!projectName) {
    throw new Error(`Usage: ${officialProjectCreateUsage(definition.kitId)}`);
  }
  validateProjectName(projectName);

  const outputDir = readFlagValue(args, '--output') || process.cwd();
  const projectPath = path.resolve(outputDir, projectName);
  const dryRun = args.includes('--dry-run');
  const flags = {
    skipGit: args.includes('--skip-git') || args.includes('--no-git'),
    skipInstall: args.includes('--skip-install'),
  };
  if (flags.skipInstall && !definition.supportsSkipInstall) {
    throw new Error(
      `${definition.displayName}'s official generator does not support --skip-install. Remove the flag so Workspai can verify the official scaffold.`
    );
  }
  const plan = definition.commandExec(projectName, flags);
  const commandDisplay = definition.commandDisplay(projectName, flags);

  if (await fsExtra.pathExists(projectPath)) {
    throw new Error(`Directory "${projectPath}" already exists`);
  }
  if (dryRun) {
    printOfficialProjectPlan(definition, projectPath, commandDisplay, plan);
    return {
      definition,
      projectName,
      projectPath,
      dryRun,
      commandDisplay,
      commandExec: [plan.command, ...plan.args],
    };
  }

  assertOfficialGeneratorNodeSupport(definition);
  await assertOfficialGeneratorToolSupport(definition, flags);
  await fsExtra.ensureDir(path.dirname(projectPath));
  try {
    const exitCode = await runCommand(plan, path.dirname(projectPath));
    if (exitCode !== 0) {
      throw new Error(
        `Official ${definition.displayName} generator failed with exit code ${exitCode}`
      );
    }
    await assertOfficialScaffold(definition, projectPath);
    if (flags.skipGit) {
      await fsExtra.remove(path.join(projectPath, '.git'));
    }
    await writeOfficialProjectMetadata({
      definition,
      projectName,
      projectPath,
      commandDisplay,
      commandExec: [plan.command, ...plan.args],
      flags,
    });
  } catch (error) {
    await fsExtra.remove(projectPath).catch(() => undefined);
    throw error;
  }

  console.log(chalk.green(`\n✓ ${definition.displayName} scaffold ready`));
  console.log(chalk.gray(`  Location   ${projectPath}`));
  console.log(
    chalk.gray(`  Generator  ${definition.officialSource} · ${definition.versionPolicy}`)
  );
  console.log(chalk.green('  ✓ Required scaffold files verified'));
  console.log(chalk.green('  ✓ Generator and version evidence recorded in .workspai/'));
  if (definition.id === 'vscode-extension') {
    console.log(
      chalk.yellow(
        '  Note       Dependency warnings above come from the official generated project; Workspai keeps them visible for Doctor and CI.'
      )
    );
  }
  console.log(chalk.gray(`  Next       cd ${projectName} && npx workspai doctor project`));
  return {
    definition,
    projectName,
    projectPath,
    dryRun,
    commandDisplay,
    commandExec: [plan.command, ...plan.args],
  };
}

async function assertOfficialScaffold(
  definition: OfficialProjectGeneratorDefinition,
  projectPath: string
): Promise<void> {
  const missing: string[] = [];
  for (const relativePath of definition.requiredArtifacts) {
    if (!(await fsExtra.pathExists(path.join(projectPath, relativePath)))) {
      missing.push(relativePath);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Official ${definition.displayName} generator did not produce required artifacts: ${missing.join(', ')}`
    );
  }
}

async function writeOfficialProjectMetadata(input: {
  definition: OfficialProjectGeneratorDefinition;
  projectName: string;
  projectPath: string;
  commandDisplay: string;
  commandExec: string[];
  flags: GeneratorFlags;
}): Promise<void> {
  const generatedAt = new Date().toISOString();
  const version = getVersion();
  const versionEvidence = await collectGeneratorVersionEvidence(
    input.projectPath,
    input.definition.id === 'laravel' ? 'stable' : 'latest'
  );
  const projectJson = {
    schema_version: '1.0',
    name: input.projectName,
    slug: input.projectName,
    kind: input.definition.kind,
    project_type: input.definition.category,
    category: input.definition.category,
    runtime: input.definition.runtime,
    runtime_candidates: input.definition.runtimeCandidates,
    framework: input.definition.framework,
    framework_display_name: input.definition.displayName,
    kit_name: input.definition.kitId,
    kit: input.definition.kitId,
    engine: 'npm',
    support_tier: input.definition.supportTier,
    version_policy: input.definition.versionPolicy,
    module_support: false,
    modules: [],
    workspai_version: version,
    rapidkit_version: version,
    generated_by: 'workspai',
    generated_at: generatedAt,
    generator: {
      id: input.definition.id,
      source: input.definition.officialSource,
      official: true,
      version_policy: input.definition.versionPolicy,
      version_evidence: versionEvidence,
      command_display: input.commandDisplay,
      command_exec: input.commandExec,
      skip_install: input.flags.skipInstall,
      skip_git: input.flags.skipGit,
    },
    ...(input.definition.defaultPort
      ? {
          ports: [{ name: 'http', port: input.definition.defaultPort, protocol: 'http' as const }],
        }
      : {}),
    contracts: {
      owns: [],
      apis: [],
      publishes: [],
      consumes: [],
      dependsOn: [],
      env: [],
    },
  };
  const contextJson = {
    engine: 'npm',
    project: input.projectName,
    kind: input.definition.kind,
    category: input.definition.category,
    runtime: input.definition.runtime,
    runtimeCandidates: input.definition.runtimeCandidates,
    framework: input.definition.framework,
    source: 'official-generator',
    versionPolicy: input.definition.versionPolicy,
  };
  const evidenceJson = {
    schema_version: '1.0',
    kind: 'workspai.official_project_create',
    generated_at: generatedAt,
    project: {
      name: input.projectName,
      path: input.projectPath,
      kind: input.definition.kind,
      category: input.definition.category,
      runtime: input.definition.runtime,
      runtime_candidates: input.definition.runtimeCandidates,
      framework: input.definition.framework,
      kit_name: input.definition.kitId,
    },
    generator: projectJson.generator,
    verified_artifacts: input.definition.requiredArtifacts,
  };

  for (const [fileName, payload] of [
    ['project.json', projectJson],
    ['context.json', contextJson],
    ['official-create.json', evidenceJson],
  ] as const) {
    const filePath = projectMetadataPath(input.projectPath, fileName);
    await fsExtra.ensureDir(path.dirname(filePath));
    await fsExtra.writeJson(filePath, payload, { spaces: 2 });
  }
}

async function runCommand(plan: CommandPlan, cwd: string): Promise<number> {
  const invocation = resolvePackageRunnerInvocation(plan.command);
  return await new Promise<number>((resolve) => {
    const baseEnv = buildLatestStableGeneratorEnv();
    const child = spawn(invocation.command, [...invocation.prefixArgs, ...plan.args], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env:
        plan.command === 'git'
          ? buildCleanGitEnv({ ...baseEnv, ...plan.env })
          : { ...baseEnv, ...plan.env },
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function assertOfficialGeneratorToolSupport(
  definition: OfficialProjectGeneratorDefinition,
  flags: GeneratorFlags
): Promise<void> {
  const required =
    definition.id === 'vscode-extension' && flags.skipGit ? [] : [...definition.requiredTools];
  const recommended =
    definition.id === 'vscode-extension' && flags.skipGit
      ? []
      : (definition.recommendedTools ?? []);
  const missingRequired: ToolRequirement[] = [];
  const missingRecommended: ToolRequirement[] = [];

  for (const requirement of required) {
    if (!(await canRunTool(requirement))) {
      missingRequired.push(requirement);
    }
  }
  for (const requirement of recommended) {
    if (!(await canRunTool(requirement))) {
      missingRecommended.push(requirement);
    }
  }

  if (missingRequired.length > 0) {
    const details = missingRequired
      .map((requirement) => `- ${requirement.label}: ${requirement.guidance}`)
      .join('\n');
    throw new Error(
      `${definition.displayName} cannot use its latest stable official generator because required local tools are unavailable:\n${details}`
    );
  }

  for (const requirement of missingRecommended) {
    console.warn(chalk.yellow(`⚠ ${requirement.label} was not found. ${requirement.guidance}`));
  }
}

function assertOfficialGeneratorNodeSupport(
  definition: OfficialProjectGeneratorDefinition,
  currentVersion = process.versions.node
): void {
  const support = definition.nodeSupport;
  if (!support) return;

  const currentMajor = Number.parseInt(currentVersion.split('.')[0] ?? '', 10);
  const supported = support.ranges.some(
    (range) =>
      (range.major === undefined || range.major === currentMajor) &&
      compareNumericVersions(currentVersion, range.minVersion) >= 0
  );
  if (supported) return;

  throw new Error(
    `${definition.displayName} requires Node.js ${support.requirement} ` +
      `(current: ${currentVersion}). ${support.guidance}`
  );
}

function compareNumericVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((value) => Number.parseInt(value, 10) || 0);
  const rightParts = right.split('.').map((value) => Number.parseInt(value, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function canRunTool(requirement: ToolRequirement): Promise<boolean> {
  const invocation = resolvePackageRunnerInvocation(requirement.command);
  return await new Promise<boolean>((resolve) => {
    const child = spawn(invocation.command, [...invocation.prefixArgs, ...requirement.args], {
      stdio: 'ignore',
      shell: false,
      env: buildLatestStableGeneratorEnv(),
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(false);
    }, 5_000);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(code === 0);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

function printOfficialProjectPlan(
  definition: OfficialProjectGeneratorDefinition,
  projectPath: string,
  commandDisplay: string,
  plan: CommandPlan
): void {
  console.log(
    chalk.bold(`\nWorkspai ${definition.category} create plan: ${definition.displayName}`)
  );
  console.log(chalk.gray(`Category: ${definition.category}`));
  console.log(chalk.gray(`Runtime:  ${definition.runtimeCandidates.join(' + ')}`));
  console.log(chalk.gray(`Version:  ${definition.versionPolicy}`));
  console.log(chalk.gray(`Target:   ${projectPath}`));
  console.log(chalk.gray(`Official: ${commandDisplay}`));
  console.log(chalk.gray(`Execute:  ${[plan.command, ...plan.args].join(' ')}`));
  console.log(chalk.gray('Dry run: no files or workspace state will be changed.'));
}

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const equals = argv.find((arg) => arg.startsWith(`${flag}=`));
  return equals ? equals.slice(flag.length + 1) : undefined;
}

export const __test__ = {
  assertOfficialScaffold,
  assertOfficialGeneratorNodeSupport,
  assertOfficialGeneratorToolSupport,
  canRunTool,
  writeOfficialProjectMetadata,
  runCommand,
};
