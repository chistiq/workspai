import { describe, expect, it } from 'vitest';

import {
  assessCanonicalDoctorEvidence,
  listCanonicalDoctorFindings,
} from '../utils/doctor-diagnosis-consumer.js';

describe('Doctor canonical diagnosis consumer', () => {
  it('uses canonical findings once and never duplicates matching legacy issues or probes', () => {
    const project = {
      name: 'api',
      issues: ['Dependencies are not installed.'],
      probes: [
        {
          id: 'runtime-dependency-materialization',
          status: 'fail',
          reason: 'Dependencies are not installed.',
        },
      ],
      diagnosis: {
        coverage: {
          blockingFindings: 1,
          advisoryFindings: 0,
          unknownFindings: 0,
          contradictionCount: 0,
          diagnosisCompleteness: 100,
        },
        findings: [
          {
            id: 'finding.api.dependencies',
            causalKey: 'causal.api.dependencies',
            status: 'blocking',
            issueClass: 'dependency',
            symptom: 'Dependencies are not installed.',
          },
        ],
      },
    };

    expect(listCanonicalDoctorFindings({ projects: [project] })).toEqual([
      {
        projectName: 'api',
        id: 'finding.api.dependencies',
        causalKey: 'causal.api.dependencies',
        issueClass: 'dependency',
        status: 'blocking',
        message: 'Dependencies are not installed.',
      },
    ]);
    expect(listCanonicalDoctorFindings({ project })).toHaveLength(1);
  });

  it('fails completeness honestly when a canonical workspace omits a project diagnosis', () => {
    const assessment = assessCanonicalDoctorEvidence({
      contract: { scoringPolicyVersion: 'doctor-score-policy-v2' },
      projects: [
        {
          name: 'api',
          diagnosis: {
            coverage: {
              blockingFindings: 0,
              advisoryFindings: 0,
              unknownFindings: 0,
              contradictionCount: 0,
              diagnosisCompleteness: 100,
            },
          },
        },
        { name: 'web' },
      ],
    });

    expect(assessment).toMatchObject({
      canonical: false,
      projectCount: 2,
      diagnosedProjectCount: 1,
      missingDiagnosisProjects: 1,
      minimumDiagnosisCompleteness: 100,
    });
  });

  it('keeps pre-diagnosis evidence readable without inventing missing canonical coverage', () => {
    expect(
      assessCanonicalDoctorEvidence({
        summary: { blockingFindings: 2, advisoryFindings: 1 },
        projects: [{ name: 'legacy-api' }],
      })
    ).toMatchObject({
      canonical: false,
      blockingFindings: 2,
      advisoryFindings: 1,
      missingDiagnosisProjects: 0,
      minimumDiagnosisCompleteness: 100,
    });
  });
});
