import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDoctorDiagnosis } from '../doctor/index.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

describe('Universal Doctor diagnosis engine', () => {
  it.each([
    ['node', 'Next.js', 'frontend'],
    ['python', 'FastAPI', 'backend'],
    ['go', 'Go/Fiber', 'backend'],
    ['java', 'Spring Boot', 'backend'],
    ['rust', 'Rust', 'backend'],
    ['dotnet', 'ASP.NET', 'backend'],
    ['php', 'Laravel', 'backend'],
    ['ruby', 'Ruby on Rails', 'backend'],
    ['elixir', 'Phoenix', 'backend'],
    ['clojure', 'Clojure', 'backend'],
    ['deno', 'Deno', 'backend'],
    ['bun', 'Bun', 'backend'],
    ['scala', 'Scala', 'backend'],
    ['kotlin', 'Kotlin', 'backend'],
    ['c', 'C', 'backend'],
    ['cpp', 'C++', 'backend'],
    ['unknown', 'Unknown', 'generic'],
  ])(
    'produces the same causal contract for %s projects',
    (runtimeFamily, framework, projectKind) => {
      const projectPath = path.join('/workspace', `${runtimeFamily}-api`);
      const diagnosis = buildDoctorDiagnosis({
        projectName: `${runtimeFamily}-api`,
        projectPath,
        runtimeFamily,
        framework,
        projectKind,
        probes: [
          {
            id: 'runtime-dependency-materialization',
            label: 'Dependency materialization',
            status: 'fail',
            severity: 'error',
            reason: 'The runtime dependency tree is unavailable.',
            issueClass: 'dependency',
            operationalImpact: 'release-risk',
            freshness: { status: 'fresh', verifyBeforeUse: true },
            repairIntent: { confidence: 'high', requiresFreshEvidence: true },
            repairCapability: {
              id: `${runtimeFamily}.materialize`,
              status: 'available',
              canAutoFix: true,
              requiresApproval: true,
              files: ['manifest', 'lockfile'],
              invocation: { executable: runtimeFamily, args: ['install'] },
              verifyCommand: 'npx workspai doctor project --json',
            },
          },
        ],
      });

      expect(diagnosis).toMatchObject({
        schemaVersion: 'workspai.doctor-diagnosis.v1',
        engineVersion: 'universal-diagnosis-v1',
        project: { runtimeFamily, framework, projectKind },
        coverage: {
          blockingFindings: 1,
          repairableFindings: 1,
          unknownFindings: 5,
          diagnosisCompleteness: runtimeFamily === 'unknown' ? 0 : 16.67,
        },
      });
      expect(diagnosis.findings[0]).toMatchObject({
        status: 'blocking',
        issueClass: 'dependency',
        confidence: 'high',
        diagnosisState: 'confirmed',
        repair: {
          disposition: 'approval-required',
          verifyCommand: 'npx workspai doctor project --json',
        },
      });
      expect(diagnosis.findings[0]?.proofs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'probe', role: 'observation' }),
          expect.objectContaining({ kind: 'command', role: 'verification' }),
        ])
      );
      assertJsonSchemaContract(
        diagnosis,
        'contracts/workspace-intelligence/doctor-diagnosis.v1.json',
        'Doctor diagnosis'
      );
    }
  );

  it('makes stale, unclassified, and contradictory evidence explicit', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'api',
      projectPath: '/workspace/api',
      runtimeFamily: 'unknown',
      probes: [
        {
          id: 'ambiguous-signal',
          label: 'Ambiguous signal',
          status: 'pass',
          severity: 'info',
          reason: 'One provider passed.',
        },
        {
          id: 'ambiguous-signal',
          label: 'Ambiguous signal',
          status: 'fail',
          severity: 'error',
          reason: 'Another provider failed.',
          issueClass: 'unknown',
          freshness: { status: 'stale', verifyBeforeUse: true },
        },
      ],
      legacyIssues: ['Runtime marker could not be classified.'],
    });

    expect(diagnosis.coverage).toMatchObject({
      contradictionCount: 1,
      blockingFindings: 2,
      unknownFindings: 8,
      unsupportedFindings: 2,
      diagnosisCompleteness: 0,
    });
    expect(diagnosis.contradictions[0]).toEqual(
      expect.objectContaining({ probeId: 'ambiguous-signal', statuses: ['fail', 'pass'] })
    );
    expect(diagnosis.unknowns).toHaveLength(8);
  });

  it('requires every canonical diagnostic domain before claiming complete coverage', () => {
    const domains = [
      ['runtime-check', 'runtime'],
      ['dependency-check', 'dependency'],
      ['security-check', 'security'],
      ['configuration-check', 'configuration'],
      ['test-check', 'test'],
      ['quality-check', 'quality'],
    ] as const;
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'complete-api',
      projectPath: '/workspace/complete-api',
      runtimeFamily: 'node',
      probes: domains.map(([id, issueClass]) => ({
        id,
        label: id,
        status: 'pass' as const,
        severity: 'info' as const,
        reason: `${issueClass} evidence passed.`,
        issueClass,
      })),
    });

    expect(diagnosis.coverage).toMatchObject({
      diagnosisCompleteness: 100,
      unknownFindings: 0,
    });
    expect(diagnosis.domains.map((domain) => domain.status)).toEqual(
      Array.from({ length: 6 }, () => 'clean')
    );
  });

  it('binds dependency audit subjects as proof without claiming unsupported causality', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'web',
      projectPath: '/workspace/web',
      runtimeFamily: 'node',
      probes: [
        {
          id: 'surface-security-hygiene',
          label: 'Security hygiene',
          status: 'fail',
          severity: 'error',
          reason: 'Dependency vulnerabilities were reported.',
          issueClass: 'security',
          operationalImpact: 'security-risk',
        },
      ],
      dependencySubjects: [{ name: 'minimist', version: '1.2.5', advisoryIds: ['GHSA-test'] }],
    });

    expect(diagnosis.findings[0]?.proofs).toContainEqual({
      kind: 'dependency',
      role: 'subject',
      ref: 'minimist@1.2.5',
      claim: 'Dependency is referenced by GHSA-test.',
    });
    expect(diagnosis.findings[0]?.diagnosisState).toBe('candidate');
  });

  it('does not attach dependency audit subjects to unrelated security controls', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'web',
      projectPath: '/workspace/web',
      runtimeFamily: 'node',
      probes: [
        {
          id: 'surface-security-headers',
          label: 'Security headers',
          status: 'warn',
          severity: 'warn',
          reason: 'A security header policy was not detected.',
          issueClass: 'security',
        },
      ],
      dependencySubjects: [{ name: 'minimist', version: '1.2.5' }],
    });

    expect(diagnosis.findings[0]?.proofs).not.toContainEqual(
      expect.objectContaining({ kind: 'dependency' })
    );
  });

  it('reconciles duplicate provider observations into one causal finding', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'api',
      projectPath: '/workspace/api',
      runtimeFamily: 'node',
      probes: [
        {
          id: 'dependency-tree',
          label: 'Dependency tree',
          status: 'warn',
          severity: 'warn',
          reason: 'Provider A found an incomplete dependency tree.',
          issueClass: 'dependency',
        },
        {
          id: 'dependency-tree',
          label: 'Dependency tree',
          status: 'fail',
          severity: 'error',
          reason: 'Provider B confirmed the dependency tree is missing.',
          issueClass: 'dependency',
        },
      ],
    });

    expect(diagnosis.findings).toHaveLength(1);
    expect(diagnosis.findings[0]).toMatchObject({ status: 'blocking' });
    expect(diagnosis.findings[0]?.proofs).toHaveLength(2);
    expect(diagnosis.coverage).toMatchObject({
      totalObservations: 2,
      blockingFindings: 1,
      advisoryFindings: 0,
      contradictionCount: 1,
    });
  });

  it('keeps causal identity isolated when two project paths share the same name', () => {
    const input = {
      projectName: 'api',
      runtimeFamily: 'node',
      probes: [
        {
          id: 'dependency-tree',
          label: 'Dependency tree',
          status: 'fail' as const,
          severity: 'error' as const,
          reason: 'Dependencies are missing.',
          issueClass: 'dependency',
        },
      ],
    };
    const first = buildDoctorDiagnosis({ ...input, projectPath: '/workspace/services/api' });
    const second = buildDoctorDiagnosis({ ...input, projectPath: '/workspace/examples/api' });

    expect(first.findings[0]?.causalKey).not.toBe(second.findings[0]?.causalKey);
  });

  it('projects container, deployment, and migration evidence into the configuration domain', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'delivery-api',
      projectPath: '/workspace/delivery-api',
      runtimeFamily: 'node',
      probes: [
        {
          id: 'surface-container-contract',
          label: 'Container contract',
          status: 'warn',
          severity: 'warn',
          reason: 'Container baseline is missing.',
          issueClass: 'container',
        },
        {
          id: 'surface-deploy-contract',
          label: 'Deployment contract',
          status: 'warn',
          severity: 'warn',
          reason: 'Deployment baseline is missing.',
          issueClass: 'deployment',
        },
        {
          id: 'migration-surface',
          label: 'Migration surface',
          status: 'pass',
          severity: 'info',
          reason: 'Migration markers detected.',
          issueClass: 'configuration',
        },
      ],
    });

    expect(diagnosis.domains.find((domain) => domain.id === 'configuration')).toMatchObject({
      status: 'findings',
      observationCount: 3,
      advisoryFindings: 2,
    });
    expect(diagnosis.coverage.unknownFindings).toBe(5);
  });

  it('records explicitly non-applicable checks without turning them into findings or unknowns', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'local-library',
      projectPath: '/workspace/local-library',
      runtimeFamily: 'node',
      probes: [
        {
          id: 'surface-container-contract',
          label: 'Container contract',
          status: 'pass',
          severity: 'warn',
          applicability: 'not-applicable',
          reason: 'No container intent was detected.',
          issueClass: 'container',
        },
        {
          id: 'surface-deploy-contract',
          label: 'Deployment contract',
          status: 'pass',
          severity: 'warn',
          applicability: 'not-applicable',
          reason: 'No deployment intent was detected.',
          issueClass: 'deployment',
        },
      ],
    });

    expect(diagnosis.findings).toEqual([]);
    expect(diagnosis.domains.find((domain) => domain.id === 'configuration')).toMatchObject({
      status: 'not-applicable',
      observationCount: 0,
      advisoryFindings: 0,
    });
    expect(diagnosis.unknowns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining('configuration') }),
      ])
    );
  });

  it('reconciles a legacy issue and its typed probe into one causal finding', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'catalog-api',
      projectPath: '/workspace/catalog-api',
      runtimeFamily: 'node',
      probes: [
        {
          id: 'runtime-dependency-materialization',
          label: 'Dependency materialization',
          status: 'fail',
          severity: 'error',
          reason: 'Dependencies are not installed.',
          issueClass: 'dependency',
          operationalImpact: 'release-risk',
        },
      ],
      legacyIssues: ['Dependencies are not installed.'],
    });

    expect(diagnosis.coverage).toMatchObject({
      totalObservations: 1,
      blockingFindings: 1,
    });
    expect(diagnosis.findings).toHaveLength(1);
    expect(diagnosis.causalGroups).toHaveLength(1);
  });
});
