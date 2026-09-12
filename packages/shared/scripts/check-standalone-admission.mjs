import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const defaultManifest = 'packages/shared/governance/sh7-standalone-admission.v1.json';
const allowedStatuses = new Set(['passed', 'passed-local', 'pending-remote', 'blocked', 'failed']);
const requiredGateIds = new Set([
  'normative-semantic-lock',
  'local-cumulative-quality',
  'linux-installed-consumer',
  'macos-installed-consumer',
  'windows-installed-consumer',
  'real-browser-runtime',
  'peak-memory-profile',
  'security-and-dependency-audit',
  'internal-artifact-integrity',
  'registered-internal-graph-consumer',
  'internal-compatibility-and-migration-policy',
  'internal-promotion-and-rollback-readiness',
  'central-cli-bridge-absence',
]);

function parseArguments(argv) {
  const options = {
    allowBlocked: false,
    ciEvidence: false,
    json: false,
    manifest: defaultManifest,
    output: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allow-blocked') options.allowBlocked = true;
    else if (argument === '--ci-evidence') options.ciEvidence = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--manifest' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires a relative path.`);
      options[argument === '--manifest' ? 'manifest' : 'output'] = value;
      index += 1;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isSafeEvidencePath(value) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}

function portableOutputPath(value) {
  if (!isSafeEvidencePath(value)) throw new Error('--output must be a safe relative path.');
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('--output escapes the repository root.');
  }
  return resolved;
}

function repositoryFile(value) {
  const resolved = portableOutputPath(value);
  if (!fs.existsSync(resolved) || !fs.lstatSync(resolved).isFile()) {
    throw new Error(`Missing admission input: ${value}`);
  }
  if (fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error(`Admission input cannot be a symlink: ${value}`);
  }
  return resolved;
}

