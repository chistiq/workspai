import { promises as fs } from 'fs';
import { randomUUID } from 'node:crypto';
import path from 'path';
import chalk from 'chalk';
import fsExtra from 'fs-extra';
import ora from 'ora';
import { execa } from 'execa';
import { getVersion } from './update-checker.js';
import {
  getWorkspaceRegistryDirectory,
  getWorkspaceRegistryFileCandidates,
  getLegacyWorkspaceRegistryDirectory,
} from './utils/platform-capabilities.js';
import { normalizeRegistryPath } from './utils/registry-path.js';
import { isDoctorEvidencePayloadCompatible } from './utils/doctor-evidence-contract.js';
import { discoverWorkspaceProjects as discoverWorkspaceProjectsShared } from './utils/workspace-discovery.js';
import { buildCleanGitEnv } from './utils/git-worktree.js';
import { projectMetadataCandidates, workspaceMetadataCandidates } from './utils/workspace-paths.js';
import { assertWorkspaceArtifactContract } from './contracts/artifact-contract-registry.js';

export interface WorkspaceProject {
  name: string;
  path: string;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  mode?: string;
  projects: WorkspaceProject[];
}

interface WorkspaceRegistry {
  workspaces: WorkspaceEntry[];
}

interface WorkspaceOptions {
  name: string;
  author: string;
  skipGit?: boolean;
}

type GitInitSpinner = {
  start(text?: string): GitInitSpinner;
  succeed(text?: string): GitInitSpinner;
  warn(text?: string): GitInitSpinner;
};

async function findContainingGitRoot(targetPath: string): Promise<string | null> {
  try {
    const result = await execa('git', ['rev-parse', '--show-toplevel'], {
      cwd: targetPath,
      env: buildCleanGitEnv(),
    });
    return result.stdout.trim() ? path.resolve(targetPath, result.stdout.trim()) : null;
  } catch {
    return null;
  }
}

async function initializeStandaloneGitRepository(
  targetPath: string,
  spinner: GitInitSpinner,
  commitMessage: string
): Promise<void> {
  const existingGitRoot = await findContainingGitRoot(targetPath);
  if (existingGitRoot) {
    spinner.warn('Git initialization skipped because target is already inside a git worktree');
    return;
  }

  spinner.start('Initializing git repository...');
  try {
    await execa('git', ['init'], { cwd: targetPath, env: buildCleanGitEnv() });
    await execa('git', ['add', '.'], { cwd: targetPath, env: buildCleanGitEnv() });
    await execa(
      'git',
      [
        '-c',
        'user.name=Workspai',
        '-c',
        'user.email=workspai@localhost',
        'commit',
        '-m',
        commitMessage,
      ],
      { cwd: targetPath, env: buildCleanGitEnv() }
    );
    spinner.succeed('Git repository initialized');
  } catch {
    spinner.warn('Could not initialize git repository');
  }
}

export function normalizeWorkspaceEntry(entry: WorkspaceEntry): WorkspaceEntry {
  const normalizedPath = normalizeRegistryPath(entry.path);
  const projectsArray = Array.isArray(entry.projects) ? entry.projects : [];
  const normalizedProjects: WorkspaceProject[] = [];
  const seenProjects = new Set<string>();

  for (const project of projectsArray) {
    if (!project || typeof project.name !== 'string' || typeof project.path !== 'string') {
      continue;
    }
    const normalizedProjectPath = normalizeRegistryPath(project.path);
    if (seenProjects.has(normalizedProjectPath)) {
      continue;
    }
    seenProjects.add(normalizedProjectPath);
    normalizedProjects.push({
      name: project.name,
      path: normalizedProjectPath,
    });
  }

  return {
    name: entry.name,
    path: normalizedPath,
    mode: entry.mode,
    projects: normalizedProjects,
  };
}

function normalizeRegistry(registry: WorkspaceRegistry): WorkspaceRegistry {
  const normalized: WorkspaceEntry[] = [];
  const seen = new Set<string>();

  for (const rawEntry of registry.workspaces || []) {
    if (!rawEntry || typeof rawEntry.name !== 'string' || typeof rawEntry.path !== 'string') {
      continue;
    }

    const entry = normalizeWorkspaceEntry(rawEntry);
    if (seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);
    normalized.push(entry);
  }

  return { workspaces: normalized };
}

