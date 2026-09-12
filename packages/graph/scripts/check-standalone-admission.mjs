import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const defaultManifest = 'packages/graph/governance/g7-standalone-admission.v1.json';
const allowedStatuses = new Set(['passed', 'passed-local', 'pending-remote', 'blocked', 'failed']);
const requiredGateIds = new Set([
  'version-1-standalone-jobs',
  'incremental-equivalence-and-slo',
  'non-cli-embedded-consumer',
  'standalone-workspace-modes',
  'final-internal-contract-policy',
  'cross-platform-release-evidence',
  'shared-workspace-runtime-integrity',
  'internal-artifact-integrity',
  'security-and-adversarial-matrix',
  'internal-migration-and-incident-policy',
  'internal-promotion-and-rollback-proof',
  'central-cli-bridge-absence',
]);

function parseArguments(argv) {
  const options = {
    allowBlocked: false,
    json: false,
    manifest: defaultManifest,
    output: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allow-blocked') options.allowBlocked = true;
    else if (argument === '--json') options.json = true;
    else if (['--manifest', '--output'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value.`);
      const key = argument === '--manifest' ? 'manifest' : 'output';
      options[key] = value;
      index += 1;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function repositoryFile(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').includes('..')
  ) {
    throw new Error(`Unsafe repository path: ${String(relative)}`);
  }
  const resolved = path.resolve(repositoryRoot, relative);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`Repository path escapes its root: ${relative}`);
  }
  return resolved;
}

function readJson(relative) {
  const file = repositoryFile(relative);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
    throw new Error(`Missing admission input: ${relative}`);
  }
  if (fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(`Admission input cannot be a symlink: ${relative}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildAudit(options) {
  const failures = [];
  const admission = readJson(options.manifest);
  const manifest = readJson('packages/graph/package.json');
  const sharedManifest = readJson('packages/shared/package.json');
  const lockfile = readJson('package-lock.json');
  const registry = readJson('independent-packages.json');
  const graphRegistry = (registry.packages ?? []).find((entry) => entry.name === manifest.name);
  const metadataSource = fs.readFileSync(
    repositoryFile('packages/graph/src/contracts/package-metadata.ts'),
    'utf8'
  );
  const contractLock = readJson('packages/graph/governance/g7-internal-contract-lock.v1.json');
  const migrationPolicy = readJson(
    'packages/graph/governance/g7-migration-rollback-policy.v1.json'
  );
  const verifiedBaseline = readJson('packages/graph/governance/g7-verified-baseline.v1.json');
  const catalogDigest = `sha256:${crypto
    .createHash('sha256')
    .update(fs.readFileSync(repositoryFile('packages/graph/conformance/contract-catalog.v1.json')))
    .digest('hex')}`;
  if (
    contractLock.status !== 'locked-for-g8-shadow-bridge' ||
    contractLock.catalog?.digest !== catalogDigest ||
    migrationPolicy.status !== 'defined-unactivated' ||
    migrationPolicy.runtime?.silentFallback !== 'prohibited' ||
    migrationPolicy.rollback?.target !== 'official-internal-graph-capability' ||
    migrationPolicy.promotion?.requiresSignedArtifactAttestation !== true ||
    migrationPolicy.promotion?.requiresSignedSbomAttestation !== true ||
    verifiedBaseline.status !== 'verified-release-candidate-baseline' ||
    verifiedBaseline.candidate?.admitted !== false ||
    verifiedBaseline.promotionState !== 'current-commit-matrix-required'
  ) {
    failures.push('Graph G7 operational readiness evidence is invalid');
  }

  if (admission.schemaVersion !== 'workspai-graph-standalone-admission.v1') {
    failures.push('unsupported Graph standalone-admission schema');
  }
  if (admission.package !== manifest.name || admission.version !== manifest.version) {
    failures.push('Graph admission package identity or version drifted');
  }
  if (
    admission.nextStage !== 'G8' ||
    admission.distribution !== 'internal-only' ||
    admission.npmPublication !== 'prohibited' ||
    typeof admission.nextStageAuthorized !== 'boolean' ||
    typeof admission.standaloneStable !== 'boolean'
  ) {
    failures.push('Graph admission lifecycle fields are incomplete');
  }
  const gates = Array.isArray(admission.gates) ? admission.gates : [];
  if (gates.length !== requiredGateIds.size) {
    failures.push('Graph admission must contain exactly the required standalone gates');
  }
  const gateIds = new Set();
  for (const gate of gates) {
    if (!requiredGateIds.has(gate.id) || gateIds.has(gate.id)) {
      failures.push(`invalid or duplicate Graph admission gate: ${String(gate.id)}`);
    }
    gateIds.add(gate.id);
    if (!allowedStatuses.has(gate.status)) {
      failures.push(`invalid status for Graph admission gate ${String(gate.id)}`);
    }
    if (typeof gate.category !== 'string' || typeof gate.reason !== 'string') {
      failures.push(`incomplete Graph admission gate ${String(gate.id)}`);
    }
    if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
      failures.push(`Graph admission gate ${String(gate.id)} has no evidence`);
      continue;
    }
    for (const evidence of gate.evidence) {
      try {
        const file = repositoryFile(evidence);
        if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
          failures.push(`missing evidence for ${String(gate.id)}: ${String(evidence)}`);
        }
      } catch {
        failures.push(`unsafe evidence for ${String(gate.id)}: ${String(evidence)}`);
      }
    }
  }
  for (const required of requiredGateIds) {
    if (!gateIds.has(required)) failures.push(`missing required Graph admission gate: ${required}`);
  }

  const summary = Object.fromEntries(
    [...allowedStatuses].map((status) => [
      status,
      gates.filter((gate) => gate.status === status).length,
    ])
  );
  const computedStatus = gates.some((gate) => gate.status === 'failed')
    ? 'failed'
    : gates.length === requiredGateIds.size && gates.every((gate) => gate.status === 'passed')
      ? 'admitted'
      : 'blocked';
  const computedAdmitted = computedStatus === 'admitted';
  if (
    admission.status !== computedStatus ||
    admission.admitted !== computedAdmitted ||
    admission.standaloneStable !== computedAdmitted ||
    admission.nextStageAuthorized !== computedAdmitted
  ) {
    failures.push('declared Graph admission state disagrees with gate statuses');
  }

  const sharedDependency = manifest.dependencies?.['@workspai/shared'];
  const lockedShared = lockfile.packages?.['packages/shared'];
  const sharedInternalReady =
    sharedDependency === sharedManifest.version &&
    lockedShared?.name === '@workspai/shared' &&
    lockedShared?.version === sharedManifest.version &&
    sharedManifest.private === true &&
    sharedManifest.scripts?.prepublishOnly === 'node scripts/refuse-publish.mjs';
  const dependencyGate = gates.find((gate) => gate.id === 'shared-workspace-runtime-integrity');
  if (!sharedInternalReady) {
    failures.push('Graph requires an exact, private and lockfile-bound Shared workspace runtime');
  }
  if (sharedInternalReady && !['passed', 'passed-local'].includes(dependencyGate?.status)) {
    failures.push('Shared workspace runtime is ready but its Graph dependency gate is blocked');
  }
  if (!sharedInternalReady && ['passed', 'passed-local'].includes(dependencyGate?.status)) {
    failures.push('Graph dependency gate cannot pass with workspace or lockfile drift');
  }

  const metadataClaimsStable =
    /maturity:\s*['"]internal-stable['"]/u.test(metadataSource) &&
    /publishable:\s*false/u.test(metadataSource);
  const metadataClaimsPublishable = /publishable:\s*true/u.test(metadataSource);
  if (metadataClaimsPublishable) {
    failures.push('internal-only Graph metadata cannot claim npm publishability');
  }
  if (computedAdmitted) {
    if (
      manifest.private !== true ||
      manifest.scripts?.prepublishOnly !== 'node scripts/refuse-publish.mjs' ||
      graphRegistry?.standaloneStability !== 'admitted' ||
      graphRegistry?.currentStage !== 'G7' ||
      !metadataClaimsStable
    ) {
      failures.push('admitted Graph state is not reflected by package, registry and metadata');
    }
  } else {
    if (
      manifest.private !== true ||
      manifest.scripts?.prepublishOnly !== 'node scripts/refuse-publish.mjs' ||
      graphRegistry?.standaloneStability !== 'not-admitted' ||
      graphRegistry?.cliRuntimeIntegration !== 'prohibited-before-standalone-stability' ||
      metadataClaimsStable
    ) {
      failures.push(
        'blocked Graph must retain every fail-closed publication and integration guard'
      );
    }
  }
  if (admission.nextStageAuthorized && computedStatus !== 'admitted') {
    failures.push('G8 cannot be authorized before standalone admission');
  }

  return {
    schemaVersion: 'workspai-graph-standalone-admission-audit.v1',
    generatedAt: new Date().toISOString(),
    package: admission.package,
    version: admission.version,
    status: failures.length > 0 ? 'invalid' : computedStatus,
    admitted: failures.length === 0 && computedAdmitted,
    standaloneStable: failures.length === 0 && computedAdmitted,
    nextStage: 'G8',
    nextStageAuthorized: failures.length === 0 && computedAdmitted,
    runtimeDependencies: {
      shared: {
        requestedVersion: sharedDependency,
        packageVersion: sharedManifest.version,
        lockfileVersion: lockedShared?.version,
        internalReady: sharedInternalReady,
      },
    },
    summary,
    blockingGates: gates
      .filter((gate) => gate.status !== 'passed')
      .map((gate) => ({ id: gate.id, status: gate.status, reason: gate.reason })),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      osRelease: os.release(),
    },
    failures,
  };
}

function renderHuman(audit) {
  const lines = [
    `Graph standalone admission: ${audit.status}`,
    `Passed: ${audit.summary.passed}; local-only: ${audit.summary['passed-local']}; pending remote: ${audit.summary['pending-remote']}; blocked: ${audit.summary.blocked}; failed: ${audit.summary.failed}`,
    `Shared workspace runtime ready: ${String(audit.runtimeDependencies.shared.internalReady)}`,
  ];
  for (const blocker of audit.blockingGates) {
    lines.push(`- ${blocker.id} [${blocker.status}]: ${blocker.reason}`);
  }
  for (const failure of audit.failures) lines.push(`! ${failure}`);
  return `${lines.join('\n')}\n`;
}

let options;
let audit;
try {
  options = parseArguments(process.argv.slice(2));
  audit = buildAudit(options);
  const serialized = `${JSON.stringify(audit, null, 2)}\n`;
  if (options.output) {
    const output = repositoryFile(options.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, serialized, { mode: 0o600 });
  }
  process.stdout.write(options.json ? serialized : renderHuman(audit));
} catch (error) {
  process.stderr.write(
    `Graph standalone admission audit failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

if (audit) {
  if (audit.status === 'invalid' || audit.status === 'failed') process.exitCode = 1;
  else if (audit.status === 'blocked' && !options.allowBlocked) process.exitCode = 2;
}
