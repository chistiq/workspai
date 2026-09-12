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