async function readWorkspaceRegistryFile(registryFile: string): Promise<WorkspaceRegistry> {
  let content: string;
  try {
    content = await fs.readFile(registryFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { workspaces: [] };
    throw error;
  }
  try {
    const parsed = JSON.parse(content) as WorkspaceRegistry;
    if (!parsed || !Array.isArray(parsed.workspaces)) throw new Error('missing workspaces array');
    return normalizeRegistry(parsed);
  } catch (error) {
    throw new Error(`Workspace registry is invalid: ${registryFile}`, { cause: error });
  }
}

async function readWorkspaceRegistryFileStrict(registryFile: string): Promise<WorkspaceRegistry> {
  let content: string;
  try {
    content = await fs.readFile(registryFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { workspaces: [] };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Workspace registry is invalid: ${registryFile}`, { cause: error });
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as WorkspaceRegistry).workspaces)
  ) {
    throw new Error(`Workspace registry is invalid: ${registryFile}`);
  }

  for (const entry of (parsed as WorkspaceRegistry).workspaces) {
    if (
      !entry ||
      typeof entry.name !== 'string' ||
      typeof entry.path !== 'string' ||
      (entry.mode !== undefined && typeof entry.mode !== 'string') ||
      (entry.projects !== undefined && !Array.isArray(entry.projects)) ||
      (Array.isArray(entry.projects) &&
        entry.projects.some(
          (project) =>
            !project || typeof project.name !== 'string' || typeof project.path !== 'string'
        ))
    ) {
      throw new Error(`Workspace registry contains an invalid entry: ${registryFile}`);
    }
  }

  return normalizeRegistry(parsed as WorkspaceRegistry);
}

async function readWorkspaceRegistryCandidates(): Promise<WorkspaceRegistry> {
  const merged: WorkspaceRegistry = { workspaces: [] };
  const seen = new Set<string>();
  for (const registryFile of getWorkspaceRegistryFileCandidates()) {
    const registry = await readWorkspaceRegistryFile(registryFile);
    for (const entry of registry.workspaces) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      merged.workspaces.push(entry);
    }
  }
  return merged;
}

async function readWorkspaceRegistryCandidatesStrict(
  registryFiles: readonly string[] = getWorkspaceRegistryFileCandidates()
): Promise<WorkspaceRegistry> {
  const merged: WorkspaceRegistry = { workspaces: [] };
  const seen = new Set<string>();
  for (const registryFile of registryFiles) {
    const registry = await readWorkspaceRegistryFileStrict(registryFile);
    for (const entry of registry.workspaces) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      merged.workspaces.push(entry);
    }
  }
  return merged;
}

function isIgnorableWorkspaceRegistryFsyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return (
    process.platform === 'win32' && (code === 'EPERM' || code === 'EINVAL' || code === 'ENOSYS')
  );
}

async function syncWorkspaceRegistryHandle(
  handle: Awaited<ReturnType<typeof fs.open>>
): Promise<void> {
  try {
    await handle.sync();
  } catch (error) {
    if (!isIgnorableWorkspaceRegistryFsyncError(error)) {
      throw error;
    }
  }
}

async function writeWorkspaceRegistryFileAtomically(
  registryFile: string,
  registry: WorkspaceRegistry
): Promise<void> {
  const registryDir = path.dirname(registryFile);
  await fs.mkdir(registryDir, { recursive: true });
  const temporaryPrefix = `${path.basename(registryFile)}.`;
  const now = Date.now();
  for (const name of await fs.readdir(registryDir)) {
    if (!name.startsWith(temporaryPrefix) || !name.endsWith('.tmp')) continue;
    const candidate = path.join(registryDir, name);
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat && now - stat.mtimeMs > 30_000) {
      await fs.rm(candidate, { force: true }).catch(() => undefined);
    }
  }

  const existingContent = await fs.readFile(registryFile, 'utf8').catch(() => null);
  if (existingContent !== null) {
    let existingIsValid = false;
    try {
      const parsed = JSON.parse(existingContent) as Partial<WorkspaceRegistry>;
      existingIsValid = Array.isArray(parsed.workspaces);
    } catch {
      existingIsValid = false;
    }
    if (!existingIsValid) {
      const corruptBackup = `${registryFile}.corrupt-${Date.now()}`;
      await fs.copyFile(registryFile, corruptBackup);
    }
  }

  await writeWorkspaceRegistryBytesAtomically(
    registryFile,
    `${JSON.stringify(normalizeRegistry(registry), null, 2)}\n`
  );
}

async function writeWorkspaceRegistryBytesAtomically(
  registryFile: string,
  content: string | Buffer
): Promise<void> {
  const registryDir = path.dirname(registryFile);
  await fs.mkdir(registryDir, { recursive: true });
  const temporaryPath = `${registryFile}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, content);
    const handle = await fs.open(temporaryPath, 'r');
    try {
      await syncWorkspaceRegistryHandle(handle);
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporaryPath, registryFile);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      await fsExtra.move(temporaryPath, registryFile, { overwrite: true });
    }
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

interface WorkspaceRegistryPreimage {
  exists: boolean;
  content?: Buffer;
}

async function captureWorkspaceRegistryPreimage(
  registryFile: string
): Promise<WorkspaceRegistryPreimage> {
  try {
    return { exists: true, content: await fs.readFile(registryFile) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
}

async function restoreWorkspaceRegistryPreimage(
  registryFile: string,
  preimage: WorkspaceRegistryPreimage
): Promise<void> {
  if (!preimage.exists) {
    await fs.rm(registryFile, { force: true });
    return;
  }
  await writeWorkspaceRegistryBytesAtomically(registryFile, preimage.content as Buffer);
}

async function withWorkspaceRegistryLock<T>(
  registryDir: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockPath = path.join(registryDir, 'workspaces.json.lock');
  const lockId = randomUUID();
  await fs.mkdir(registryDir, { recursive: true });
  const startedAt = Date.now();
  let lockHandle: Awaited<ReturnType<typeof fs.open>> | undefined;

  while (!lockHandle) {
    try {
      lockHandle = await fs.open(lockPath, 'wx');
      await lockHandle.writeFile(
        `${JSON.stringify({ pid: process.pid, lockId, createdAt: new Date().toISOString() })}\n`
      );
      await syncWorkspaceRegistryHandle(lockHandle);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        const lockPayload = await fs
          .readFile(lockPath, 'utf8')
          .then((content) => JSON.parse(content) as { pid?: unknown })
          .catch(() => null);
        const ownerPid = Number(lockPayload?.pid);
        let ownerAlive = false;
        if (Number.isInteger(ownerPid) && ownerPid > 0) {
          try {
            process.kill(ownerPid, 0);
            ownerAlive = true;
          } catch (ownerError) {
            ownerAlive = (ownerError as NodeJS.ErrnoException).code === 'EPERM';
          }
        }
        if (!ownerAlive) {
          await fs.rm(lockPath, { force: true }).catch(() => undefined);
          continue;
        }
      }
      if (Date.now() - startedAt > 10_000) {
        throw new Error(`Timed out waiting for workspace registry lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  try {
    return await operation();
  } finally {
    await lockHandle.close().catch(() => undefined);
    const ownsCurrentLock = await fs
      .readFile(lockPath, 'utf8')
      .then((content) => {
        const payload = JSON.parse(content) as { lockId?: unknown };
        return payload.lockId === lockId;
      })
      .catch(() => false);
    if (ownsCurrentLock) {
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}

async function mutateWorkspaceRegistry(
  mutation: (registry: WorkspaceRegistry) => void | Promise<void>
): Promise<WorkspaceRegistry> {
  // Resolve every path before the first await. Vitest workers and embedding
  // hosts can mutate process.env while this transaction waits for the lock;
  // recomputing HOME/APPDATA later would lock one registry and write another.
  const canonicalDirectory = getWorkspaceRegistryDirectory();
  const canonicalFile = path.join(canonicalDirectory, 'workspaces.json');
  const legacyFile = path.join(getLegacyWorkspaceRegistryDirectory(), 'workspaces.json');
  const registryCandidates = [...new Set(getWorkspaceRegistryFileCandidates())];

  return withWorkspaceRegistryLock(canonicalDirectory, async () => {
    const [canonicalPreimage, legacyPreimage] = await Promise.all([
      captureWorkspaceRegistryPreimage(canonicalFile),
      captureWorkspaceRegistryPreimage(legacyFile),
    ]);
    const registry = await readWorkspaceRegistryCandidatesStrict(registryCandidates);
    await mutation(registry);
    const normalized = normalizeRegistry(registry);

    // Canonical state is authoritative. The legacy file remains an exact
    // compatibility mirror until older extension releases stop consuming it.
    try {
      await writeWorkspaceRegistryFileAtomically(canonicalFile, normalized);
      await writeWorkspaceRegistryFileAtomically(legacyFile, normalized);
    } catch (error) {
      const restoration = await Promise.allSettled([
        restoreWorkspaceRegistryPreimage(canonicalFile, canonicalPreimage),
        restoreWorkspaceRegistryPreimage(legacyFile, legacyPreimage),
      ]);
      const restorationErrors = restoration
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (restorationErrors.length > 0) {
        throw new AggregateError(
          [error, ...restorationErrors],
          'Workspace registry transaction failed and could not be fully restored'
        );
      }
      throw error;
    }
    return normalized;
  });
}

export async function registerWorkspaceStrict(workspacePath: string, name: string): Promise<void> {
  const normalizedWorkspacePath = normalizeRegistryPath(workspacePath);
  await mutateWorkspaceRegistry((registry) => {
    const existing = registry.workspaces.find((workspace) => {
      return workspace.path === normalizedWorkspacePath;
    });
    if (existing) {
      existing.name = name;
      existing.mode = existing.mode || 'full';
      existing.projects = Array.isArray(existing.projects) ? existing.projects : [];
      return;
    }
    registry.workspaces.push({
      name,
      path: normalizedWorkspacePath,
      mode: 'full',
      projects: [],
    });
  });
}

export async function captureWorkspaceRegistrationStrict(
  workspacePath: string
): Promise<WorkspaceEntry | null> {
  const normalizedWorkspacePath = normalizeRegistryPath(workspacePath);
  const registry = await readWorkspaceRegistryCandidatesStrict();
  const workspace = registry.workspaces.find(
    (candidate) => candidate.path === normalizedWorkspacePath
  );
  return workspace
    ? {
        ...workspace,
        projects: workspace.projects.map((project) => ({ ...project })),
      }
    : null;
}

export async function restoreWorkspaceRegistrationStrict(
  workspacePath: string,
  snapshot: WorkspaceEntry | null
): Promise<void> {
  const normalizedWorkspacePath = normalizeRegistryPath(workspacePath);
  await mutateWorkspaceRegistry((registry) => {
    const existingIndex = registry.workspaces.findIndex(
      (workspace) => workspace.path === normalizedWorkspacePath
    );
    if (!snapshot) {
      if (existingIndex >= 0) registry.workspaces.splice(existingIndex, 1);
      return;
    }
    const restored = normalizeWorkspaceEntry(snapshot);
    if (existingIndex >= 0) {
      registry.workspaces[existingIndex] = restored;
    } else {
      registry.workspaces.push(restored);
    }
  });
}

export async function unregisterWorkspaceStrict(workspacePath: string): Promise<void> {
  const normalizedWorkspacePath = normalizeRegistryPath(workspacePath);
  await mutateWorkspaceRegistry((registry) => {
    registry.workspaces = registry.workspaces.filter(
      (workspace) => workspace.path !== normalizedWorkspacePath
    );
  });
}

/**
 * Register workspace in the canonical registry and its legacy compatibility mirror.
 * This enables current and older VS Code Extension releases to discover CLI workspaces.
 */
export async function registerWorkspace(workspacePath: string, name: string): Promise<void> {
  try {
    await registerWorkspaceStrict(workspacePath, name);
  } catch (_error) {
    // Silent fail - registry is optional
    console.warn(chalk.gray('Note: Could not register workspace in shared registry'));
  }
}

/**
 * Register a project in its workspace's registry entry
 * Updates the projects array in the workspace registry
 */
/**
 * Scan workspace directory and register all projects that have Workspai project metadata.
 */
export interface SyncWorkspaceResult {
  workspacePath: string;
  workspaceFound: boolean;
  added: string[];
  skipped: number;
}

export async function syncWorkspaceProjects(
  workspacePath: string,
  silent = false
): Promise<SyncWorkspaceResult> {
  const normalizedWorkspacePath = normalizeRegistryPath(workspacePath);
  const emptyResult: SyncWorkspaceResult = {
    workspacePath: normalizedWorkspacePath,
    workspaceFound: false,
    added: [],
    skipped: 0,
  };

  try {
    let registry = await readWorkspaceRegistryCandidates();
    let workspace = registry.workspaces.find((w) => w.path === normalizedWorkspacePath);

    // A cloned or moved workspace can have valid local markers without a machine-local
    // registry entry. `workspace sync` is the reconciliation command, so repair that
    // missing link before scanning projects instead of leaving a permanent warning.
    if (!workspace) {
      await registerWorkspace(normalizedWorkspacePath, path.basename(path.resolve(workspacePath)));
      registry = await readWorkspaceRegistryCandidates();
      workspace = registry.workspaces.find((w) => w.path === normalizedWorkspacePath);
      if (!workspace) {
        if (!silent) console.log('⚠️  Workspace could not be registered in registry');
        return emptyResult;
      }
      if (!silent) console.log('✔ Registered workspace in shared registry');
    }

    // Initialize projects array if needed
    if (!Array.isArray(workspace.projects)) {
      workspace.projects = [];
    }

    // Scan workspace directory recursively for projects
    let addedCount = 0;
    let skippedCount = 0;
    const addedPaths: string[] = [];
    const discoveredProjects: WorkspaceProject[] = [];

    const queue = [workspacePath];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const currentPath = queue.shift();
      if (!currentPath) continue;
      if (visited.has(currentPath)) continue;
      visited.add(currentPath);

      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }
        if (
          ['node_modules', 'dist', 'build', 'target', 'coverage', 'htmlcov'].includes(entry.name)
        ) {
          continue;
        }

        const rawProjectPath = path.join(currentPath, entry.name);
        const projectPath = normalizeRegistryPath(rawProjectPath);

        try {
          let isRapidkitProject = false;
          for (const candidate of [
            ...projectMetadataCandidates(projectPath, 'context.json'),
            ...projectMetadataCandidates(projectPath, 'project.json'),
          ]) {
            try {
              await fs.access(candidate);
              isRapidkitProject = true;
              break;
            } catch {
              // Keep scanning canonical and legacy marker candidates.
            }
          }

          if (isRapidkitProject) {
            const projectName = path.basename(projectPath);
            const exists = workspace.projects.some((p) => p.path === projectPath);

            discoveredProjects.push({ name: projectName, path: projectPath });

            if (!exists) {
              workspace.projects.push({
                name: projectName,
                path: projectPath,
              });
              addedCount++;
              addedPaths.push(projectPath);
              if (!silent) console.log(`✔ Added: ${path.relative(workspacePath, projectPath)}`);
            } else {
              skippedCount++;
            }
            continue;
          }
        } catch {
          // Not a RapidKit project, continue recursion.
        }

        queue.push(rawProjectPath);
      }
    }

    await mutateWorkspaceRegistry((latestRegistry) => {
      const latestWorkspace = latestRegistry.workspaces.find(
        (entry) => entry.path === normalizedWorkspacePath
      );
      if (!latestWorkspace) return;
      const workspacePrefix = `${normalizedWorkspacePath}${path.sep}`;
      const externalProjects = (latestWorkspace.projects || []).filter(
        (project) =>
          project.path !== normalizedWorkspacePath && !project.path.startsWith(workspacePrefix)
      );
      latestWorkspace.projects = normalizeWorkspaceEntry({
        ...latestWorkspace,
        projects: [...externalProjects, ...discoveredProjects],
      }).projects;
    });

    if (addedCount > 0) {
      if (!silent) console.log(`\n✅ Synced ${addedCount} project(s) to registry`);
    } else {
      if (!silent) console.log(`\n✅ All projects already registered (${skippedCount} found)`);
    }

    return {
      workspacePath: normalizedWorkspacePath,
      workspaceFound: true,
      added: addedPaths,
      skipped: skippedCount,
    };
  } catch (error) {
    if (!silent) console.error('❌ Failed to sync projects:', (error as Error).message);
    return emptyResult;
  }
}

export async function registerProjectInWorkspaceStrict(
  workspacePath: string,
  projectName: string,
  projectPath: string
): Promise<void> {
  const normalizedWorkspacePath = normalizeRegistryPath(workspacePath);
  const normalizedProjectPath = normalizeRegistryPath(projectPath);
  await mutateWorkspaceRegistry((registry) => {
    const workspace = registry.workspaces.find((entry) => {
      return entry.path === normalizedWorkspacePath;
    });
    if (!workspace) {
      throw new Error(`Workspace is not registered: ${normalizedWorkspacePath}`);
    }

    workspace.projects = Array.isArray(workspace.projects) ? workspace.projects : [];
    const existingIndex = workspace.projects.findIndex(
      (project) => project.path === normalizedProjectPath || project.name === projectName
    );
    const nextProject = { name: projectName, path: normalizedProjectPath };
    if (existingIndex >= 0) {
      workspace.projects[existingIndex] = nextProject;
    } else {
      workspace.projects.push(nextProject);
    }
  });
}

export async function registerProjectInWorkspace(
  workspacePath: string,
  projectName: string,
  projectPath: string
): Promise<void> {
  try {
    await registerProjectInWorkspaceStrict(workspacePath, projectName, projectPath);
  } catch (_error) {
    // Silent fail - registry tracking is optional
  }
}

export async function createWorkspace(
  workspacePath: string,
  options: WorkspaceOptions
): Promise<void> {
  const spinner = ora('Creating Workspai workspace...').start();

  try {
    // Create workspace directory
    await fs.mkdir(workspacePath, { recursive: true });

    // Create canonical Workspai metadata directory. Legacy `.rapidkit` is read-only fallback.
    await fs.mkdir(path.join(workspacePath, '.workspai'), { recursive: true });

    // Create config.json
    const config = {
      workspace_name: options.name,
      author: options.author,
      rapidkit_version: getVersion(),
      created_at: new Date().toISOString(),
      type: 'workspace',
    };
    await fs.writeFile(
      path.join(workspacePath, '.workspai', 'config.json'),
      JSON.stringify(config, null, 2)
    );

    const { syncWorkspaceFoundationFiles } = await import('./create.js');
    await syncWorkspaceFoundationFiles(workspacePath, {
      workspaceName: options.name,
      installMethod: 'venv',
      writeMarker: true,
      writeGitignore: false,
      onlyIfMissing: true,
    });

    // Create the main rapidkit CLI script
    const cliScript = generateCLIScript();
    await fs.writeFile(path.join(workspacePath, 'rapidkit'), cliScript);
    await fs.chmod(path.join(workspacePath, 'rapidkit'), 0o755);

    // Create Windows launcher
    const cliScriptCmd = generateCLIScriptCmd();
    await fs.writeFile(path.join(workspacePath, 'rapidkit.cmd'), cliScriptCmd);

    // Create README.md
    const readme = generateReadme(options.name);
    await fs.writeFile(path.join(workspacePath, 'README.md'), readme);

    // Create .gitignore
    const gitignore = `# Workspai workspace
.env
.env.*
!.env.example

# OS
.DS_Store
Thumbs.db

# IDEs
.vscode/
.idea/

# Logs
*.log
`;
    await fs.writeFile(path.join(workspacePath, '.gitignore'), gitignore);

    // Copy templates to workspace
    await copyTemplates(workspacePath);

    spinner.succeed('Workspace created!');

    // Git initialization
    if (!options.skipGit) {
      await initializeStandaloneGitRepository(
        workspacePath,
        ora(),
        'Initial commit: Workspai workspace'
      );
    }

    // Register workspace in shared registry for Extension compatibility
    await registerWorkspaceStrict(workspacePath, options.name);

    // Publish registry evidence only after registration so a newly created
    // workspace cannot start with an immediately stale global-registry snapshot.
    const { publishWorkspaceRegistrySummary } =
      await import('./utils/workspace-registry-summary.js');
    await publishWorkspaceRegistrySummary(workspacePath);

    // Success message
    console.log(`
${chalk.green('✨ Workspai workspace created successfully!')}

${chalk.bold('📂 Workspace structure:')}
${workspacePath}/
  ├── rapidkit            # Local CLI wrapper
  ├── rapidkit.cmd        # Windows local CLI wrapper
  ├── .workspai/          # Workspace configuration
  │   ├── workspace.json  # Workspace manifest
  │   ├── toolchain.lock  # Runtime pinning
  │   ├── policies.yml    # Enforcement policy
  │   ├── cache-config.yml# Cache policy
  │   └── config.json     # Workspai workspace config
  └── README.md

${chalk.bold('🚀 Get started:')}
  ${chalk.cyan(`cd ${options.name}`)}
  ${chalk.cyan('npx workspai create project fastapi.standard my-api --yes')}
  ${chalk.cyan('cd my-api')}
  ${chalk.cyan('npx workspai init')}
  ${chalk.cyan('npx workspai dev')}

${chalk.bold('📦 Available templates:')}
  fastapi      - FastAPI + Python
  nestjs       - NestJS + TypeScript
  springboot   - Spring Boot + Java
  gofiber      - Go Fiber
  gogin        - Go Gin

${chalk.bold('📚 Commands:')}
  npx workspai create project <kit> <name> Create a new project
  npx workspai init                        Install dependencies
  npx workspai dev                         Start dev server
  npx workspai help                        Show all commands

${chalk.gray('Alternative: npx workspai dev, make dev')}
${chalk.gray('💡 Tip: Install globally (npm i -g workspai) to use without npx')}\n`);
  } catch (error) {
    spinner.fail('Failed to create workspace');
    throw error;
  }
}

function generateCLIScript(): string {
  return `#!/usr/bin/env bash
#
# Workspai CLI - local workspace commands
# This script provides legacy ./rapidkit commands within the workspace
#

set -e

# Find workspace root (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

# Check if we're in a project directory (modern metadata first, legacy fallback)
find_project_root() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.workspai/project.json" || -f "$dir/.rapidkit/project.json" ]]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

# Check if we're in a workspace (modern marker first, legacy config fallback)
find_workspace_root() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.workspai-workspace" || -f "$dir/.rapidkit-workspace" ]]; then
            echo "$dir"
            return 0
        fi
        if [[ -f "$dir/.workspai/config.json" ]]; then
            if grep -q '"type": "workspace"' "$dir/.workspai/config.json" 2>/dev/null; then
                echo "$dir"
                return 0
            fi
        fi
        if [[ -f "$dir/.rapidkit/config.json" ]]; then
            if grep -q '"type": "workspace"' "$dir/.rapidkit/config.json" 2>/dev/null; then
                echo "$dir"
                return 0
            fi
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

# Colors
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[0;33m'
BLUE='\\033[0;34m'
CYAN='\\033[0;36m'
NC='\\033[0m' # No Color
BOLD='\\033[1m'

print_banner() {
    echo -e "\${BLUE}\${BOLD}🚀 Workspai CLI\${NC}"
    echo ""
}

print_help() {
    print_banner
    echo -e "\${BOLD}Usage:\${NC} rapidkit <command> [options]"
    echo ""
    echo -e "\${BOLD}🏗️  Workspace Commands:\${NC}"
    echo "  create <name>         Create a new project from template"
    echo "  create --help         Show create command options"
    echo ""
    echo -e "\${BOLD}🚀 Project Commands\${NC} (run inside a project):"
    echo "  init                  Install project dependencies"
    echo "  dev                   Start development server"
    echo "  start                 Start production server"
    echo "  build                 Build for production"
    echo "  test                  Run tests"
    echo "  lint                  Run linting"
    echo "  format                Format code"
    echo ""
    echo -e "\${BOLD}📚 Other Commands:\${NC}"
    echo "  help                  Show this help message"
    echo "  version               Show version"
    echo ""
    echo -e "\${BOLD}Examples:\${NC}"
    echo -e "  \${CYAN}workspai create project fastapi.standard my-api --yes\${NC}"
    echo -e "  \${CYAN}workspai create project nestjs.standard my-app --yes\${NC}"
    echo -e "  \${CYAN}cd my-api && workspai dev\${NC}"
    echo ""
}

print_create_help() {
    print_banner
    echo -e "\${BOLD}Usage:\${NC} workspai create project <kit> <project-name> [options]"
    echo ""
    echo -e "\${BOLD}Options:\${NC}"
    echo "  -t, --template <name>   Legacy template alias (fastapi, nestjs, springboot, gofiber, gogin)"
    echo "  -y, --yes               Skip prompts, use defaults"
    echo "  --skip-git              Skip git initialization"
    echo "  --skip-install          Skip dependency installation"
    echo ""
    echo -e "\${BOLD}Templates:\${NC}"
    echo "  fastapi      FastAPI + Python (default)"
    echo "  nestjs       NestJS + TypeScript"
    echo "  springboot   Spring Boot + Java"
    echo "  gofiber      Go Fiber"
    echo "  gogin        Go Gin"
    echo ""
    echo -e "\${BOLD}Examples:\${NC}"
    echo -e "  \${CYAN}workspai create project fastapi.standard my-api --yes\${NC}"
    echo -e "  \${CYAN}workspai create project nestjs.standard my-app --yes\${NC}"
    echo -e "  \${CYAN}workspai create my-api --template fastapi\${NC}  \${YELLOW}(legacy-compatible)\${NC}"
    echo ""
}

# Create project command
cmd_create() {
    local project_name=""
    local template="fastapi"
    local yes_flag=""
    local skip_git=""
    local skip_install=""

    # Canonical Workspai syntax: create project <kit> <name>
    if [[ "\${1:-}" == "project" ]]; then
        shift
        template="\${1:-fastapi.standard}"
        if [[ $# -gt 0 ]]; then
            shift
        fi
        project_name="\${1:-}"
        if [[ $# -gt 0 ]]; then
            shift
        fi
    fi

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                print_create_help
                exit 0
                ;;
            -t|--template)
                template="$2"
                shift 2
                ;;
            -y|--yes)
                yes_flag="--yes"
                shift
                ;;
            --skip-git)
                skip_git="--skip-git"
                shift
                ;;
            --skip-install)
                skip_install="--skip-install"
                shift
                ;;
            -*)
                echo -e "\${RED}❌ Unknown option: $1\${NC}"
                print_create_help
                exit 1
                ;;
            *)
                if [[ -z "$project_name" ]]; then
                    project_name="$1"
                fi
                shift
                ;;
        esac
    done

    # Validate template
    if [[ "$template" != "fastapi" && "$template" != "fastapi.standard" && "$template" != "nestjs" && "$template" != "nestjs.standard" && "$template" != "springboot" && "$template" != "springboot.standard" && "$template" != "spring" && "$template" != "gofiber" && "$template" != "gofiber.standard" && "$template" != "gogin" && "$template" != "gogin.standard" && "$template" != "go" && "$template" != "fiber" && "$template" != "gin" && "$template" != "java" ]]; then
        echo -e "\${RED}❌ Invalid template: $template\${NC}"
      echo -e "Available templates: fastapi.standard, nestjs.standard, springboot.standard, gofiber.standard, gogin.standard"
        exit 1
    fi

    # If no project name, prompt for it or show help
    if [[ -z "$project_name" ]]; then
        if [[ -n "$yes_flag" ]]; then
            project_name="my-\${template}-project"
        else
            echo -e "\${YELLOW}Project name required\${NC}"
            echo ""
            print_create_help
            exit 1
        fi
    fi

    # Find workspace root
    local workspace_root
    workspace_root=$(find_workspace_root) || {
        echo -e "\${RED}❌ Not in a Workspai workspace\${NC}"
        echo -e "Run this command from within a Workspai workspace."
        exit 1
    }

    local project_path="$PWD/$project_name"

    # Check if project already exists
    if [[ -d "$project_path" ]]; then
        echo -e "\${RED}❌ Directory '$project_name' already exists\${NC}"
        exit 1
    fi

    echo -e "\${BLUE}\${BOLD}🚀 Creating $template project: $project_name\${NC}"
    echo ""

    local normalized_template="$template"
    case "$template" in
      fastapi) normalized_template="fastapi.standard" ;;
      nestjs) normalized_template="nestjs.standard" ;;
      spring|springboot|java) normalized_template="springboot.standard" ;;
      go|fiber|gofiber) normalized_template="gofiber.standard" ;;
      gin|gogin) normalized_template="gogin.standard" ;;
    esac

    if command -v workspai >/dev/null 2>&1; then
      workspai create project "$normalized_template" "$project_name" $yes_flag $skip_git $skip_install
    else
      npx workspai create project "$normalized_template" "$project_name" $yes_flag $skip_git $skip_install
    fi
}

# Project commands (dev, build, test, etc.)
cmd_project() {
    local cmd="$1"
    shift

    # Find project root
    local project_root
    project_root=$(find_project_root) || {
        echo -e "\${RED}❌ Not in a Workspai project\${NC}"
        echo -e "Run this command from within a project directory."
        echo -e "Use \${CYAN}workspai create project fastapi.standard my-api --yes\${NC} to create a new project."
        exit 1
    }

    # Read project type from project.json
    local project_json="$project_root/.workspai/project.json"
    if [[ ! -f "$project_json" ]]; then
        project_json="$project_root/.rapidkit/project.json"
    fi
    local kit_name
    kit_name=$(grep -o '"kit_name": *"[^"]*"' "$project_json" | cut -d'"' -f4)

    cd "$project_root"

    case "$kit_name" in
        fastapi.standard|fastapi.ddd|python)
            # Python/FastAPI project
            case "$cmd" in
                init)
                    echo -e "\${BLUE}📦 Installing dependencies...\${NC}"
                    
                    # Source activate script first to ensure Poetry is available
                    if [[ -f ".workspai/activate" ]]; then
                        source .workspai/activate
                    elif [[ -f ".rapidkit/activate" ]]; then
                        source .rapidkit/activate
                    fi
                    
                    poetry install
                    echo -e "\${GREEN}✅ Dependencies installed!\${NC}"
                    ;;
                dev)
                    echo -e "\${BLUE}🚀 Starting development server...\${NC}"
                    poetry run dev "$@"
                    ;;
                start)
                    echo -e "\${BLUE}⚡ Starting production server...\${NC}"
                    poetry run start "$@"
                    ;;
                build)
                    echo -e "\${BLUE}📦 Building project...\${NC}"
                    poetry run build
                    ;;
                test)
                    echo -e "\${BLUE}🧪 Running tests...\${NC}"
                    poetry run test
                    ;;
                lint)
                    echo -e "\${BLUE}🔧 Running linter...\${NC}"
                    poetry run lint
                    ;;
                format)
                    echo -e "\${BLUE}✨ Formatting code...\${NC}"
                    poetry run format
                    ;;
                *)
                    echo -e "\${RED}❌ Unknown command: $cmd\${NC}"
                    exit 1
                    ;;
            esac
            ;;
        nestjs.standard|node)
            # Node/NestJS project
            local pm="npm"
            if command -v pnpm &>/dev/null && [[ -f "pnpm-lock.yaml" ]]; then
                pm="pnpm"
            elif command -v yarn &>/dev/null && [[ -f "yarn.lock" ]]; then
                pm="yarn"
            fi

            case "$cmd" in
                init)
                    echo -e "\${BLUE}📦 Installing dependencies...\${NC}"
                    
                    # Source activate script first to ensure environment is ready
                    if [[ -f ".workspai/activate" ]]; then
                        source .workspai/activate
                    elif [[ -f ".rapidkit/activate" ]]; then
                        source .rapidkit/activate
                    fi
                    
                    $pm install
                    echo -e "\${GREEN}✅ Dependencies installed!\${NC}"
                    ;;
                dev)
                    echo -e "\${BLUE}🚀 Starting development server...\${NC}"
                    $pm run dev
                    ;;
                start)
                    echo -e "\${BLUE}⚡ Starting production server...\${NC}"
                    $pm run start
                    ;;
                build)
                    echo -e "\${BLUE}📦 Building project...\${NC}"
                    $pm run build
                    ;;
                test)
                    echo -e "\${BLUE}🧪 Running tests...\${NC}"
                    $pm run test
                    ;;
                lint)
                    echo -e "\${BLUE}🔧 Running linter...\${NC}"
                    $pm run lint
                    ;;
                format)
                    echo -e "\${BLUE}✨ Formatting code...\${NC}"
                    $pm run format
                    ;;
                *)
                    echo -e "\${RED}❌ Unknown command: $cmd\${NC}"
                    exit 1
                    ;;
            esac
            ;;
        *)
            echo -e "\${RED}❌ Unknown project type: $kit_name\${NC}"
            exit 1
            ;;
    esac
}

