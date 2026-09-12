import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const realRepositoryRoot = fs.realpathSync(repositoryRoot);
const shaPattern = /^[a-f0-9]{40}$/u;
const runIdPattern = /^[1-9][0-9]*$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const officialRepository = 'chistiq/workspai';
const provenancePredicateType = 'https://slsa.dev/provenance/v1';
const sbomPredicateType = 'https://cyclonedx.org/bom';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function releaseEvidenceDigest(relative, bytes) {
  const hash = crypto.createHash('sha256');
  hash.update(relative);
  hash.update('\0');
  hash.update(bytes);
  hash.update('\0');
  return hash.digest('hex');
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      ![
        '--artifact-directory',
        '--provenance-bundle',
        '--sbom-bundle',
        '--release-candidate',
        '--sbom',
        '--repository',
        '--source-commit',
        '--tested-commit',
        '--run-id',
        '--ref',
        '--output',
      ].includes(name) ||
      !value ||
      value.startsWith('-')
    ) {
      throw new Error(`Invalid or incomplete promotion option: ${String(name)}`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function repositoryPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').includes('..')
  ) {
    throw new Error(`Promotion path must be repository-relative: ${String(value)}`);
  }
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`Promotion path escapes the repository: ${value}`);
  }
  return resolved;
}

function trustedBundlePath(value) {
  const resolved = path.resolve(value);
  const runnerTemp = process.env.RUNNER_TEMP
    ? fs.realpathSync(path.resolve(process.env.RUNNER_TEMP))
    : undefined;
  const allowedRoots = [realRepositoryRoot, runnerTemp].filter(Boolean);
  const real = fs.realpathSync(resolved);
  if (
    !allowedRoots.some((root) => real === root || real.startsWith(`${String(root)}${path.sep}`))
  ) {
    throw new Error('Attestation bundle must be inside the repository or GitHub runner temp');
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {
    throw new Error('Attestation bundle must be a regular non-symlink file');
  }
  return real;
}

function regularFile(file, label, maximumBytes = 16 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  const real = fs.realpathSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > maximumBytes ||
    (real !== realRepositoryRoot && !real.startsWith(`${realRepositoryRoot}${path.sep}`))
  ) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return real;
}

function regularDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  const real = fs.realpathSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (real !== realRepositoryRoot && !real.startsWith(`${realRepositoryRoot}${path.sep}`))
  ) {
    throw new Error(`${label} must be a repository-owned non-symlink directory`);
  }
  return real;
}

export function buildVerificationArguments({
  artifact,
  bundle,
  repository,
  testedCommit,
  predicateType,
}) {
  return [
    'attestation',
    'verify',
    artifact,
    '--bundle',
    bundle,
    '--repo',
    repository,
    '--signer-workflow',
    `${repository}/.github/workflows/ci.yml`,
    '--signer-digest',
    testedCommit,
    '--source-digest',
    testedCommit,
    '--source-ref',
    'refs/heads/main',
    '--predicate-type',
    predicateType,
    '--deny-self-hosted-runners',
    '--format',
    'json',
  ];
}

function verifiedStatement(
  result,
  expectedPredicateType,
  artifactName,
  artifactDigest,
  failures,
  label
) {
  if (!Array.isArray(result) || result.length !== 1) {
    failures.push(`${label} verification must return exactly one attestation`);
    return undefined;
  }
  const verification = result[0]?.verificationResult;
  const statement = verification?.statement;
  if (
    !statement ||
    statement._type !== 'https://in-toto.io/Statement/v1' ||
    statement.predicateType !== expectedPredicateType
  ) {
    failures.push(`${label} verification returned the wrong predicate type`);
    return undefined;
  }
  if (
    !Array.isArray(verification.verifiedTimestamps) ||
    verification.verifiedTimestamps.length === 0
  ) {
    failures.push(`${label} attestation has no verified transparency or timestamp witness`);
  }
  if (
    !Array.isArray(statement.subject) ||
    statement.subject.length !== 1 ||
    statement.subject[0]?.name !== artifactName ||
    statement.subject[0]?.digest?.sha256 !== artifactDigest
  ) {
    failures.push(`${label} attestation is not bound to the exact packed artifact`);
  }
  return statement;
}

