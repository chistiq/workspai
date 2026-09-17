#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');

const files = {
  platformCapabilities: path.join(packageRoot, 'src', 'utils', 'platform-capabilities.ts'),
  registryPath: path.join(packageRoot, 'src', 'utils', 'registry-path.ts'),
  lifecycleTransaction: path.join(packageRoot, 'src', 'utils', 'lifecycle-transaction.ts'),
  workspace: path.join(packageRoot, 'src', 'workspace.ts'),
  workspacePaths: path.join(packageRoot, 'src', 'utils', 'workspace-paths.ts'),
  workspaceRegistrySummary: path.join(packageRoot, 'src', 'utils', 'workspace-registry-summary.ts'),
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, filePath]) => [key, readFileSync(filePath, 'utf8')])
);

const failures = [];

function fail(message) {
  failures.push(message);
}

function extractFunctionBody(content, functionName) {
  const declarationPattern = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\(`
  );
  const declaration = declarationPattern.exec(content);
  if (!declaration) {
    fail(`Missing function: ${functionName}`);
    return '';
  }
  const start = declaration.index;

  const firstBrace = content.indexOf('{', start);
  if (firstBrace === -1) {
    fail(`Missing function body: ${functionName}`);
    return '';
  }

  let depth = 0;
  for (let index = firstBrace; index < content.length; index += 1) {
    const character = content[index];
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(firstBrace + 1, index);
      }
    }
  }

  fail(`Could not parse function body: ${functionName}`);
  return '';
}

function assertIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    fail(message);
  }
}

function assertNotIncludes(haystack, needle, message) {
  if (haystack.includes(needle)) {
    fail(message);
  }
}

function assertOrdered(haystack, needles, message) {
  let previousIndex = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle);
    if (index === -1 || index <= previousIndex) {
      fail(message);
      return;
    }
    previousIndex = index;
  }
}

function assertMatch(haystack, pattern, message) {
  if (!pattern.test(haystack)) {
    fail(message);
  }
}

const canonicalRegistryDirectory = extractFunctionBody(
  source.platformCapabilities,
  'getWorkspaceRegistryDirectory'
);
const legacyRegistryDirectory = extractFunctionBody(
  source.platformCapabilities,
  'getLegacyWorkspaceRegistryDirectory'
);
const registryCandidates = extractFunctionBody(
  source.platformCapabilities,
  'getWorkspaceRegistryFileCandidates'
);
const canonicalWorkspacesDirectory = extractFunctionBody(
  source.workspacePaths,
  'getCanonicalWorkspacesDirectory'
);
const normalizeRegistryPath = extractFunctionBody(source.registryPath, 'normalizeRegistryPath');
const readWorkspaceRegistryCandidates = extractFunctionBody(
  source.workspace,
  'readWorkspaceRegistryCandidates'
);
const mutateWorkspaceRegistry = extractFunctionBody(source.workspace, 'mutateWorkspaceRegistry');
const syncWorkspaceProjects = extractFunctionBody(source.workspace, 'syncWorkspaceProjects');
const listWorkspaces = extractFunctionBody(source.workspace, 'listWorkspaces');
const lifecycleSyncHandle = extractFunctionBody(source.lifecycleTransaction, 'syncHandle');
const lifecycleSyncDirectory = extractFunctionBody(source.lifecycleTransaction, 'syncDirectory');

assertIncludes(
  canonicalRegistryDirectory,
  'env.HOME || env.USERPROFILE || os.homedir()',
  'Canonical workspace registry must resolve from HOME/USERPROFILE/os.homedir().'
);
assertIncludes(
  canonicalRegistryDirectory,
  "path.join(homeDir, '.workspai')",
  'Canonical workspace registry must remain ~/.workspai, including on Windows.'
);
assertNotIncludes(
  canonicalRegistryDirectory,
  'env.APPDATA',
  'Canonical workspace registry must not use APPDATA; APPDATA is compatibility-only.'
);
assertNotIncludes(
  canonicalRegistryDirectory,
  'env.XDG_CONFIG_HOME',
  'Canonical workspace registry must not use XDG_CONFIG_HOME; XDG/APPDATA are compatibility-only.'
);
assertNotIncludes(
  canonicalRegistryDirectory,
  'isWindowsPlatform(platform)',
  'Canonical registry directory must not branch by platform; Windows and POSIX use the same ~/.workspai contract.'
);

assertIncludes(
  legacyRegistryDirectory,
  'env.HOME || env.USERPROFILE || os.homedir()',
  'Legacy workspace registry mirror must resolve from HOME/USERPROFILE/os.homedir().'
);
assertIncludes(
  legacyRegistryDirectory,
  "path.join(homeDir, '.rapidkit')",
  'Legacy workspace registry mirror must remain ~/.rapidkit.'
);
assertNotIncludes(
  legacyRegistryDirectory,
  'env.APPDATA',
  'Legacy workspace registry mirror must not use APPDATA as its canonical location.'
);

assertIncludes(
  registryCandidates,
  "path.join(getWorkspaceRegistryDirectory(env, platform), 'workspaces.json')",
  'Workspace registry candidates must read the canonical ~/.workspai/workspaces.json first.'
);
assertIncludes(
  registryCandidates,
  "path.join(getLegacyWorkspaceRegistryDirectory(env, platform), 'workspaces.json')",
  'Workspace registry candidates must read the legacy ~/.rapidkit/workspaces.json mirror.'
);
assertIncludes(
  registryCandidates,
  'isWindowsPlatform(platform)',
  'Windows registry compatibility candidates must stay platform-gated.'
);
assertIncludes(
  registryCandidates,
  'env.XDG_CONFIG_HOME || env.APPDATA',
  'Windows registry compatibility candidates must include XDG_CONFIG_HOME/APPDATA.'
);
assertIncludes(
  registryCandidates,
  "path.join(configHome, 'workspai', 'workspaces.json')",
  'Windows registry compatibility candidates must include APPDATA/workspai/workspaces.json.'
);
assertIncludes(
  registryCandidates,
  "path.join(configHome, 'rapidkit', 'workspaces.json')",
  'Windows registry compatibility candidates must include APPDATA/rapidkit/workspaces.json.'
);
assertIncludes(
  registryCandidates,
  'return [...new Set(candidates)]',
  'Workspace registry candidates must be deduplicated.'
);
assertOrdered(
  registryCandidates,
  [
    "path.join(getWorkspaceRegistryDirectory(env, platform), 'workspaces.json')",
    "path.join(getLegacyWorkspaceRegistryDirectory(env, platform), 'workspaces.json')",
    "path.join(configHome, 'workspai', 'workspaces.json')",
    "path.join(configHome, 'rapidkit', 'workspaces.json')",
  ],
  'Workspace registry candidate precedence must be canonical, legacy mirror, then Windows config compatibility files.'
);

assertIncludes(
  canonicalWorkspacesDirectory,
  "path.join(homeDir, '.workspai', 'workspaces')",
  'Managed workspace creation must stay under ~/.workspai/workspaces.'
);

assertIncludes(
  normalizeRegistryPath,
  "process.platform === 'win32' ? resolved.toLowerCase() : resolved",
  'Registry path normalization must lowercase paths only on Windows.'
);

assertIncludes(
  readWorkspaceRegistryCandidates,
  'for (const registryFile of getWorkspaceRegistryFileCandidates())',
  'Registry reads must merge all canonical, legacy, and Windows compatibility candidates.'
);
assertIncludes(
  readWorkspaceRegistryCandidates,
  'seen.has(entry.path)',
  'Registry candidate merging must deduplicate by normalized workspace path.'
);

assertIncludes(
  mutateWorkspaceRegistry,
  'const canonicalDirectory = getWorkspaceRegistryDirectory()',
  'Registry mutations must snapshot the canonical ~/.workspai registry directory before waiting.'
);
assertIncludes(
  mutateWorkspaceRegistry,
  "path.join(canonicalDirectory, 'workspaces.json')",
  'Registry mutations must derive the canonical ~/.workspai/workspaces.json file from the pinned directory.'
);
assertIncludes(
  mutateWorkspaceRegistry,
  "path.join(getLegacyWorkspaceRegistryDirectory(), 'workspaces.json')",
  'Registry mutations must mirror to the legacy ~/.rapidkit/workspaces.json file.'
);
assertIncludes(
  mutateWorkspaceRegistry,
  'const registryCandidates = [...new Set(getWorkspaceRegistryFileCandidates())]',
  'Registry mutations must snapshot and deduplicate every compatibility candidate before waiting.'
);
assertIncludes(
  mutateWorkspaceRegistry,
  'return withWorkspaceRegistryLock(canonicalDirectory',
  'Registry mutations must lock the same pinned canonical directory they later write.'
);
assertIncludes(
  mutateWorkspaceRegistry,
  'readWorkspaceRegistryCandidatesStrict(registryCandidates)',
  'Registry mutations must read the pinned candidate inventory instead of recomputing HOME/APPDATA under the lock.'
);
assertOrdered(
  mutateWorkspaceRegistry,
  [
    'const canonicalDirectory = getWorkspaceRegistryDirectory()',
    "const canonicalFile = path.join(canonicalDirectory, 'workspaces.json')",
    "const legacyFile = path.join(getLegacyWorkspaceRegistryDirectory(), 'workspaces.json')",
    'const registryCandidates = [...new Set(getWorkspaceRegistryFileCandidates())]',
    'return withWorkspaceRegistryLock(canonicalDirectory',
    'const normalized = normalizeRegistry(registry)',
    'await writeWorkspaceRegistryFileAtomically(canonicalFile, normalized)',
    'await writeWorkspaceRegistryFileAtomically(legacyFile, normalized)',
  ],
  'Registry mutations must normalize once, then write canonical and legacy mirror with the same payload.'
);

assertIncludes(
  syncWorkspaceProjects,
  'path.basename(path.resolve(workspacePath))',
  'Repaired cloned workspace registrations must preserve the original path basename casing.'
);
assertNotIncludes(
  syncWorkspaceProjects,
  'registerWorkspace(normalizedWorkspacePath, path.basename(normalizedWorkspacePath))',
  'Never derive workspace registry names from normalized paths; Windows normalization lowercases names.'
);
assertIncludes(
  syncWorkspaceProjects,
  'await registerWorkspace(normalizedWorkspacePath, path.basename(path.resolve(workspacePath)))',
  'workspace sync must repair cloned workspaces while preserving original basename casing.'
);
assertIncludes(
  syncWorkspaceProjects,
  'const queue = [workspacePath]',
  'workspace sync must discover nested projects from the original workspace path.'
);
assertIncludes(
  syncWorkspaceProjects,
  "['node_modules', 'dist', 'build', 'target', 'coverage', 'htmlcov'].includes(entry.name)",
  'workspace sync must skip heavy dependency/build/cache directories while scanning nested projects.'
);

assertIncludes(
  source.workspace,
  'const mergedRegistry = await readWorkspaceRegistryCandidates()',
  'workspace list must read merged registry candidates, not only one platform-specific file.'
);
assertIncludes(
  source.workspace,
  'const exists = await fs.stat(ws.path).catch(() => null)',
  'workspace list must prune stale registered workspace paths.'
);

assertIncludes(
  source.workspace,
  'function isIgnorableWorkspaceRegistryFsyncError',
  'Workspace registry writes must keep a Windows fsync compatibility guard.'
);
assertIncludes(
  source.workspace,
  'async function syncWorkspaceRegistryHandle',
  'Workspace registry writes must route FileHandle.sync through syncWorkspaceRegistryHandle.'
);
assertIncludes(
  source.workspace,
  "code === 'EPERM' || code === 'EINVAL' || code === 'ENOSYS'",
  'Windows registry fsync guard must tolerate EPERM/EINVAL/ENOSYS only.'
);
assertIncludes(
  source.workspace,
  "process.platform === 'win32'",
  'Workspace registry fsync tolerance must remain Windows-only.'
);
assertIncludes(
  source.workspace,
  'const corruptBackup = `${registryFile}.corrupt-${Date.now()}`',
  'Invalid registry JSON must be preserved before repair.'
);
assertIncludes(
  source.workspace,
  'await fs.copyFile(registryFile, corruptBackup)',
  'Corrupt registry backup must copy the original file before overwriting.'
);
assertIncludes(
  source.workspace,
  "await fs.open(lockPath, 'wx')",
  'Registry mutations must keep an exclusive lock for concurrent CLI registrations.'
);
assertIncludes(
  source.workspace,
  'await fs.rm(lockPath, { force: true }).catch(() => undefined)',
  'Registry lock must be removed after mutations.'
);
assertIncludes(
  source.workspace,
  "new Set(['EPERM', 'EBUSY', 'EACCES'])",
  'Registry replace must retry Windows EPERM, EBUSY and EACCES failures.'
);
assertIncludes(
  source.workspace,
  'async function replaceWorkspaceRegistryFile',
  'Registry publication must isolate replace/retry from the durable write.'
);
assertIncludes(
  source.workspace,
  'if (!isTransientWorkspaceRegistryReplaceError(moveError)) {\n          throw moveError;\n        }',
  'Registry overwrite retry must decide from the move error alone.'
);
if (
  source.workspace.includes(
    '!isTransientWorkspaceRegistryReplaceError(error) &&\n          !isTransientWorkspaceRegistryReplaceError(moveError)'
  )
) {
  fail('Registry overwrite retry must not inherit the earlier rename error.');
}

const rawSyncOccurrences = [...source.workspace.matchAll(/await\s+[\w.]+\.sync\(\)/g)].map(
  (match) => match[0]
);
if (rawSyncOccurrences.length > 1) {
  fail(
    `Workspace registry has raw FileHandle.sync calls outside the compatibility helper: ${rawSyncOccurrences.join(
      ', '
    )}`
  );
}

assertIncludes(
  source.lifecycleTransaction,
  'function isIgnorableWindowsDurabilityError',
  'Lifecycle transaction journals must keep a Windows fsync compatibility guard.'
);
assertIncludes(
  source.lifecycleTransaction,
  "code === 'EPERM' || code === 'EINVAL' || code === 'ENOSYS'",
  'Lifecycle transaction fsync tolerance must be limited to EPERM/EINVAL/ENOSYS.'
);
assertIncludes(
  source.lifecycleTransaction,
  "process.platform === 'win32'",
  'Lifecycle transaction fsync tolerance must remain Windows-only.'
);
assertIncludes(
  lifecycleSyncHandle,
  'isIgnorableWindowsDurabilityError(error)',
  'Lifecycle FileHandle.sync must use the Windows durability compatibility guard.'
);
assertIncludes(
  lifecycleSyncDirectory,
  'await syncHandle(handle)',
  'Lifecycle directory sync must use the guarded sync helper.'
);
assertIncludes(
  source.lifecycleTransaction,
  "if ((error as NodeJS.ErrnoException).code === 'ENOENT')",
  'Lifecycle recovery must tolerate journals removed or not yet published by concurrent owners.'
);

const rawLifecycleSyncOccurrences = [
  ...source.lifecycleTransaction.matchAll(/await\s+(?!syncHandle\b)[\w.]+\.sync\(\)/g),
].map((match) => match[0]);
if (rawLifecycleSyncOccurrences.length > 1) {
  fail(
    `Lifecycle transactions have raw FileHandle.sync calls outside the compatibility helper: ${rawLifecycleSyncOccurrences.join(
      ', '
    )}`
  );
}

assertIncludes(
  source.workspaceRegistrySummary,
  'for (const registryFile of getWorkspaceRegistryFileCandidates())',
  'Workspace registry summary must read canonical, legacy, and Windows compatibility registry candidates.'
);
assertIncludes(
  source.workspaceRegistrySummary,
  "registryPath: path.join(getWorkspaceRegistryDirectory(), 'workspaces.json')",
  'Workspace registry summary fallback path must report the canonical registry path.'
);
assertMatch(
  source.workspaceRegistrySummary,
  /normalizeRegistryPath\(workspace\.path\)\s*===\s*normalizedWorkspacePath/,
  'Workspace registry summary must compare registry paths through normalizeRegistryPath.'
);

if (failures.length > 0) {
  console.error('Windows workspace registry invariant check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('\nRun: corepack npm --workspace workspai run check:windows-registry');
  process.exit(1);
}

console.log('Windows workspace registry invariants passed.');