# Main command handler
main() {
    local cmd="\${1:-help}"
    shift || true

    case "$cmd" in
        create)
            cmd_create "$@"
            ;;
        init|dev|start|build|test|lint|format)
            cmd_project "$cmd" "$@"
            ;;
        help|-h|--help)
            print_help
            ;;
        version|-v|--version)
            echo "Workspai CLI (legacy ./rapidkit launcher) v${getVersion()}"
            ;;
        *)
            echo -e "\${RED}❌ Unknown command: $cmd\${NC}"
            echo ""
            print_help
            exit 1
            ;;
    esac
}

main "$@"
`;
}

function generateCLIScriptCmd(): string {
  return `@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

where sh >nul 2>nul
if %ERRORLEVEL%==0 (
  sh "%SCRIPT_DIR%rapidkit" %*
  exit /b %ERRORLEVEL%
)

where bash >nul 2>nul
if %ERRORLEVEL%==0 (
  bash "%SCRIPT_DIR%rapidkit" %*
  exit /b %ERRORLEVEL%
)

echo [Workspai] No sh/bash found. Falling back to npx workspai.
npx workspai %*
exit /b %ERRORLEVEL%
`;
}

function generateReadme(workspaceName: string): string {
  return `# ${workspaceName}

Workspai workspace for building API projects.

