import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const closurePath = 'packages/graph/governance/g4-stage-closure.v1.json';
const planPath = 'packages/graph/governance/g4-stage-plan.v1.json';
const implementationPaths = [
  'packages/graph/src/application/build-repo-graph.ts',
  'packages/graph/src/application/publish-project-graph.ts',
  'packages/graph/src/adapters/node/repository-file-source.ts',
  'packages/graph/src/adapters/node/project-artifact-store.ts',
  'packages/graph/src/providers/repository-files.ts',
  'packages/graph/src/providers/package-json.ts',
  'packages/graph/src/providers/ecmascript-imports.ts',
  'packages/graph/src/providers/language-imports.ts',
  'packages/graph/src/providers/repository-surfaces.ts',
  'packages/graph/src/providers/repository-routes.ts',
  'packages/graph/src/providers/git-head.ts',
  'packages/graph/src/projections/index.ts',
  'packages/graph/src/projections/review-context-slice.ts',
  'packages/graph/src/cli.ts',
  'packages/graph/test/build/repository-fixture-matrix.test.ts',
  'packages/graph/test/projections/repository-preview-views.test.ts',
  'packages/graph/test/projections/review-context-slice.test.ts',
  'packages/graph/test/adapters/node-project-artifact-store.test.ts',
  'packages/graph/scripts/check-packed-package.mjs',
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
    if (!fs.statSync(file).isFile()) throw new Error(`Missing G4 evidence: ${relative}`);
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
    `G4 closure violates the stage contract: ${JSON.stringify(validateClosure.errors)}`
  );
}
const inProgressG4 =
  graph?.currentStage === 'G4' &&
  graph?.stageStatus === 'in-progress' &&
  graph?.latestClosure === 'packages/graph/governance/g3-stage-approval.v1.json';
const admittedHistoricalG4 =
  graph?.currentStage === 'G5' &&
  graph?.stageStatus === 'local-source-complete' &&
  graph?.latestClosure === 'packages/graph/governance/g5-stage-closure.v1.json';
if (!inProgressG4 && !admittedHistoricalG4) {
  failures.push('Graph registry does not authorize in-progress G4 work');
}
if (plan.stage !== 'G4' || plan.status !== 'in-progress' || plan.nextStageAuthorized !== false) {
  failures.push('G4 plan identity or fail-closed state drifted');
}
if (
  closure.stage !== 'G4' ||
  closure.status !== 'local-passed-remote-pending-awaiting-approval' ||
  closure.nextStage !== 'G5' ||
  closure.nextStageAuthorized !== false ||
  closure.approval?.status !== 'awaiting'
) {
  failures.push('G4 closure identity or fail-closed approval state drifted');
}
if (manifest.private !== true || manifest.publishable === true) {
  failures.push('G4 candidate must remain private and non-publishable');
}
if (
  closure.measurements?.publicInternalDocuments !== 0 ||
  closure.measurements?.cliRuntimeBridges !== 0
) {
  failures.push('G4 closure cannot claim leaked internal documents or a central CLI bridge');
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
  schemaVersion: 'workspai-graph-repository-preview-admission-audit.v1',
  generatedAt: new Date().toISOString(),
  package: manifest.name,
  version: manifest.version,
  stage: 'G4',
  status: failures.length ? 'invalid' : ciEvidence ? 'passed-platform' : 'pending-remote',
  admitted: false,
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