export function evaluatePromotionEvidence({
  releaseCandidate,
  committedSbom,
  provenanceVerification,
  sbomVerification,
  artifactName,
  artifactDigest,
  committedSbomEvidenceDigest,
  sourceCommit,
  testedCommit,
  runId,
}) {
  const failures = [];
  const requiredPlatforms = ['Linux', 'Windows', 'macOS'];
  const evidence = Array.isArray(releaseCandidate?.evidence) ? releaseCandidate.evidence : [];
  const observedPlatforms = evidence.map((entry) => entry.runnerOs).sort();
  if (
    releaseCandidate?.schemaVersion !== 'workspai-graph-g7-release-matrix.v1' ||
    releaseCandidate?.stage !== 'G7' ||
    releaseCandidate?.status !== 'verified-release-candidate' ||
    releaseCandidate?.candidatePassed !== true ||
    releaseCandidate?.admitted !== false ||
    releaseCandidate?.standaloneStable !== false ||
    releaseCandidate?.provenance !== 'unattested' ||
    releaseCandidate?.nextStageAuthorized !== false ||
    !Array.isArray(releaseCandidate?.failures) ||
    releaseCandidate.failures.length !== 0 ||
    JSON.stringify(releaseCandidate?.requiredRunnerOperatingSystems) !==
      JSON.stringify(requiredPlatforms) ||
    JSON.stringify(observedPlatforms) !== JSON.stringify(requiredPlatforms) ||
    !evidence.every((entry) => digestPattern.test(entry.digest ?? '')) ||
    ![
      releaseCandidate?.g6CandidateDigest,
      releaseCandidate?.planDigest,
      releaseCandidate?.closureDigest,
      releaseCandidate?.inventoryDigest,
      releaseCandidate?.sbomDigest,
      releaseCandidate?.releaseInputsDigest,
    ].every((digest) => digestPattern.test(digest ?? ''))
  ) {
    failures.push('G7 release candidate is invalid or overclaims admission');
  }
  if (releaseCandidate?.sbomDigest !== `sha256:${committedSbomEvidenceDigest}`) {
    failures.push('G7 release candidate is not bound to the committed CycloneDX snapshot');
  }
  if (
    committedSbom?.bomFormat !== 'CycloneDX' ||
    committedSbom?.specVersion !== '1.6' ||
    !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-(?:[1-5]|8)[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      committedSbom?.serialNumber ?? ''
    )
  ) {
    failures.push('committed Graph SBOM is not a valid identity-bearing CycloneDX 1.6 document');
  }
  if (
    releaseCandidate?.sourceCommit !== sourceCommit ||
    releaseCandidate?.testedCommit !== testedCommit ||
    sourceCommit !== testedCommit ||
    evidence.some((entry) => entry.runId !== runId) ||
    evidence.length !== 3
  ) {
    failures.push('Promotion requires one exact main-branch commit and same-run platform evidence');
  }
  const provenanceStatement = verifiedStatement(
    provenanceVerification,
    provenancePredicateType,
    artifactName,
    artifactDigest,
    failures,
    'provenance'
  );
  const sbomStatement = verifiedStatement(
    sbomVerification,
    sbomPredicateType,
    artifactName,
    artifactDigest,
    failures,
    'SBOM'
  );
  if (provenanceStatement?.predicate?.buildDefinition?.buildType === undefined) {
    failures.push('provenance attestation has no SLSA build definition');
  }
  if (!isDeepStrictEqual(sbomStatement?.predicate, committedSbom)) {
    failures.push('verified SBOM predicate differs from the committed CycloneDX snapshot');
  }
  return { failures, promotionQualified: failures.length === 0 };
}

