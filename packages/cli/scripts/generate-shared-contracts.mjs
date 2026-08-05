import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, '..');
const monorepoRoot = path.resolve(cliRoot, '..', '..');
const contractsDir = path.resolve(cliRoot, 'contracts');

const GENERATED_FILES = [
  'runtime-command-surface.v1.json',
  'cli-runtime-command-inventory.v1.snapshot.json',
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
  'workspace-snapshot.v2.json',
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
  'create-planner-capabilities.v1.json',
  'agent-customization-pack.v1.json',
  'backend-import-stack-parity.snapshot.json',
  'module-layout.v1.json',
  'project-entry-capability.v1.json',
  'infra-stack.v1.json',
  'extension-cli-compatibility.v1.json',
  'workspace-intelligence-architecture.v1.json',
  'workspace-intelligence-chain.v1.json',
  'studio-card-repair-capabilities.v1.json',
  'workspace-repair-capabilities.v1.json',
];

function runGenerator() {
  const scriptPath = path.resolve(cliRoot, 'scripts/run-generate-shared-contracts.ts');
  const tsxPackage = path.resolve(monorepoRoot, 'node_modules', 'tsx');
  const hasTsx = fs.existsSync(tsxPackage);
  const runner = hasTsx ? process.execPath : 'npx';
  const args = hasTsx ? ['--import', 'tsx', scriptPath] : ['tsx', scriptPath];
  const result = spawnSync(runner, args, {
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

const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const before = Object.fromEntries(
    GENERATED_FILES.map((fileName) => [
      fileName,
      fs.existsSync(path.join(contractsDir, fileName))
        ? fs.readFileSync(path.join(contractsDir, fileName), 'utf-8')
        : '',
    ])
  );

  runGenerator();

  for (const fileName of GENERATED_FILES) {
    const targetPath = path.join(contractsDir, fileName);
    const after = fs.readFileSync(targetPath, 'utf-8');
    if (before[fileName] !== after) {
      console.error(`Generated contract drift: ${targetPath}`);
      console.error('Run: npm run generate:contracts && npm run sync:parity-snapshot');
      process.exit(1);
    }
  }

  console.log('Generated contracts match committed packages/cli/contracts/ files.');
  process.exit(0);
}

runGenerator();
console.log('Generated shared contracts in packages/cli/contracts/.');
console.log('Next: npm run sync:parity-snapshot');
