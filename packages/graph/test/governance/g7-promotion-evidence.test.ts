import { describe, expect, it } from 'vitest';

// @ts-expect-error Package governance scripts intentionally remain uncompiled JavaScript.
import * as promotionEvidence from '../../scripts/check-g7-promotion-evidence.mjs';

const { buildVerificationArguments, evaluatePromotionEvidence } = promotionEvidence;

const sourceCommit = 'a'.repeat(40);
const runId = '123456';
const artifactDigest = 'b'.repeat(64);
const artifactName = 'workspai-graph.tgz';
const committedSbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: 'urn:uuid:12345678-1234-4234-8234-123456789abc',
  version: 1,
};
const committedSbomEvidenceDigest = '1'.repeat(64);

function releaseCandidate() {
  const digest = `sha256:${'1'.repeat(64)}`;
  return {
    schemaVersion: 'workspai-graph-g7-release-matrix.v1',
    stage: 'G7',
    status: 'verified-release-candidate',
    candidatePassed: true,
    admitted: false,
    standaloneStable: false,
    provenance: 'unattested',
    nextStageAuthorized: false,
    sourceCommit,
    testedCommit: sourceCommit,
    requiredRunnerOperatingSystems: ['Linux', 'Windows', 'macOS'],
    g6CandidateDigest: digest,
    planDigest: digest,
    closureDigest: digest,
    inventoryDigest: digest,
    sbomDigest: `sha256:${committedSbomEvidenceDigest}`,
    releaseInputsDigest: digest,
    evidence: ['Linux', 'macOS', 'Windows'].map((runnerOs) => ({
      runnerOs,
      runId,
      digest,
    })),
    failures: [],
  };
}

function verification(predicateType: string, predicate: unknown, digest = artifactDigest) {
  return [
    {
      verificationResult: {
        verifiedTimestamps: [{ type: 'rekor' }],
        statement: {
          _type: 'https://in-toto.io/Statement/v1',
          subject: [{ name: artifactName, digest: { sha256: digest } }],
          predicateType,
          predicate,
        },
      },
    },
  ];
}

function validInput() {
  return {
    releaseCandidate: releaseCandidate(),
    committedSbom,
    provenanceVerification: verification('https://slsa.dev/provenance/v1', {
      buildDefinition: { buildType: 'https://actions.github.io/buildtypes/workflow/v1' },
    }),
    sbomVerification: verification('https://cyclonedx.org/bom', committedSbom),
    artifactName,
    artifactDigest,
    committedSbomEvidenceDigest,
    sourceCommit,
    testedCommit: sourceCommit,
    runId,
  };
}

describe('Graph G7 promotion evidence', () => {
  it('pins gh verification to repository, workflow, commit, predicate and hosted runners', () => {
    expect(
      buildVerificationArguments({
        artifact: '/tmp/graph.tgz',
        bundle: '/tmp/provenance.jsonl',
        repository: 'chistiq/workspai',
        testedCommit: sourceCommit,
        predicateType: 'https://slsa.dev/provenance/v1',
      })
    ).toEqual([
      'attestation',
      'verify',
      '/tmp/graph.tgz',
      '--bundle',
      '/tmp/provenance.jsonl',
      '--repo',
      'chistiq/workspai',
      '--signer-workflow',
      'chistiq/workspai/.github/workflows/ci.yml',
      '--signer-digest',
      sourceCommit,
      '--source-digest',
      sourceCommit,
      '--source-ref',
      'refs/heads/main',
      '--predicate-type',
      'https://slsa.dev/provenance/v1',
      '--deny-self-hosted-runners',
      '--format',
      'json',
    ]);
  });

  it('qualifies exact main-commit provenance and CycloneDX evidence without admitting G8', () => {
    expect(evaluatePromotionEvidence(validInput())).toEqual({
      failures: [],
      promotionQualified: true,
    });
  });

  it('rejects an artifact digest substitution', () => {
    const input = validInput();
    input.sbomVerification = verification(
      'https://cyclonedx.org/bom',
      committedSbom,
      'c'.repeat(64)
    );
    expect(evaluatePromotionEvidence(input)).toMatchObject({
      promotionQualified: false,
      failures: expect.arrayContaining([
        'SBOM attestation is not bound to the exact packed artifact',
      ]),
    });
  });

  it('rejects a signed but different SBOM and a cross-commit candidate', () => {
    const input = validInput();
    input.sbomVerification = verification('https://cyclonedx.org/bom', {
      ...committedSbom,
      version: 2,
    });
    input.testedCommit = 'd'.repeat(40);
    expect(evaluatePromotionEvidence(input)).toMatchObject({
      promotionQualified: false,
      failures: expect.arrayContaining([
        'Promotion requires one exact main-branch commit and same-run platform evidence',
        'verified SBOM predicate differs from the committed CycloneDX snapshot',
      ]),
    });
  });

  it('rejects candidate-to-SBOM digest drift before promotion', () => {
    const input = validInput();
    input.releaseCandidate.sbomDigest = `sha256:${'f'.repeat(64)}`;
    expect(evaluatePromotionEvidence(input)).toMatchObject({
      promotionQualified: false,
      failures: expect.arrayContaining([
        'G7 release candidate is not bound to the committed CycloneDX snapshot',
      ]),
    });
  });

  it('rejects ambiguous attestations and missing transparency evidence', () => {
    const input = validInput();
    input.provenanceVerification = [
      ...input.provenanceVerification,
      ...input.provenanceVerification,
    ];
    input.sbomVerification[0].verificationResult.verifiedTimestamps = [];
    expect(evaluatePromotionEvidence(input)).toMatchObject({
      promotionQualified: false,
      failures: expect.arrayContaining([
        'provenance verification must return exactly one attestation',
        'SBOM attestation has no verified transparency or timestamp witness',
      ]),
    });
  });
});
