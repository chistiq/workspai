import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Single source-of-truth contract sync.
 *
 * Canonical contracts live in packages/cli/contracts/.
 * This script:
 * - regenerates generated canonical contracts from Workspai CLI source code
 * - mirrors every canonical JSON contract to workspai/contracts/
 * - mirrors every canonical JSON contract to rapidkit-vscode/contracts/
 * - mirrors runtime-consumed extension JSON contracts to rapidkit-vscode/src/contracts/
 */

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const npmOnly = args.has('--npm-only');
const stageGit = args.has('--stage-git');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, '..');
const monorepoRoot = path.resolve(cliRoot, '..', '..');
const contractsDir = path.resolve(cliRoot, 'contracts');
const rootContractsDir = path.resolve(monorepoRoot, 'contracts');
const vscodeRoot = process.env.RAPIDKIT_VSCODE_REPO_PATH
  ? path.resolve(process.env.RAPIDKIT_VSCODE_REPO_PATH)
  : path.resolve(monorepoRoot, '..', 'rapidkit-vscode');

const GENERATED_FILES = [
  'runtime-command-surface.v1.json',
  'cli-operation-result.v1.json',
  'command-capabilities.v1.json',
  'version.v1.json',
  'published-contract-catalog.v1.json',
  'autopilot-release.v1.json',
  'workspace-list.v1.json',
  'workspace-sync.v1.json',
  'compatibility-matrix.v1.json',
  'workspace-intelligence/mcp-design.v1.json',
  'workspace-intelligence/agent-hooks.v1.json',
  'project-archive.v1.json',
  'workspace-snapshot.v1.json',
  'infra-plan.v1.json',
  'private-product-manifest.v1.json',
  'product-factory-plan.v1.json',
  'workspace-model-cache.v1.json',
  'workspace-watch-event.v1.json',
  'doctor-project-scan.v2.json',
  'doctor-workspace-cache.v2.json',
  'workspace-archive-capabilities.v1.json',
  'workspace-archive-manifest.v1.json',
  'workspace-archive-operation-result.v1.json',
  'ingestion-plan.v1.json',
  'ingestion-result.v1.json',
  'create-planner-capabilities.v1.json',
  'agent-customization-pack.v1.json',
  'backend-import-stack-parity.snapshot.json',
  'module-layout.v1.json',
  'project-entry-capability.v1.json',
  'infra-stack.v1.json',
  'extension-cli-compatibility.v1.json',
  'workspace-intelligence-architecture.v1.json',
  'workspace-intelligence-chain.v1.json',
];

const VSCODE_SRC_CONTRACT_FILES = [
  'cli-operation-result.v1.json',
  'command-capabilities.v1.json',
  'version.v1.json',
  'published-contract-catalog.v1.json',
  'agent-customization-pack.v1.json',
  'create-planner-capabilities.v1.json',
  'release-readiness.v1.json',
  'workspace-registry.v1.json',
  'workspace-archive-capabilities.v1.json',
  'workspace-archive-manifest.v1.json',
  'workspace-archive-operation-result.v1.json',
  'ingestion-plan.v1.json',
  'ingestion-result.v1.json',
];
const LEGACY_CONTRACT_PORTAL_PATTERN = /https:\/\/(?:www\.)?(?:getrapidkit\.com|rapidkit\.dev)\//i;
const WORKSPAI_CONTRACT_TITLE_PATTERN = /^Workspai\b/;

function runGenerator() {
  const scriptPath = path.resolve(cliRoot, 'scripts/run-generate-shared-contracts.ts');
  const tsxPackage = path.resolve(monorepoRoot, 'node_modules', 'tsx');
  const hasTsx = fs.existsSync(tsxPackage);
  const runner = hasTsx ? process.execPath : 'npx';
  const runnerArgs = hasTsx ? ['--import', 'tsx', scriptPath] : ['tsx', scriptPath];
  const result = spawnSync(runner, runnerArgs, {
    cwd: cliRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error('Could not run shared contract generator.');
    console.error(
      hasTsx
        ? `Failed runner: ${process.execPath} --import tsx`
        : 'Neither local/workspace node_modules/.bin/tsx nor npx is available.'
    );
    console.error('Install npm dependencies or run through npm so npx can resolve tsx.');
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Compare contract content independent of line-ending style. Windows checkouts
// (core.autocrlf=true) store CRLF while the generator writes LF; without this
// the --check gate reports false drift even though the contracts are identical.
function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n');
}

function contractContentEquals(a, b) {
  return normalizeNewlines(a) === normalizeNewlines(b);
}

function listJsonContracts(dir, prefix = '') {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(prefix, entry.name);
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listJsonContracts(absolutePath, relativePath);
      }
      return entry.isFile() && entry.name.endsWith('.json') ? [relativePath] : [];
    })
    .sort();
}

