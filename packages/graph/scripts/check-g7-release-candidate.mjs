import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const planPath = 'packages/graph/governance/g7-stage-plan.v1.json';
const closurePath = 'packages/graph/governance/g7-stage-closure.v1.json';
const inventoryPath = 'packages/graph/governance/g7-release-inventory.v1.json';
const sbomPath = 'packages/graph/governance/g7-sbom.cdx.json';
const releaseRoots = [
  'packages/graph/src',
  'packages/graph/schemas',
  'packages/graph/fixtures',
  'packages/graph/conformance',
];
const releaseFiles = [
  'packages/graph/package.json',
  'packages/graph/README.md',
  'packages/graph/CHANGELOG.md',
  'packages/graph/LICENSE',
  'packages/graph/tsup.config.ts',
  'packages/graph/scripts/check-packed-package.mjs',
  'packages/graph/scripts/check-g7-release-candidate.mjs',
  'packages/graph/scripts/check-g7-release-matrix.mjs',
  'packages/graph/scripts/check-g7-operational-readiness.mjs',
  'packages/graph/scripts/check-g7-promotion-evidence.mjs',
  'packages/graph/scripts/finalize-g7-standalone-admission.mjs',
  'packages/graph/scripts/check-standalone-admission.mjs',
  'packages/graph/scripts/generate-g7-release-inventory.mjs',
  'packages/graph/scripts/generate-graph-sbom.mjs',
  '.github/workflows/ci.yml',
  inventoryPath,
  sbomPath,
  'packages/graph/governance/g7-standalone-admission.v1.json',
  'packages/graph/governance/g7-internal-contract-lock.v1.json',
  'packages/graph/governance/g7-migration-rollback-policy.v1.json',
  'packages/graph/governance/g7-verified-baseline.v1.json',
];
const fullSha = /^[a-f0-9]{40}$/u;
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const ciEvidence = args.includes('--ci-evidence');
const outputArgument = valueAfter('--output');

function repositoryFile(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..')
  ) {
    throw new Error(`Unsafe release evidence path: ${String(relative)}`);
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`Release evidence path escapes the repository: ${relative}`);
  }
  return resolved;
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(repositoryFile(relative), 'utf8'));
}

function collectFiles(relative) {
  const absolute = repositoryFile(relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Release evidence cannot be a symlink: ${relative}`);
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) throw new Error(`Unsupported release evidence entry: ${relative}`);
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectFiles(`${relative}/${entry.name}`));
}

function digestFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const relative of [...new Set(files)].sort()) {
    const file = repositoryFile(relative);
    if (!fs.lstatSync(file).isFile()) throw new Error(`Missing release evidence: ${relative}`);
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
const inventory = readJson(inventoryPath);
const sbom = readJson(sbomPath);

if (
  graph?.currentStage !== 'G5' ||
  graph?.stageStatus !== 'local-source-complete' ||
  graph?.standaloneStability !== 'not-admitted' ||
  graph?.cliRuntimeIntegration !== 'prohibited-before-standalone-stability'
) {
  failures.push('Graph registry must remain fail-closed on G5');
}
if (
  plan.stage !== 'G7' ||
  plan.status !== 'local-source-complete' ||
  plan.nextStageAuthorized !== false
) {
  failures.push('G7 plan identity or authorization boundary drifted');
}
if (
  closure.stage !== 'G7' ||
  closure.status !== 'local-passed-remote-pending-awaiting-approval' ||
  closure.advancesAdmissionGate !== false ||
  closure.measurements?.standaloneStable !== false
) {
  failures.push('G7 closure must remain an unadmitted local candidate');
}
if (
  manifest.private !== true ||
  manifest.publishable === true ||
  inventory.publishable !== false ||
  inventory.standaloneStable !== false ||
  inventory.provenance !== 'unattested' ||
  inventory.rollbackProcedure !== 'defined-unactivated'
) {
  failures.push('Release inventory must not claim publication, provenance or stability');
}
if (
  sbom.bomFormat !== 'CycloneDX' ||
  sbom.specVersion !== '1.6' ||
  !Array.isArray(sbom.components) ||
  sbom.components.length === 0
) {
  failures.push('CycloneDX release SBOM is incomplete');
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

const releaseInputFiles = [
  ...releaseFiles,
  ...releaseRoots.flatMap((relative) => collectFiles(relative)),
];
const report = {
  schemaVersion: 'workspai-graph-g7-release-candidate-audit.v1',
  generatedAt: new Date().toISOString(),
  package: manifest.name,
  version: manifest.version,
  stage: 'G7',
  status: failures.length ? 'invalid' : ciEvidence ? 'passed-platform-candidate' : 'pending-remote',
  admitted: false,
  standaloneStable: false,
  publicPreview: false,
  provenance: 'unattested',
  rollbackProcedure: 'defined-unactivated',
  nextStage: 'G8',
  nextStageAuthorized: false,
  registryStage: graph?.currentStage,
  planDigest: digestFiles([planPath]),
  closureDigest: digestFiles([closurePath]),
  inventoryDigest: digestFiles([inventoryPath]),
  sbomDigest: digestFiles([sbomPath]),
  releaseInputsDigest: digestFiles(releaseInputFiles),
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
