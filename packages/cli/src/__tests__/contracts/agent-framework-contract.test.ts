import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION,
  AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS,
  AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
  AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION,
  AGENT_FRAMEWORK_CAPABILITIES_SCHEMA_VERSION,
  AGENT_FRAMEWORK_CAPABILITY_IDS,
  AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
  AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION,
  buildAgentFrameworkAdapterManifestSchema,
  buildAgentFrameworkAdmissionCandidateSchema,
  buildAgentFrameworkCapabilitiesContract,
  buildAgentFrameworkOwnershipReceiptSchema,
  buildAgentFrameworkConformanceReportSchema,
  validateAgentFrameworkAdapterManifest,
  validateAgentFrameworkConformanceReport,
  type AgentFrameworkAdapterManifest,
  type AgentFrameworkConformanceReport,
} from '../../contracts/agent-framework-contract.js';

function capabilityDeclarations(): AgentFrameworkAdapterManifest['capabilities'] {
  return Object.fromEntries(
    AGENT_FRAMEWORK_CAPABILITY_IDS.map((id) => [
      id,
      {
        support: id === 'managed-hosting' ? 'unsupported' : 'native',
        evidence: id === 'managed-hosting' ? [] : [`test-results/${id}.json`],
        prerequisites: [],
        limitations: [],
      },
    ])
  ) as AgentFrameworkAdapterManifest['capabilities'];
}

function adapterOperations(): AgentFrameworkAdapterManifest['operations'] {
  const modes = {
    detect: 'read-only',
    'plan-scaffold': 'plan-only',
    'plan-attach': 'plan-only',
    'render-managed-files': 'render-only',
    'project-context': 'resolve-only',
    validate: 'read-only',
    'resolve-runtime': 'resolve-only',
  } as const;
  return Object.fromEntries(
    AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS.map((id) => [
      id,
      { supported: true, mode: modes[id], limitations: [] },
    ])
  ) as AgentFrameworkAdapterManifest['operations'];
}

function validManifest(): AgentFrameworkAdapterManifest {
  return {
    schemaVersion: AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    adapter: {
      id: 'fixture-agent',
      package: '@workspai/agent-fixture',
      version: '1.0.0',
      stability: 'stable',
    },
    framework: {
      id: 'fixture',
      name: 'Fixture Agent Framework',
      homepage: 'https://example.com/fixture',
      license: 'Apache-2.0',
      upstreamStatus: 'stable',
      supportedVersionRange: '>=1.0.0 <2.0.0',
      testedVersions: ['1.2.3'],
    },
    implementation: {
      languages: ['TypeScript'],
      runtimes: ['node'],
      platforms: ['linux'],
      executionBoundary: 'subprocess',
      distribution: 'optional-package',
    },
    operations: adapterOperations(),
    capabilities: capabilityDeclarations(),
    detection: {
      authoredMarkers: [
        {
          id: 'dependency',
          kind: 'dependency',
          ecosystem: 'npm',
          name: 'fixture',
          match: 'exact',
          manifestPaths: ['package.json'],
          manifestSuffixes: [],
          searchDepth: 0,
          weight: 0.7,
        },
        {
          id: 'source',
          kind: 'file-content',
          path: 'src/agent.ts',
          needle: 'fixture',
          maxBytes: 65536,
          weight: 0.3,
        },
      ],
      generatedMarkers: [
        { id: 'generated', kind: 'path', path: '.workspai/agent-framework.json', weight: 0.1 },
      ],
      minimumAuthoredMarkers: 1,
      minimumConfidence: 0.7,
    },
    ownership: {
      canonicalTruth: 'workspai',
      runtimeState: 'framework',
      sessionState: 'framework',
      mutationAdmission: 'workspai-pcc',
      verificationOwner: 'workspai-cli',
      managedWritePolicy: 'owned-files-or-managed-sections',
      conflictPolicy: 'preserve-user-content',
      managedRoots: ['.workspai/adapters/fixture'],
    },
    security: {
      secrets: 'references-only',
      network: 'deny-unless-explicitly-granted',
      generatedCodeExecution: 'disabled-unless-explicitly-granted',
      toolMutation: 'approval-required',
      untrustedInput: 'isolated',
      telemetrySensitiveData: 'redacted',
    },
    bindings: {
      contextInputs: ['.workspai/reports/workspace-context.json'],
      evidenceInputs: ['.workspai/reports/INDEX.json'],
      mutationGateway: 'proof-carrying-change',
      verificationGateway: 'workspace-verify',
      projectionPolicy: 'references-and-bounded-projections-only',
    },
  };
}