function assertCanonicalContractPortal(relativePaths) {
  const violations = [];
  for (const relativePath of relativePaths) {
    const canonicalPath = path.resolve(contractsDir, relativePath);
    const content = fs.readFileSync(canonicalPath, 'utf-8');
    if (LEGACY_CONTRACT_PORTAL_PATTERN.test(content)) {
      violations.push(relativePath);
      continue;
    }

    const schema = JSON.parse(content);
    const title = typeof schema?.title === 'string' ? schema.title.trim() : '';
    if (schema?.$schema && !WORKSPAI_CONTRACT_TITLE_PATTERN.test(title)) {
      violations.push(
        `${relativePath} (schema title must begin with Workspai; received: ${title || '<missing>'})`
      );
      continue;
    }
    const schemaId = typeof schema?.$id === 'string' ? schema.$id : '';
    if (/^https?:\/\//i.test(schemaId)) {
      const schemaUrl = new URL(schemaId);
      const portableRelativePath = relativePath.split(path.sep).join('/');
      const acceptedPaths = new Set([
        `/schemas/${portableRelativePath}`,
        `/contracts/${portableRelativePath}`,
      ]);
      if (
        schemaUrl.hostname !== 'workspai.dev' ||
        !acceptedPaths.has(decodeURIComponent(schemaUrl.pathname))
      ) {
        violations.push(relativePath);
      }
    }
  }

  if (violations.length > 0) {
    console.error('Canonical contracts must publish Workspai-owned URLs on workspai.dev:');
    for (const relativePath of violations) {
      console.error(`- ${relativePath}`);
    }
    process.exit(1);
  }
}

function snapshotGeneratedFiles() {
  return Object.fromEntries(
    GENERATED_FILES.map((fileName) => {
      const targetPath = path.join(contractsDir, fileName);
      return [fileName, fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : ''];
    })
  );
}

function verifyGeneratedFiles(before) {
  for (const fileName of GENERATED_FILES) {
    const targetPath = path.join(contractsDir, fileName);
    const after = fs.readFileSync(targetPath, 'utf-8');
    if (!contractContentEquals(before[fileName], after)) {
      console.error(`Generated contract drift: ${targetPath}`);
      console.error('Run: npm run sync:shared-contracts');
      process.exit(1);
    }
  }
}

function readCanonical(relativePath) {
  const canonicalPath = path.resolve(contractsDir, relativePath);
  if (!fs.existsSync(canonicalPath)) {
    console.error(`Canonical contract missing in Workspai CLI package: ${canonicalPath}`);
    process.exit(1);
  }

  return {
    canonicalPath,
    content: fs.readFileSync(canonicalPath, 'utf-8'),
  };
}

function writeTarget(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf-8');
}

function verifyTarget(targetPath, content, label) {
  if (!fs.existsSync(targetPath)) {
    console.error(`${label} contract copy is missing: ${targetPath}`);
    process.exit(1);
  }

  const targetContent = fs.readFileSync(targetPath, 'utf-8');
  if (!contractContentEquals(targetContent, content)) {
    console.error(`${label} contract copy is out of sync: ${targetPath}`);
    console.error('Run: npm --workspace workspai run sync:shared-contracts');
    process.exit(1);
  }
}

function syncContract(relativePath, targetRoot, label, content) {
  const targetPath = path.resolve(targetRoot, relativePath);
  if (checkOnly) {
    verifyTarget(targetPath, content, label);
    return;
  }

  writeTarget(targetPath, content);
  console.log(`- ${label}: ${targetPath}`);
}

