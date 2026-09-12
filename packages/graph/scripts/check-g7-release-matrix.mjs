import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const required = new Set(['Linux', 'macOS', 'Windows']);
const platform = new Map([
  ['Linux', 'linux'],
  ['macOS', 'darwin'],
  ['Windows', 'win32'],
]);
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }
  return args[index + 1];
};
const fullSha = /^[a-f0-9]{40}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const githubRunId = /^[1-9][0-9]*$/u;
const sourceCommit = option('--source-commit');
const testedCommit = option('--tested-commit');
if (!fullSha.test(sourceCommit) || !fullSha.test(testedCommit)) {
  throw new Error('Source and tested commits must be full lowercase Git SHAs.');
}

function repositoryPath(value) {
  if (path.isAbsolute(value) || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error('Admission paths must be portable repository-relative paths.');
  }
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('Admission path escapes the repository.');
  }
  return resolved;
}

const evidenceDirectory = repositoryPath(option('--evidence-directory'));
const g6CandidatePath = repositoryPath(option('--g6-candidate'));
const output = repositoryPath(option('--output'));
const failures = [];
const observed = new Set();
const evidence = [];
let planDigest;
let closureDigest;
let inventoryDigest;
let sbomDigest;
let releaseInputsDigest;
let runId;
let event;

const g6 = JSON.parse(fs.readFileSync(g6CandidatePath, 'utf8'));
if (
  g6.schemaVersion !== 'workspai-graph-g6-matrix-admission.v1' ||
  g6.stage !== 'G6' ||
  g6.status !== 'admitted-platform-candidate' ||
  g6.admitted !== true ||
  g6.nextStageAuthorized !== false ||
  g6.sourceCommit !== sourceCommit ||
  g6.testedCommit !== testedCommit ||
  !Array.isArray(g6.evidence) ||
  g6.evidence.length !== required.size ||
  JSON.stringify(g6.requiredRunnerOperatingSystems) !== JSON.stringify([...required].sort()) ||
  !Array.isArray(g6.failures) ||
  g6.failures.length !== 0
) {
  failures.push('G7 release evidence requires the matching admitted G6 matrix candidate');
}
const g6RunIds = new Set((g6.evidence ?? []).map((entry) => entry.runId));
const g6Runners = new Set((g6.evidence ?? []).map((entry) => entry.runnerOs));
if (g6RunIds.size !== 1 || !githubRunId.test([...g6RunIds][0] ?? '')) {
  failures.push('G6 candidate must bind every platform to one GitHub run');
}
if (
  g6Runners.size !== required.size ||
  [...required].some((runner) => !g6Runners.has(runner)) ||
  !(g6.evidence ?? []).every((entry) => digestPattern.test(entry.digest ?? ''))
) {
  failures.push('G6 candidate must retain one valid digest for every required platform');
}
const g6RunId = [...g6RunIds][0];

for (const name of fs
  .readdirSync(evidenceDirectory)
  .filter((item) => item.endsWith('.json'))
  .sort()) {
  const file = path.join(evidenceDirectory, name);
  const bytes = fs.readFileSync(file);
  const report = JSON.parse(bytes.toString('utf8'));
  const runnerOs = report.platformEvidence?.runnerOs;
  if (
    report.schemaVersion !== 'workspai-graph-g7-release-candidate-audit.v1' ||
    report.stage !== 'G7' ||
    report.status !== 'passed-platform-candidate' ||
    report.admitted !== false ||
    report.standaloneStable !== false ||
    report.publicPreview !== false ||
    report.provenance !== 'unattested' ||
    report.rollbackProcedure !== 'defined-unactivated' ||
    report.nextStageAuthorized !== false ||
    report.registryStage !== 'G5'
  ) {
    failures.push(`${String(runnerOs)}: G7 release-candidate evidence is invalid`);
  }
  if (
    report.platformEvidence?.status !== 'passed' ||
    report.platformEvidence?.prerequisite !== 'npm run check:package-infrastructure'
  ) {
    failures.push(`${String(runnerOs)}: package-infrastructure prerequisite is missing`);
  }
  if (
    report.ci?.provider !== 'github-actions' ||
    !githubRunId.test(report.ci?.runId ?? '') ||
    !['pull_request', 'push'].includes(report.ci?.event)
  ) {
    failures.push(`${String(runnerOs)}: GitHub run identity is invalid`);
  }
  if (!Array.isArray(report.failures) || report.failures.length !== 0) {
    failures.push(`${String(runnerOs)}: evidence contains validation failures`);
  }
  if (!required.has(runnerOs) || report.environment?.platform !== platform.get(runnerOs)) {
    failures.push(`${String(runnerOs)}: platform mismatch`);
  }
  if (observed.has(runnerOs)) failures.push(`${String(runnerOs)}: duplicate evidence`);
  observed.add(runnerOs);
  if (report.ci?.sourceCommit !== sourceCommit || report.ci?.testedCommit !== testedCommit) {
    failures.push(`${String(runnerOs)}: commit binding mismatch`);
  }
  const digests = [
    report.planDigest,
    report.closureDigest,
    report.inventoryDigest,
    report.sbomDigest,
    report.releaseInputsDigest,
  ];
  if (!digests.every((digest) => digestPattern.test(digest))) {
    failures.push(`${String(runnerOs)}: release evidence digest is invalid`);
  }
  planDigest ??= report.planDigest;
  closureDigest ??= report.closureDigest;
  inventoryDigest ??= report.inventoryDigest;
  sbomDigest ??= report.sbomDigest;
  releaseInputsDigest ??= report.releaseInputsDigest;
  runId ??= report.ci?.runId;
  event ??= report.ci?.event;
  if (
    report.planDigest !== planDigest ||
    report.closureDigest !== closureDigest ||
    report.inventoryDigest !== inventoryDigest ||
    report.sbomDigest !== sbomDigest ||
    report.releaseInputsDigest !== releaseInputsDigest ||
    report.ci?.runId !== runId ||
    report.ci?.event !== event
  ) {
    failures.push(`${String(runnerOs)}: matrix evidence drifted`);
  }
  evidence.push({
    runnerOs,
    runnerArch: report.platformEvidence?.runnerArch,
    node: report.environment?.node,
    runId: report.ci?.runId,
    digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
  });
}
for (const runner of required) {
  if (!observed.has(runner)) failures.push(`${runner}: evidence is missing`);
}
if (observed.size !== required.size) failures.push('Expected exactly three platform reports');
if (runId !== g6RunId) failures.push('G6 and G7 evidence must originate from the same GitHub run');
evidence.sort((left, right) => left.runnerOs.localeCompare(right.runnerOs));
const candidatePassed = failures.length === 0;
const candidate = {
  schemaVersion: 'workspai-graph-g7-release-matrix.v1',
  generatedAt: new Date().toISOString(),
  package: '@workspai/graph',
  stage: 'G7',
  sourceCommit,
  testedCommit,
  status: candidatePassed ? 'verified-release-candidate' : 'blocked',
  candidatePassed,
  admitted: false,
  standaloneStable: false,
  publicPreview: false,
  provenance: 'unattested',
  rollbackProcedure: 'defined-unactivated',
  nextStage: 'G8',
  nextStageAuthorized: false,
  g6CandidateDigest: `sha256:${crypto
    .createHash('sha256')
    .update(fs.readFileSync(g6CandidatePath))
    .digest('hex')}`,
  planDigest,
  closureDigest,
  inventoryDigest,
  sbomDigest,
  releaseInputsDigest,
  requiredRunnerOperatingSystems: [...required].sort(),
  evidence,
  failures,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
if (!candidatePassed) process.exitCode = 1;