## Quick Start

\`\`\`bash
# Optional: add the local legacy launcher to PATH (or use ./rapidkit)
export PATH="$PWD:$PATH"

# Create a FastAPI project
npx workspai create project fastapi.standard my-api --yes

# Or create a NestJS project
npx workspai create project nestjs.standard my-app --yes

# Enter project and start development
cd my-api
npx workspai init    # Install dependencies
npx workspai dev     # Start dev server
\`\`\`

## Available Templates

| Template | Stack | Description |
|----------|-------|-------------|
| \`fastapi\` | Python + FastAPI | High-performance Python API |
| \`nestjs\` | TypeScript + NestJS | Enterprise Node.js framework |

## Commands

| Command | Description |
|---------|-------------|
| \`npx workspai create project <kit> <name>\` | Create a new project |
| \`npx workspai init\` | Install dependencies |
| \`npx workspai dev\` | Start development server |
| \`npx workspai start\` | Start production server |
| \`npx workspai build\` | Build for production |
| \`npx workspai test\` | Run tests |
| \`npx workspai lint\` | Run linting |
| \`npx workspai format\` | Format code |

## Workspace Intelligence

\`\`\`bash
npx workspai workspace model --json --write
npx workspai workspace context --for-agent --json --write
npx workspai pipeline --json --strict
\`\`\`

Durable evidence is written to \`.workspai/reports/\`; generated agent
instructions start at \`AGENTS.md\`.

## Learn More

- [Workspai Documentation](https://workspai.dev)
- [GitHub Repository](https://github.com/chistiq/workspai)
`;
}

