import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const toolRequire = createRequire(path.join(packageRoot, 'package.json'));
const Ajv2020 = toolRequire('ajv/dist/2020').default;
const planPath = 'packages/graph/governance/g4-stage-plan.v1.json';
const approvalPath = 'packages/graph/governance/g3-stage-approval.v1.json';
const remoteAdmissionPath = 'packages/graph/governance/g3-remote-admission.v1.json';
const implementationPaths = [
  'packages/graph/src/application/build-repo-graph.ts',
  'packages/graph/src/application/repo-build-types.ts',
  'packages/graph/src/adapters/node/repository-file-source.ts',
  'packages/graph/src/adapters/node/index.ts',
  'packages/graph/src/adapters/node/project-artifact-store.ts',
  'packages/graph/src/application/publish-project-graph.ts',
  'packages/graph/src/cli.ts',
  'packages/graph/src/providers/repository-files.ts',
  'packages/graph/src/providers/package-json.ts',
  'packages/graph/src/providers/ecmascript-imports.ts',
  'packages/graph/src/providers/language-imports.ts',
  'packages/graph/src/providers/repository-surfaces.ts',
  'packages/graph/src/providers/repository-routes.ts',
  'packages/graph/src/providers/git-head.ts',
  'packages/graph/src/contracts/structural-extractor-profile.ts',
  'packages/graph/src/projections/index.ts',
  'packages/graph/src/projections/review-context-slice.ts',
  'packages/graph/test/build/repo-build.test.ts',
  'packages/graph/test/build/repository-fixture-matrix.test.ts',
  'packages/graph/test/contracts/structural-extractor-profile.test.ts',
  'packages/graph/test/projections/repository-preview-views.test.ts',
  'packages/graph/test/projections/review-context-slice.test.ts',
  'packages/graph/test/adapters/node-file-source.test.ts',
  'packages/graph/test/adapters/node-project-artifact-store.test.ts',
  'packages/graph/test/cli/graph-cli.test.ts',
  'packages/graph/scripts/check-packed-package.mjs',
];
const expectedPlatforms = new Set(['Linux', 'macOS', 'Windows']);
const fullSha = /^[a-f0-9]{40}$/u;
const digest = /^sha256:[a-f0-9]{64}$/u;

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
      throw new Error(`Missing repository preview evidence: ${relative}`);
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
const registry = readJson('independent-packages.json');
const graph = registry.packages?.find((entry) => entry.name === manifest.name);
const plan = readJson(planPath);
const approval = readJson(approvalPath);
const remote = readJson(remoteAdmissionPath);
const validateApproval = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(readJson('contracts/independent-package-stage-closure.v1.json'));

if (!validateApproval(approval)) {
  failures.push(
    `G3 approval violates the stage contract: ${JSON.stringify(validateApproval.errors)}`
  );
}
if (
  approval.stage !== 'G3' ||
  approval.status !== 'approved' ||
  approval.nextStage !== 'G4' ||
  approval.nextStageAuthorized !== true ||
  approval.approval?.status !== 'approved'
) {
  failures.push('G3 approval does not authorize G4');
}
if (
  remote.stage !== 'G3' ||
  remote.status !== 'passed' ||
  remote.workflow?.conclusion !== 'success' ||
  remote.repositoryGate?.conclusion !== 'success' ||
  !fullSha.test(remote.sourceCommit ?? '') ||
  !fullSha.test(remote.testedCommit ?? '') ||
  !digest.test(remote.candidateClosureDigest ?? '') ||
  !digest.test(remote.planDigest ?? '') ||
  !digest.test(remote.implementationDigest ?? '')
) {
  failures.push('G3 remote admission is incomplete or malformed');
}
const platforms = new Set();
for (const platform of remote.platforms ?? []) {
  platforms.add(platform.runner);
  if (
    !expectedPlatforms.has(platform.runner) ||
    platform.conclusion !== 'success' ||
    !digest.test(platform.digest ?? '')
  ) {
    failures.push(`Invalid G3 platform evidence: ${String(platform.runner)}`);
  }
}
if (
  platforms.size !== expectedPlatforms.size ||
  [...expectedPlatforms].some((platform) => !platforms.has(platform))
) {
  failures.push('G3 admission must retain exactly Linux, macOS and Windows evidence');
}
if (
  graph?.currentStage !== 'G4' ||
  graph?.stageStatus !== 'in-progress' ||
  graph?.latestClosure !== approvalPath
) {
  failures.push('Graph registry is not authorized for in-progress G4 work');
}
if (
  plan.stage !== 'G4' ||
  plan.status !== 'in-progress' ||
  plan.authorizedBy !== approvalPath ||
  plan.nextStage !== 'G5' ||
  plan.nextStageAuthorized !== false ||
  plan.nativeAcceleration?.status !== 'prohibited' ||
  plan.nativeAcceleration?.earliestDecisionStage !== 'G6' ||
  plan.publicInternalDocuments !== 0
) {
  failures.push('G4 plan identity or fail-closed boundaries drifted');
}
if (manifest.private !== true || manifest.publishable === true) {
  failures.push('G4 candidate must remain private and non-publishable');
}
for (const checkpoint of plan.checkpoints ?? []) {
  for (const evidence of checkpoint.evidence ?? []) {
    const file = repositoryFile(evidence);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      failures.push(`Missing G4 checkpoint evidence: ${evidence}`);
    }
  }
}
if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(JSON.stringify({ plan, approval, remote }))) {
  failures.push('Graph governance contains a machine-local path');
}

const report = {
  schemaVersion: 'workspai-graph-repository-preview-stage-audit.v1',
  generatedAt: new Date().toISOString(),
  package: manifest.name,
  version: manifest.version,
  stage: 'G4',
  status: failures.length > 0 ? 'invalid' : 'in-progress',
  admitted: false,
  nextStage: 'G5',
  nextStageAuthorized: false,
  authorizationDigest: digestFiles([approvalPath, remoteAdmissionPath]),
  planDigest: digestFiles([planPath]),
  implementationDigest: digestFiles(implementationPaths),
  implementationPaths,
  failures,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
