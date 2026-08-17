import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { ARTIFACT_REMEDIATION_PLAN_SCHEMA_VERSION } from '../../contracts/artifact-remediation-plan-contract.js';
import {
  BLOCKER_RESOLUTION_CLASSES,
  BLOCKER_RESOLUTION_SCHEMA_VERSION,
  computeBlockerSignature,
  isBlockerResolution,
  normalizeBlockerResolutionClass,
} from '../../contracts/blocker-resolution-contract.js';
import {
  buildCliOperationResultSchema,
  cliOperationError,
  cliOperationSuccess,
} from '../../contracts/cli-operation-result-contract.js';
import {
  buildCreatePlannerCapabilitiesContract,
  resolveContractedCreateCapability,
} from '../../contracts/create-planner-capabilities-contract.js';
import { DOCTOR_REMEDIATION_PLAN_SCHEMA_VERSION } from '../../contracts/doctor-remediation-plan-contract.js';
import {
  buildFactFreshnessContract,
  buildWorkspaceFact,
  FACT_FRESHNESS_TTL_SECONDS,
  summarizeFactFreshness,
} from '../../contracts/fact-freshness-contract.js';
import { INFRA_STACK_CATALOG_BODY } from '../../contracts/infra-stack-catalog.js';
import { buildRuntimeCommandSurfaceContract } from '../../contracts/runtime-command-surface-contract.js';
import { STANDARD_ANSWER_CONTRACT_SECTIONS } from '../../contracts/standard-answer-contract.js';
import {
  BUILTIN_OPERATIONAL_SKILL_IDS,
  isBuiltinOperationalSkillId,
  operationalSkillPath,
} from '../../contracts/workspace-artifact-paths.js';
import {
  WORKSPACE_INTELLIGENCE_RUNTIME_STEPS,
  WORKSPACE_INTELLIGENCE_STEP_IDS,
  workspaceIntelligenceRuntimeStep,
} from '../../contracts/workspace-intelligence-runtime-registry.js';

