import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error Package governance scripts intentionally remain uncompiled JavaScript.
import * as finalization from '../../scripts/finalize-g7-standalone-admission.mjs';

const { evaluateAdmissionTransition } = finalization;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const temporary: string[] = [];
const digest = `sha256:${'a'.repeat(64)}`;
const commit = 'b'.repeat(40);

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function validInput() {
  const gateIds = [
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
  ];
  return {
    promotion: {
      schemaVersion: 'workspai-graph-g7-promotion-evidence.v1',
      package: '@workspai/graph',
      version: '0.0.0-development',
      distribution: 'internal-only',
      repository: 'chistiq/workspai',
      ref: 'refs/heads/main',
      sourceCommit: commit,
      testedCommit: commit,
      runId: '123456',
      status: 'verified-promotion-evidence',
      promotionQualified: true,
      admitted: false,
      standaloneStable: false,
      nextStageAuthorized: false,
      artifact: { name: 'workspai-graph-0.0.0-development.tgz', digest },
      releaseCandidateDigest: digest,
      sbom: { contentDigest: digest, releaseEvidenceDigest: digest },
      attestationBundles: { provenance: digest, sbom: digest },
      verificationPolicy: {
        repository: 'chistiq/workspai',
        signerWorkflow: 'chistiq/workspai/.github/workflows/ci.yml',
        signerDigest: commit,
        sourceDigest: commit,
        sourceRef: 'refs/heads/main',
        denySelfHostedRunners: true,
        provenancePredicateType: 'https://slsa.dev/provenance/v1',
        sbomPredicateType: 'https://cyclonedx.org/bom',
      },
      failures: [],
    },
    ledger: {
      schemaVersion: 'workspai-graph-standalone-admission.v1',
      status: 'blocked',
      admitted: false,
      standaloneStable: false,
      distribution: 'internal-only',
      npmPublication: 'prohibited',
      nextStage: 'G8',
      nextStageAuthorized: false,
      gates: gateIds.map((id) => ({
        id,
        status: [
          'cross-platform-release-evidence',
          'internal-promotion-and-rollback-proof',
        ].includes(id)
          ? 'pending-remote'
          : id === 'central-cli-bridge-absence'
            ? 'passed'
            : 'passed-local',
      })),
    },
    graphManifest: {
      name: '@workspai/graph',
      version: '0.0.0-development',
      private: true,
      dependencies: { '@workspai/shared': '0.0.0-development' },
      scripts: { prepublishOnly: 'node scripts/refuse-publish.mjs' },
    },
    sharedManifest: { name: '@workspai/shared', version: '0.0.0-development', private: true },
    lockedShared: { name: '@workspai/shared', version: '0.0.0-development' },
    graphRegistry: {
      currentStage: 'G5',
      standaloneStability: 'not-admitted',
      cliRuntimeIntegration: 'prohibited-before-standalone-stability',
    },
    migrationPolicy: {
      status: 'defined-unactivated',
      migration: { nextMode: 'g8-shadow-comparison' },
      rollback: { target: 'official-internal-graph-capability' },
      promotion: { requiresProtectedMainPush: true, npmPublication: 'prohibited' },
    },
  };
}

describe('Graph G7 standalone admission finalization', () => {
  it('admits only the exact main-run promotion transition', () => {
    expect(evaluateAdmissionTransition(validInput())).toEqual({ admitted: true, failures: [] });
  });

  it('rejects a feature-branch or self-hosted promotion proof', () => {
    const input = validInput();
    input.promotion.ref = 'refs/heads/feature/graph';
    input.promotion.verificationPolicy.denySelfHostedRunners = false;
    expect(evaluateAdmissionTransition(input)).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'G7 promotion evidence is incomplete, unqualified or overclaims admission',
        'G7 promotion evidence does not enforce the required attestation identity',
      ]),
    });
  });

  it('rejects a blocked local gate or pre-existing CLI integration', () => {
    const input = validInput();
    input.ledger.gates[0].status = 'blocked';
    input.graphRegistry.cliRuntimeIntegration = 'enabled';
    expect(evaluateAdmissionTransition(input)).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'G7 gate cannot transition from version-1-standalone-jobs:blocked',
        'G7 transition requires the existing registry and CLI bridge to remain fail-closed',
      ]),
    });
  });

  it('rejects artifact substitution and Shared lock drift', () => {
    const input = validInput();
    input.promotion.artifact.name = 'different.tgz';
    input.lockedShared.version = '0.0.1';
    expect(evaluateAdmissionTransition(input)).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'G7 package or exact private Shared runtime identity drifted',
      ]),
    });
  });

  it('emits an internal shadow-only decision without rewriting the source ledger', () => {
    const resultRoot = path.join(packageRoot, 'test-results');
    fs.mkdirSync(resultRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(resultRoot, 'g7-admission-finalization-'));
    temporary.push(directory);
    const promotionPath = path.join(directory, 'promotion.json');
    const outputPath = path.join(directory, 'decision.json');
    fs.writeFileSync(promotionPath, JSON.stringify(validInput().promotion));
    const portable = (target: string): string =>
      path.relative(repositoryRoot, target).split(path.sep).join(path.posix.sep);

    const result = spawnSync(
      process.execPath,
      [
        'scripts/finalize-g7-standalone-admission.mjs',
        '--promotion-evidence',
        portable(promotionPath),
        '--output',
        portable(outputPath),
      ],
      { cwd: packageRoot, encoding: 'utf8' }
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toMatchObject({
      status: 'admitted',
      admitted: true,
      standaloneStable: true,
      nextStage: 'G8',
      nextStageAuthorized: true,
      authorizedRuntimeMode: 'g8-shadow-comparison-only',
      currentGraphAuthority: 'official-internal-graph-capability',
      npmPublication: 'prohibited',
      failures: [],
    });
  });
});
