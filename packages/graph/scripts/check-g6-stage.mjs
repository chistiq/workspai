import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const planPath = 'packages/graph/governance/g6-stage-plan.v1.json';
const closurePath = 'packages/graph/governance/g6-stage-closure.v1.json';
const remoteCheckpoint = 'g6-cross-platform-admission';

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
      throw new Error(`Missing G6 evidence: ${relative}`);
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
const closure = readJson(closurePath);

if (
  plan.stage !== 'G6' ||
  plan.status !== 'local-source-complete' ||
  plan.nextStage !== 'G7' ||
  plan.nextStageAuthorized !== false ||
  plan.nativeAcceleration?.status !== 'prohibited' ||
  plan.publicInternalDocuments !== 0
) {
  failures.push('G6 plan identity or fail-closed boundaries drifted');
}
if (
  closure.stage !== 'G6' ||
  closure.status !== 'local-passed-remote-pending-awaiting-approval' ||
  closure.advancesAdmissionGate !== false ||
  closure.nextStage !== 'G7' ||
  closure.nextStageAuthorized !== false
) {
  failures.push('G6 closure does not record local pass with remote admission pending');
}
if (manifest.private !== true || manifest.publishable === true) {
  failures.push('G6 candidate must remain private and non-publishable');
}

const checkpoints = plan.checkpoints ?? [];
for (const checkpoint of checkpoints) {
  if (checkpoint.id === remoteCheckpoint) {
    if (checkpoint.status !== 'planned') {
      failures.push(`${remoteCheckpoint} must remain planned until remote evidence exists`);
    }
    continue;
  }
  if (checkpoint.status !== 'implemented-local-candidate') {
    failures.push(`G6 checkpoint ${checkpoint.id} is not implemented-local-candidate`);
  }
  for (const evidence of checkpoint.evidence ?? []) {
    const file = repositoryFile(evidence);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      failures.push(`Missing G6 checkpoint evidence: ${evidence}`);
    }
  }
}
if (!checkpoints.some((checkpoint) => checkpoint.id === remoteCheckpoint)) {
  failures.push(`G6 plan must retain ${remoteCheckpoint}`);
}
if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(JSON.stringify({ plan, closure }))) {
  failures.push('G6 governance contains a machine-local path');
}

const report = {
  schemaVersion: 'workspai-graph-g6-stage-audit.v1',
  generatedAt: new Date().toISOString(),
  package: manifest.name,
  version: manifest.version,
  stage: 'G6',
  status: failures.length > 0 ? 'invalid' : 'local-source-complete',
  admitted: false,
  nextStage: 'G7',
  nextStageAuthorized: false,
  planDigest: digestFiles([planPath]),
  closureDigest: digestFiles([closurePath]),
  checkpoints: checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    status: checkpoint.status,
  })),
  failures,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
