import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const officialRepository = 'chistiq/workspai';
const promotionGateIds = new Set([
  'cross-platform-release-evidence',
  'internal-promotion-and-rollback-proof',
]);
const requiredGateIds = new Set([
  'version-1-standalone-jobs',
  'incremental-equivalence-and-slo',
  'non-cli-embedded-consumer',
  'standalone-workspace-modes',
  'final-internal-contract-policy',
  ...promotionGateIds,
  'shared-workspace-runtime-integrity',
  'internal-artifact-integrity',
  'security-and-adversarial-matrix',
  'internal-migration-and-incident-policy',
  'central-cli-bridge-absence',
]);

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--promotion-evidence', '--output'].includes(name) || !value || value.startsWith('-')) {
      throw new Error(`Invalid or incomplete finalization option: ${String(name)}`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function repositoryPath(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..')
  ) {
    throw new Error(`Admission path must be repository-relative: ${String(relative)}`);
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`Admission path escapes the repository: ${relative}`);
  }
  return resolved;
}

function readJson(relative) {
  const file = repositoryPath(relative);
  const stat = fs.lstatSync(file);
  const real = fs.realpathSync(file);
  const realRoot = fs.realpathSync(repositoryRoot);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 16 * 1024 * 1024 ||
    (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`))
  ) {
    throw new Error(`Admission input is not a safe regular file: ${relative}`);
  }
  return { value: JSON.parse(fs.readFileSync(real, 'utf8')), bytes: fs.readFileSync(real) };
}

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

export function evaluateAdmissionTransition({
  promotion,
  ledger,
  graphManifest,
  sharedManifest,
  lockedShared,
  graphRegistry,
  migrationPolicy,
}) {
  const failures = [];
  const policy = promotion?.verificationPolicy;
  if (
    promotion?.schemaVersion !== 'workspai-graph-g7-promotion-evidence.v1' ||
    promotion?.package !== '@workspai/graph' ||
    promotion?.distribution !== 'internal-only' ||
    promotion?.repository !== officialRepository ||
    promotion?.ref !== 'refs/heads/main' ||
    !commitPattern.test(promotion?.sourceCommit ?? '') ||
    promotion?.sourceCommit !== promotion?.testedCommit ||
    !/^[1-9][0-9]*$/u.test(promotion?.runId ?? '') ||
    promotion?.status !== 'verified-promotion-evidence' ||
    promotion?.promotionQualified !== true ||
    promotion?.admitted !== false ||
    promotion?.standaloneStable !== false ||
    promotion?.nextStageAuthorized !== false ||
    !Array.isArray(promotion?.failures) ||
    promotion.failures.length !== 0 ||
    !digestPattern.test(promotion?.artifact?.digest ?? '') ||
    !digestPattern.test(promotion?.releaseCandidateDigest ?? '') ||
    !digestPattern.test(promotion?.sbom?.contentDigest ?? '') ||
    !digestPattern.test(promotion?.sbom?.releaseEvidenceDigest ?? '') ||
    !digestPattern.test(promotion?.attestationBundles?.provenance ?? '') ||
    !digestPattern.test(promotion?.attestationBundles?.sbom ?? '')
  ) {
    failures.push('G7 promotion evidence is incomplete, unqualified or overclaims admission');
  }
  if (
    policy?.repository !== officialRepository ||
    policy?.signerWorkflow !== `${officialRepository}/.github/workflows/ci.yml` ||
    policy?.signerDigest !== promotion?.testedCommit ||
    policy?.sourceDigest !== promotion?.testedCommit ||
    policy?.sourceRef !== 'refs/heads/main' ||
    policy?.denySelfHostedRunners !== true ||
    policy?.provenancePredicateType !== 'https://slsa.dev/provenance/v1' ||
    policy?.sbomPredicateType !== 'https://cyclonedx.org/bom'
  ) {
    failures.push('G7 promotion evidence does not enforce the required attestation identity');
  }

  const gates = Array.isArray(ledger?.gates) ? ledger.gates : [];
  const gateIds = new Set(gates.map((gate) => gate.id));
  if (
    ledger?.schemaVersion !== 'workspai-graph-standalone-admission.v1' ||
    ledger?.status !== 'blocked' ||
    ledger?.admitted !== false ||
    ledger?.standaloneStable !== false ||
    ledger?.distribution !== 'internal-only' ||
    ledger?.npmPublication !== 'prohibited' ||
    ledger?.nextStage !== 'G8' ||
    ledger?.nextStageAuthorized !== false ||
    gates.length !== requiredGateIds.size ||
    gateIds.size !== gates.length ||
    [...requiredGateIds].some((id) => !gateIds.has(id))
  ) {
    failures.push('G7 source admission ledger is not the canonical fail-closed candidate');
  }
  for (const gate of gates) {
    const expectedStatuses = promotionGateIds.has(gate.id)
      ? new Set(['pending-remote'])
      : new Set(['passed', 'passed-local']);
    if (!expectedStatuses.has(gate.status)) {
      failures.push(`G7 gate cannot transition from ${String(gate.id)}:${String(gate.status)}`);
    }
  }

  const exactSharedReady =
    graphManifest?.dependencies?.['@workspai/shared'] === sharedManifest?.version &&
    lockedShared?.name === '@workspai/shared' &&
    lockedShared?.version === sharedManifest?.version &&
    sharedManifest?.private === true;
  const expectedArtifactName = `${String(graphManifest?.name)
    .replace(/^@/u, '')
    .replace('/', '-')}-${String(graphManifest?.version)}.tgz`;
  if (
    graphManifest?.name !== '@workspai/graph' ||
    graphManifest?.version !== promotion?.version ||
    graphManifest?.private !== true ||
    graphManifest?.scripts?.prepublishOnly !== 'node scripts/refuse-publish.mjs' ||
    promotion?.artifact?.name !== expectedArtifactName ||
    !exactSharedReady
  ) {
    failures.push('G7 package or exact private Shared runtime identity drifted');
  }
  if (
    graphRegistry?.currentStage !== 'G5' ||
    graphRegistry?.standaloneStability !== 'not-admitted' ||
    graphRegistry?.cliRuntimeIntegration !== 'prohibited-before-standalone-stability'
  ) {
    failures.push(
      'G7 transition requires the existing registry and CLI bridge to remain fail-closed'
    );
  }
  if (
    migrationPolicy?.status !== 'defined-unactivated' ||
    migrationPolicy?.migration?.nextMode !== 'g8-shadow-comparison' ||
    migrationPolicy?.rollback?.target !== 'official-internal-graph-capability' ||
    migrationPolicy?.promotion?.requiresProtectedMainPush !== true ||
    migrationPolicy?.promotion?.npmPublication !== 'prohibited'
  ) {
    failures.push('G7 transition does not retain the migration and rollback boundary');
  }
  return { failures, admitted: failures.length === 0 };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const promotionInput = readJson(options['promotion-evidence']);
  const ledgerInput = readJson('packages/graph/governance/g7-standalone-admission.v1.json');
  const graphManifest = readJson('packages/graph/package.json').value;
  const sharedManifest = readJson('packages/shared/package.json').value;
  const lockfile = readJson('package-lock.json').value;
  const registry = readJson('independent-packages.json').value;
  const migrationPolicy = readJson(
    'packages/graph/governance/g7-migration-rollback-policy.v1.json'
  ).value;
  const graphRegistry = registry.packages?.find((entry) => entry.name === '@workspai/graph');
  const evaluation = evaluateAdmissionTransition({
    promotion: promotionInput.value,
    ledger: ledgerInput.value,
    graphManifest,
    sharedManifest,
    lockedShared: lockfile.packages?.['packages/shared'],
    graphRegistry,
    migrationPolicy,
  });
  const decision = {
    schemaVersion: 'workspai-graph-g7-standalone-admission-decision.v1',
    generatedAt: new Date().toISOString(),
    package: '@workspai/graph',
    version: graphManifest.version,
    distribution: 'internal-only',
    npmPublication: 'prohibited',
    sourceCommit: promotionInput.value.sourceCommit,
    testedCommit: promotionInput.value.testedCommit,
    runId: promotionInput.value.runId,
    status: evaluation.admitted ? 'admitted' : 'blocked',
    admitted: evaluation.admitted,
    standaloneStable: evaluation.admitted,
    nextStage: 'G8',
    nextStageAuthorized: evaluation.admitted,
    authorizedRuntimeMode: evaluation.admitted ? 'g8-shadow-comparison-only' : 'none',
    currentGraphAuthority: 'official-internal-graph-capability',
    promotionEvidenceDigest: sha256(promotionInput.bytes),
    sourceLedgerDigest: sha256(ledgerInput.bytes),
    resolvedGates: (ledgerInput.value.gates ?? []).map((gate) => ({
      id: gate.id,
      sourceStatus: gate.status,
      decisionStatus: evaluation.admitted ? 'passed' : 'blocked',
    })),
    failures: evaluation.failures,
  };
  const output = repositoryPath(options.output);
  const outputParent = path.dirname(output);
  fs.mkdirSync(outputParent, { recursive: true });
  const parentStat = fs.lstatSync(outputParent);
  const realParent = fs.realpathSync(outputParent);
  const realRoot = fs.realpathSync(repositoryRoot);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`))
  ) {
    throw new Error('Admission decision output directory is unsafe');
  }
  if (fs.existsSync(output)) {
    const outputStat = fs.lstatSync(output);
    if (!outputStat.isFile() || outputStat.isSymbolicLink()) {
      throw new Error('Admission decision cannot replace a symlink or non-file entry');
    }
  }
  fs.writeFileSync(output, `${JSON.stringify(decision, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  if (!evaluation.admitted) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
