import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const planPath = 'packages/graph/governance/g7-stage-plan.v1.json';
const closurePath = 'packages/graph/governance/g7-stage-closure.v1.json';
const g6PlanPath = 'packages/graph/governance/g6-stage-plan.v1.json';
const registryPath = 'independent-packages.json';
const plannedCheckpoints = new Set([
  'sbom-provenance-security-verification',
  'retrieval-benchmark-command',
  'g7-standalone-stable-admission',
]);

function repositoryFile(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..')
  ) {
    throw new Error(`Unsafe repository evidence path: ${String(relative)}`);
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`Repository evidence path escapes its root: ${relative}`);
  }
  return resolved;
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(repositoryFile(relative), 'utf8'));
}

function digestFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const relative of [...files].sort()) {
    const file = repositoryFile(relative);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      throw new Error(`Missing G7 evidence: ${relative}`);
    }
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

const failures = [];
const manifest = readJson('packages/graph/package.json');
const plan = readJson(planPath);
const g6Plan = readJson(g6PlanPath);
const registry = readJson(registryPath);
const graphRegistry = (registry.packages ?? []).find((entry) => entry.name === '@workspai/graph');

if (
  plan.stage !== 'G7' ||
  plan.status !== 'local-source-continuation' ||
  plan.nextStage !== 'G8' ||
  plan.nextStageAuthorized !== false ||
  plan.nativeAcceleration?.status !== 'prohibited' ||
  plan.publicInternalDocuments !== 0
) {
  failures.push('G7 plan identity or fail-closed boundaries drifted');
}
if (manifest.private !== true || manifest.publishable === true) {
  failures.push('G7 candidate must remain private and non-publishable');
}
if (
  !graphRegistry ||
  graphRegistry.currentStage !== 'G5' ||
  graphRegistry.latestClosure !== 'packages/graph/governance/g5-stage-closure.v1.json' ||
  graphRegistry.standaloneStability !== 'not-admitted' ||
  graphRegistry.cliRuntimeIntegration !== 'prohibited-before-standalone-stability'
) {
  failures.push('Independent package registry must remain on G5 while G7 is unauthorized');
}
if (
  g6Plan.nextStageAuthorized !== false ||
  !(g6Plan.checkpoints ?? []).some(
    (checkpoint) =>
      checkpoint.id === 'g6-cross-platform-admission' && checkpoint.status === 'planned'
  )
) {
  failures.push('G6 remote admission must stay planned and must not authorize G7');
}
if (fs.existsSync(path.join(packageRoot, 'governance/g8-stage-plan.v1.json'))) {
  failures.push('G8 stage plan must not exist until G7 standalone-stable admission');
}

const checkpoints = plan.checkpoints ?? [];
for (const checkpoint of checkpoints) {
  if (plannedCheckpoints.has(checkpoint.id)) {
    if (checkpoint.status !== 'planned') {
      failures.push(`${checkpoint.id} must remain planned until its evidence exists`);
    }
    continue;
  }
  if (checkpoint.status !== 'implemented-local-candidate') {
    failures.push(`G7 checkpoint ${checkpoint.id} is not implemented-local-candidate`);
  }
  for (const evidence of checkpoint.evidence ?? []) {
    const file = repositoryFile(evidence);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      failures.push(`Missing G7 checkpoint evidence: ${evidence}`);
    }
  }
}
for (const required of plannedCheckpoints) {
  if (!checkpoints.some((checkpoint) => checkpoint.id === required)) {
    failures.push(`G7 plan must retain ${required}`);
  }
}
if (fs.existsSync(repositoryFile(closurePath))) {
  const closure = readJson(closurePath);
  if (
    closure.nextStageAuthorized !== false ||
    closure.advancesAdmissionGate !== false ||
    closure.status === 'admitted' ||
    closure.status === 'standalone-stable'
  ) {
    failures.push('G7 closure cannot authorize G8, admission or standalone stability');
  }
}
if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(JSON.stringify({ plan, registry: graphRegistry }))) {
  failures.push('G7 governance contains a machine-local path');
}

const report = {
  schemaVersion: 'workspai-graph-g7-stage-audit.v1',
  generatedAt: new Date().toISOString(),
  package: manifest.name,
  version: manifest.version,
  stage: 'G7',
  status: failures.length > 0 ? 'invalid' : 'local-source-continuation',
  admitted: false,
  standaloneStable: false,
  nextStage: 'G8',
  nextStageAuthorized: false,
  registryStage: graphRegistry?.currentStage,
  planDigest: digestFiles([planPath]),
  checkpoints: checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    status: checkpoint.status,
  })),
  failures,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
