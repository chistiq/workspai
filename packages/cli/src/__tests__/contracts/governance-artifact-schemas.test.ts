import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  DOCTOR_PROJECT_EVIDENCE_SCHEMA,
  DOCTOR_WORKSPACE_EVIDENCE_SCHEMA,
} from '../../utils/doctor-evidence-contract.js';
import { WORKSPACE_REGISTRY_SUMMARY_SCHEMA_VERSION } from '../../utils/workspace-registry-summary.js';
import { WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION } from '../../utils/workspace-run-evidence.js';

const CONTRACTS_DIR = path.resolve(process.cwd(), 'contracts');

const GOVERNANCE_ARTIFACT_SCHEMAS = [
  {
    fileName: 'workspace-registry.v1.json',
    schemaVersion: WORKSPACE_REGISTRY_SUMMARY_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-run-last.v1.json',
    schemaVersion: WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION,
  },
  {
    fileName: 'doctor-workspace-evidence.v1.json',
    schemaVersion: DOCTOR_WORKSPACE_EVIDENCE_SCHEMA,
  },
  {
    fileName: 'doctor-project-evidence.v1.json',
    schemaVersion: DOCTOR_PROJECT_EVIDENCE_SCHEMA,
  },
  {
    fileName: 'doctor-remediation-plan.v1.json',
    schemaVersion: 'doctor-remediation-plan-v2',
  },
  {
    fileName: 'artifact-remediation-plan.v1.json',
    schemaVersion: 'artifact-remediation-plan-v1',
  },
  {
    fileName: 'analyze-last-run.v1.json',
    schemaVersion: 'rapidkit-analyze-v1',
  },
  {
    fileName: 'cli-log-event.v1.json',
    schemaVersion: 'cli-log-event-v1',
  },
] as const;

