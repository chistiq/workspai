import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const closurePath = path.join(packageRoot, 'governance/g1-stage-closure.v1.json');
const catalogPath = path.join(packageRoot, 'conformance/contract-catalog.v1.json');
const stageClosureSchemaPath = path.join(
  repositoryRoot,
  'contracts/independent-package-stage-closure.v1.json'
);
const qualityPolicyPath = path.join(repositoryRoot, 'independent-package-quality-policy.v1.json');
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

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeRepositoryFile(value) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) return undefined;
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    return undefined;
  }
  return resolved;
}

function existingRepositoryFile(value) {
  const resolved = safeRepositoryFile(value);
  return resolved && fs.existsSync(resolved) && fs.lstatSync(resolved).isFile()
    ? resolved
    : undefined;
}

function outputPath(value) {
  const resolved = safeRepositoryFile(value);
  if (!resolved) throw new Error('--output must be a safe repository-relative path.');
  return resolved;
}

function auditFoundation(options) {
  const failures = [];
  const closure = readJson(closurePath);
  const catalog = readJson(catalogPath);
  const stageClosureSchema = readJson(stageClosureSchemaPath);
  const qualityPolicy = readJson(qualityPolicyPath);
  const packageManifest = readJson(path.join(packageRoot, 'package.json'));
  const schemas = fs
    .readdirSync(path.join(packageRoot, 'schemas'))
    .filter((entry) => entry.endsWith('.schema.json'))
    .sort();

  if (closure.schemaVersion !== 'workspai-independent-package-stage-closure.v1') {
    failures.push('unsupported G1 closure schema');
  }
  if (closure.package !== packageManifest.name || closure.stage !== 'G1') {
    failures.push('G1 closure package identity drifted');
  }
  let validateClosure;
  try {
    validateClosure = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: false,
    }).compile(stageClosureSchema);
  } catch (error) {
    failures.push(
      `stage closure schema does not compile: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (validateClosure && !validateClosure(closure)) {
    failures.push(
      `G1 closure violates the shared stage contract: ${JSON.stringify(validateClosure.errors)}`
    );
  }
  if (
    closure.status !== 'local-passed-remote-pending-awaiting-approval' ||
    closure.nextStageAuthorized !== false ||
    closure.approval?.status !== 'awaiting' ||
    closure.environment?.remoteMatrix !== 'pending'
  ) {
    failures.push('G1 must remain review-pending until retained cross-platform evidence exists');
  }
  if (packageManifest.private !== true)
    failures.push('review-pending Graph package must be private');
  if (packageManifest.scripts?.prepublishOnly !== 'node scripts/refuse-publish.mjs') {
    failures.push('review-pending Graph package lost its refusing publication guard');
  }
  if (!Array.isArray(closure.dimensions) || closure.dimensions.length === 0) {
    failures.push('G1 closure has no permanent quality dimensions');
  }
  const dimensionIds = new Set();
  const requiredDimensionIds = new Set(
    (qualityPolicy.qualityDimensions ?? []).map((dimension) => dimension.id)
  );
  for (const dimension of closure.dimensions ?? []) {
    if (
      typeof dimension.id !== 'string' ||
      dimensionIds.has(dimension.id) ||
      !requiredDimensionIds.has(dimension.id) ||
      !['passed', 'pending-remote'].includes(dimension.status)
    ) {
      failures.push(`invalid G1 dimension: ${String(dimension.id)}`);
    }
    dimensionIds.add(dimension.id);
    if (!Array.isArray(dimension.evidence) || dimension.evidence.length === 0) {
      failures.push(`G1 dimension has no evidence: ${String(dimension.id)}`);
      continue;
    }
    for (const evidence of dimension.evidence) {
      const file = existingRepositoryFile(evidence);
      if (!file) {
        failures.push(`unsafe or missing G1 evidence: ${String(evidence)}`);
      }
    }
  }
  if (
    dimensionIds.size !== requiredDimensionIds.size ||
    [...requiredDimensionIds].some((id) => !dimensionIds.has(id))
  ) {
    failures.push('G1 closure does not report every permanent quality dimension exactly once');
  }
  if (!Array.isArray(catalog.contracts) || catalog.contracts.length !== schemas.length) {
    failures.push('schema catalog count does not match packaged schemas');
  }
  if (closure.measurements?.candidateSchemas !== schemas.length) {
    failures.push('G1 closure schema measurement drifted');
  }
  for (const entry of catalog.contracts ?? []) {
    const file = safeRepositoryFile(`packages/graph/${String(entry.file)}`);
    if (!file || !fs.existsSync(file) || digestFile(file) !== entry.sha256) {
      failures.push(`catalog digest drifted: ${String(entry.id)}`);
    }
  }
  if (closure.measurements?.publicInternalDocuments !== 0) {
    failures.push('G1 closure reports internal documentation in the public artifact');
  }
  if (closure.measurements?.cliRuntimeBridges !== 0) {
    failures.push('G1 closure reports a premature CLI runtime bridge');
  }
  if (closure.measurements?.nativeTruthImplementations !== 0) {
    failures.push('G1 closure reports a premature native truth implementation');
  }

  let platformEvidence;
  if (options.ciEvidence) {
    if (process.env.GITHUB_ACTIONS !== 'true') {
      failures.push('--ci-evidence is valid only inside GitHub Actions');
    }
    if (process.env.WORKSPAI_PACKAGE_INFRASTRUCTURE_PASSED !== '1') {
      failures.push('platform evidence requires the preceding package-infrastructure pass');
    }
    platformEvidence = {
      status: failures.length === 0 ? 'passed' : 'failed',
      runnerOs: process.env.RUNNER_OS ?? process.platform,
      runnerArch: process.env.RUNNER_ARCH ?? process.arch,
      prerequisite: 'npm run check:package-infrastructure',
    };
  }

  return {
    schemaVersion: 'workspai-graph-foundation-admission-audit.v1',
    generatedAt: new Date().toISOString(),
    package: packageManifest.name,
    version: packageManifest.version,
    stage: 'G1',
    status:
      failures.length > 0 ? 'invalid' : options.ciEvidence ? 'passed-platform' : 'pending-remote',
    admitted: false,
    contractCatalog: {
      count: schemas.length,
      digest: `sha256:${digestFile(catalogPath)}`,
    },
    closureDigest: `sha256:${digestFile(closurePath)}`,
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
  return (
    [
      `Graph foundation admission: ${audit.status}`,
      `Contracts: ${audit.contractCatalog.count}; catalog: ${audit.contractCatalog.digest}`,
      ...audit.failures.map((failure) => `- ${failure}`),
    ].join('\n') + '\n'
  );
}

let options;
let audit;
try {
  options = parseArguments(process.argv.slice(2));
  audit = auditFoundation(options);
  const serialized = `${JSON.stringify(audit, null, 2)}\n`;
  if (options.output) {
    const destination = outputPath(options.output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized, { encoding: 'utf8', mode: 0o600 });
  }
  process.stdout.write(options.json ? serialized : renderHuman(audit));
} catch (error) {
  process.stderr.write(
    `Graph foundation admission audit failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

if (audit) {
  if (audit.status === 'invalid') process.exitCode = 1;
  else if (audit.status === 'pending-remote' && !options.allowPending) process.exitCode = 2;
}
