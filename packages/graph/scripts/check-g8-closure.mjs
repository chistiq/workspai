import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const closurePath = 'packages/graph/governance/g8-stage-closure.v1.json';
const planPath = 'packages/graph/governance/g8-stage-plan.v1.json';
const inventoryPath = 'packages/cli/test-data/graph-shadow/g8-consumer-inventory.v1.json';
const realInventoryPath = 'packages/cli/test-data/graph-shadow/real-workspace-inventory.v1.json';
const adapterPath = 'packages/cli/src/graph-package-consumer-adapter.ts';
const productionCallers = [
  'packages/cli/src/index.ts',
  'packages/cli/src/workspace-model.ts',
  'packages/cli/src/utils/workspace-contract.ts',
];

const REQUIRED_REMAINING_RISKS = Object.freeze([
  'Production CLI commands still call buildWorkspaceKnowledgeGraph; package-primary is not the graph producer.',
  'GRAPH_CONSUMER_PACKAGE_PRIMARY remains false and refuseUnadmittedPackagePrimaryExecution always throws. executePackagePrimaryWithCompare is not implemented.',
  'Checkpoint package-primary-replacement-decision remains planned.',
  'Trusted required cross-platform corpus is only committed-node-service; large, polyglot, generated-heavy and multi-project repositories are optional local observations.',
  'Production CLI does not persist a trusted change journal for incremental package rebuilds.',
  'G8 real-workspace matrix admission remains admitted=false and nextStageAuthorized=false.',
  'G9 nextStageAuthorized remains false; legacy composers must not be removed.',
]);

function repositoryFile(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..')
  ) {
    throw new Error(`Unsafe G8 closure path: ${String(relative)}`);
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`G8 closure path escapes the repository: ${relative}`);
  }
  return resolved;
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(repositoryFile(relative), 'utf8'));
}

function readSource(relative) {
  return fs.readFileSync(repositoryFile(relative), 'utf8');
}

const failures = [];
const closure = readJson(closurePath);
const plan = readJson(planPath);
const inventory = readJson(inventoryPath);
const realInventory = readJson(realInventoryPath);
const adapterSource = readSource(adapterPath);
const replacement = (plan.checkpoints ?? []).find(
  (checkpoint) => checkpoint.id === 'package-primary-replacement-decision'
);

if (
  closure.schemaVersion !== 'workspai-independent-package-stage-closure.v1' ||
  closure.package !== '@workspai/graph' ||
  closure.stage !== 'G8' ||
  closure.status !== 'blocked' ||
  closure.advancesAdmissionGate !== false ||
  closure.nextStage !== 'G9' ||
  closure.nextStageAuthorized !== false ||
  closure.approval?.status !== 'awaiting' ||
  closure.approval?.requiredForNextStage !== true ||
  closure.measurements?.outcome !== 'g8-shadow-candidate' ||
  closure.measurements?.packagePrimary !== false ||
  closure.measurements?.authorizedRuntimeMode !== 'g8-shadow-comparison-only' ||
  closure.measurements?.currentGraphAuthority !== 'official-internal-graph-capability'
) {
  failures.push('G8 closure drifted from a blocked shadow-candidate ledger');
}

if (
  !adapterSource.includes('export const GRAPH_CONSUMER_PACKAGE_PRIMARY = false as const') ||
  !adapterSource.includes('export async function refuseUnadmittedPackagePrimaryExecution') ||
  !adapterSource.includes('throw new GraphPackagePrimaryNotAdmittedError') ||
  adapterSource.includes('export async function executePackagePrimaryWithCompare') ||
  !adapterSource.includes('return buildWorkspaceKnowledgeGraph(options)')
) {
  failures.push('consumer adapter no longer fail-closes unadmitted package-primary execution');
}

for (const caller of productionCallers) {
  const source = readSource(caller);
  if (!source.includes('buildWorkspaceKnowledgeGraph(')) {
    failures.push(`${caller} no longer calls the released CLI composer`);
  }
  if (
    source.includes('executePackagePrimaryWithCompare') ||
    source.includes('refuseUnadmittedPackagePrimaryExecution') ||
    /GRAPH_CONSUMER_PACKAGE_PRIMARY\s*===\s*true/u.test(source)
  ) {
    failures.push(`${caller} routed Graph truth through unadmitted package-primary execution`);
  }
}

if (
  inventory.packagePrimary !== false ||
  inventory.currentGraphAuthority !== 'official-internal-graph-capability' ||
  inventory.silentFallback !== 'prohibited' ||
  replacement?.status !== 'planned'
) {
  failures.push(
    'consumer inventory or replacement checkpoint no longer preserves shadow-only authority'
  );
}

const requiredCrossPlatform = (realInventory.required ?? []).filter((entry) =>
  (entry.requiredFor ?? []).includes('cross-platform')
);
if (
  requiredCrossPlatform.length !== 1 ||
  requiredCrossPlatform[0]?.id !== 'committed-node-service' ||
  (realInventory.optionalLocalReferences ?? []).some((entry) => entry.trustedBaseline)
) {
  failures.push('trusted G8 corpus contract drifted');
}

const remaining = [...(closure.remainingRisks ?? [])];
if (
  remaining.length !== REQUIRED_REMAINING_RISKS.length ||
  REQUIRED_REMAINING_RISKS.some((risk, index) => remaining[index] !== risk)
) {
  failures.push('G8 remaining-risk ledger drifted from executable blockers');
}

if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(JSON.stringify(closure))) {
  failures.push('G8 closure contains a machine-local path');
}

const report = {
  schemaVersion: 'workspai-graph-g8-closure-audit.v1',
  package: '@workspai/graph',
  stage: 'G8',
  outcome: 'g8-shadow-candidate',
  status: failures.length === 0 ? 'blocked' : 'invalid',
  admitted: false,
  nextStageAuthorized: false,
  remainingRisks: REQUIRED_REMAINING_RISKS,
  failures,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