function validReport(): AgentFrameworkConformanceReport {
  const checks = AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.map((id) => ({
    id,
    status: 'passed' as const,
    required: true,
    summary: `${id} passed`,
    evidencePaths: [`test-results/${id}.json`],
    durationMs: 1,
  }));
  return {
    schemaVersion: AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    generatedAt: '2026-09-05T00:00:00.000Z',
    adapter: {
      id: 'fixture-agent',
      version: '1.0.0',
      manifestSha256: 'a'.repeat(64),
    },
    frameworkVersion: '1.2.3',
    cliVersion: '0.74.0',
    environment: {
      platform: 'linux',
      architecture: 'x64',
      runtime: 'node',
      runtimeVersion: '24.18.0',
    },
    checks,
    summary: {
      passed: checks.length,
      failed: 0,
      skipped: 0,
      required: checks.length,
    },
    verdict: 'admitted',
    blockers: [],
    limitations: [],
  };
}

describe('agent framework contracts', () => {
  it('keeps every capability, operation, authority, and admission check explicit', () => {
    const contract = buildAgentFrameworkCapabilitiesContract();

    expect(contract.schemaVersion).toBe(AGENT_FRAMEWORK_CAPABILITIES_SCHEMA_VERSION);
    expect(contract.capabilities.map((entry) => entry.id)).toEqual(AGENT_FRAMEWORK_CAPABILITY_IDS);
    expect(contract.adapterOperations.map((entry) => entry.id)).toEqual(
      AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS
    );
    expect(contract.publication.requiredChecks).toEqual(AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS);
    expect(contract.kitRelationship.frameworkIsNotModelProvider).toBe(true);
    expect(contract.kitRelationship.workspaceAllowsMultipleScopedAdapters).toBe(true);
    expect(contract.kitRelationship.implicitCrossFrameworkBridgeAllowed).toBe(false);
    expect(contract.kitRelationship.noCoreBranchingByFrameworkId).toBe(true);
    expect(contract.authorities.forbiddenForAdapter).toContain(
      'apply source mutations outside the Workspai PCC or Repair admission boundary'
    );
  });

  it('accepts a complete adapter manifest and rejects authority or path escalation', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      buildAgentFrameworkAdapterManifestSchema()
    );
    const manifest = validManifest();

    expect(validate(manifest)).toBe(true);
    expect(validateAgentFrameworkAdapterManifest(manifest)).toEqual([]);

    expect(validate({ ...manifest, extra: true })).toBe(false);
    expect(
      validate({
        ...manifest,
        ownership: { ...manifest.ownership, mutationAdmission: 'framework' },
      })
    ).toBe(false);
    expect(
      validate({
        ...manifest,
        ownership: { ...manifest.ownership, managedRoots: ['../outside'] },
      })
    ).toBe(false);
    expect(
      validate({
        ...manifest,
        capabilities: Object.fromEntries(
          Object.entries(manifest.capabilities).filter(([id]) => id !== 'human-in-the-loop')
        ),
      })
    ).toBe(false);
  });

  it('keeps maintenance frameworks in compatibility posture', () => {
    const manifest = validManifest();
    manifest.framework.upstreamStatus = 'maintenance';

    expect(validateAgentFrameworkAdapterManifest(manifest)).toContain(
      'a maintenance-mode framework must use compatibility stability'
    );

    manifest.adapter.stability = 'compatibility';
    expect(validateAgentFrameworkAdapterManifest(manifest)).toEqual([]);
  });

  it('represents blocked evidence honestly and admits only complete passing evidence', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      buildAgentFrameworkConformanceReportSchema()
    );
    const report = validReport();

    expect(validate(report)).toBe(true);
    expect(validateAgentFrameworkConformanceReport(report)).toEqual([]);

    const failed = structuredClone(report);
    failed.checks[0].status = 'failed';
    failed.summary.passed -= 1;
    failed.summary.failed += 1;
    failed.verdict = 'blocked';
    failed.blockers = ['manifest schema failed'];
    expect(validate(failed)).toBe(true);
    expect(validateAgentFrameworkConformanceReport(failed)).toEqual([]);

    const unexplainedFailure = structuredClone(failed);
    unexplainedFailure.blockers = [];
    expect(validate(unexplainedFailure)).toBe(false);

    const falseAdmission = structuredClone(failed);
    falseAdmission.verdict = 'admitted';
    expect(validateAgentFrameworkConformanceReport(falseAdmission)).toContain(
      'conformance verdict does not match required checks and blockers'
    );
  });

  it('accepts only portable, digest-bound managed-file ownership receipts', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      buildAgentFrameworkOwnershipReceiptSchema()
    );
    const receipt = {
      schemaVersion: AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION,
      generatedAt: '2026-09-06T00:00:00.000Z',
      changeId: 'change-feature-change-12345678',
      adapter: {
        id: 'fixture-agent',
        version: '1.0.0',
        manifestSha256: 'a'.repeat(64),
      },
      framework: { id: 'fixture', version: '1.2.3' },
      target: {
        workspace: 'platform',
        project: 'api',
        artifactPrefix: 'api',
        instanceName: 'release-reviewer',
      },
      files: [{ path: 'agents/release-reviewer/main.py', sha256: 'b'.repeat(64) }],
    };

    expect(validate(receipt)).toBe(true);
    expect(validate({ ...receipt, localPath: '/home/user/project' })).toBe(false);
    expect(
      validate({
        ...receipt,
        files: [{ path: '../outside.py', sha256: 'b'.repeat(64) }],
      })
    ).toBe(false);
    expect(
      validate({
        ...receipt,
        adapter: { ...receipt.adapter, manifestSha256: 'not-a-digest' },
      })
    ).toBe(false);
  });

  it('keeps admission candidates review-pending and binds every lane artifact', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      buildAgentFrameworkAdmissionCandidateSchema()
    );
    const candidate = {
      schemaVersion: AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION,
      protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
      generatedAt: '2026-09-06T00:00:00.000Z',
      sourceCommit: 'a'.repeat(40),
      cliVersion: '0.74.0',
      reviewStatus: 'pending',
      adapters: [
        {
          id: 'fixture-agent',
          version: '1.0.0',
          manifestSha256: 'b'.repeat(64),
          framework: { id: 'fixture' },
          lanes: [
            {
              platform: 'linux',
              runtime: 'node',
              runtimeVersion: '24.18.0',
              frameworkVersion: '1.2.3',
              report: { path: 'fixture-agent-linux.json', sha256: 'c'.repeat(64) },
              evidence: AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.map((id) => ({
                path: `evidence/fixture-agent/linux/${id}.json`,
                sha256: 'd'.repeat(64),
              })),
            },
          ],
        },
      ],
      verdict: 'admitted',
      blockers: [],
    };

    expect(validate(candidate)).toBe(true);
    expect(validate({ ...candidate, reviewStatus: 'approved' })).toBe(false);
    expect(validate({ ...candidate, sourceCommit: 'main' })).toBe(false);
    expect(
      validate({
        ...candidate,
        adapters: [
          {
            ...candidate.adapters[0],
            lanes: [
              {
                ...candidate.adapters[0].lanes[0],
                report: { path: '../report.json', sha256: 'c'.repeat(64) },
              },
            ],
          },
        ],
      })
    ).toBe(false);
  });
});
