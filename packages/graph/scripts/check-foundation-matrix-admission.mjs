import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const closurePath = path.join(packageRoot, 'governance/g1-stage-closure.v1.json');
const catalogPath = path.join(packageRoot, 'conformance/contract-catalog.v1.json');
const requiredRunnerOperatingSystems = new Set(['Linux', 'macOS', 'Windows']);

function parseArguments(argv) {
  const options = { evidenceDirectory: undefined, sourceCommit: undefined, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (
      (argument === '--evidence-directory' ||
        argument === '--source-commit' ||
        argument === '--output') &&
      (!value || value.startsWith('-'))
    ) {
      throw new Error(`${argument} requires a value.`);
    }
    if (argument === '--evidence-directory') options.evidenceDirectory = value;
    else if (argument === '--source-commit') options.sourceCommit = value;
    else if (argument === '--output') options.output = value;
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }
  if (!options.evidenceDirectory) throw new Error('--evidence-directory is required.');
  if (!options.sourceCommit || !/^[a-f0-9]{40}$/.test(options.sourceCommit)) {
    throw new Error('--source-commit must be a full lowercase Git SHA.');
  }
  if (!options.output) throw new Error('--output is required.');
  return options;
}

function repositoryPath(value, flag) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) {
    throw new Error(`${flag} must be a repository-relative path.`);
  }
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`${flag} escapes the repository root.`);
  }
  return resolved;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function digestFile(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function evidenceFiles(directory) {
  if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) {
    throw new Error('evidence directory does not exist or is not a directory.');
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function validateEvidence(report, expected, failures) {
  const runnerOs = report?.platformEvidence?.runnerOs;
  const label = typeof runnerOs === 'string' ? runnerOs : 'unknown';
  if (report.schemaVersion !== 'workspai-graph-foundation-admission-audit.v1') {
    failures.push(`${label}: unsupported evidence schema`);
  }
  if (
    report.package !== expected.package ||
    report.version !== expected.version ||
    report.stage !== 'G1'
  ) {
    failures.push(`${label}: package, version or stage drifted`);
  }
  if (report.status !== 'passed-platform' || report.admitted !== false) {
    failures.push(`${label}: platform audit did not pass in evidence-only mode`);
  }
  if (
    report.contractCatalog?.count !== expected.catalogCount ||
    report.contractCatalog?.digest !== expected.catalogDigest ||
    report.closureDigest !== expected.closureDigest
  ) {
    failures.push(`${label}: contract catalog or closure digest drifted`);
  }
  if (
    report.platformEvidence?.status !== 'passed' ||
    report.platformEvidence?.prerequisite !== 'npm run check:package-infrastructure'
  ) {
    failures.push(`${label}: package-infrastructure prerequisite is not proven`);
  }
  if (report.ci?.provider !== 'github-actions' || report.ci?.commit !== expected.sourceCommit) {
    failures.push(`${label}: evidence is not bound to the requested GitHub commit`);
  }
  if (!report.ci?.runId || report.ci.runId === 'unknown') {
    failures.push(`${label}: GitHub run identity is missing`);
  }
  if (!Array.isArray(report.failures) || report.failures.length !== 0) {
    failures.push(`${label}: evidence contains validation failures`);
  }
  if (!requiredRunnerOperatingSystems.has(runnerOs)) {
    failures.push(`${label}: runner operating system is outside the required matrix`);
  }
  if (!Number.isFinite(Date.parse(report.generatedAt))) {
    failures.push(`${label}: evidence timestamp is invalid`);
  }
  if (
    typeof report.environment?.node !== 'string' ||
    !/^v(?:2[0-9]|[3-9][0-9])\./.test(report.environment.node)
  ) {
    failures.push(`${label}: Node runtime is below the supported major version`);
  }
  return typeof runnerOs === 'string' ? runnerOs : undefined;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const evidenceDirectory = repositoryPath(options.evidenceDirectory, '--evidence-directory');
  const output = repositoryPath(options.output, '--output');
  const packageManifest = readJson(path.join(packageRoot, 'package.json'));
  const catalog = readJson(catalogPath);
  const files = evidenceFiles(evidenceDirectory);
  const failures = [];
  const expected = {
    package: packageManifest.name,
    version: packageManifest.version,
    catalogCount: catalog.contracts?.length,
    catalogDigest: digestFile(catalogPath),
    closureDigest: digestFile(closurePath),
    sourceCommit: options.sourceCommit,
  };
  const reports = files.map((file) => ({ file, report: readJson(file) }));
  const observedOperatingSystems = new Set();
  const evidence = [];

  for (const { file, report } of reports) {
    const runnerOs = validateEvidence(report, expected, failures);
    if (runnerOs) {
      if (observedOperatingSystems.has(runnerOs)) failures.push(`${runnerOs}: duplicate evidence`);
      observedOperatingSystems.add(runnerOs);
    }
    evidence.push({
      runnerOs: runnerOs ?? 'unknown',
      runnerArch: report.platformEvidence?.runnerArch ?? 'unknown',
      node: report.environment?.node ?? 'unknown',
      runId: report.ci?.runId ?? 'unknown',
      digest: digestFile(file),
    });
  }

  for (const runnerOs of requiredRunnerOperatingSystems) {
    if (!observedOperatingSystems.has(runnerOs)) failures.push(`${runnerOs}: evidence is missing`);
  }
  if (reports.length !== requiredRunnerOperatingSystems.size) {
    failures.push(
      `expected exactly ${requiredRunnerOperatingSystems.size} evidence reports; found ${reports.length}`
    );
  }

  evidence.sort((left, right) => left.runnerOs.localeCompare(right.runnerOs));
  const admitted = failures.length === 0;
  const candidate = {
    schemaVersion: 'workspai-graph-foundation-matrix-admission.v1',
    generatedAt: new Date().toISOString(),
    package: packageManifest.name,
    version: packageManifest.version,
    stage: 'G1',
    sourceCommit: options.sourceCommit,
    status: admitted ? 'admitted-candidate' : 'blocked',
    admitted,
    nextStage: 'G2',
    nextStageAuthorized: admitted,
    contractCatalog: { count: expected.catalogCount, digest: expected.catalogDigest },
    closureDigest: expected.closureDigest,
    requiredRunnerOperatingSystems: [...requiredRunnerOperatingSystems].sort(),
    evidence,
    failures,
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
  if (!admitted) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `Graph foundation matrix admission failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