function buildAudit(options) {
  const failures = [];
  const manifest = readJson(repositoryFile(options.manifest));
  const packageManifest = readJson(path.join(packageRoot, 'package.json'));
  const packageGates = readJson(path.join(packageRoot, 'governance/shared-package-gates.v1.json'));
  const registry = readJson(path.join(repositoryRoot, 'independent-packages.json'));
  const sharedRegistry = (registry.packages ?? []).find(
    (entry) => entry.name === packageManifest.name
  );

  if (manifest.schemaVersion !== 'workspai-shared-standalone-admission.v1') {
    failures.push('unsupported standalone-admission schema');
  }
  if (manifest.package !== packageManifest.name || manifest.version !== packageManifest.version) {
    failures.push('admission package identity or version drifted');
  }
  if (
    manifest.distribution !== 'internal-only' ||
    manifest.npmPublication !== 'prohibited' ||
    manifest.nextStage !== 'SH8' ||
    typeof manifest.nextStageAuthorized !== 'boolean' ||
    typeof manifest.standaloneStable !== 'boolean'
  ) {
    failures.push('internal admission lifecycle or distribution policy drifted');
  }
  if (!Array.isArray(manifest.gates) || manifest.gates.length !== requiredGateIds.size) {
    failures.push('admission manifest must contain exactly the required internal gates');
  }

  const gateIds = new Set();
  for (const gate of manifest.gates ?? []) {
    if (!requiredGateIds.has(gate.id) || gateIds.has(gate.id)) {
      failures.push(`invalid or duplicate admission gate: ${String(gate.id)}`);
    }
    gateIds.add(gate.id);
    if (!allowedStatuses.has(gate.status)) {
      failures.push(`invalid status for admission gate ${gate.id}`);
    }
    if (typeof gate.category !== 'string' || typeof gate.reason !== 'string') {
      failures.push(`incomplete admission gate ${gate.id}`);
    }
    if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
      failures.push(`admission gate ${gate.id} has no evidence`);
      continue;
    }
    for (const evidencePath of gate.evidence) {
      if (!isSafeEvidencePath(evidencePath)) {
        failures.push(`unsafe evidence path for ${gate.id}: ${String(evidencePath)}`);
        continue;
      }
      const resolved = path.join(repositoryRoot, evidencePath);
      if (!fs.existsSync(resolved) || !fs.lstatSync(resolved).isFile()) {
        failures.push(`missing evidence for ${gate.id}: ${evidencePath}`);
      }
    }
  }
  for (const required of requiredGateIds) {
    if (!gateIds.has(required)) failures.push(`missing required admission gate: ${required}`);
  }

  const gates = manifest.gates ?? [];
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
    manifest.status !== computedStatus ||
    manifest.admitted !== computedAdmitted ||
    manifest.standaloneStable !== computedAdmitted ||
    manifest.nextStageAuthorized !== computedAdmitted
  ) {
    failures.push('declared admission status disagrees with gate statuses');
  }
  if (
    packageManifest.private !== true ||
    packageManifest.scripts?.prepublishOnly !== 'node scripts/refuse-publish.mjs'
  ) {
    failures.push('Shared must remain private and refuse npm publication after admission');
  }
  if (computedStatus !== 'admitted') {
    const sh7 = (packageGates.gates ?? []).find((gate) => gate.id === 'SH7');
    if (computedStatus === 'blocked' && sh7?.status !== 'blocked') {
      failures.push('machine package gate must report SH7 blocked after the admission decision');
    }
    if (
      sharedRegistry?.standaloneStability !== 'not-admitted' ||
      sharedRegistry?.cliRuntimeIntegration !== 'prohibited-before-standalone-stability'
    ) {
      failures.push('blocked Shared must remain outside the central CLI runtime');
    }
  } else if (
    sharedRegistry?.standaloneStability !== 'admitted' ||
    sharedRegistry?.currentStage !== 'SH7'
  ) {
    failures.push('admitted Shared state is not reflected by the package registry');
  }

  let platformEvidence;
  if (options.ciEvidence) {
    if (process.env.GITHUB_ACTIONS !== 'true') {
      failures.push('--ci-evidence is valid only inside GitHub Actions');
    }
    if (process.env.WORKSPAI_PACKAGE_INFRASTRUCTURE_PASSED !== '1') {
      failures.push('CI platform evidence requires the preceding package-infrastructure pass');
    }
    platformEvidence = {
      status: failures.length === 0 ? 'passed' : 'failed',
      runnerOs: process.env.RUNNER_OS ?? process.platform,
      runnerArch: process.env.RUNNER_ARCH ?? process.arch,
      prerequisite: 'npm run check:package-infrastructure',
    };
  }

  return {
    schemaVersion: 'workspai-shared-standalone-admission-audit.v1',
    generatedAt: new Date().toISOString(),
    package: manifest.package,
    version: manifest.version,
    status: failures.length > 0 ? 'invalid' : computedStatus,
    admitted: failures.length === 0 && computedAdmitted,
    standaloneStable: failures.length === 0 && computedAdmitted,
    distribution: 'internal-only',
    npmPublication: 'prohibited',
    nextStage: 'SH8',
    nextStageAuthorized: failures.length === 0 && computedAdmitted,
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
    ...(process.env.GITHUB_ACTIONS === 'true'
      ? {
          ci: {
            provider: 'github-actions',
            runId: process.env.GITHUB_RUN_ID ?? 'unknown',
            runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? 'unknown',
            commit: process.env.GITHUB_SHA ?? 'unknown',
            ref: process.env.GITHUB_REF ?? 'unknown',
          },
        }
      : {}),
    ...(platformEvidence ? { platformEvidence } : {}),
    failures,
  };
}

function renderHuman(audit) {
  const lines = [
    `Shared standalone admission: ${audit.status}`,
    `Passed: ${audit.summary.passed}; local-only: ${audit.summary['passed-local']}; pending remote: ${audit.summary['pending-remote']}; blocked: ${audit.summary.blocked}; failed: ${audit.summary.failed}`,
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
    const output = portableOutputPath(options.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, serialized, { encoding: 'utf8', mode: 0o600 });
  }
  process.stdout.write(options.json ? serialized : renderHuman(audit));
} catch (error) {
  process.stderr.write(
    `Standalone admission audit failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

if (audit) {
  if (audit.status === 'invalid' || audit.status === 'failed') process.exitCode = 1;
  else if (audit.status === 'blocked' && !options.allowBlocked) process.exitCode = 2;
}
