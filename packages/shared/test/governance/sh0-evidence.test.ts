import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, relativePath), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('@workspai/shared SH0 governance', () => {
  it('keeps public and machine evidence present without duplicating maintainer docs', () => {
    const requiredEvidence = [
      'governance/shared-package-gates.v1.json',
      'governance/cli-bridgeability-fixtures.v1.json',
      'governance/semantic-lock-decisions.v1.json',
      'governance/sh2-stabilization-report.v1.json',
      'governance/sh3a-stabilization-report.v1.json',
      'governance/sh3b-stabilization-report.v1.json',
      'governance/sh3c-stabilization-report.v1.json',
      'governance/sh4-internal-consumers.v1.json',
      'governance/sh4-stabilization-report.v1.json',
      'governance/sh5-external-validation.v1.json',
      'governance/sh5-stabilization-report.v1.json',
      'governance/sh6-domain-adoption.v1.json',
      'governance/sh6-stabilization-report.v1.json',
      'governance/sh7-standalone-admission.v1.json',
      'governance/sh7-external-consumer-evidence-policy.v1.json',
      'governance/sh7-stabilization-report.v1.json',
    ];
    const manifest = readJson('package.json') as { files?: string[] };

    for (const relativePath of requiredEvidence) {
      expect(fs.existsSync(path.join(packageRoot, relativePath)), relativePath).toBe(true);
    }
    expect(manifest.files).not.toContain('docs');
    expect(manifest.files).not.toContain('governance');
    expect(fs.existsSync(path.join(packageRoot, 'docs'))).toBe(false);
  });

  it('retains the approved SH3-A closure while SH3-B is active', () => {
    const report = readJson('governance/sh3a-stabilization-report.v1.json') as {
      schemaVersion?: string;
      status?: string;
      advancesAdmissionGate?: boolean;
      nextStage?: string;
      nextStageAuthorized?: boolean;
      dimensions?: Array<{ id?: string; status?: string }>;
      measurements?: { portfolioDigest?: string };
      approval?: { status?: string };
    };

    expect(report).toMatchObject({
      schemaVersion: 'workspai-independent-package-stage-closure.v1',
      status: 'approved',
      advancesAdmissionGate: false,
      nextStage: 'SH3-B',
      nextStageAuthorized: true,
      approval: { status: 'approved' },
    });
    expect(report.measurements?.portfolioDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.dimensions).toHaveLength(12);
    expect(
      report.dimensions?.find((dimension) => dimension.id === 'package-independence')
    ).toMatchObject({ status: 'passed' });
  });

  it('keeps SH1 review-pending until normative sources and unresolved questions close', () => {
    const semanticLock = readJson('governance/semantic-lock-decisions.v1.json') as {
      status?: string;
      normativeSources?: Array<{ id?: string; status?: string }>;
      decisions?: Array<{ id?: string; subject?: string; decision?: unknown }>;
      unresolved?: string[];
      admissionRule?: string;
    };

    expect(semanticLock.status).toBe('review-pending');
    expect(semanticLock.normativeSources).toEqual([
      { id: 'WIS-RFC-0001', status: 'proposed-ready-for-maintainer-review' },
      { id: 'WIS-RFC-0002', status: 'proposed-ready-for-maintainer-review' },
    ]);
    expect(semanticLock.decisions?.map((decision) => decision.id)).toEqual([
      'SL-001',
      'SL-002',
      'SL-003',
      'SL-004',
      'SL-005',
      'SL-006',
      'SL-007',
      'SL-008',
      'SL-009',
      'SL-010',
    ]);
    expect(semanticLock.unresolved?.length).toBeGreaterThanOrEqual(5);
    expect(semanticLock.admissionRule).toContain('SH1 cannot pass');
  });

  it('defines bounded, redacted bridgeability fixtures without claiming capture', () => {
    const fixtureManifest = readJson('governance/cli-bridgeability-fixtures.v1.json') as {
      status?: string;
      capturePolicy?: Record<string, string>;
      cases?: Array<{
        id?: string;
        family?: string;
        source?: string;
        requiredOutcomes?: string[];
      }>;
    };

    expect(fixtureManifest.status).toBe('manifest-only');
    expect(fixtureManifest.capturePolicy?.network).toBe('forbidden');
    expect(fixtureManifest.capturePolicy?.absolutePaths).toBe(
      'replace-with-logical-scope-and-portable-relative-path'
    );
    expect(fixtureManifest.cases?.length).toBeGreaterThanOrEqual(8);
    expect(
      fixtureManifest.cases?.every(
        (fixtureCase) =>
          Boolean(fixtureCase.id) &&
          Boolean(fixtureCase.family) &&
          (fixtureCase.requiredOutcomes?.length ?? 0) > 0
      )
    ).toBe(true);
    for (const fixtureCase of fixtureManifest.cases ?? []) {
      expect(fixtureCase.source, fixtureCase.id).toBeTruthy();
      expect(
        fs.existsSync(path.join(repositoryRoot, fixtureCase.source ?? '')),
        fixtureCase.id
      ).toBe(true);
    }
  });

  it('reports candidate evidence without claiming stability or CLI integration', () => {
    const gates = readJson('governance/shared-package-gates.v1.json') as {
      currentGate?: string;
      publishable?: boolean;
      cliRuntimeIntegration?: string;
      gates?: Array<{ id?: string; status?: string; requiredEvidence?: string[] }>;
      blockers?: string[];
    };

    expect(gates.currentGate).toBe('SH0');
    expect(gates.publishable).toBe(false);
    expect(gates.cliRuntimeIntegration).toBe('prohibited-before-standalone-stability');
    expect(gates.gates?.find((gate) => gate.id === 'SH0')?.status).toBe('candidate-evidence');
    expect(gates.gates?.find((gate) => gate.id === 'SH7')?.status).toBe('blocked');
    expect(gates.blockers?.length).toBeGreaterThanOrEqual(6);
    for (const gate of gates.gates ?? []) {
      for (const relativePath of gate.requiredEvidence ?? []) {
        expect(
          fs.existsSync(path.join(packageRoot, relativePath)),
          `${gate.id}:${relativePath}`
        ).toBe(true);
      }
    }
  });

  it('records explicit, bounded approval before the next stage starts', () => {
    const report = readJson('governance/sh2-stabilization-report.v1.json') as {
      status?: string;
      advancesAdmissionGate?: boolean;
      nextStage?: string;
      nextStageAuthorized?: boolean;
      remainingAdmissionBlockers?: string[];
    };

    expect(report).toMatchObject({
      status: 'local-passed-stage-approved-remote-ci-pending',
      advancesAdmissionGate: false,
      nextStage: 'SH3',
      nextStageAuthorized: true,
    });
    expect(report.remainingAdmissionBlockers?.length).toBeGreaterThanOrEqual(5);
  });

  it('remains a runtime dependency leaf', () => {
    const manifest = readJson('package.json') as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.optionalDependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });
});
