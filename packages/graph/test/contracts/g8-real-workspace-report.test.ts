import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function compile(name: string) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8')) as object;
  return new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: false,
  }).compile(schema);
}

describe('G8 real-workspace evidence contracts', () => {
  it('admits the valid platform report and rejects authority, path and mapping forgeries', () => {
    const validate = compile('g8-real-workspace-platform-report.v1-candidate.schema.json');
    const valid = JSON.parse(
      fs.readFileSync(
        path.join(root, 'fixtures/g8/valid-real-workspace-platform-report.json'),
        'utf8'
      )
    ) as object;
    const invalid = JSON.parse(
      fs.readFileSync(
        path.join(root, 'fixtures/g8/invalid-real-workspace-platform-report.json'),
        'utf8'
      )
    ) as object;

    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(invalid)).toBe(false);
    expect(JSON.stringify(invalid)).toMatch(/\/home\/example\//);
    expect(JSON.stringify(invalid)).not.toMatch(/\/home\/runner(?:\/|$)/);
  });

  it('rejects G9 authorization and unbounded evidence collections', () => {
    const validate = compile('g8-real-workspace-matrix-admission.v1-candidate.schema.json');
    expect(
      validate({
        schemaVersion: 'workspai.graph-g8-real-workspace-matrix-admission.v1-candidate',
        package: '@workspai/graph',
        stage: 'G8',
        checkpoint: 'real-workspace-cross-platform-parity',
        status: 'pr-candidate',
        admitted: false,
        nextStage: 'G9',
        nextStageAuthorized: false,
        crossPlatformAdmission: 'pending',
        currentGraphAuthority: 'official-internal-graph-capability',
        authorizedRuntimeMode: 'g8-shadow-comparison-only',
        sourceCommit: 'a'.repeat(40),
        testedCommit: 'b'.repeat(40),
        runId: '1',
        event: 'pull_request',
        inventoryDigest: `sha256:${'c'.repeat(64)}`,
        mappingVersion: 'workspai.graph-shadow-mapping.v1',
        requiredRunnerOperatingSystems: ['Linux', 'macOS', 'Windows'],
        evidence: [],
        failures: [],
      }),
      JSON.stringify(validate.errors)
    ).toBe(true);
    expect(
      validate({
        schemaVersion: 'workspai.graph-g8-real-workspace-matrix-admission.v1-candidate',
        package: '@workspai/graph',
        stage: 'G8',
        checkpoint: 'real-workspace-cross-platform-parity',
        status: 'pr-candidate',
        admitted: false,
        nextStage: 'G9',
        nextStageAuthorized: true,
        crossPlatformAdmission: 'pending',
        currentGraphAuthority: 'official-internal-graph-capability',
        authorizedRuntimeMode: 'g8-shadow-comparison-only',
        sourceCommit: 'a'.repeat(40),
        testedCommit: 'b'.repeat(40),
        runId: '1',
        event: 'pull_request',
        inventoryDigest: `sha256:${'c'.repeat(64)}`,
        mappingVersion: 'workspai.graph-shadow-mapping.v1',
        requiredRunnerOperatingSystems: ['Linux', 'macOS', 'Windows'],
        evidence: [],
        failures: [],
      })
    ).toBe(false);
  });
});