async function copyTemplates(workspacePath: string): Promise<void> {
  const { fileURLToPath } = await import('url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Templates source (from npm package)
  const packageRoot = path.resolve(__dirname, '..');
  const templatesSource = path.join(packageRoot, 'templates', 'kits');
  const templatesDest = path.join(workspacePath, '.workspai', 'templates');

  // Copy templates
  const { default: fsExtra } = await import('fs-extra');
  await fsExtra.copy(templatesSource, templatesDest);

  // Copy generator script
  const generatorSource = path.join(packageRoot, 'templates', 'generator.js');
  const generatorDest = path.join(workspacePath, '.workspai', 'generator.js');
  await fsExtra.copy(generatorSource, generatorDest);
}

// ============================================
// Direct Project Creation (without workspace)
// ============================================

interface ProjectOptions {
  name: string;
  template: string;
  author: string;
  description?: string;
  package_manager?: string;
  skipGit?: boolean;
  skipInstall?: boolean;
}

export async function createProject(projectPath: string, options: ProjectOptions): Promise<void> {
  const isFastAPI = options.template === 'fastapi';
  const templateName = isFastAPI ? 'FastAPI' : 'NestJS';

  const spinner = ora(`Creating ${templateName} project...`).start();

  try {
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Templates source (from npm package)
    const packageRoot = path.resolve(__dirname, '..');
    const templateDir = isFastAPI ? 'fastapi-standard' : 'nestjs-standard';
    const templatesPath = path.join(packageRoot, 'templates', 'kits', templateDir);

    // Create project directory
    await fs.mkdir(projectPath, { recursive: true });

    // Build context
    const context = {
      project_name: isFastAPI
        ? options.name.replace(/-/g, '_').toLowerCase()
        : options.name.replace(/_/g, '-').toLowerCase(),
      author: options.author,
      description: options.description || `${templateName} application generated with Workspai`,
      app_version: '0.1.0',
      license: 'MIT',
      package_manager: options.package_manager || 'npm',
      created_at: new Date().toISOString(),
      rapidkit_version: getVersion(),
    };

    // Copy and render template files
    await copyAndRenderTemplate(templatesPath, projectPath, context);

    // Create .gitignore
    const gitignoreContent = isFastAPI
      ? `# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Virtual environments
.venv/
venv/
ENV/
env/

# IDEs
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Project specific
.env
.env.local
`
      : `# Node artifacts
node_modules/
dist/
.tmp/
.env
.env.*
!.env.example

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# OS
.DS_Store
Thumbs.db

# IDEs
.idea/
.vscode/

# Coverage
coverage/
`;

    await fs.writeFile(path.join(projectPath, '.gitignore'), gitignoreContent);

    spinner.succeed(`${templateName} project created!`);

    // Git initialization
    if (!options.skipGit) {
      await initializeStandaloneGitRepository(
        projectPath,
        ora(),
        `Initial commit: ${templateName} project via Workspai`
      );
    }

    // Install dependencies
    if (!options.skipInstall) {
      if (!isFastAPI) {
        const pm = options.package_manager || 'npm';
        const installSpinner = ora(`Installing dependencies with ${pm}...`).start();
        try {
          await execa(pm, ['install'], { cwd: projectPath });
          installSpinner.succeed('Dependencies installed');
        } catch {
          installSpinner.warn(`Could not install dependencies. Run '${pm} install' manually.`);
        }
      }
    }

    // Success message
    const projectName = path.basename(projectPath);

    if (isFastAPI) {
      console.log(`
${chalk.green('✨ FastAPI project created successfully!')}

${chalk.bold('📂 Project structure:')}
${projectPath}/
  ├── .workspai/           # Project metadata
  ├── src/
  │   ├── main.py          # FastAPI application
  │   ├── cli.py           # CLI commands
  │   ├── routing/         # API routes
  │   └── modules/         # Module system
  ├── tests/               # Test suite
  ├── pyproject.toml       # Poetry configuration
  └── README.md

${chalk.bold('🚀 Get started:')}
  ${chalk.cyan(`cd ${projectName}`)}
  ${chalk.cyan('npx workspai init')}          ${chalk.gray('# Install dependencies')}
  ${chalk.cyan('npx workspai dev')}           ${chalk.gray('# Start dev server')}

${chalk.bold('📚 Available commands:')}
  npx workspai init    # Install dependencies (poetry install)
  npx workspai dev     # Start dev server with hot reload
  npx workspai start   # Start production server
  npx workspai test    # Run tests
  npx workspai lint    # Lint code
  npx workspai format  # Format code

${chalk.gray('Alternative: make dev, npx workspai dev, poetry run dev')}
${chalk.gray('💡 Tip: Install globally (npm i -g workspai) to use without npx')}
`);
    } else {
      console.log(`
${chalk.green('✨ NestJS project created successfully!')}

${chalk.bold('📂 Project structure:')}
${projectPath}/
  ├── .workspai/           # Project metadata
  ├── src/
  │   ├── main.ts          # Application entry point
  │   ├── app.module.ts    # Root module
  │   ├── config/          # Configuration
  │   └── examples/        # Example module
  ├── test/                # Test files
  ├── package.json         # Dependencies
  └── README.md

${chalk.bold('🚀 Get started:')}
  ${chalk.cyan(`cd ${projectName}`)}
  ${options.skipInstall ? chalk.cyan('npx workspai init') + chalk.gray('         # npm install') + '\n  ' : ''}${chalk.cyan('cp .env.example .env')}
  ${chalk.cyan('npx workspai dev')}           ${chalk.gray('# Start dev server')}

${chalk.bold('📚 Available commands:')}
  npx workspai init    # Install dependencies
  npx workspai dev     # Start dev server with hot reload
  npx workspai start   # Start production server
  npx workspai build   # Build for production
  npx workspai test    # Run tests
  npx workspai lint    # Lint code
  npx workspai format  # Format code

${chalk.bold('🌐 API endpoints:')}
  http://localhost:8000/health          # Health check
  http://localhost:8000/docs            # Swagger docs
  http://localhost:8000/examples/notes  # Example API

${chalk.gray('💡 Tip: Install globally (npm i -g workspai) to use without npx')}
`);
    }
  } catch (error) {
    spinner.fail(`Failed to create ${templateName} project`);
    throw error;
  }
}

async function copyAndRenderTemplate(
  src: string,
  dest: string,
  context: Record<string, string>
): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destName = entry.name.replace(/\.j2$/, '');
    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyAndRenderTemplate(srcPath, destPath, context);
    } else {
      let content = await fs.readFile(srcPath, 'utf-8');

      // Render template if it's a .j2 file
      if (entry.name.endsWith('.j2')) {
        content = renderTemplate(content, context);
      }

      await fs.writeFile(destPath, content);

      // Make scripts executable
      if (
        destName === 'rapidkit' ||
        destName === 'activate' ||
        (destName.endsWith('.py') &&
          (destPath.includes('.workspai') || destPath.includes('.rapidkit')))
      ) {
        await fs.chmod(destPath, 0o755);
      }
    }
  }
}

