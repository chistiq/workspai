import { describe, expect, it } from 'vitest';

import {
  assertDoctorEvidenceSemanticInvariants,
  isDoctorEvidencePayloadCompatible,
} from '../utils/doctor-evidence-contract.js';
import { buildDoctorDiagnosis } from '../doctor/diagnosis-engine.js';

function validEvidence(): Record<string, unknown> {
  return {
    schemaVersion: 'doctor-project-evidence-v1',
    evidenceType: 'project',
    healthScore: {
      total: 2,
      passed: 1,
      warnings: 0,
      errors: 1,
      verdict: 'blocked',
    },
    project: {
      verdict: 'blocked',
      issues: [],
      probes: [
        { id: 'dependency', status: 'pass' },
        { id: 'security', status: 'fail' },
      ],
      probeSummary: {
        total: 2,
        passed: 1,
        warnings: 0,
        failed: 1,
        blockingFindings: 1,
        advisoryFindings: 0,
        verdict: 'blocked',
      },
    },
  };
}

describe('Doctor evidence semantic invariants', () => {
  it('rejects arbitrary schema-less objects at the Doctor trust boundary', () => {
    expect(isDoctorEvidencePayloadCompatible({}, 'workspace')).toBe(false);
    expect(isDoctorEvidencePayloadCompatible({ evidenceType: 'workspace' }, 'workspace')).toBe(
      false
    );
    expect(isDoctorEvidencePayloadCompatible({ schemaVersion: 1, projects: [] }, 'workspace')).toBe(
      false
    );
    expect(isDoctorEvidencePayloadCompatible({ evidenceType: 1, projects: [] }, 'workspace')).toBe(
      false
    );
    expect(isDoctorEvidencePayloadCompatible({ projects: [] }, 'workspace')).toBe(true);
    expect(isDoctorEvidencePayloadCompatible({ project: { name: 'api' } }, 'project')).toBe(true);
  });

  it('accepts internally consistent blocked evidence', () => {
    expect(() => assertDoctorEvidenceSemanticInvariants(validEvidence())).not.toThrow();
  });

  it('rejects a score total that does not equal its components', () => {
    const evidence = validEvidence();
    (evidence.healthScore as Record<string, unknown>).total = 99;
    expect(() => assertDoctorEvidenceSemanticInvariants(evidence)).toThrow(
      /total must equal passed \+ warnings \+ errors/
    );
  });

  it('rejects a passing verdict when score counts contain errors', () => {
    const evidence = validEvidence();
    (evidence.healthScore as Record<string, unknown>).verdict = 'passed';
    expect(() => assertDoctorEvidenceSemanticInvariants(evidence)).toThrow(/contradicts score/);
  });

  it('rejects health totals that disagree with host/project components', () => {
    const evidence = validEvidence();
    (evidence.healthScore as Record<string, unknown>).components = {
      host: { total: 1, passed: 1, warnings: 0, errors: 0 },
      projects: { total: 1, passed: 1, warnings: 0, errors: 0 },
    };
    expect(() => assertDoctorEvidenceSemanticInvariants(evidence)).toThrow(
      /contradicts its host\/project components/
    );
  });

  it('rejects the historical contradiction of failed probes with zero score errors', () => {
    const evidence = validEvidence();
    const healthScore = evidence.healthScore as Record<string, unknown>;
    healthScore.passed = 2;
    healthScore.errors = 0;
    healthScore.verdict = 'passed';
    expect(() => assertDoctorEvidenceSemanticInvariants(evidence)).toThrow(
      /blocking findings but healthScore\.errors is zero/
    );
  });

  it('rejects a project verdict or blocker count that disagrees with its probes', () => {
    const evidence = validEvidence();
    const project = evidence.project as Record<string, unknown>;
    const summary = project.probeSummary as Record<string, unknown>;
    summary.blockingFindings = 0;
    summary.verdict = 'passed';
    project.verdict = 'passed';
    expect(() => assertDoctorEvidenceSemanticInvariants(evidence)).toThrow(
      /blockingFindings contradicts/
    );
  });

  it('keeps pre-v2 legacy evidence readable during migration', () => {
    expect(() =>
      assertDoctorEvidenceSemanticInvariants({
        schemaVersion: 'doctor-project-evidence-v1',
        healthScore: { total: 1, passed: 1, warnings: 0, errors: 0 },
      })
    ).not.toThrow();
  });

  it('validates canonical diagnosis even when legacy healthScore verdict is absent', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'api',
      projectPath: '/workspace/api',
      runtimeFamily: 'node',
      probes: [],
    }) as unknown as Record<string, unknown>;
    diagnosis.schemaVersion = 'workspai.doctor-diagnosis.v999';

    expect(() =>
      assertDoctorEvidenceSemanticInvariants({ projects: [{ name: 'api', diagnosis }] })
    ).toThrow(/diagnosis schemaVersion is missing or unsupported/);
  });

  it('rejects canonical v2 evidence when any project omits its diagnosis', () => {
    expect(() =>
      assertDoctorEvidenceSemanticInvariants({
        contract: { scoringPolicyVersion: 'doctor-score-policy-v2' },
        projects: [{ name: 'api' }],
      })
    ).toThrow(/project without diagnosis/);
  });

  it('rejects malformed typed repair operations before evidence is published', () => {
    expect(() =>
      assertDoctorEvidenceSemanticInvariants({
        projects: [
          {
            name: 'api',
            repairCapabilities: [
              {
                id: 'unsafe-env',
                operation: {
                  type: 'env-key-add',
                  path: '.env',
                  keys: [{ name: 'SAFE', value: 'ok\nINJECTED=1' }],
                },
              },
            ],
          },
        ],
      })
    ).toThrow(/invalid typed operation/);
  });
});
