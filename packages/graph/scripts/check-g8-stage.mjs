import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const failures = [];
const commitPattern = /^[a-f0-9]{40}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function repositoryFile(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..')
  ) {
    throw new Error(`Unsafe G8 evidence path: ${String(relative)}`);
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`G8 evidence path escapes the repository: ${relative}`);
  }
  return resolved;
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(repositoryFile(relative), 'utf8'));
}

function digest(relative) {
  return `sha256:${crypto
    .createHash('sha256')
    .update(fs.readFileSync(repositoryFile(relative)))
    .digest('hex')}`;
}

const planPath = 'packages/graph/governance/g8-stage-plan.v1.json';
const admissionPath = 'packages/graph/governance/g7-retained-admission.v1.json';
const transitionPath = 'packages/graph/governance/g7-stage-admission.v1.json';
const plan = readJson(planPath);
const admission = readJson(admissionPath);
const transition = readJson(transitionPath);
const registry = readJson('independent-packages.json');
const graphManifest = readJson('packages/graph/package.json');
const cliManifest = readJson('packages/cli/package.json');
const graphRegistry = (registry.packages ?? []).find((entry) => entry.name === '@workspai/graph');
const requiredCheckpoints = new Set([
  'prepared-context-bridge',
  'artifact-compatibility-renderers',
  'legacy-package-shadow-execution',
  'semantic-parity-corpus',
  'real-workspace-cross-platform-parity',
  'workspace-intelligence-consumer-parity',
  'rust-wasm-host-routing',
  'package-primary-replacement-decision',
]);