function renderTemplate(content: string, context: Record<string, string>): string {
  let result = content;

  for (const [key, value] of Object.entries(context)) {
    // Simple variable replacement: {{ key }}
    const simpleRegex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    result = result.replace(simpleRegex, String(value));

    // With replace filter: {{ key | replace('a', 'b') }}
    const replaceRegex = new RegExp(
      `\\{\\{\\s*${key}\\s*\\|\\s*replace\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*['"]([^'"]*)['"]\\s*\\)\\s*\\}\\}`,
      'g'
    );
    result = result.replace(replaceRegex, (_match: string, from: string, to: string) => {
      return String(value).replace(new RegExp(from, 'g'), to);
    });

    // With lower filter: {{ key | lower }}
    const lowerRegex = new RegExp(`\\{\\{\\s*${key}\\s*\\|\\s*lower\\s*\\}\\}`, 'g');
    result = result.replace(lowerRegex, String(value).toLowerCase());

    // Combined: {{ key | replace('a', 'b') | lower }}
    const combinedRegex = new RegExp(
      `\\{\\{\\s*${key}\\s*\\|\\s*replace\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*['"]([^'"]*)['"]\\s*\\)\\s*\\|\\s*lower\\s*\\}\\}`,
      'g'
    );
    result = result.replace(combinedRegex, (_match: string, from: string, to: string) => {
      return String(value).replace(new RegExp(from, 'g'), to).toLowerCase();
    });
  }

  return result;
}

