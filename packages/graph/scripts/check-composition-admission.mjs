import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const closurePath = path.join(packageRoot, 'governance/g2-stage-closure.v1.json');
const stageSchemaPath = path.join(
  repositoryRoot,
  'contracts/independent-package-stage-closure.v1.json'
);
const qualityPolicyPath = path.join(repositoryRoot, 'independent-package-quality-policy.v1.json');
const implementationPaths = [
  'packages/graph/src/application/compose-graph.ts',
  'packages/graph/src/application/composition-types.ts',
  'packages/graph/src/ports/index.ts',
  'packages/graph/src/adapters/node/index.ts',
  'packages/graph/src/adapters/node/reference-worker-entry.ts',
  'packages/graph/test/composition/reference-engine.test.ts',
  'packages/graph/scripts/check-node-worker-adapter.mjs',
  'packages/graph/scripts/check-packed-package.mjs',
];
const toolRequire = createRequire(path.join(packageRoot, 'package.json'));
const Ajv2020 = toolRequire('ajv/dist/2020').default;

function parseArguments(argv) {
  const options = { allowPending: false, ciEvidence: false, json: false, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allow-pending') options.allowPending = true;
    else if (argument === '--ci-evidence') options.ciEvidence = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--output requires a relative path.');
      options.output = value;
      index += 1;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeRepositoryFile(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return undefined;
  }
  const resolved = path.resolve(repositoryRoot, value);
  return resolved === repositoryRoot || resolved.startsWith(`${repositoryRoot}${path.sep}`)
    ? resolved
    : undefined;
}

function digestFiles(relativePaths) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of [...relativePaths].sort()) {
    const file = safeRepositoryFile(relativePath);
    if (!file || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      throw new Error(`missing or unsafe digest input: ${relativePath}`);
    }
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function outputPath(value) {
  const resolved = safeRepositoryFile(value);
  if (!resolved) throw new Error('--output must be a safe repository-relative path.');
  return resolved;
}

function auditComposition(options) {
  const failures = [];
  const closure = readJson(closurePath);
  const packageManifest = readJson(path.join(packageRoot, 'package.json'));
  const registry = readJson(path.join(repositoryRoot, 'independent-packages.json'));
  const qualityPolicy = readJson(qualityPolicyPath);
  const graphRegistry = registry.packages?.find((entry) => entry.name === packageManifest.name);
  const validateClosure = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  }).compile(readJson(stageSchemaPath));
  if (!validateClosure(closure)) {
    failures.push(
      `G2 closure violates the stage contract: ${JSON.stringify(validateClosure.errors)}`
    );
  }
  if (
    closure.package !== packageManifest.name ||
    closure.stage !== 'G2' ||
    closure.status !== 'local-passed-remote-pending-awaiting-approval' ||
    closure.nextStage !== 'G3' ||
    closure.nextStageAuthorized !== false ||
    closure.approval?.status !== 'awaiting'
  ) {
    failures.push('G2 closure identity or fail-closed approval state drifted');
  }
  if (
    graphRegistry?.currentStage !== 'G2' ||
    graphRegistry?.stageStatus !== 'in-progress' ||
    graphRegistry?.latestClosure !== 'packages/graph/governance/g1-stage-approval.v1.json'
  ) {
    failures.push('Graph registry is not authorized for in-progress G2 work');
  }
  if (packageManifest.private !== true || packageManifest.publishable === true) {
    failures.push('G2 candidate must remain private and non-publishable');
  }
  const requiredDimensions = new Set(
    qualityPolicy.qualityDimensions?.map((dimension) => dimension.id) ?? []
  );
  const observedDimensions = new Set();
  for (const dimension of closure.dimensions ?? []) {
    observedDimensions.add(dimension.id);
    if (
      !requiredDimensions.has(dimension.id) ||
      !['passed', 'pending-remote'].includes(dimension.status)
    ) {
      failures.push(`invalid G2 dimension ${String(dimension.id)}`);
    }
    for (const evidence of dimension.evidence ?? []) {
      const file = safeRepositoryFile(evidence);
      if (!file || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
        failures.push(`unsafe or missing G2 evidence ${String(evidence)}`);
      }
    }
  }
  if (
    observedDimensions.size !== requiredDimensions.size ||
    [...requiredDimensions].some((dimension) => !observedDimensions.has(dimension))
  ) {
    failures.push('G2 closure must report every quality dimension exactly once');
  }
  if (
    closure.measurements?.publicInternalDocuments !== 0 ||
    closure.measurements?.cliRuntimeBridges !== 0 ||
    closure.measurements?.nativeTruthImplementations !== 0
  ) {
    failures.push('G2 closure widened publication, CLI or native truth authority');
  }
  if (options.ciEvidence) {
    if (process.env.GITHUB_ACTIONS !== 'true') failures.push('CI evidence requires GitHub Actions');
    if (process.env.WORKSPAI_PACKAGE_INFRASTRUCTURE_PASSED !== '1') {
      failures.push('CI evidence requires the preceding package-infrastructure pass');
    }
  }
  return {
    schemaVersion: 'workspai-graph-composition-admission-audit.v1',
    generatedAt: new Date().toISOString(),
    package: packageManifest.name,
    version: packageManifest.version,
    stage: 'G2',
    status:
      failures.length > 0 ? 'invalid' : options.ciEvidence ? 'passed-platform' : 'pending-remote',
    admitted: false,
    closureDigest: digestFiles(['packages/graph/governance/g2-stage-closure.v1.json']),
    implementationDigest: digestFiles(implementationPaths),
    implementationPaths,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      osRelease: os.release(),
    },
    ...(options.ciEvidence
      ? {
          platformEvidence: {
            status: failures.length === 0 ? 'passed' : 'failed',
            runnerOs: process.env.RUNNER_OS ?? process.platform,
            runnerArch: process.env.RUNNER_ARCH ?? process.arch,
            prerequisite: 'npm run check:package-infrastructure',
          },
          ci: {
            provider: 'github-actions',
            runId: process.env.GITHUB_RUN_ID ?? 'unknown',
            runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? 'unknown',
            commit: process.env.GITHUB_SHA ?? 'unknown',
            ref: process.env.GITHUB_REF ?? 'unknown',
          },
        }
      : {}),
    failures,
  };
}

let options;
let audit;
try {
  options = parseArguments(process.argv.slice(2));
  audit = auditComposition(options);
  const serialized = `${JSON.stringify(audit, null, 2)}\n`;
  if (options.output) {
    const destination = outputPath(options.output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized, { encoding: 'utf8', mode: 0o600 });
  }
  process.stdout.write(
    options.json
      ? serialized
      : `Graph composition admission: ${audit.status}\nImplementation: ${audit.implementationDigest}\n${audit.failures.map((failure) => `- ${failure}\n`).join('')}`
  );
} catch (error) {
  process.stderr.write(
    `Graph composition admission failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

if (audit) {
  if (audit.status === 'invalid') process.exitCode = 1;
  else if (audit.status === 'pending-remote' && !options.allowPending) process.exitCode = 2;
}