if (
  admission.status !== 'admitted' ||
  admission.standaloneStable !== true ||
  admission.nextStage !== 'G8' ||
  admission.nextStageAuthorized !== true ||
  admission.authorizedRuntimeMode !== 'g8-shadow-comparison-only' ||
  admission.currentGraphAuthority !== 'official-internal-graph-capability' ||
  admission.sourceCommit !== admission.testedCommit ||
  !commitPattern.test(admission.sourceCommit ?? '') ||
  !digestPattern.test(admission.promotionEvidenceDigest ?? '') ||
  !digestPattern.test(admission.sourceLedgerDigest ?? '') ||
  admission.npmPublication !== 'prohibited'
) {
  failures.push('G8 lacks an exact retained standalone admission');
}
if (
  plan.stage !== 'G8' ||
  plan.status !== 'in-progress' ||
  plan.authorizedBy !== transitionPath ||
  plan.authorizedRuntimeMode !== 'g8-shadow-comparison-only' ||
  plan.currentGraphAuthority !== 'official-internal-graph-capability' ||
  plan.nextStage !== 'G9' ||
  plan.nextStageAuthorized !== false
) {
  failures.push('G8 plan identity or authority boundary drifted');
}
if (
  transition.stage !== 'G7' ||
  transition.status !== 'approved' ||
  transition.advancesAdmissionGate !== true ||
  transition.nextStage !== 'G8' ||
  transition.nextStageAuthorized !== true ||
  transition.approval?.status !== 'approved' ||
  !JSON.stringify(transition).includes(admissionPath)
) {
  failures.push('G8 lacks a valid package-owned G7 transition closure');
}
const checkpoints = Array.isArray(plan.checkpoints) ? plan.checkpoints : [];
const checkpointIds = new Set();
for (const checkpoint of checkpoints) {
  if (!requiredCheckpoints.has(checkpoint.id) || checkpointIds.has(checkpoint.id)) {
    failures.push(`invalid or duplicate G8 checkpoint: ${String(checkpoint.id)}`);
  }
  checkpointIds.add(checkpoint.id);
  if (!['planned', 'implemented-local-candidate', 'passed'].includes(checkpoint.status)) {
    failures.push(`invalid G8 checkpoint status: ${String(checkpoint.id)}`);
  }
  if (checkpoint.status !== 'planned') {
    if (!Array.isArray(checkpoint.evidence) || checkpoint.evidence.length === 0) {
      failures.push(`implemented G8 checkpoint lacks evidence: ${String(checkpoint.id)}`);
    }
    for (const evidence of checkpoint.evidence ?? []) {
      const file = repositoryFile(evidence);
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
        failures.push(`missing G8 checkpoint evidence: ${String(evidence)}`);
      }
    }
  }
  if (checkpoint.id === 'real-workspace-cross-platform-parity' && checkpoint.status === 'passed') {
    failures.push(
      'real-workspace cross-platform admission cannot be marked passed without retained remote evidence'
    );
  }
  if (
    checkpoint.id === 'real-workspace-cross-platform-parity' &&
    checkpoint.crossPlatformAdmission &&
    checkpoint.crossPlatformAdmission !== 'pending'
  ) {
    failures.push(
      'real-workspace cross-platform admission must remain pending until the remote matrix is retained'
    );
  }
  if (checkpoint.id === 'package-primary-replacement-decision' && checkpoint.status !== 'planned') {
    failures.push('package-primary replacement remains unauthorized during G8 shadow comparison');
  }
}
for (const checkpoint of requiredCheckpoints) {
  if (!checkpointIds.has(checkpoint)) failures.push(`missing G8 checkpoint: ${checkpoint}`);
}
if (
  !graphRegistry ||
  graphRegistry.currentStage !== 'G8' ||
  graphRegistry.stageStatus !== 'in-progress' ||
  graphRegistry.standaloneStability !== 'admitted' ||
  graphRegistry.latestClosure !== 'packages/graph/governance/g7-stage-admission.v1.json' ||
  graphRegistry.cliRuntimeIntegration !== 'g8-shadow-comparison-only'
) {
  failures.push('independent package registry does not preserve G8 shadow-only execution');
}
if (
  graphManifest.private !== true ||
  graphManifest.scripts?.prepublishOnly !== 'node scripts/refuse-publish.mjs' ||
  cliManifest.dependencies?.['@workspai/graph'] !== undefined ||
  cliManifest.optionalDependencies?.['@workspai/graph'] !== undefined ||
  cliManifest.devDependencies?.['@workspai/graph'] !== graphManifest.version
) {
  failures.push('G8 internal bundle dependency or non-publication boundary drifted');
}
const bridgeSource = fs.readFileSync(
  repositoryFile('packages/cli/src/graph-package-shadow-bridge.ts'),
  'utf8'
);
const bundleConfig = fs.readFileSync(repositoryFile('packages/cli/tsup.config.ts'), 'utf8');
if (
  !bridgeSource.includes("from '@workspai/graph/adapters/node'") ||
  (!bridgeSource.includes("authority: 'released-cli'") &&
    !bridgeSource.includes('runGraphShadowComparison')) ||
  !bundleConfig.includes("'internal/graph-package-shadow-bridge':") ||
  !bundleConfig.includes("noExternal: ['@workspai/graph', '@workspai/shared']")
) {
  failures.push('prepared CLI bridge or internal product bundling is incomplete');
}
const workflow = fs.readFileSync(repositoryFile('.github/workflows/ci.yml'), 'utf8');
if (
  !workflow.includes('graph-g8-real-workspace-') ||
  !workflow.includes('check-g8-real-workspace-matrix-admission.mjs') ||
  !workflow.includes('graph-g8-real-workspace-parity')
) {
  failures.push('G8 real-workspace cross-platform CI evidence lane is missing');
}
const realWorkspacePolicy = readJson(
  'packages/cli/test-data/graph-shadow/real-workspace-policy.v1.json'
);
const realWorkspaceApprovals = readJson(
  'packages/cli/test-data/graph-shadow/real-workspace-approvals.v1.json'
);
const realWorkspaceInventory = readJson(
  'packages/cli/test-data/graph-shadow/real-workspace-inventory.v1.json'
);
if (Object.keys(realWorkspacePolicy.approvedDifferences ?? { forbidden: true }).length !== 0) {
  failures.push('real-workspace policy cannot carry unbound approved differences');
}
if (
  realWorkspaceApprovals.schemaVersion !== 'workspai.graph-real-workspace-approvals.v1' ||
  !Array.isArray(realWorkspaceApprovals.records)
) {
  failures.push('real-workspace approvals ledger is missing');
}
const approvedByCorpus = new Map();
for (const record of realWorkspaceApprovals.records ?? []) {
  const key = `${record.corpusId}:${record.sourceTreeDigest}`;
  const codes = approvedByCorpus.get(key) ?? new Set();
  codes.add(record.code);
  approvedByCorpus.set(key, codes);
}
const primaryDifferenceCodes = [
  'GRAPH_SHADOW_NODE_SET_DIFFERENT',
  'GRAPH_SHADOW_RELATION_SET_DIFFERENT',
  'GRAPH_SHADOW_PROOF_LINEAGE_DIFFERENT',
  'GRAPH_SHADOW_UNKNOWN_ACCOUNTING_DIFFERENT',
  'GRAPH_SHADOW_COMPLETENESS_DIFFERENT',
  'GRAPH_SHADOW_DIAGNOSTICS_DIFFERENT',
];
for (const codes of approvedByCorpus.values()) {
  if (primaryDifferenceCodes.every((code) => codes.has(code))) {
    failures.push('real-workspace approvals cannot blanket every semantic difference class');
  }
}
const crossPlatform = (realWorkspaceInventory.required ?? []).filter((entry) =>
  (entry.requiredFor ?? []).includes('cross-platform')
);
if (
  crossPlatform.length !== 1 ||
  crossPlatform[0]?.id !== 'committed-node-service' ||
  crossPlatform[0]?.trustedBaseline !== true
) {
  failures.push('G8 matrix inventory must declare exactly one trusted committed corpus');
}
if ((realWorkspaceInventory.optionalLocalReferences ?? []).some((entry) => entry.trustedBaseline)) {
  failures.push('local reference repositories cannot be trusted baselines');
}
if (
  !fs.existsSync(
    repositoryFile('packages/cli/test-data/graph-shadow/real-workspace-corpus.v1/src/index.ts')
  )
) {
  failures.push('committed real-workspace corpus is missing');
}
if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(JSON.stringify({ plan, admission }))) {
  failures.push('G8 governance contains a machine-local path');
}

const report = {
  schemaVersion: 'workspai-graph-g8-stage-audit.v1',
  package: graphManifest.name,
  stage: 'G8',
  status: failures.length === 0 ? 'in-progress' : 'invalid',
  authorizedRuntimeMode: plan.authorizedRuntimeMode,
  currentGraphAuthority: plan.currentGraphAuthority,
  planDigest: digest(planPath),
  transitionDigest: digest(transitionPath),
  retainedAdmissionDigest: digest(admissionPath),
  checkpoints: checkpoints.map(({ id, status }) => ({ id, status })),
  failures,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