function getGitTopLevel(cwd) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function toRepoRelativePath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

/**
 * After regenerate/sync, re-stage contract files in the current commit so pre-commit
 * does not leave generator formatting drift as unstaged changes.
 */
function stageSyncedContracts(canonicalRelativePaths) {
  const npmGitRoot = getGitTopLevel(cliRoot);
  if (!npmGitRoot) {
    console.warn('[workspai] Skipping contract git staging (not inside a git repository).');
    return;
  }

  const staged = new Set();

  function stageInRepo(repoRoot, absolutePath) {
    if (!repoRoot || !fs.existsSync(absolutePath)) {
      return;
    }
    const relativePath = toRepoRelativePath(repoRoot, absolutePath);
    if (!relativePath || relativePath.startsWith('..')) {
      return;
    }
    const key = `${repoRoot}:${relativePath}`;
    if (staged.has(key)) {
      return;
    }
    const unstaged = spawnSync('git', ['diff', '--name-only', '--', relativePath], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    const untracked = spawnSync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '--', relativePath],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      }
    );
    const needsStage = Boolean(unstaged.stdout.trim()) || Boolean(untracked.stdout.trim());
    if (!needsStage) {
      return;
    }
    const result = spawnSync('git', ['add', '--', relativePath], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      console.error(`Failed to stage contract file: ${absolutePath}`);
      if (result.stderr?.trim()) {
        console.error(result.stderr.trim());
      }
      process.exit(result.status ?? 1);
    }
    staged.add(key);
  }

  for (const relativePath of canonicalRelativePaths) {
    stageInRepo(npmGitRoot, path.resolve(contractsDir, relativePath));
    stageInRepo(npmGitRoot, path.resolve(rootContractsDir, relativePath));
  }

  if (!npmOnly && fs.existsSync(vscodeRoot)) {
    const vscodeGitRoot = getGitTopLevel(vscodeRoot);
    for (const relativePath of canonicalRelativePaths) {
      stageInRepo(vscodeGitRoot, path.resolve(vscodeRoot, 'contracts', relativePath));
      if (VSCODE_SRC_CONTRACT_FILES.includes(relativePath)) {
        stageInRepo(vscodeGitRoot, path.resolve(vscodeRoot, 'src', 'contracts', relativePath));
      }
    }
  }

  if (staged.size > 0) {
    console.log('📎 Staged synced contract files for this commit:');
    for (const entry of [...staged].sort()) {
      const [, relativePath] = entry.split(':');
      console.log(`   - ${relativePath}`);
    }
  }
}

const generatedSnapshot = checkOnly ? snapshotGeneratedFiles() : null;
runGenerator();
if (checkOnly) {
  verifyGeneratedFiles(generatedSnapshot);
}

const canonicalFiles = listJsonContracts(contractsDir);
if (canonicalFiles.length === 0) {
  console.error(`No canonical contracts found in ${contractsDir}`);
  process.exit(1);
}
assertCanonicalContractPortal(canonicalFiles);

for (const relativePath of canonicalFiles) {
  const { canonicalPath, content } = readCanonical(relativePath);

  if (!checkOnly) {
    console.log(`Contract synced from ${canonicalPath}`);
  }

  syncContract(relativePath, rootContractsDir, 'workspai/contracts', content);

  if (!npmOnly && fs.existsSync(vscodeRoot)) {
    syncContract(
      relativePath,
      path.resolve(vscodeRoot, 'contracts'),
      'rapidkit-vscode/contracts',
      content
    );

    if (VSCODE_SRC_CONTRACT_FILES.includes(relativePath)) {
      syncContract(
        relativePath,
        path.resolve(vscodeRoot, 'src', 'contracts'),
        'rapidkit-vscode/src/contracts',
        content
      );
    }
  }
}

if (checkOnly) {
  console.log('Shared generated contracts and mirrors match packages/cli/contracts/.');
} else {
  console.log('Shared contracts generated and synced from packages/cli/contracts/.');
  if (stageGit) {
    stageSyncedContracts(canonicalFiles);
  }
}
