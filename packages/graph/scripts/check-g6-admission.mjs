import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const planPath = 'packages/graph/governance/g6-stage-plan.v1.json';
const closurePath = 'packages/graph/governance/g6-stage-closure.v1.json';
const remoteCheckpoint = 'g6-cross-platform-admission';
const implementationPaths = [
  'packages/graph/src/contracts/incremental.ts',
  'packages/graph/src/domain/content-state-merkle.ts',
  'packages/graph/src/application/build-content-state-manifest.ts',
  'packages/graph/src/application/compare-content-state-manifest.ts',
  'packages/graph/src/application/plan-shard-reuse.ts',
  'packages/graph/src/application/plan-incremental-graph-build.ts',
  'packages/graph/src/application/build-incremental-repo-graph.ts',
  'packages/graph/src/application/providers-required-for-added-inputs.ts',
  'packages/graph/src/application/plan-inventory-reread.ts',
  'packages/graph/src/application/parse-git-status-porcelain.ts',
  'packages/graph/src/application/build-graph-change-overlay.ts',
  'packages/graph/src/application/plan-query-cache-invalidation.ts',
  'packages/graph/src/adapters/node/repository-file-source.ts',
  'packages/graph/test/application/official-provider-incremental-equivalence.test.ts',
  'packages/graph/scripts/check-g6-stage.mjs',
];
const toolRequire = createRequire(path.join(packageRoot, 'package.json'));
const Ajv2020 = toolRequire('ajv/dist/2020').default;
const fullSha = /^[a-f0-9]{40}$/u;
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const ciEvidence = args.includes('--ci-evidence');
const outputArgument = valueAfter('--output');

function repositoryFile(relative) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\')) {
    throw new Error('Evidence paths must be portable repository-relative paths.');
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('Evidence path escapes the repository.');
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
    if (!fs.statSync(file).isFile()) throw new Error(`Missing G6 evidence: ${relative}`);
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

const failures = [];
const manifest = readJson('packages/graph/package.json');
const registry = readJson('independent-packages.json');
const graph = registry.packages?.find((entry) => entry.name === manifest.name);
const plan = readJson(planPath);
const closure = readJson(closurePath);
const validateClosure = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(readJson('contracts/independent-package-stage-closure.v1.json'));

if (!validateClosure(closure)) {
  failures.push(
    `G6 closure violates the stage contract: ${JSON.stringify(validateClosure.errors)}`
  );
}
if (
  graph?.currentStage !== 'G5' ||
  graph?.stageStatus !== 'local-source-complete' ||
  graph?.latestClosure !== 'packages/graph/governance/g5-stage-closure.v1.json'
) {
  failures.push('Graph registry must remain on sealed G5 until signed G6 remote admission');
}
if (
  plan.stage !== 'G6' ||
  plan.status !== 'local-source-complete' ||
  plan.nextStage !== 'G7' ||
  plan.nextStageAuthorized !== false ||
  plan.nativeAcceleration?.status !== 'prohibited' ||
  plan.publicInternalDocuments !== 0
) {
  failures.push('G6 plan identity or fail-closed state drifted');
}
const remote = (plan.checkpoints ?? []).find((checkpoint) => checkpoint.id === remoteCheckpoint);
if (!remote || remote.status !== 'planned') {
  failures.push(`${remoteCheckpoint} must remain planned until retained matrix evidence exists`);
}
if (
  closure.stage !== 'G6' ||
  closure.status !== 'local-passed-remote-pending-awaiting-approval' ||
  closure.nextStage !== 'G7' ||
  closure.nextStageAuthorized !== false ||
  closure.advancesAdmissionGate !== false ||
  closure.approval?.status !== 'awaiting'
) {
  failures.push('G6 closure identity or fail-closed approval state drifted');
}
if (manifest.private !== true || manifest.publishable === true) {
  failures.push('G6 candidate must remain private and non-publishable');
}
if (
  closure.measurements?.publicInternalDocuments !== 0 ||
  closure.measurements?.cliRuntimeBridges !== 0 ||
  closure.measurements?.nativeTruthImplementations !== 0
) {
  failures.push('G6 closure cannot claim leaked documents, a CLI bridge or native truth');
}
if (ciEvidence) {
  if (process.env.GITHUB_ACTIONS !== 'true') failures.push('CI evidence requires GitHub Actions');
  if (process.env.WORKSPAI_PACKAGE_INFRASTRUCTURE_PASSED !== '1') {
    failures.push('CI evidence requires package infrastructure');
  }
  if (!fullSha.test(process.env.WORKSPAI_ADMISSION_SOURCE_COMMIT ?? '')) {
    failures.push('CI evidence requires a full source commit');
  }
  if (!fullSha.test(process.env.GITHUB_SHA ?? '')) {
    failures.push('CI evidence requires a tested commit');
  }
}

const report = {
  schemaVersion: 'workspai-graph-g6-admission-audit.v1',
  generatedAt: new Date().toISOString(),
  package: manifest.name,
  version: manifest.version,
  stage: 'G6',
  status: failures.length ? 'invalid' : ciEvidence ? 'passed-platform' : 'pending-remote',
  admitted: false,
  nextStage: 'G7',
  nextStageAuthorized: false,
  registryStage: graph?.currentStage,
  nativeAcceleration: plan.nativeAcceleration?.status,
  closureDigest: digestFiles([closurePath]),
  planDigest: digestFiles([planPath]),
  implementationDigest: digestFiles(implementationPaths),
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    osRelease: os.release(),
  },
  ...(ciEvidence
    ? {
        platformEvidence: {
          status: failures.length ? 'failed' : 'passed',
          runnerOs: process.env.RUNNER_OS,
          runnerArch: process.env.RUNNER_ARCH,
          prerequisite: 'npm run check:package-infrastructure',
        },
        ci: {
          provider: 'github-actions',
          runId: process.env.GITHUB_RUN_ID,
          sourceCommit: process.env.WORKSPAI_ADMISSION_SOURCE_COMMIT,
          testedCommit: process.env.GITHUB_SHA,
          event: process.env.GITHUB_EVENT_NAME,
        },
      }
    : {}),
  failures,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputArgument) {
  const output = repositoryFile(outputArgument);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized, { mode: 0o600 });
}
process.stdout.write(serialized);
if (failures.length) process.exitCode = 1;
