import path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import fsExtra from 'fs-extra';

import { getVersion } from './update-checker.js';
import { validateProjectName } from './validation.js';
import {
  buildLatestStableGeneratorEnv,
  resolvePackageRunnerInvocation,
} from './utils/platform-capabilities.js';
import type { ImportedProjectRegistryEntry } from './imported-projects-registry.js';
import type { BackendImportStack } from './utils/backend-framework-contract.js';
import { buildCleanGitEnv, isInsideExistingGitWorktree } from './utils/git-worktree.js';
import { projectMetadataPath } from './utils/workspace-paths.js';
import { collectGeneratorVersionEvidence } from './utils/generator-version-evidence.js';

export type FrontendGeneratorId =
  | 'nextjs'
  | 'remix'
  | 'vite-react'
  | 'vite-vue'
  | 'vite-svelte'
  | 'vite-solid'
  | 'vite-vanilla'
  | 'nuxt'
  | 'angular'
  | 'astro'
  | 'sveltekit';

export interface FrontendGeneratorDefinition {
  id: FrontendGeneratorId;
  kitId: `frontend.${FrontendGeneratorId}`;
  aliases: string[];
  displayName: string;
  framework: string;
  defaultPort: number;
  versionPolicy: 'latest-stable';
  minNodeMajor?: number;
  minNodeMessage?: string;
  commandDisplay: (
    projectName: string,
    options?: { skipGit: boolean; skipInstall: boolean }
  ) => string;
  commandExec: (
    projectName: string,
    options: { skipGit: boolean; skipInstall: boolean }
  ) => {
    command: string;
    args: string[];
  };
}

export interface CreateFrontendProjectOptions {
  args: string[];
  dryRun?: boolean;
}

export interface CreateFrontendProjectResult {
  definition: FrontendGeneratorDefinition;
  projectName: string;
  projectPath: string;
  dryRun: boolean;
  commandDisplay: string;
  commandExec: string[];
}

export function buildFrontendProjectRegistryEntry(input: {
  workspacePath: string;
  result: CreateFrontendProjectResult;
  importedAt?: string;
}): ImportedProjectRegistryEntry {
  const relationship = isSameOrInsideDirectory(input.workspacePath, input.result.projectPath)
    ? 'imported'
    : 'adopted';

  return {
    name: input.result.projectName,
    path: input.result.projectPath,
    relativePath: toWorkspaceRelativePath(input.workspacePath, input.result.projectPath),
    relationship,
    stack: input.result.definition.framework as BackendImportStack,
    runtime: 'node',
    framework: input.result.definition.framework,
    frameworkDisplayName: input.result.definition.displayName,
    supportTier: 'extended',
    moduleSupport: false,
    confidence: 'high',
    source: relationship === 'adopted' ? 'adopted-local' : 'local-folder',
    importedAt: input.importedAt ?? new Date().toISOString(),
  };
}