/**
 * List all registered workspaces from shared registry
 */
export async function listWorkspaces(options: { json?: boolean } = {}): Promise<void> {
  // Use same logic as registerWorkspace for consistency
  const registryDir = getWorkspaceRegistryDirectory();

  const registryFile = path.join(registryDir, 'workspaces.json');
  const mergedRegistry = await readWorkspaceRegistryCandidates();

  if (mergedRegistry.workspaces.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'rapidkit-workspace-list-v1',
            registryPath: registryFile,
            workspaces: [],
            summary: {
              total: 0,
              missing: 0,
              registryExists: false,
            },
          },
          null,
          2
        )
      );
      return;
    }
    console.log(chalk.yellow('\n⚠️  No workspaces registered yet.\n'));
    console.log(chalk.gray('Create a workspace with: npx workspai <workspace-name>\n'));
    return;
  }

  try {
    const parsed = mergedRegistry as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as WorkspaceRegistry).workspaces)
    ) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              schemaVersion: 'rapidkit-workspace-list-v1',
              registryPath: registryFile,
              workspaces: [],
              summary: {
                total: 0,
                missing: 0,
                registryExists: true,
                registryValid: false,
              },
              error: {
                code: 'workspace.registry.invalid',
                message: 'Workspace registry is invalid.',
              },
            },
            null,
            2
          )
        );
        return;
      }
      console.log(chalk.yellow('\n⚠️  Workspace registry is invalid; resetting to empty state.\n'));
      await mutateWorkspaceRegistry((registry) => {
        registry.workspaces = [];
      });
      return;
    }
    const normalizedRegistry = normalizeRegistry(parsed as WorkspaceRegistry);

    const existingWorkspaces: WorkspaceEntry[] = [];
    let missingCount = 0;
    for (const ws of normalizedRegistry.workspaces) {
      const exists = await fs.stat(ws.path).catch(() => null);
      if (exists) {
        existingWorkspaces.push(ws);
      } else {
        missingCount += 1;
      }
    }

    const registry = { workspaces: existingWorkspaces };

    const inputShape = JSON.stringify(parsed);
    const outputShape = JSON.stringify(registry);
    if (!options.json && inputShape !== outputShape) {
      const existingPaths = new Set(existingWorkspaces.map((workspace) => workspace.path));
      await mutateWorkspaceRegistry((latestRegistry) => {
        latestRegistry.workspaces = latestRegistry.workspaces.filter((workspace) => {
          return existingPaths.has(workspace.path);
        });
      });
    }

    if (!registry.workspaces || registry.workspaces.length === 0) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              schemaVersion: 'rapidkit-workspace-list-v1',
              registryPath: registryFile,
              workspaces: [],
              summary: {
                total: 0,
                missing: missingCount,
                registryExists: true,
                registryValid: true,
                cleanupApplied: false,
              },
            },
            null,
            2
          )
        );
        return;
      }
      console.log(chalk.yellow('\n⚠️  No workspaces registered yet.\n'));
      if (missingCount > 0) {
        console.log(
          chalk.gray(
            `Cleaned ${missingCount} stale workspace entr${missingCount === 1 ? 'y' : 'ies'}.\n`
          )
        );
      }
      return;
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'rapidkit-workspace-list-v1',
            registryPath: registryFile,
            workspaces: registry.workspaces,
            summary: {
              total: registry.workspaces.length,
              missing: missingCount,
              registryExists: true,
              registryValid: true,
              cleanupApplied: false,
            },
          },
          null,
          2
        )
      );
      return;
    }

    console.log(chalk.bold('\n📦 Registered Workspai Workspaces:\n'));

    for (const ws of registry.workspaces) {
      console.log(chalk.cyan(`  ${ws.name}`));
      console.log(chalk.gray(`    Path: ${ws.path}`));
      console.log(chalk.gray(`    Projects: ${ws.projects?.length || 0}`));

      console.log();
    }

    if (missingCount > 0) {
      console.log(
        chalk.gray(
          `Cleaned ${missingCount} stale workspace entr${missingCount === 1 ? 'y' : 'ies'}.`
        )
      );
    }

    console.log(chalk.gray(`Total: ${registry.workspaces.length} workspace(s)\n`));
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'rapidkit-workspace-list-v1',
            registryPath: registryFile,
            workspaces: [],
            summary: {
              total: 0,
              missing: 0,
              registryExists: true,
              registryValid: false,
            },
            error: {
              code: 'workspace.registry.read_failed',
              message: (error as Error).message,
            },
          },
          null,
          2
        )
      );
      return;
    }
    console.error(chalk.red('\n❌ Failed to read workspace registry'));
    console.error(chalk.gray(String(error)));
  }
}

type WorkspaceShareProject = {
  name: string;
  relative_path: string;
  runtime?: string;
  kit_name?: string;
  modules?: string[];
  doctor_report?: unknown;
  reports?: string[];
  absolute_path?: string;
};

