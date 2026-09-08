import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const requiredOperatingSystems = new Set(['Linux', 'macOS', 'Windows']);

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!['--evidence-directory', '--source-commit', '--output'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value.`);
    if (argument === '--evidence-directory') options.evidenceDirectory = value;
    else if (argument === '--source-commit') options.sourceCommit = value;
    else options.output = value;
    index += 1;
  }
  if (!options.evidenceDirectory || !options.output) {
    throw new Error('--evidence-directory and --output are required.');
  }
  if (!/^[a-f0-9]{40}$/u.test(options.sourceCommit ?? '')) {
    throw new Error('--source-commit must be a full lowercase Git SHA.');
  }
  return options;
}

function repositoryPath(value, flag) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new Error(`${flag} must be a portable repository-relative path.`);
  }
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`${flag} escapes the repository root.`);
  }
  return resolved;
}

function digestFile(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const packageManifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
  );
  const evidenceDirectory = repositoryPath(options.evidenceDirectory, '--evidence-directory');
  const output = repositoryPath(options.output, '--output');
  const files = fs
    .readdirSync(evidenceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(evidenceDirectory, entry.name))
    .sort();
  const failures = [];
  const observed = new Set();
  const evidence = [];
  let expectedClosureDigest;
  let expectedImplementationDigest;

  for (const file of files) {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const runnerOs = report.platformEvidence?.runnerOs ?? 'unknown';
    if (report.schemaVersion !== 'workspai-graph-composition-admission-audit.v1') {
      failures.push(`${runnerOs}: unsupported evidence schema`);
    }
    if (report.package !== packageManifest.name || report.version !== packageManifest.version) {
      failures.push(`${runnerOs}: package identity or version drifted`);
    }
    if (report.stage !== 'G2' || report.status !== 'passed-platform' || report.admitted !== false) {
      failures.push(`${runnerOs}: composition audit did not pass in evidence-only mode`);
    }
    if (
      report.platformEvidence?.status !== 'passed' ||
      report.platformEvidence?.prerequisite !== 'npm run check:package-infrastructure'
    ) {
      failures.push(`${runnerOs}: package-infrastructure prerequisite is missing`);
    }
    if (
      report.ci?.provider !== 'github-actions' ||
      report.ci?.commit !== options.sourceCommit ||
      !report.ci?.runId ||
      report.ci.runId === 'unknown'
    ) {
      failures.push(`${runnerOs}: evidence is not bound to the requested CI commit and run`);
    }
    if (!requiredOperatingSystems.has(runnerOs))
      failures.push(`${runnerOs}: unsupported runner OS`);
    if (observed.has(runnerOs)) failures.push(`${runnerOs}: duplicate platform evidence`);
    observed.add(runnerOs);
    expectedClosureDigest ??= report.closureDigest;
    expectedImplementationDigest ??= report.implementationDigest;
    if (
      report.closureDigest !== expectedClosureDigest ||
      report.implementationDigest !== expectedImplementationDigest
    ) {
      failures.push(`${runnerOs}: closure or implementation digest drifted across the matrix`);
    }
    if (!Array.isArray(report.failures) || report.failures.length !== 0) {
      failures.push(`${runnerOs}: evidence contains validation failures`);
    }
    evidence.push({
      runnerOs,
      runnerArch: report.platformEvidence?.runnerArch ?? 'unknown',
      node: report.environment?.node ?? 'unknown',
      runId: report.ci?.runId ?? 'unknown',
      digest: digestFile(file),
    });
  }
  for (const runnerOs of requiredOperatingSystems) {
    if (!observed.has(runnerOs)) failures.push(`${runnerOs}: evidence is missing`);
  }
  if (files.length !== requiredOperatingSystems.size) {
    failures.push(
      `expected exactly ${requiredOperatingSystems.size} reports; found ${files.length}`
    );
  }
  evidence.sort((left, right) => left.runnerOs.localeCompare(right.runnerOs));
  const admitted = failures.length === 0;
  const candidate = {
    schemaVersion: 'workspai-graph-composition-matrix-admission.v1',
    generatedAt: new Date().toISOString(),
    package: packageManifest.name,
    version: packageManifest.version,
    stage: 'G2',
    sourceCommit: options.sourceCommit,
    status: admitted ? 'admitted-candidate' : 'blocked',
    admitted,
    nextStage: 'G3',
    nextStageAuthorized: admitted,
    closureDigest: expectedClosureDigest ?? 'unknown',
    implementationDigest: expectedImplementationDigest ?? 'unknown',
    requiredRunnerOperatingSystems: [...requiredOperatingSystems].sort(),
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
    `Graph composition matrix admission failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