function verifyWithGh({ artifact, bundle, repository, testedCommit, predicateType }) {
  const arguments_ = buildVerificationArguments({
    artifact,
    bundle,
    repository,
    testedCommit,
    predicateType,
  });
  const result = spawnSync('gh', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `gh attestation verification failed for ${predicateType}: ${result.stderr || result.error?.message || 'unknown error'}`
    );
  }
  return JSON.parse(result.stdout);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.repository !== officialRepository) {
    throw new Error(`Promotion is restricted to ${officialRepository}`);
  }
  if (
    !shaPattern.test(options['source-commit'] ?? '') ||
    !shaPattern.test(options['tested-commit'] ?? '')
  ) {
    throw new Error('Promotion commits must be full lowercase Git SHAs');
  }
  if (!runIdPattern.test(options['run-id'] ?? '')) throw new Error('GitHub run ID is invalid');
  if (options.ref !== 'refs/heads/main') throw new Error('Promotion is restricted to main');

  const artifactDirectory = regularDirectory(
    repositoryPath(options['artifact-directory']),
    'Graph artifact directory'
  );
  const artifacts = fs
    .readdirSync(artifactDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.tgz'));
  if (artifacts.length !== 1)
    throw new Error('Promotion requires exactly one packed Graph artifact');
  const artifact = regularFile(
    path.join(artifactDirectory, artifacts[0].name),
    'Graph artifact',
    1024 * 1024
  );
  const packageManifest = JSON.parse(
    fs.readFileSync(repositoryPath('packages/graph/package.json'), 'utf8')
  );
  const expectedArtifactName = `${packageManifest.name
    .replace(/^@/u, '')
    .replace('/', '-')}-${packageManifest.version}.tgz`;
  if (path.basename(artifact) !== expectedArtifactName) {
    throw new Error(`Packed Graph artifact identity drifted: expected ${expectedArtifactName}`);
  }
  const releaseCandidatePath = regularFile(
    repositoryPath(options['release-candidate']),
    'G7 release candidate',
    1024 * 1024
  );
  const sbomPath = regularFile(repositoryPath(options.sbom), 'committed Graph SBOM');
  const provenanceBundle = trustedBundlePath(options['provenance-bundle']);
  const sbomBundle = trustedBundlePath(options['sbom-bundle']);
  const artifactDigest = sha256(fs.readFileSync(artifact));
  const releaseCandidate = JSON.parse(fs.readFileSync(releaseCandidatePath, 'utf8'));
  const committedSbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
  const committedSbomBytes = fs.readFileSync(sbomPath);
  const committedSbomDigest = sha256(committedSbomBytes);
  const committedSbomEvidenceDigest = releaseEvidenceDigest(options.sbom, committedSbomBytes);
  const provenanceVerification = verifyWithGh({
    artifact,
    bundle: provenanceBundle,
    repository: options.repository,
    testedCommit: options['tested-commit'],
    predicateType: provenancePredicateType,
  });
  const sbomVerification = verifyWithGh({
    artifact,
    bundle: sbomBundle,
    repository: options.repository,
    testedCommit: options['tested-commit'],
    predicateType: sbomPredicateType,
  });
  const evaluation = evaluatePromotionEvidence({
    releaseCandidate,
    committedSbom,
    provenanceVerification,
    sbomVerification,
    artifactName: path.basename(artifact),
    artifactDigest,
    committedSbomEvidenceDigest,
    sourceCommit: options['source-commit'],
    testedCommit: options['tested-commit'],
    runId: options['run-id'],
  });
  const report = {
    schemaVersion: 'workspai-graph-g7-promotion-evidence.v1',
    generatedAt: new Date().toISOString(),
    package: '@workspai/graph',
    version: packageManifest.version,
    distribution: 'internal-only',
    repository: options.repository,
    ref: options.ref,
    sourceCommit: options['source-commit'],
    testedCommit: options['tested-commit'],
    runId: options['run-id'],
    status: evaluation.promotionQualified ? 'verified-promotion-evidence' : 'blocked',
    promotionQualified: evaluation.promotionQualified,
    admitted: false,
    standaloneStable: false,
    nextStage: 'G8',
    nextStageAuthorized: false,
    artifact: { name: path.basename(artifact), digest: `sha256:${artifactDigest}` },
    releaseCandidateDigest: `sha256:${sha256(fs.readFileSync(releaseCandidatePath))}`,
    sbom: {
      contentDigest: `sha256:${committedSbomDigest}`,
      releaseEvidenceDigest: `sha256:${committedSbomEvidenceDigest}`,
    },
    attestationBundles: {
      provenance: `sha256:${sha256(fs.readFileSync(provenanceBundle))}`,
      sbom: `sha256:${sha256(fs.readFileSync(sbomBundle))}`,
    },
    verificationPolicy: {
      repository: officialRepository,
      signerWorkflow: `${officialRepository}/.github/workflows/ci.yml`,
      signerDigest: options['tested-commit'],
      sourceDigest: options['tested-commit'],
      sourceRef: 'refs/heads/main',
      denySelfHostedRunners: true,
      provenancePredicateType,
      sbomPredicateType,
    },
    failures: evaluation.failures,
  };
  const output = repositoryPath(options.output);
  const outputParent = path.dirname(output);
  fs.mkdirSync(outputParent, { recursive: true });
  regularDirectory(outputParent, 'Promotion output directory');
  if (fs.existsSync(output)) {
    const outputStat = fs.lstatSync(output);
    if (!outputStat.isFile() || outputStat.isSymbolicLink()) {
      throw new Error('Promotion output must not replace a symlink or non-file entry');
    }
  }
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!evaluation.promotionQualified) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