function readSchema(fileName: string): Record<string, unknown> {
  const filePath = path.join(CONTRACTS_DIR, fileName);
  expect(fs.existsSync(filePath), `${fileName} must exist`).toBe(true);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function schemaConst(schema: Record<string, unknown>): string | undefined {
  const properties = schema.properties as Record<string, unknown> | undefined;
  const schemaVersion = properties?.schemaVersion as Record<string, unknown> | undefined;
  if (typeof schemaVersion?.const === 'string') {
    return schemaVersion.const;
  }
  const enumValues = schemaVersion?.enum as string[] | undefined;
  return enumValues?.[0];
}

describe('governance artifact JSON schemas', () => {
  for (const contract of GOVERNANCE_ARTIFACT_SCHEMAS) {
    it(`keeps ${contract.fileName} aligned with writer schemaVersion`, () => {
      const schema = readSchema(contract.fileName);
      expect(schemaConst(schema)).toBe(contract.schemaVersion);
    });
  }

  it('defines Doctor repair capability contracts for workspace and project evidence', () => {
    for (const fileName of [
      'doctor-workspace-evidence.v1.json',
      'doctor-project-evidence.v1.json',
    ]) {
      const schema = readSchema(fileName);
      const defs = schema.$defs as Record<string, any>;
      expect(defs.repairCapability.required).toEqual(
        expect.arrayContaining([
          'id',
          'issueId',
          'fixKind',
          'canAutoFix',
          'canEditFiles',
          'requiresApproval',
          'refreshCommands',
        ])
      );
      expect(defs.repairCapability.properties.fixKind.enum).toEqual(
        expect.arrayContaining([
          'package-json-script',
          'file-create',
          'file-append',
          'file-copy',
          'dependency-sync',
          'manual',
        ])
      );
      expect(defs.repairCapability.properties.operation.$ref).toBe('#/$defs/repairOperation');
      expect(defs.repairOperation.properties.type.enum).toEqual(
        expect.arrayContaining([
          'file-create',
          'file-append',
          'file-copy',
          'package-json-script',
          'json-edit',
          'env-key-add',
          'makefile-target',
        ])
      );
      expect(schema.properties.policyProfile.$ref).toBe('#/$defs/policyProfile');
      expect(defs.policyProfile.properties.name.enum).toEqual(
        expect.arrayContaining(['local', 'ci', 'release', 'enterprise-strict'])
      );
      expect(schema.properties.evidenceFreshness.$ref).toBe('#/$defs/evidenceFreshness');
      expect(defs.probe.properties.freshness.$ref).toBe('#/$defs/freshness');
      expect(defs.freshness.properties.category.enum).toEqual(
        expect.arrayContaining(['structure', 'verification', 'state'])
      );
      expect(defs.freshness.properties.status.enum).toEqual(
        expect.arrayContaining(['fresh', 'stale', 'unknown'])
      );
      expect(defs.probe.properties.issueClass.enum).toEqual(
        expect.arrayContaining(['dependency', 'security', 'test', 'container'])
      );
      expect(defs.probe.properties.operationalImpact.enum).toEqual(
        expect.arrayContaining(['ci-risk', 'release-risk', 'security-risk'])
      );
      expect(defs.probe.properties.repairIntent.$ref).toBe('#/$defs/repairIntent');
      expect(defs.repairIntent.properties.mode.enum).toEqual(
        expect.arrayContaining(['edit-file', 'run-command', 'verify-before-fix'])
      );
      expect(defs.probe.properties.repairCapability.$ref).toBe('#/$defs/repairCapability');
    }
  });

  it('defines Doctor remediation plan contract for Studio fix handoff', () => {
    const schema = readSchema('doctor-remediation-plan.v1.json');
    const defs = schema.$defs as Record<string, any>;
    expect(schemaConst(schema)).toBe('doctor-remediation-plan-v2');
    expect(defs.step.required).toEqual(
      expect.arrayContaining([
        'id',
        'phase',
        'order',
        'dependsOn',
        'projectName',
        'projectPath',
        'originalCommand',
        'kind',
        'risk',
        'files',
        'preview',
        'diffPreview',
        'refreshCommands',
        'rollback',
        'studioStatus',
        'executableInCurrentEnvironment',
      ])
    );
    expect(schema.required).toEqual(expect.arrayContaining(['policyProfile']));
    expect(schema.properties.policyProfile.enum).toEqual(
      expect.arrayContaining(['local', 'ci', 'release', 'enterprise-strict'])
    );
    expect(defs.step.properties.phase.enum).toEqual(
      expect.arrayContaining([
        'dependency-baseline',
        'local-environment',
        'source-hygiene',
        'command-contract',
      ])
    );
    expect(defs.step.properties.operation.$ref).toBe('#/$defs/repairOperation');
    expect(defs.step.properties.diffPreview.$ref).toBe('#/$defs/diffPreview');
    expect(defs.step.properties.repairIntent.$ref).toBe('#/$defs/repairIntent');
    expect(defs.studioStatus.properties.state.enum).toEqual(
      expect.arrayContaining(['ready', 'blocked', 'review-required', 'guidance-only'])
    );
    expect(defs.rollback.properties.strategy.enum).toEqual(
      expect.arrayContaining(['snapshot', 'idempotent', 'manual', 'none'])
    );
    expect(defs.repairOperation.oneOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'file-create' }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'file-append' }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'file-copy' }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'package-json-script' }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'json-edit' }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'env-key-add' }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'makefile-target' }),
          }),
        }),
      ])
    );
  });

  it('publishes Doctor remediation plan v2 at its canonical path and retains the v1 alias', () => {
    const canonical = readSchema('doctor-remediation-plan.v2.json');
    const legacyAlias = readSchema('doctor-remediation-plan.v1.json');

    expect(canonical.$id).toBe('https://workspai.dev/contracts/doctor-remediation-plan.v2.json');
    expect(canonical.$ref).toBe('doctor-remediation-plan.v1.json');
    expect(legacyAlias.$id).toBe('https://workspai.dev/contracts/doctor-remediation-plan.v1.json');
    expect(schemaConst(legacyAlias)).toBe('doctor-remediation-plan-v2');
  });

  it('defines cross-artifact remediation plan contract for Studio handoff', () => {
    const schema = readSchema('artifact-remediation-plan.v1.json');
    const defs = schema.$defs as Record<string, any>;
    expect(schemaConst(schema)).toBe('artifact-remediation-plan-v1');
    expect(schema.required).toEqual(
      expect.arrayContaining(['workspace', 'source', 'summary', 'actions'])
    );
    expect(defs.action.required).toEqual(
      expect.arrayContaining([
        'artifactKind',
        'cardId',
        'mode',
        'risk',
        'verifyCommand',
        'rollback',
      ])
    );
    expect(defs.action.properties.mode.enum).toEqual(
      expect.arrayContaining(['edit-file', 'run-command', 'verify-before-fix'])
    );
    expect(defs.action.properties.status.enum).toEqual(
      expect.arrayContaining(['ready', 'review-required', 'guidance-only'])
    );
    expect(defs.operation.oneOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'file-create' }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: 'run-command' }),
          }),
        }),
      ])
    );
  });
});