type WorkspaceShareBundle = {
  schema_version: '1.1';
  generated_at: string;
  generated_by: 'workspai';
  workspace: {
    name: string;
    relative_root: string;
    profile?: string;
    rapidkit_version?: string;
    absolute_root?: string;
  };
  summary: {
    project_count: number;
    doctor_evidence_included: boolean;
    contract_included?: boolean;
  };
  reports: {
    workspace: string[];
  };
  projects: WorkspaceShareProject[];
  contract?: unknown;
  blueprint?: {
    schema_version: 'rapidkit.workspace-blueprint.v1';
    purpose: 'portable-reproducibility';
    workspace: {
      name: string;
      profile?: string;
    };
    projects: Array<{
      name: string;
      relative_path: string;
      runtime?: string;
      kit_name?: string;
      modules: string[];
      recreate_commands: string[];
    }>;
    recommended_commands: string[];
  };
};

export interface WorkspaceShareOptions {
  outputPath?: string;
  includePaths?: boolean;
  includeDoctorEvidence?: boolean;
  includeBlueprint?: boolean;
}

async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readFirstJsonIfExists(filePaths: string[]): Promise<unknown | null> {
  for (const filePath of filePaths) {
    const payload = await readJsonIfExists(filePath);
    if (payload !== null) {
      return payload;
    }
  }
  return null;
}

function shouldIncludeDoctorShareReport(payload: unknown): boolean {
  return isDoctorEvidencePayloadCompatible(payload);
}

async function discoverWorkspaceProjects(workspacePath: string): Promise<string[]> {
  return discoverWorkspaceProjectsShared(workspacePath, {
    skipDirs: new Set(['node_modules', 'dist', 'build', 'target', 'coverage', 'htmlcov']),
    includeHiddenDirs: false,
    descendIntoMatchedProjects: true,
  });
}

async function listReportJsonFiles(reportsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(reportsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Build a portable workspace share bundle for collaboration/debug handoffs.
 * The bundle is JSON by default and excludes absolute paths unless requested.
 */
export async function createWorkspaceShareBundle(
  workspacePath: string,
  options?: WorkspaceShareOptions
): Promise<string> {
  const includePaths = options?.includePaths === true;
  const includeDoctorEvidence = options?.includeDoctorEvidence !== false;
  const includeBlueprint = options?.includeBlueprint !== false;
  const normalizedWorkspacePath = path.resolve(workspacePath);

  const workspaceMeta = (await readFirstJsonIfExists(
    workspaceMetadataCandidates(normalizedWorkspacePath, 'workspace.json')
  )) as Record<string, unknown> | null;

  const workspaceName =
    (typeof workspaceMeta?.workspace_name === 'string' && workspaceMeta.workspace_name.trim()) ||
    path.basename(normalizedWorkspacePath);
  const workspaceProfile =
    typeof workspaceMeta?.profile === 'string' ? workspaceMeta.profile : undefined;
  const rapidkitVersion =
    typeof workspaceMeta?.rapidkit_version === 'string'
      ? workspaceMeta.rapidkit_version
      : undefined;

  const projectPaths = await discoverWorkspaceProjects(normalizedWorkspacePath);
  const projects: WorkspaceShareProject[] = [];

  for (const projectPath of projectPaths) {
    const projectMeta = (await readFirstJsonIfExists(
      projectMetadataCandidates(projectPath, 'project.json')
    )) as Record<string, unknown> | null;
    const projectRelativePath = path.relative(normalizedWorkspacePath, projectPath) || '.';
    const projectReportsDir = path.dirname(
      projectMetadataCandidates(projectPath, path.join('reports', 'placeholder'))[0]
    );
    const legacyProjectReportsDir = path.dirname(
      projectMetadataCandidates(projectPath, path.join('reports', 'placeholder'))[1]
    );

    const projectEntry: WorkspaceShareProject = {
      name: path.basename(projectPath),
      relative_path: projectRelativePath,
      runtime: typeof projectMeta?.runtime === 'string' ? projectMeta.runtime : undefined,
      kit_name: typeof projectMeta?.kit_name === 'string' ? projectMeta.kit_name : undefined,
      modules: Array.isArray(projectMeta?.modules)
        ? projectMeta.modules.filter((item): item is string => typeof item === 'string')
        : undefined,
    };

    if (includePaths) {
      projectEntry.absolute_path = projectPath;
    }

    if (includeDoctorEvidence) {
      const doctorReport = await readFirstJsonIfExists([
        path.join(projectReportsDir, 'doctor-last-run.json'),
        path.join(legacyProjectReportsDir, 'doctor-last-run.json'),
      ]);
      if (shouldIncludeDoctorShareReport(doctorReport)) {
        projectEntry.doctor_report = doctorReport;
      }
    }

    const reportFiles = [
      ...(await listReportJsonFiles(projectReportsDir)),
      ...(await listReportJsonFiles(legacyProjectReportsDir)),
    ].filter((file, index, all) => all.indexOf(file) === index);
    if (reportFiles.length > 0) {
      projectEntry.reports = reportFiles;
    }

    projects.push(projectEntry);
  }

  const workspaceReportsDirs = workspaceMetadataCandidates(normalizedWorkspacePath, 'reports');
  const workspaceReports = [
    ...(await listReportJsonFiles(workspaceReportsDirs[0])),
    ...(await listReportJsonFiles(workspaceReportsDirs[1])),
  ].filter((file, index, all) => all.indexOf(file) === index);
  const workspaceContract = await readFirstJsonIfExists(
    workspaceMetadataCandidates(normalizedWorkspacePath, 'workspace.contract.json')
  );

  const bundle: WorkspaceShareBundle = {
    schema_version: '1.1',
    generated_at: new Date().toISOString(),
    generated_by: 'workspai',
    workspace: {
      name: workspaceName,
      relative_root: '.',
      profile: workspaceProfile,
      rapidkit_version: rapidkitVersion,
      ...(includePaths ? { absolute_root: normalizedWorkspacePath } : {}),
    },
    summary: {
      project_count: projects.length,
      doctor_evidence_included: includeDoctorEvidence,
      contract_included: !!workspaceContract,
    },
    reports: {
      workspace: workspaceReports,
    },
    projects,
    ...(workspaceContract ? { contract: workspaceContract } : {}),
  };

  if (includeBlueprint) {
    bundle.blueprint = {
      schema_version: 'rapidkit.workspace-blueprint.v1',
      purpose: 'portable-reproducibility',
      workspace: {
        name: workspaceName,
        profile: workspaceProfile,
      },
      projects: projects.map((project) => ({
        name: project.name,
        relative_path: project.relative_path,
        runtime: project.runtime,
        kit_name: project.kit_name,
        modules: project.modules ?? [],
        recreate_commands: [
          ...(project.kit_name
            ? [
                `npx workspai create project ${project.kit_name} ${project.name} --yes --skip-install`,
              ]
            : []),
          `cd ${project.relative_path}`,
          'npx workspai init',
          'npx workspai test',
        ],
      })),
      recommended_commands: [
        'npx workspai workspace contract verify --strict',
        'npx workspai doctor workspace',
        'npx workspai workspace run init --json',
        'npx workspai workspace run test --strict --json',
        'npx workspai readiness --strict --json',
      ],
    };
  }

  const outputPath = options?.outputPath
    ? path.resolve(options.outputPath)
    : path.join(workspaceReportsDirs[0], 'share-bundle.json');

  if (!options?.outputPath) {
    assertWorkspaceArtifactContract('.workspai/reports/share-bundle.json', bundle);
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(bundle, null, 2), 'utf8');

  return outputPath;
}
