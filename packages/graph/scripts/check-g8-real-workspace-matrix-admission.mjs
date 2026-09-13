import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const requiredOperatingSystems = new Set(['Linux', 'macOS', 'Windows']);
const platformByOperatingSystem = new Map([
  ['Linux', 'linux'],
  ['macOS', 'darwin'],
  ['Windows', 'win32'],
]);
const FULL_GIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GITHUB_RUN_ID = /^[1-9][0-9]*$/u;
const MAPPING_VERSION = /^workspai\.graph-shadow-mapping\.v[0-9]+$/u;
const LOCAL_PATH = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\\\\)/u;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const SCHEMA_VERSION = 'workspai.graph-g8-real-workspace-platform-report.v1-candidate';
const CANDIDATE_SCHEMA = 'workspai.graph-g8-real-workspace-matrix-admission.v1-candidate';

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (
      !['--evidence-directory', '--source-commit', '--tested-commit', '--output'].includes(argument)
    ) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value.`);
    if (argument === '--evidence-directory') options.evidenceDirectory = value;
    else if (argument === '--source-commit') options.sourceCommit = value;
    else if (argument === '--tested-commit') options.testedCommit = value;
    else options.output = value;
    index += 1;
  }
  if (!options.evidenceDirectory || !options.output) {
    throw new Error('--evidence-directory and --output are required.');
  }
  if (!FULL_GIT_SHA.test(options.sourceCommit ?? '')) {
    throw new Error('--source-commit must be a full lowercase Git SHA.');
  }
  if (!FULL_GIT_SHA.test(options.testedCommit ?? '')) {
    throw new Error('--tested-commit must be a full lowercase Git SHA.');
  }
  return options;
}

function repositoryPath(value, flag) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').includes('..') ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new Error(`${flag} must be a portable repository-relative path.`);
  }
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`${flag} escapes the repository root.`);
  }
  const parent = path.dirname(resolved);
  if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) {
    throw new Error(`${flag} cannot use a symlinked artifact boundary.`);
  }
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error(`${flag} cannot use a symlinked evidence path.`);
  }
  return resolved;
}

function digestFile(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function digestPayload(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function qualificationDigest(qualification) {
  return digestPayload({
    schemaVersion: qualification?.schemaVersion,
    profile: qualification?.profile,
    inventoryDigest: qualification?.inventoryDigest,
    mappingVersion: qualification?.mappingVersion,
    observations: qualification?.observations,
    mutatedCanonicalArtifacts: qualification?.mutatedCanonicalArtifacts,
    usedProcessCwdAsAuthority: qualification?.usedProcessCwdAsAuthority,
  });
}

function comparedComparison(report) {
  const compared = (report.qualification?.observations ?? []).find(
    (item) => item.id === 'committed-node-service' && item.kind === 'committed-fixture'
  );
  return compared?.comparison ?? null;
}

function writeAtomicJson(target, value) {
  const parent = path.dirname(target);
  if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) {
    throw new Error('Matrix admission cannot use a symlinked artifact boundary.');
  }
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(target)) {
    throw new Error('Matrix admission output cannot overwrite existing evidence.');
  }
  const temporary = path.join(
    parent,
    `.${path.basename(target)}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  try {
    fs.linkSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function semanticFailures(report, options, runnerOs) {
  const failures = [];
  if (report.schemaVersion !== SCHEMA_VERSION) {
    failures.push(`${runnerOs}: unsupported evidence schema`);
  }
  if (
    report.package !== '@workspai/graph' ||
    report.stage !== 'G8' ||
    report.checkpoint !== 'real-workspace-cross-platform-parity' ||
    report.admitted !== false ||
    report.nextStage !== 'G9' ||
    report.nextStageAuthorized !== false ||
    report.crossPlatformAdmission !== 'pending' ||
    report.currentGraphAuthority !== 'official-internal-graph-capability' ||
    report.authorizedRuntimeMode !== 'g8-shadow-comparison-only'
  ) {
    failures.push(`${runnerOs}: G8 authority or admission boundary drifted`);
  }
  if (report.status !== 'passed-platform' || report.platformEvidence?.status !== 'passed') {
    failures.push(`${runnerOs}: platform report failed`);
  }
  if (!Array.isArray(report.failures) || report.failures.length !== 0) {
    failures.push(`${runnerOs}: evidence contains validation failures`);
  }
  const digestKeys = [
    'inventoryDigest',
    'sourceFixtureDigest',
    'sourceTreeDigest',
    'scopeDigest',
    'providerProfileDigest',
    'graphPolicyDigest',
    'redactionAuthorizationDigest',
    'resourceBudgetDigest',
    'reportDigest',
    'semanticOutputDigest',
  ];
  for (const key of digestKeys) {
    if (!SHA256_DIGEST.test(report[key] ?? '')) {
      failures.push(`${runnerOs}: ${key} is not a portable SHA-256 digest`);
    }
  }
  if (!MAPPING_VERSION.test(report.mappingVersion ?? '')) {
    failures.push(`${runnerOs}: mapping version is missing or unversioned`);
  }
  if (
    report.ci?.provider !== 'github-actions' ||
    report.ci?.sourceCommit !== options.sourceCommit ||
    report.ci?.testedCommit !== options.testedCommit ||
    !GITHUB_RUN_ID.test(report.ci?.runId ?? '') ||
    !['pull_request', 'push'].includes(report.ci?.event)
  ) {
    failures.push(
      `${runnerOs}: evidence is not bound to the requested source commit, tested commit and run`
    );
  }
  if (!requiredOperatingSystems.has(runnerOs)) {
    failures.push(`${runnerOs}: unsupported runner OS`);
  } else if (report.environment?.platform !== platformByOperatingSystem.get(runnerOs)) {
    failures.push(`${runnerOs}: runner OS and runtime platform do not match`);
  }
  const receipt = report.receipt ?? {};
  if (
    receipt.authority !== 'released-cli' ||
    receipt.epoch !== 'package-shadow' ||
    receipt.executionPath !== 'compared' ||
    receipt.packageWrites !== 'prohibited' ||
    receipt.fallback !== 'prohibited' ||
    receipt.schemaVersion !== 'workspai.graph-model-authority-receipt.v1-candidate'
  ) {
    failures.push(`${runnerOs}: invalid or missing authority receipt`);
  }
  if (receipt.authority === 'package-authoritative' || report.nextStageAuthorized === true) {
    failures.push(`${runnerOs}: forged authority`);
  }
  if (receipt.packageWrites !== 'prohibited') failures.push(`${runnerOs}: write claim`);
  if (receipt.fallback !== 'prohibited') failures.push(`${runnerOs}: fallback claim`);
  if (report.packageExecutionStatus !== 'complete') {
    failures.push(`${runnerOs}: package execution was partial or missing`);
  }
  const compared = (report.qualification?.observations ?? []).find(
    (item) => item.id === 'committed-node-service' && item.kind === 'committed-fixture'
  );
  if (!compared?.comparison) {
    failures.push(`${runnerOs}: committed corpus comparison is missing`);
  }
  if ((compared?.comparison?.regressions ?? 1) > 0) {
    failures.push(`${runnerOs}: unapproved regression`);
  }
  if (
    report.comparisonStatus !== 'equivalent' ||
    compared?.comparison?.status !== 'equivalent' ||
    (compared?.comparison?.approvedDifferences ?? 1) > 0 ||
    (compared?.comparison?.differenceCodes ?? ['x']).length !== 0
  ) {
    failures.push(`${runnerOs}: corpus is not semantically equivalent`);
  }
  if (
    compared?.comparison?.status === 'equivalent' &&
    (compared?.comparison?.approvedDifferences ?? 0) > 0
  ) {
    failures.push(`${runnerOs}: approved differences were silently marked equivalent`);
  }
  if (report.qualification?.mutatedCanonicalArtifacts !== false) {
    failures.push(`${runnerOs}: canonical artifact mutation was observed`);
  }
  if (report.qualification?.usedProcessCwdAsAuthority !== false) {
    failures.push(`${runnerOs}: process.cwd was used as project authority`);
  }
  if (compared?.comparison) {
    if (compared.comparison.semanticOutputDigest !== report.semanticOutputDigest) {
      failures.push(`${runnerOs}: semantic output digest tampering`);
    }
    if (compared.comparison.sourceTreeDigest !== report.sourceTreeDigest) {
      failures.push(`${runnerOs}: source tree digest tampering`);
    }
    if (compared.comparison.status !== report.comparisonStatus) {
      failures.push(`${runnerOs}: comparison status tampering`);
    }
    if (
      JSON.stringify(compared.comparison.differenceCodes ?? []) !==
      JSON.stringify(report.differenceCodes ?? [])
    ) {
      failures.push(`${runnerOs}: difference code tampering`);
    }
    if (compared.comparison.sourceFixtureDigest !== report.sourceFixtureDigest) {
      failures.push(`${runnerOs}: source fixture digest tampering`);
    }
    if (compared.comparison.scopeDigest !== report.scopeDigest) {
      failures.push(`${runnerOs}: scope digest tampering`);
    }
    if (compared.comparison.providerProfileDigest !== report.providerProfileDigest) {
      failures.push(`${runnerOs}: provider profile digest tampering`);
    }
    if (compared.comparison.graphPolicyDigest !== report.graphPolicyDigest) {
      failures.push(`${runnerOs}: graph policy digest tampering`);
    }
    if (compared.comparison.redactionAuthorizationDigest !== report.redactionAuthorizationDigest) {
      failures.push(`${runnerOs}: redaction authorization digest tampering`);
    }
    if (compared.comparison.resourceBudgetDigest !== report.resourceBudgetDigest) {
      failures.push(`${runnerOs}: resource budget digest tampering`);
    }
  }
  if (JSON.stringify(report.qualification?.receipt ?? {}) !== JSON.stringify(receipt)) {
    failures.push(`${runnerOs}: nested receipt tampering`);
  }
  if (receipt.comparison?.reportDigest !== report.reportDigest) {
    failures.push(`${runnerOs}: report digest tampering`);
  }
  if (qualificationDigest(report.qualification) !== report.reportDigest) {
    failures.push(`${runnerOs}: report digest was not recomputable from the qualification payload`);
  }
  if (LOCAL_PATH.test(JSON.stringify(report))) {
    failures.push(`${runnerOs}: machine-local path`);
  }
  if (
    !report.versions?.cli?.version ||
    report.versions?.cli?.commit !== options.testedCommit ||
    !report.versions?.graphPackage?.version ||
    report.versions?.graphPackage?.commit !== options.testedCommit
  ) {
    failures.push(`${runnerOs}: CLI or Graph package version binding is invalid`);
  }
  return failures;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const evidenceDirectory = repositoryPath(options.evidenceDirectory, '--evidence-directory');
  const output = repositoryPath(options.output, '--output');
  const failures = [];
  const files = [];
  for (const entry of fs.readdirSync(evidenceDirectory, { withFileTypes: true })) {
    const file = path.join(evidenceDirectory, entry.name);
    if (entry.isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) {
      failures.push(`${entry.name}: oversized or substituted evidence`);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(file);
  }
  files.sort();
  const observed = new Set();
  const evidence = [];
  let expectedInventoryDigest;
  let expectedMappingVersion;
  let expectedRunId;
  let expectedEvent;
  let expectedParity;

  for (const file of files) {
    const metadata = fs.lstatSync(file);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_EVIDENCE_BYTES) {
      failures.push(`${path.basename(file)}: oversized or substituted evidence`);
      continue;
    }
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const runnerOs = report.platformEvidence?.runnerOs ?? 'unknown';
    failures.push(...semanticFailures(report, options, runnerOs));
    if (observed.has(runnerOs)) failures.push(`${runnerOs}: duplicate platform evidence`);
    observed.add(runnerOs);
    expectedRunId ??= report.ci?.runId;
    expectedEvent ??= report.ci?.event;
    expectedInventoryDigest ??= report.inventoryDigest;
    expectedMappingVersion ??= report.mappingVersion;
    expectedParity ??= {
      inventoryDigest: report.inventoryDigest,
      mappingVersion: report.mappingVersion,
      sourceFixtureDigest: report.sourceFixtureDigest,
      sourceTreeDigest: report.sourceTreeDigest,
      scopeDigest: report.scopeDigest,
      providerProfileDigest: report.providerProfileDigest,
      graphPolicyDigest: report.graphPolicyDigest,
      redactionAuthorizationDigest: report.redactionAuthorizationDigest,
      resourceBudgetDigest: report.resourceBudgetDigest,
      reportDigest: report.reportDigest,
      semanticOutputDigest: report.semanticOutputDigest,
      comparisonStatus: report.comparisonStatus,
      differenceCodes: JSON.stringify(report.differenceCodes ?? []),
      receipt: JSON.stringify(report.receipt ?? {}),
      nestedReceipt: JSON.stringify(report.qualification?.receipt ?? {}),
      nestedComparison: JSON.stringify(comparedComparison(report)),
    };
    if (report.ci?.runId !== expectedRunId || report.ci?.event !== expectedEvent) {
      failures.push(`${runnerOs}: evidence was mixed across GitHub runs or events`);
    }
    if (
      report.inventoryDigest !== expectedParity.inventoryDigest ||
      report.mappingVersion !== expectedParity.mappingVersion ||
      report.sourceFixtureDigest !== expectedParity.sourceFixtureDigest ||
      report.sourceTreeDigest !== expectedParity.sourceTreeDigest ||
      report.scopeDigest !== expectedParity.scopeDigest ||
      report.providerProfileDigest !== expectedParity.providerProfileDigest ||
      report.graphPolicyDigest !== expectedParity.graphPolicyDigest ||
      report.redactionAuthorizationDigest !== expectedParity.redactionAuthorizationDigest ||
      report.resourceBudgetDigest !== expectedParity.resourceBudgetDigest ||
      report.reportDigest !== expectedParity.reportDigest ||
      report.semanticOutputDigest !== expectedParity.semanticOutputDigest ||
      report.comparisonStatus !== expectedParity.comparisonStatus ||
      JSON.stringify(report.differenceCodes ?? []) !== expectedParity.differenceCodes ||
      JSON.stringify(report.receipt ?? {}) !== expectedParity.receipt ||
      JSON.stringify(report.qualification?.receipt ?? {}) !== expectedParity.nestedReceipt ||
      JSON.stringify(comparedComparison(report)) !== expectedParity.nestedComparison
    ) {
      failures.push(`${runnerOs}: platform semantic parity drifted`);
    }
    evidence.push({
      runnerOs,
      runnerArch: report.platformEvidence?.runnerArch ?? 'unknown',
      node: report.environment?.node ?? 'unknown',
      runId: report.ci?.runId ?? 'unknown',
      digest: digestFile(file),
      reportDigest: report.reportDigest ?? `sha256:${'0'.repeat(64)}`,
      semanticOutputDigest: report.semanticOutputDigest ?? `sha256:${'0'.repeat(64)}`,
      sourceTreeDigest: report.sourceTreeDigest ?? `sha256:${'0'.repeat(64)}`,
      scopeDigest: report.scopeDigest ?? `sha256:${'0'.repeat(64)}`,
      providerProfileDigest: report.providerProfileDigest ?? `sha256:${'0'.repeat(64)}`,
      graphPolicyDigest: report.graphPolicyDigest ?? `sha256:${'0'.repeat(64)}`,
      resourceBudgetDigest: report.resourceBudgetDigest ?? `sha256:${'0'.repeat(64)}`,
      redactionAuthorizationDigest:
        report.redactionAuthorizationDigest ?? `sha256:${'0'.repeat(64)}`,
      comparisonStatus: report.comparisonStatus ?? 'failed',
      differenceCodes: report.differenceCodes ?? [],
      packageExecutionStatus: report.packageExecutionStatus ?? 'not-executed',
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
  const event = expectedEvent === 'push' ? 'push' : 'pull_request';
  const candidate = {
    schemaVersion: CANDIDATE_SCHEMA,
    package: '@workspai/graph',
    stage: 'G8',
    checkpoint: 'real-workspace-cross-platform-parity',
    status: 'blocked',
    admitted: false,
    nextStage: 'G9',
    nextStageAuthorized: false,
    crossPlatformAdmission: 'pending',
    currentGraphAuthority: 'official-internal-graph-capability',
    authorizedRuntimeMode: 'g8-shadow-comparison-only',
    sourceCommit: options.sourceCommit,
    testedCommit: options.testedCommit,
    runId: expectedRunId ?? '0',
    event,
    inventoryDigest: expectedInventoryDigest ?? `sha256:${'0'.repeat(64)}`,
    mappingVersion: expectedMappingVersion ?? 'workspai.graph-shadow-mapping.v1',
    requiredRunnerOperatingSystems: [...requiredOperatingSystems].sort(),
    evidence,
    failures,
  };
  if (LOCAL_PATH.test(JSON.stringify(candidate))) {
    candidate.failures = [...candidate.failures, 'aggregate evidence leaked a machine-local path'];
  }
  const complete = candidate.failures.length === 0;
  candidate.status = complete
    ? event === 'push'
      ? 'admitted-candidate'
      : 'pr-candidate'
    : 'blocked';
  writeAtomicJson(output, candidate);
  process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
  if (!complete) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `Graph G8 real-workspace matrix admission failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
