import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const implementationPaths = [
  'packages/graph/src/application/assess-proof.ts',
  'packages/graph/src/application/query-cache.ts',
  'packages/graph/src/application/query-graph.ts',
  'packages/graph/src/contracts/query.ts',
  'packages/graph/src/contracts/query-presets.ts',
  'packages/graph/src/conformance/query.ts',
  'packages/graph/test/query/query-engine.test.ts',
  'packages/graph/scripts/check-query-profile.mjs',
  'packages/graph/scripts/check-packed-package.mjs',
];
const closurePath = 'packages/graph/governance/g3-stage-closure.v1.json';
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
  if (!relative || path.isAbsolute(relative) || relative.includes('\\'))
    throw new Error('Evidence paths must be portable repository-relative paths.');
  const resolved = path.resolve(repositoryRoot, relative);
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`))
    throw new Error('Evidence path escapes the repository.');
  return resolved;
}

function digestFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const relative of [...files].sort()) {
    const file = repositoryFile(relative);
    if (!fs.statSync(file).isFile()) throw new Error(`Missing query evidence: ${relative}`);
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

const failures = [];
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const registry = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'independent-packages.json'), 'utf8')
);
const graph = registry.packages?.find((entry) => entry.name === manifest.name);
const plan = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'governance/g3-stage-plan.v1.json'), 'utf8')
);
const closure = JSON.parse(fs.readFileSync(repositoryFile(closurePath), 'utf8'));
const validateClosure = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(
  JSON.parse(
    fs.readFileSync(repositoryFile('contracts/independent-package-stage-closure.v1.json'), 'utf8')
  )
);
if (!validateClosure(closure))
  failures.push(
    `G3 closure violates the stage contract: ${JSON.stringify(validateClosure.errors)}`
  );
const inProgressG3 =
  graph?.currentStage === 'G3' &&
  graph?.stageStatus === 'in-progress' &&
  graph?.latestClosure === 'packages/graph/governance/g2-stage-approval.v1.json';
const admittedHistoricalG3 =
  graph?.currentStage === 'G4' &&
  graph?.stageStatus === 'in-progress' &&
  graph?.latestClosure === 'packages/graph/governance/g3-stage-approval.v1.json';
if (!inProgressG3 && !admittedHistoricalG3)
  failures.push('Graph registry neither authorizes nor records admitted G3 work');
if (plan.stage !== 'G3' || plan.nextStageAuthorized !== false)
  failures.push('G3 plan identity or fail-closed state drifted');
if (
  closure.stage !== 'G3' ||
  closure.status !== 'local-passed-remote-pending-awaiting-approval' ||
  closure.nextStage !== 'G4' ||
  closure.nextStageAuthorized !== false ||
  closure.approval?.status !== 'awaiting'
)
  failures.push('G3 closure identity or fail-closed approval state drifted');
if (manifest.private !== true || manifest.publishable === true)
  failures.push('G3 candidate must remain private and non-publishable');
if (ciEvidence) {
  if (process.env.GITHUB_ACTIONS !== 'true') failures.push('CI evidence requires GitHub Actions');
  if (process.env.WORKSPAI_PACKAGE_INFRASTRUCTURE_PASSED !== '1')
    failures.push('CI evidence requires package infrastructure');
  if (!fullSha.test(process.env.WORKSPAI_ADMISSION_SOURCE_COMMIT ?? ''))
    failures.push('CI evidence requires a full source commit');
  if (!fullSha.test(process.env.GITHUB_SHA ?? ''))
    failures.push('CI evidence requires tested commit');
}
const report = {
  schemaVersion: 'workspai-graph-query-admission-audit.v1',
  generatedAt: new Date().toISOString(),
  package: manifest.name,
  version: manifest.version,
  stage: 'G3',
  status: failures.length
    ? 'invalid'
    : ciEvidence
      ? 'passed-platform'
      : admittedHistoricalG3
        ? 'approved-historical'
        : 'pending-remote',
  admitted: false,
  closureDigest: digestFiles([closurePath]),
  planDigest: digestFiles(['packages/graph/governance/g3-stage-plan.v1.json']),
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