function isSameOrInsideDirectory(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return (
    relativePath === '' ||
    (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

function toWorkspaceRelativePath(workspacePath: string, projectPath: string): string {
  return (path.relative(workspacePath, projectPath) || '.').split(path.sep).join('/');
}

const FRONTEND_GENERATORS: FrontendGeneratorDefinition[] = [
  {
    id: 'nextjs',
    kitId: 'frontend.nextjs',
    aliases: ['frontend.nextjs', 'next', 'nextjs', 'next.js'],
    displayName: 'Next.js',
    framework: 'nextjs',
    defaultPort: 3000,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npx create-next-app@latest ${name}`,
    commandExec: (name, options) => ({
      command: 'npx',
      args: [
        '--yes',
        'create-next-app@latest',
        name,
        '--yes',
        ...(options.skipGit ? ['--disable-git'] : []),
        ...(options.skipInstall ? ['--skip-install'] : []),
      ],
    }),
  },
  {
    id: 'remix',
    kitId: 'frontend.remix',
    aliases: ['frontend.remix', 'remix', 'remix-run', 'react-router'],
    displayName: 'React Router',
    framework: 'remix',
    defaultPort: 5173,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npx create-react-router@latest ${name}`,
    commandExec: (name, options) => ({
      command: 'npx',
      args: [
        '--yes',
        'create-react-router@latest',
        name,
        '--yes',
        ...(options.skipInstall ? ['--no-install'] : ['--install']),
        '--no-git-init',
      ],
    }),
  },
  {
    id: 'vite-react',
    kitId: 'frontend.vite-react',
    aliases: ['frontend.vite-react', 'vite-react', 'react', 'vite.react'],
    displayName: 'React + Vite',
    framework: 'react',
    defaultPort: 5173,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npm create vite@latest ${name} -- --template react-ts`,
    commandExec: (name) => ({
      command: 'npm',
      args: ['create', 'vite@latest', name, '--', '--template', 'react-ts', '--no-interactive'],
    }),
  },
  {
    id: 'vite-vue',
    kitId: 'frontend.vite-vue',
    aliases: ['frontend.vite-vue', 'vite-vue', 'vue', 'vite.vue'],
    displayName: 'Vue + Vite',
    framework: 'vue',
    defaultPort: 5173,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npm create vite@latest ${name} -- --template vue-ts`,
    commandExec: (name) => ({
      command: 'npm',
      args: ['create', 'vite@latest', name, '--', '--template', 'vue-ts', '--no-interactive'],
    }),
  },
  {
    id: 'vite-svelte',
    kitId: 'frontend.vite-svelte',
    aliases: ['frontend.vite-svelte', 'vite-svelte', 'svelte', 'vite.svelte'],
    displayName: 'Svelte + Vite',
    framework: 'svelte',
    defaultPort: 5173,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npm create vite@latest ${name} -- --template svelte-ts`,
    commandExec: (name) => ({
      command: 'npm',
      args: ['create', 'vite@latest', name, '--', '--template', 'svelte-ts', '--no-interactive'],
    }),
  },
  {
    id: 'vite-solid',
    kitId: 'frontend.vite-solid',
    aliases: ['frontend.vite-solid', 'vite-solid', 'solid', 'solidjs', 'vite.solid'],
    displayName: 'Solid + Vite',
    framework: 'solid',
    defaultPort: 5173,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npm create vite@latest ${name} -- --template solid-ts`,
    commandExec: (name) => ({
      command: 'npm',
      args: ['create', 'vite@latest', name, '--', '--template', 'solid-ts', '--no-interactive'],
    }),
  },
  {
    id: 'vite-vanilla',
    kitId: 'frontend.vite-vanilla',
    aliases: ['frontend.vite-vanilla', 'vite', 'vanilla', 'vite-vanilla'],
    displayName: 'Vite',
    framework: 'vite',
    defaultPort: 5173,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npm create vite@latest ${name} -- --template vanilla-ts`,
    commandExec: (name) => ({
      command: 'npm',
      args: ['create', 'vite@latest', name, '--', '--template', 'vanilla-ts', '--no-interactive'],
    }),
  },
  {
    id: 'nuxt',
    kitId: 'frontend.nuxt',
    aliases: ['frontend.nuxt', 'nuxt', 'nuxtjs', 'nuxt.js'],
    displayName: 'Nuxt',
    framework: 'nuxt',
    defaultPort: 3000,
    versionPolicy: 'latest-stable',
    commandDisplay: (name, options) =>
      `npx create-nuxt@latest ${name} --template minimal --packageManager npm --gitInit ${
        options?.skipGit ? 'false' : 'true'
      }${options?.skipInstall ? ' --no-install' : ''}`,
    commandExec: (name, options) => ({
      command: 'npx',
      args: [
        '--yes',
        'create-nuxt@latest',
        name,
        '--template',
        'minimal',
        '--packageManager',
        'npm',
        '--gitInit',
        options.skipGit ? 'false' : 'true',
        ...(options.skipInstall ? ['--no-install'] : []),
      ],
    }),
  },
  {
    id: 'angular',
    kitId: 'frontend.angular',
    aliases: ['frontend.angular', 'angular', 'ng'],
    displayName: 'Angular',
    framework: 'angular',
    defaultPort: 4200,
    versionPolicy: 'latest-stable',
    minNodeMajor: 20,
    minNodeMessage:
      'The latest stable Angular CLI requires a modern Node.js runtime. Upgrade to Node.js 20.19+ (or a newer supported LTS), then retry.',
    commandDisplay: (name) => `npx @angular/cli@latest new ${name}`,
    commandExec: (name, options) => ({
      command: 'npx',
      args: [
        '--yes',
        '@angular/cli@latest',
        'new',
        name,
        '--defaults',
        '--skip-git',
        ...(options.skipInstall ? ['--skip-install'] : []),
      ],
    }),
  },
  {
    id: 'astro',
    kitId: 'frontend.astro',
    aliases: ['frontend.astro', 'astro'],
    displayName: 'Astro',
    framework: 'astro',
    defaultPort: 4321,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npm create astro@latest ${name}`,
    commandExec: (name, options) => ({
      command: 'npm',
      args: [
        'create',
        'astro@latest',
        name,
        '--',
        '--yes',
        ...(options.skipInstall ? ['--no-install'] : []),
        ...(options.skipGit ? ['--no-git'] : []),
      ],
    }),
  },
  {
    id: 'sveltekit',
    kitId: 'frontend.sveltekit',
    aliases: ['frontend.sveltekit', 'sveltekit', 'svelte-kit'],
    displayName: 'SvelteKit',
    framework: 'sveltekit',
    defaultPort: 5173,
    versionPolicy: 'latest-stable',
    commandDisplay: (name) => `npx sv@latest create ${name}`,
    commandExec: (name, options) => ({
      command: 'npx',
      args: [
        '--yes',
        'sv@latest',
        'create',
        name,
        '--template',
        'minimal',
        '--types',
        'ts',
        '--no-add-ons',
        ...(options.skipInstall ? ['--no-install'] : ['--install', 'npm']),
      ],
    }),
  },
];

const FRONTEND_GENERATOR_BY_ALIAS = new Map<string, FrontendGeneratorDefinition>();
for (const definition of FRONTEND_GENERATORS) {
  FRONTEND_GENERATOR_BY_ALIAS.set(definition.id, definition);
  FRONTEND_GENERATOR_BY_ALIAS.set(definition.kitId, definition);
  for (const alias of definition.aliases) {
    FRONTEND_GENERATOR_BY_ALIAS.set(alias.toLowerCase(), definition);
  }
}

export function listFrontendGenerators(): FrontendGeneratorDefinition[] {
  return [...FRONTEND_GENERATORS];
}

export function resolveFrontendGenerator(
  value: string | undefined
): FrontendGeneratorDefinition | null {
  if (!value) return null;
  return FRONTEND_GENERATOR_BY_ALIAS.get(value.trim().toLowerCase()) ?? null;
}

export function isFrontendProjectKit(value: string | undefined): boolean {
  return !!resolveFrontendGenerator(value);
}

export function normalizeCreateFrontendArgs(args: string[]): string[] | null {
  if (args[0] !== 'create' || args[1] !== 'frontend') return null;
  const framework = args[2];
  const name = args[3];
  const tail = args.slice(4);
  const definition = resolveFrontendGenerator(framework);
  if (!definition) {
    return ['create', 'project', `frontend.${framework ?? ''}`, name ?? '', ...tail].filter(
      Boolean
    );
  }
  return ['create', 'project', definition.kitId, name ?? '', ...tail].filter(Boolean);
}

export function formatProjectCreateCommand(kit: string, projectName: string): string {
  const definition = resolveFrontendGenerator(kit);
  const kitLabel = definition?.id ?? kit.replace(/^frontend\./, '');
  return `workspai create project ${kitLabel} ${projectName}`;
}

export function formatProjectCreateDisplayCommand(kit: string, projectName: string): string {
  return `npx ${formatProjectCreateCommand(kit, projectName)}`;
}

export function frontendCreateUsage(value?: string): string {
  const definition = resolveFrontendGenerator(value);
  if (definition) {
    return `${formatProjectCreateCommand(definition.id, '<name>')} [--output <dir>] [--skip-install] [--dry-run]`;
  }
  return 'workspai create project <nextjs|remix|vite-react|vite-vue|vite-svelte|vite-solid|vite-vanilla|nuxt|angular|astro|sveltekit> <name> [--output <dir>] [--skip-install] [--dry-run]';
}

export async function createFrontendProject(
  options: CreateFrontendProjectOptions
): Promise<CreateFrontendProjectResult> {
  const args = options.args;
  if (args[0] !== 'create' || args[1] !== 'project') {
    throw new Error(
      'Frontend create expects normalized args: create project <frontend.kit> <name>'
    );
  }

  const definition = resolveFrontendGenerator(args[2]);
  if (!definition) {
    throw new Error(`Unknown frontend generator: ${args[2] ?? '(missing)'}`);
  }

  const projectName = args[3];
  if (!projectName) {
    throw new Error(`Usage: ${frontendCreateUsage(definition.id)}`);
  }
  validateProjectName(projectName);

  assertFrontendGeneratorNodeSupport(definition);

  const outputDir = readFlagValue(args, '--output') || process.cwd();
  const projectPath = path.resolve(outputDir, projectName);
  const dryRun = options.dryRun === true || args.includes('--dry-run');
  const skipInstall = args.includes('--skip-install');
  const skipGit = args.includes('--skip-git') || args.includes('--no-git');
  const commandPlan = definition.commandExec(projectName, { skipGit, skipInstall });
  const commandDisplay = definition.commandDisplay(projectName, { skipGit, skipInstall });

  if (await fsExtra.pathExists(projectPath)) {
    throw new Error(`Directory "${projectPath}" already exists`);
  }

  if (dryRun) {
    printFrontendPlan({ definition, projectName, projectPath, commandDisplay, commandPlan });
    return {
      definition,
      projectName,
      projectPath,
      dryRun,
      commandDisplay,
      commandExec: [commandPlan.command, ...commandPlan.args],
    };
  }

  await fsExtra.ensureDir(path.dirname(projectPath));
  try {
    const exitCode = await runCommand(
      commandPlan.command,
      commandPlan.args,
      path.dirname(projectPath)
    );
    const scaffoldReady = await hasFrontendScaffoldArtifacts(projectPath);

    if (exitCode !== 0) {
      throw new Error(
        `Official ${definition.displayName} generator failed with exit code ${exitCode}`
      );
    }
    if (!scaffoldReady) {
      throw new Error(
        `Official ${definition.displayName} generator did not produce a valid package.json`
      );
    }

    if (!skipGit) {
      await maybeInitProjectGit(projectPath);
    }

    await writeFrontendRapidkitMetadata({
      definition,
      projectName,
      projectPath,
      commandDisplay,
      commandExec: [commandPlan.command, ...commandPlan.args],
      skipGit,
      skipInstall,
    });
  } catch (error) {
    await fsExtra.remove(projectPath);
    throw error;
  }

  console.log(chalk.green(`✅ ${definition.displayName} project created at ${projectPath}`));
  console.log(
    chalk.gray(
      `   Display command: ${formatProjectCreateDisplayCommand(definition.id, projectName)}`
    )
  );
  console.log(chalk.gray('   Next: cd ' + projectName + ' && npx workspai dev'));

  return {
    definition,
    projectName,
    projectPath,
    dryRun,
    commandDisplay,
    commandExec: [commandPlan.command, ...commandPlan.args],
  };
}

async function writeFrontendRapidkitMetadata(input: {
  definition: FrontendGeneratorDefinition;
  projectName: string;
  projectPath: string;
  commandDisplay: string;
  commandExec: string[];
  skipGit: boolean;
  skipInstall: boolean;
}): Promise<void> {
  const generatedAt = new Date().toISOString();
  const rapidkitVersion = await getVersion();
  const versionEvidence = await collectGeneratorVersionEvidence(input.projectPath, 'latest');
  const projectJson = {
    schema_version: '1.0',
    name: input.projectName,
    slug: input.projectName,
    kind: 'frontend',
    project_type: 'frontend',
    category: 'frontend',
    runtime: 'node',
    framework: input.definition.framework,
    framework_display_name: input.definition.displayName,
    kit_name: input.definition.kitId,
    kit: input.definition.kitId,
    engine: 'npm',
    support_tier: 'extended',
    module_support: false,
    modules: [],
    workspai_version: rapidkitVersion,
    rapidkit_version: rapidkitVersion,
    generated_by: 'workspai',
    generated_at: generatedAt,
    frontend: {
      generator: input.definition.id,
      official_generator: true,
      version_policy: input.definition.versionPolicy,
      version_evidence: versionEvidence,
      default_port: input.definition.defaultPort,
      command_display: input.commandDisplay,
      command_exec: input.commandExec,
      skip_install: input.skipInstall,
      skip_git: input.skipGit,
    },
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
    project: input.projectName,
    runtime: 'node',
    framework: input.definition.framework,
    kind: 'frontend',
    category: 'frontend',
    source: 'official-generator',
  };
  const evidenceJson = {
    kind: 'workspai.frontend_create',
    schema_version: '1.0',
    generated_at: generatedAt,
    project: {
      name: input.projectName,
      path: input.projectPath,
      kind: 'frontend',
      category: 'frontend',
      runtime: 'node',
      framework: input.definition.framework,
      framework_display_name: input.definition.displayName,
      kit_name: input.definition.kitId,
    },
    generator: {
      id: input.definition.id,
      version_policy: input.definition.versionPolicy,
      version_evidence: versionEvidence,
      command_display: input.commandDisplay,
      command_exec: input.commandExec,
    },
  };

  for (const [fileName, payload] of [
    ['project.json', projectJson],
    ['context.json', contextJson],
    ['frontend-create.json', evidenceJson],
  ] as const) {
    const primaryPath = projectMetadataPath(input.projectPath, fileName);
    await fsExtra.ensureDir(path.dirname(primaryPath));
    await fsExtra.writeJson(primaryPath, payload, { spaces: 2 });
  }
}

function printFrontendPlan(input: {
  definition: FrontendGeneratorDefinition;
  projectName: string;
  projectPath: string;
  commandDisplay: string;
  commandPlan: { command: string; args: string[] };
}): void {
  console.log(chalk.bold(`\nWorkspai frontend create plan: ${input.definition.displayName}`));
  console.log(chalk.gray(`Project: ${input.projectName}`));
  console.log(chalk.gray(`Target:  ${input.projectPath}`));
  console.log(
    chalk.gray(
      `Show:    ${formatProjectCreateDisplayCommand(input.definition.id, input.projectName)}`
    )
  );
  console.log(
    chalk.gray(`Run:     ${[input.commandPlan.command, ...input.commandPlan.args].join(' ')}`)
  );
  console.log(chalk.gray(`Default: http://localhost:${input.definition.defaultPort}`));
}

function getNodeMajorVersion(): number {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : 0;
}

function assertFrontendGeneratorNodeSupport(definition: FrontendGeneratorDefinition): void {
  if (!definition.minNodeMajor) {
    return;
  }
  const nodeMajor = getNodeMajorVersion();
  if (nodeMajor >= definition.minNodeMajor) {
    return;
  }
  throw new Error(
    definition.minNodeMessage ??
      `${definition.displayName} requires Node.js ${definition.minNodeMajor}+ (current: ${process.versions.node}).`
  );
}

async function hasFrontendScaffoldArtifacts(projectPath: string): Promise<boolean> {
  if (!(await fsExtra.pathExists(projectPath))) {
    return false;
  }

  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!(await fsExtra.pathExists(packageJsonPath))) {
    return false;
  }

  try {
    const packageJson: unknown = await fsExtra.readJson(packageJsonPath);
    return packageJson !== null && typeof packageJson === 'object' && !Array.isArray(packageJson);
  } catch {
    return false;
  }
}

async function maybeInitProjectGit(projectPath: string): Promise<void> {
  const gitDir = path.join(projectPath, '.git');
  if (await fsExtra.pathExists(gitDir)) {
    return;
  }
  if (await isInsideExistingGitWorktree(projectPath)) {
    console.log(
      chalk.gray('   Git initialization skipped; target is inside an existing git worktree.')
    );
    return;
  }

  const exitCode = await runCommand('git', ['init'], projectPath);
  if (exitCode === 0) {
    console.log(chalk.gray('   Git repository initialized.'));
    return;
  }

  console.log(
    chalk.yellow(
      '⚠️  Git initialization was skipped or failed. You can run `git init` manually inside the project.'
    )
  );
}

async function runCommand(command: string, args: string[], cwd: string): Promise<number> {
  const invocation = resolvePackageRunnerInvocation(command);
  return await new Promise<number>((resolve) => {
    const child = spawn(invocation.command, [...invocation.prefixArgs, ...args], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env:
        command === 'git'
          ? buildCleanGitEnv(buildLatestStableGeneratorEnv())
          : buildLatestStableGeneratorEnv(),
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

export const __test__ = {
  hasFrontendScaffoldArtifacts,
  runCommand,
};

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}
