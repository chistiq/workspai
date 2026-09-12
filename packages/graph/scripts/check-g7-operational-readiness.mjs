import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const args = process.argv.slice(2);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value.`);
  return value;
}

function repositoryFile(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..')
  ) {
    throw new Error(`Unsafe operational evidence path: ${String(relative)}`);
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`Operational evidence path escapes the repository: ${relative}`);
  }
  return resolved;
}

function readJson(relative) {
  const file = repositoryFile(relative);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Operational evidence must be a regular file: ${relative}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fileDigest(relative) {
  return `sha256:${crypto
    .createHash('sha256')
    .update(fs.readFileSync(repositoryFile(relative)))
    .digest('hex')}`;
}

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return collectSourceFiles(absolute);
    return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) ? [absolute] : [];
  });
}

const lockPath = option(
  '--contract-lock',
  'packages/graph/governance/g7-internal-contract-lock.v1.json'
);
const policyPath = option(
  '--operations-policy',
  'packages/graph/governance/g7-migration-rollback-policy.v1.json'
);
const baselinePath = option(
  '--verified-baseline',
  'packages/graph/governance/g7-verified-baseline.v1.json'
);
const failures = [];
const lock = readJson(lockPath);
const policy = readJson(policyPath);
const baseline = readJson(baselinePath);
const graphManifest = readJson('packages/graph/package.json');
const cliManifest = readJson('packages/cli/package.json');
const ciWorkflow = fs.readFileSync(repositoryFile('.github/workflows/ci.yml'), 'utf8');

if (
  lock.schemaVersion !== 'workspai-graph-internal-contract-lock.v1' ||
  lock.package !== '@workspai/graph' ||
  lock.status !== 'locked-for-g8-shadow-bridge' ||
  lock.distribution !== 'internal-only' ||
  lock.contractEpoch !== 'graph-internal-v1'
) {
  failures.push('internal Graph contract lock identity or scope drifted');
}
if (lock.catalog?.path !== 'packages/graph/conformance/contract-catalog.v1.json') {
  failures.push('internal Graph contract lock must bind the canonical catalog');
} else if (lock.catalog?.digest !== fileDigest(lock.catalog.path)) {
  failures.push('internal Graph contract catalog digest drifted');
}
if (
  lock.catalog?.candidateNamesRemainWireIdentities !== true ||
  lock.compatibility?.breakingChangesRequireNewEpoch !== true ||
  lock.compatibility?.additiveChangesRequireConformanceEvidence !== true ||
  lock.compatibility?.unknownExtensionsRemainNonAuthoritative !== true ||
  lock.compatibility?.silentSemanticReinterpretation !== 'prohibited' ||
  lock.compatibility?.deprecationRequiresMigrationFixture !== true
) {
  failures.push('internal Graph compatibility policy is incomplete');
}
const requiredScopes = new Set([
  'canonical-graph',
  'generation-publication',
  'graph-query',
  'graph-query-result',
  'graph-quality',
  'model-generation-binding',
  'provider-manifest',
  'proof-policy',
]);
if (
  !Array.isArray(lock.scope) ||
  lock.scope.length !== requiredScopes.size ||
  lock.scope.some((entry) => !requiredScopes.has(entry))
) {
  failures.push('internal Graph contract lock does not cover every bridge-critical scope');
}
if (
  lock.claims?.npmStable !== false ||
  lock.claims?.publicPreview !== false ||
  lock.claims?.centralCliPrimary !== false
) {
  failures.push('internal Graph contract lock overclaims distribution or activation');
}

if (
  policy.schemaVersion !== 'workspai-graph-migration-rollback-policy.v1' ||
  policy.package !== '@workspai/graph' ||
  policy.status !== 'defined-unactivated' ||
  policy.distribution !== 'internal-only'
) {
  failures.push('Graph migration and rollback policy identity drifted');
}
if (
  policy.migration?.currentAuthority !== 'official-internal-graph-capability' ||
  policy.migration?.nextMode !== 'g8-shadow-comparison' ||
  policy.migration?.packageMayBecomePrimaryInG7 !== false ||
  policy.migration?.stateRewriteInG7 !== 'prohibited' ||
  policy.migration?.canonicalGenerationMutationInShadowMode !== 'prohibited' ||
  policy.migration?.compatibilityEpoch !== lock.contractEpoch
) {
  failures.push('Graph migration policy does not preserve the existing Graph authority');
}
if (
  policy.runtime?.silentFallback !== 'prohibited' ||
  policy.runtime?.fallbackRequiresQualifiedReason !== true ||
  policy.runtime?.fallbackMustEmitDeterministicTelemetry !== true ||
  policy.runtime?.userEngineSelection !== 'prohibited' ||
  policy.runtime?.dynamicRuntimeDownload !== 'prohibited' ||
  policy.runtime?.userRustToolchain !== 'not-required'
) {
  failures.push('Graph runtime fallback or zero-toolchain boundary drifted');
}
if (
  policy.rollback?.target !== 'official-internal-graph-capability' ||
  policy.rollback?.activationDefault !== 'off' ||
  policy.rollback?.sourceRewrite !== 'prohibited' ||
  policy.rollback?.dataMigrationRequiredBeforeG8 !== false ||
  policy.rollback?.dataLossAtG7 !== 'none-no-runtime-integration' ||
  !Array.isArray(policy.rollback?.triggerClasses) ||
  policy.rollback.triggerClasses.length === 0
) {
  failures.push('Graph rollback policy is incomplete or destructive');
}
if (
  policy.promotion?.requiresCurrentCommitLinuxMacosWindowsEvidence !== true ||
  policy.promotion?.requiresExactSharedWorkspaceLock !== true ||
  policy.promotion?.requiresPackedConsumer !== true ||
  policy.promotion?.requiresNativeParityWhenBundled !== true ||
  policy.promotion?.requiresSignedArtifactAttestation !== true ||
  policy.promotion?.requiresSignedSbomAttestation !== true ||
  policy.promotion?.requiresExplicitAdmissionLedger !== true ||
  policy.promotion?.npmPublication !== 'prohibited'
) {
  failures.push('Graph internal promotion policy is incomplete');
}
if (
  !/graph-g7-release-candidate:[\s\S]*?id-token:\s*write/u.test(ciWorkflow) ||
  !/graph-g7-release-candidate:[\s\S]*?attestations:\s*write/u.test(ciWorkflow) ||
  !/graph-g7-release-candidate:[\s\S]*?artifact-metadata:\s*write/u.test(ciWorkflow) ||
  (ciWorkflow.match(/uses:\s*actions\/attest@v4/gu) ?? []).length !== 2 ||
  (ciWorkflow.match(/subject-path:\s*artifacts\/graph-package\/\*\.tgz/gu) ?? []).length !== 2 ||
  !/sbom-path:\s*packages\/graph\/governance\/g7-sbom\.cdx\.json/u.test(ciWorkflow) ||
  !/name:\s*graph-internal-package/u.test(ciWorkflow) ||
  !/name:\s*graph-g7-release-attestation/u.test(ciWorkflow)
) {
  failures.push('Graph G7 workflow does not retain signed candidate provenance');
}

const platformRows = Array.isArray(baseline.platformEvidence) ? baseline.platformEvidence : [];
const platformNames = new Set(platformRows.map((entry) => entry.runnerOs));
if (
  baseline.schemaVersion !== 'workspai-graph-g7-verified-baseline.v1' ||
  baseline.package !== '@workspai/graph' ||
  baseline.status !== 'verified-release-candidate-baseline' ||
  baseline.evidenceTrust !== 'retained-github-actions-metadata-unattested' ||
  !commitPattern.test(baseline.sourceCommit ?? '') ||
  !commitPattern.test(baseline.testedCommit ?? '') ||
  !/^[1-9][0-9]*$/u.test(baseline.githubRunId ?? '') ||
  baseline.candidate?.passed !== true ||
  baseline.candidate?.admitted !== false ||
  baseline.candidate?.standaloneStable !== false ||
  baseline.promotionState !== 'current-commit-matrix-required' ||
  baseline.claims?.signedAttestation !== false ||
  baseline.claims?.npmPublication !== false ||
  baseline.claims?.g8Authorized !== false ||
  platformRows.length !== 3 ||
  !['Linux', 'macOS', 'Windows'].every((entry) => platformNames.has(entry)) ||
  !platformRows.every((entry) => digestPattern.test(entry.digest ?? '')) ||
  !digestPattern.test(baseline.candidateArtifact?.digest ?? '') ||
  !digestPattern.test(baseline.candidate?.g6CandidateDigest ?? '') ||
  !digestPattern.test(baseline.candidate?.releaseInputsDigest ?? '')
) {
  failures.push('retained G7 baseline metadata is incomplete or overclaims admission');
}

if (
  graphManifest.private !== true ||
  graphManifest.scripts?.prepublishOnly !== 'node scripts/refuse-publish.mjs'
) {
  failures.push('Graph must remain private and refuse publication');
}
if (
  cliManifest.dependencies?.['@workspai/graph'] !== undefined ||
  cliManifest.optionalDependencies?.['@workspai/graph'] !== undefined
) {
  failures.push('central CLI cannot depend on Graph before G8 shadow admission');
}
const cliRuntimeSources = collectSourceFiles(repositoryFile('packages/cli/src')).filter(
  (file) => !file.includes(`${path.sep}__tests__${path.sep}`)
);
if (
  cliRuntimeSources.some((file) =>
    /(?:from\s+|import\s*\()(['"])@workspai\/graph(?:\/[^'"]*)?\1/u.test(
      fs.readFileSync(file, 'utf8')
    )
  )
) {
  failures.push('central CLI runtime imports Graph before G8 shadow admission');
}
const portable = JSON.stringify({ lock, policy, baseline });
if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(portable)) {
  failures.push('G7 operational evidence contains a machine-local path');
}

const report = {
  schemaVersion: 'workspai-graph-g7-operational-readiness-audit.v1',
  package: '@workspai/graph',
  status: failures.length === 0 ? 'ready-for-current-commit-matrix' : 'invalid',
  contractEpoch: lock.contractEpoch,
  rollbackTarget: policy.rollback?.target,
  centralCliRuntimeImports: 0,
  baselineRunId: baseline.githubRunId,
  baselineAdmitted: false,
  currentCommitEvidenceRequired: true,
  failures,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