describe('contract semantic boundaries', () => {
  it('validates success and error operation envelopes and rejects cross-state payloads', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      buildCliOperationResultSchema()
    );
    const success = cliOperationSuccess('workspace model', { projects: 2 });
    const persisted = cliOperationSuccess('workspace model', { projects: 2 }, 'model.json');
    const gated = cliOperationSuccess(
      'workspace verify',
      { gate: { passed: false } },
      undefined,
      1
    );
    const error = cliOperationError({
      operation: 'workspace model',
      code: 'MODEL_FAILED',
      message: 'Model generation failed.',
      exitCode: 4,
      context: { workspace: 'shop' },
      examples: ['workspai workspace model --json'],
      nextActions: ['Run workspai doctor workspace.'],
    });

    expect(validate(success)).toBe(true);
    expect(success).not.toHaveProperty('outputPath');
    expect(validate(persisted)).toBe(true);
    expect(persisted.outputPath).toBe('model.json');
    expect(validate(gated)).toBe(true);
    expect(gated).toMatchObject({ status: 'success', exitCode: 1 });
    expect(validate(error)).toBe(true);
    expect(error.exitCode).toBe(4);
    expect(
      cliOperationError({ operation: 'doctor', code: 'FAILED', message: 'failed' })
    ).toMatchObject({ exitCode: 1 });
    expect(validate({ ...success, error: { code: 'X', message: 'x' } })).toBe(false);
    expect(validate({ ...error, artifact: {} })).toBe(false);
    expect(validate({ ...success, unexpected: true })).toBe(false);
  });

  it('canonicalizes blocker signatures and rejects every malformed envelope boundary', () => {
    const blockers = Array.from({ length: 14 }, (_, index) => ` blocker-${index} `);
    const longStderr = `ignored-${'x'.repeat(450)}`;
    expect(computeBlockerSignature({ blockers: ['', ...blockers], stderrTail: longStderr })).toBe(
      computeBlockerSignature({
        blockers: blockers.slice(0, 12).map((entry) => entry.trim()),
        exitCode: null,
        stderrTail: longStderr.trim().slice(-400),
      })
    );

    for (const resolutionClass of BLOCKER_RESOLUTION_CLASSES) {
      expect(normalizeBlockerResolutionClass(` ${resolutionClass} `)).toBe(resolutionClass);
    }
    expect(normalizeBlockerResolutionClass(1)).toBeNull();
    expect(normalizeBlockerResolutionClass('')).toBeNull();

    const valid = {
      schemaVersion: BLOCKER_RESOLUTION_SCHEMA_VERSION,
      blockerId: 'doctor-1',
      blockerSignature: 'signature',
      resolutionClass: 'config-fixable',
      sourceCommand: 'doctor workspace',
      sourceArtifact: 'doctor.json',
      commandRetryHint: 'workspai doctor workspace',
      verifyCommand: 'workspai workspace verify',
      verifyArtifact: 'verify.json',
      fixHints: [
        { actionKind: 'run-once', detail: 'Regenerate evidence.', studioActionId: 'doctor-fix' },
      ],
    };
    expect(isBlockerResolution(valid)).toBe(true);
    for (const invalid of [
      null,
      [],
      { ...valid, schemaVersion: 'v0' },
      { ...valid, blockerId: 1 },
      { ...valid, blockerSignature: null },
      { ...valid, resolutionClass: 'other' },
      { ...valid, fixHints: {} },
      { ...valid, fixHints: [null] },
      { ...valid, fixHints: [{ actionKind: 'delete', detail: 'unsafe' }] },
      { ...valid, fixHints: [{ actionKind: 'run-once', detail: 1 }] },
      { ...valid, fixHints: [{ actionKind: 'run-once', detail: 'x', targetPath: 1 }] },
      { ...valid, fixHints: [{ actionKind: 'run-once', detail: 'x', studioActionId: 'unknown' }] },
      { ...valid, sourceCommand: 1 },
      { ...valid, sourceArtifact: 1 },
      { ...valid, commandRetryHint: 1 },
      { ...valid, verifyCommand: 1 },
      { ...valid, verifyArtifact: 1 },
    ]) {
      expect(isBlockerResolution(invalid)).toBe(false);
    }
  });

  it('covers every freshness kind, expiry boundary, override, and summary verdict', () => {
    const generatedAt = '2026-07-01T00:00:00.000Z';
    const kinds = [
      ['durable', FACT_FRESHNESS_TTL_SECONDS.durable],
      ['derived', FACT_FRESHNESS_TTL_SECONDS.derived],
      ['evidence-backed', FACT_FRESHNESS_TTL_SECONDS.evidenceBacked],
      ['live', FACT_FRESHNESS_TTL_SECONDS.live],
      ['verify-before-use', FACT_FRESHNESS_TTL_SECONDS.verifyBeforeUse],
    ] as const;
    for (const [kind, ttlSeconds] of kinds) {
      expect(
        buildFactFreshnessContract({
          kind,
          category: 'structure',
          generatedAt,
          now: new Date(generatedAt),
          reason: `${kind} fact`,
        }).ttlSeconds
      ).toBe(ttlSeconds);
    }

    const exactExpiry = buildFactFreshnessContract({
      kind: 'live',
      category: 'state',
      generatedAt,
      now: new Date('2026-07-01T00:05:00.000Z'),
      reason: 'Boundary is inclusive.',
    });
    expect(exactExpiry.status).toBe('fresh');
    expect(exactExpiry.verifyBeforeUse).toBe(true);

    const timeless = buildFactFreshnessContract({
      kind: 'durable',
      category: 'structure',
      generatedAt,
      now: new Date('2026-07-20T00:00:00.000Z'),
      ttlSeconds: null,
      verifyBeforeUse: false,
      sourceArtifact: 'contract.json',
      sourcePath: 'projects[0]',
      inputsHash: 'trusted-hash',
      reason: 'Explicitly timeless.',
    });
    expect(timeless).toMatchObject({
      status: 'unknown',
      verifyBeforeUse: false,
      inputsHash: 'trusted-hash',
    });
    expect(timeless).not.toHaveProperty('expiresAt');

    const overridden = buildFactFreshnessContract({
      kind: 'derived',
      category: 'structure',
      generatedAt,
      now: new Date('2026-08-01T00:00:00.000Z'),
      status: 'fresh',
      reason: 'Producer supplied a stronger verdict.',
    });
    expect(overridden.status).toBe('fresh');

    const fresh = buildWorkspaceFact({
      id: 'fresh',
      label: 'Fresh',
      scope: 'workspace',
      value: 1,
      freshness: {
        kind: 'durable',
        category: 'structure',
        generatedAt,
        now: new Date(generatedAt),
        reason: 'fresh',
      },
    });
    const unknown = buildWorkspaceFact({
      id: 'unknown',
      label: 'Unknown',
      scope: 'project',
      project: 'api',
      value: 2,
      freshness: {
        kind: 'derived',
        category: 'verification',
        generatedAt,
        status: 'unknown',
        reason: 'unknown',
      },
    });
    const live = buildWorkspaceFact({
      id: 'live',
      label: 'Live',
      scope: 'workspace',
      value: 3,
      freshness: {
        kind: 'live',
        category: 'state',
        generatedAt,
        now: new Date(generatedAt),
        reason: 'live',
      },
    });
    expect(unknown.project).toBe('api');
    expect(summarizeFactFreshness({ facts: [fresh] }).status).toBe('fresh');
    expect(
      summarizeFactFreshness({ facts: [fresh, unknown, live], now: new Date(generatedAt) })
    ).toMatchObject({
      status: 'unknown',
      unknownFacts: 1,
      liveFacts: 1,
      totalFacts: 3,
      byKind: { durable: 1, derived: 1, 'evidence-backed': 0, live: 1, 'verify-before-use': 0 },
      byCategory: { structure: 1, verification: 1, state: 1 },
    });
  });

  it('resolves every create-planner lane without leaking mutable registry arrays', () => {
    const first = buildCreatePlannerCapabilitiesContract();
    const second = buildCreatePlannerCapabilitiesContract();
    expect(first.schemaVersion).toBe('rapidkit-create-planner-capabilities-v1');
    expect(Object.keys(first.lanes)).toEqual(['native', 'official', 'existing']);

    const originalAlias = second.officialCreate[0]?.aliases[0];
    first.officialCreate[0]?.aliases.push('mutation');
    expect(buildCreatePlannerCapabilitiesContract().officialCreate[0]?.aliases[0]).toBe(
      originalAlias
    );
    expect(buildCreatePlannerCapabilitiesContract().officialCreate[0]?.aliases).not.toContain(
      'mutation'
    );

    expect(resolveContractedCreateCapability({ kitId: 'fastapi.standard' })).toMatchObject({
      lane: 'native',
      canExecuteCreate: true,
    });
    expect(resolveContractedCreateCapability({ framework: 'wordpress' })).toMatchObject({
      lane: 'official',
      status: 'planned',
      fallbackLane: 'existing',
    });
    expect(resolveContractedCreateCapability({ runtime: 'rust' })).toMatchObject({
      lane: 'existing',
      resolved: 'rust',
      canExecuteCreate: false,
    });
    expect(
      resolveContractedCreateCapability({ projectExists: true, runtime: 'node' })
    ).toMatchObject({
      lane: 'existing',
      requested: 'node',
      canExecuteCreate: false,
    });
    expect(resolveContractedCreateCapability({ framework: 'uncontracted' })).toMatchObject({
      lane: 'existing',
      requested: 'uncontracted',
    });
  });

  it('keeps runtime registry lookups and generated command surface aligned and independently mutable', () => {
    for (const id of WORKSPACE_INTELLIGENCE_STEP_IDS) {
      expect(workspaceIntelligenceRuntimeStep(id)).toBe(WORKSPACE_INTELLIGENCE_RUNTIME_STEPS[id]);
    }
    expect(workspaceIntelligenceRuntimeStep('missing' as never)).toBeUndefined();

    const first = buildRuntimeCommandSurfaceContract();
    const second = buildRuntimeCommandSurfaceContract();
    expect(first.workspaceIntelligenceExecution.map((entry) => entry.id)).toEqual(
      WORKSPACE_INTELLIGENCE_STEP_IDS
    );
    first.lifecycleCommands.push('mutation');
    first.workspaceIntelligenceExecution[0]?.argv.push('mutation');
    expect(second.lifecycleCommands).not.toContain('mutation');
    expect(second.workspaceIntelligenceExecution[0]?.argv).not.toContain('mutation');
    for (const execution of first.workspaceIntelligenceExecution) {
      expect(execution.produces.every((artifact) => artifact.path.length > 0)).toBe(true);
    }
  });

  it('enforces safe operational skill ids and pins foundational constants', () => {
    for (const id of BUILTIN_OPERATIONAL_SKILL_IDS) {
      expect(isBuiltinOperationalSkillId(id)).toBe(true);
      expect(operationalSkillPath(` ${id} `)).toBe(`.workspai/skills/${id}.md`);
    }
    expect(isBuiltinOperationalSkillId('workspai-unknown')).toBe(false);
    for (const invalid of ['', '   ', '../secret', 'nested/skill']) {
      expect(() => operationalSkillPath(invalid)).toThrow('Invalid operational skill id');
    }
    expect(ARTIFACT_REMEDIATION_PLAN_SCHEMA_VERSION).toBe('artifact-remediation-plan-v1');
    expect(DOCTOR_REMEDIATION_PLAN_SCHEMA_VERSION).toBe('doctor-remediation-plan-v2');
    expect(STANDARD_ANSWER_CONTRACT_SECTIONS).toEqual([
      'Scope',
      'Evidence',
      'Diagnosis',
      'Fix Plan',
      'Run',
      'Verify',
      'Assumptions',
    ]);
    expect(INFRA_STACK_CATALOG_BODY.services.postgres?.ports[0]).toEqual({
      name: 'sql',
      host: 5432,
      container: 5432,
    });
    expect(INFRA_STACK_CATALOG_BODY.moduleMappings['free/tasks/celery']).toEqual(['redis']);
  });
});
