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
const repositoryPath = (value) => {
  if (path.isAbsolute(value) || value.includes('\\')) {
    throw new Error('Admission paths must be portable repository-relative paths.');
  }
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('Admission path escapes the repository.');
  }
  return resolved;
};
const evidenceDirectory = repositoryPath(option('--evidence-directory'));
const output = repositoryPath(option('--output'));
const failures = [];
const observed = new Set();
const evidence = [];
let planDigest;
let closureDigest;
let implementationDigest;
let runId;
let event;

for (const name of fs
  .readdirSync(evidenceDirectory)
  .filter((item) => item.endsWith('.json'))
  .sort()) {
  const file = path.join(evidenceDirectory, name);
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const runnerOs = report.platformEvidence?.runnerOs;
  if (
    report.schemaVersion !== 'workspai-graph-g6-admission-audit.v1' ||
    report.stage !== 'G6' ||
    report.status !== 'passed-platform' ||
    report.admitted !== false ||
    report.nextStage !== 'G7' ||
    report.nextStageAuthorized !== false ||
    report.registryStage !== 'G5' ||
    report.nativeAcceleration !== 'prohibited'
  ) {
    failures.push(`${String(runnerOs)}: G6 platform admission failed`);
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
  if (
    !digestPattern.test(report.planDigest) ||
    !digestPattern.test(report.closureDigest) ||
    !digestPattern.test(report.implementationDigest)
  ) {
    failures.push(`${String(runnerOs)}: evidence digest is invalid`);
  }
  planDigest ??= report.planDigest;
  closureDigest ??= report.closureDigest;
  implementationDigest ??= report.implementationDigest;
  runId ??= report.ci?.runId;
  event ??= report.ci?.event;
  if (
    report.planDigest !== planDigest ||
    report.closureDigest !== closureDigest ||
    report.implementationDigest !== implementationDigest ||
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
    digest: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`,
  });
}
for (const runner of required) {
  if (!observed.has(runner)) failures.push(`${runner}: evidence is missing`);
}
if (observed.size !== required.size) failures.push('Expected exactly three platform reports');
evidence.sort((left, right) => left.runnerOs.localeCompare(right.runnerOs));
const admitted = failures.length === 0;
const candidate = {
  schemaVersion: 'workspai-graph-g6-matrix-admission.v1',
  generatedAt: new Date().toISOString(),
  package: '@workspai/graph',
  stage: 'G6',
  sourceCommit,
  testedCommit,
  status: admitted ? 'admitted-platform-candidate' : 'blocked',
  admitted,
  nextStage: 'G7',
  nextStageAuthorized: false,
  closureDigest,
  planDigest,
  implementationDigest,
  requiredRunnerOperatingSystems: [...required].sort(),
  evidence,
  failures,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
if (!admitted) process.exitCode = 1;
