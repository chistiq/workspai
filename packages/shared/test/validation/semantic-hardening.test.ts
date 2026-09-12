import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isWisCoreResultEnvelope,
  validateWisCoreResultEnvelope,
} from '../../src/validation/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = path.join(packageRoot, 'fixtures/core/v0.2.0-draft/valid-pass.json');

interface MutableFixture {
  [key: string]: unknown;
  generation: { id: string; generatedAt: string; parents?: string[] };
  freshness: { status: string; evaluatedAt?: string; invalidationCauses?: string[] };
  operationOutcome: string;
  status: string;
  compatibility: { status: string; unsupportedCapabilities?: string[] };
  unknowns: unknown[];
  omissions: unknown[];
  diagnostics: unknown[];
  evidence: unknown[];
}

function fixture(): MutableFixture {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as MutableFixture;
}

function expectCode(value: unknown, code: string): void {
  const result = validateWisCoreResultEnvelope(value);
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  }
}

describe('Core semantic hardening', () => {
  it('exposes a type guard for valid and invalid values', () => {
    expect(isWisCoreResultEnvelope(fixture())).toBe(true);
    expect(isWisCoreResultEnvelope({})).toBe(false);
  });

  it('rejects invalid limit configuration', () => {
    expect(() => validateWisCoreResultEnvelope(fixture(), { limits: { maxDepth: 0 } })).toThrow(
      RangeError
    );
    expect(() => validateWisCoreResultEnvelope(fixture(), { limits: { maxNodes: 1.5 } })).toThrow(
      RangeError
    );
    expect(() =>
      validateWisCoreResultEnvelope(fixture(), { limits: { maxDiagnostics: 1_001 } })
    ).toThrow('maxDiagnostics exceeds the hard safety ceiling');
    expect(() => validateWisCoreResultEnvelope(fixture(), { limits: { maxDepth: 65 } })).toThrow(
      'maxDepth exceeds the hard safety ceiling'
    );
  });

  it('returns a stable cancellation diagnostic through the public validator', () => {
    expect(validateWisCoreResultEnvelope(fixture(), { signal: { aborted: true } })).toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ code: 'WIS_RESOURCE_CANCELLED' })],
    });
  });

  it('enforces generation and freshness timestamps', () => {
    const invalidGeneration = fixture();
    invalidGeneration.generation.generatedAt = '2026-02-30T00:00:00Z';
    expectCode(invalidGeneration, 'WIS_SEMANTIC_INVALID_GENERATION_TIME');

    const invalidFreshness = fixture();
    invalidFreshness.freshness.evaluatedAt = 'not-a-time';
    expectCode(invalidFreshness, 'WIS_STRUCTURAL_PATTERN');

    const impossibleFreshness = fixture();
    impossibleFreshness.freshness.evaluatedAt = '2026-13-01T00:00:00Z';
    expectCode(impossibleFreshness, 'WIS_SEMANTIC_INVALID_FRESHNESS_TIME');
  });

  it('enforces operation/result coherence', () => {
    const failedOperation = fixture();
    failedOperation.operationOutcome = 'failed';
    expectCode(failedOperation, 'WIS_SEMANTIC_FAILED_OPERATION_VERDICT');

    const cancelledPass = fixture();
    cancelledPass.operationOutcome = 'cancelled';
    expectCode(cancelledPass, 'WIS_SEMANTIC_CANCELLED_OPERATION_VERDICT');
  });

  it('requires partial, stale and compatibility explanations', () => {
    const partial = fixture();
    partial.status = 'partial';
    expectCode(partial, 'WIS_SEMANTIC_PARTIAL_WITHOUT_OMISSION');

    const stale = fixture();
    stale.freshness.status = 'stale';
    expectCode(stale, 'WIS_SEMANTIC_STALE_WITHOUT_CAUSE');

    const conditional = fixture();
    conditional.compatibility.status = 'conditionally-compatible';
    expectCode(conditional, 'WIS_SEMANTIC_COMPATIBILITY_WITHOUT_REASON');
  });

  it('fails closed for organization scope unless the exact profile is admitted', () => {
    const value = fixture();
    value.scope = { kind: 'organization', organizationId: 'organization:fixture' };

    expectCode(value, 'WIS_SEMANTIC_ORGANIZATION_SCOPE_NOT_ADMITTED');
    expect(
      validateWisCoreResultEnvelope(value, {
        policy: { organizationScopeProfiles: ['wis.profile.fixture'] },
      })
    ).toMatchObject({ valid: true });
    expect(
      validateWisCoreResultEnvelope(value, {
        policy: { organizationScopeProfiles: ['wis.profile.other'] },
      })
    ).toMatchObject({
      valid: false,
      diagnostics: [
        expect.objectContaining({ code: 'WIS_SEMANTIC_ORGANIZATION_SCOPE_NOT_ADMITTED' }),
      ],
    });
  });

  it.each(['unknowns', 'omissions'] as const)(
    'rejects pass with status-affecting %s',
    (collection) => {
      const value = fixture();
      value[collection] = [
        collection === 'unknowns'
          ? { code: 'UNKNOWN', subject: 'fixture', reason: 'unknown', affectsStatus: true }
          : {
              code: 'OMITTED',
              reason: 'omitted',
              affectsStatus: true,
              recoverable: false,
            },
      ];
      expectCode(value, 'WIS_SEMANTIC_FALSE_PASS');
    }
  );

  it('checks artifact and diagnostic evidence locators', () => {
    const artifact = fixture();
    artifact.evidence = [
      {
        id: 'evidence:artifact',
        sourceKind: 'source',
        artifact: {
          id: 'artifact:source',
          generationId: 'generation:source',
          relativeLocator: 'C:\\private\\source.ts',
        },
      },
    ];
    expectCode(artifact, 'WIS_SEMANTIC_NON_PORTABLE_LOCATOR');

    const diagnosticEvidence = fixture();
    diagnosticEvidence.status = 'attention';
    diagnosticEvidence.diagnostics = [
      {
        code: 'FIXTURE',
        severity: 'warning',
        message: 'fixture',
        affectsStatus: false,
        evidence: [
          {
            id: 'evidence:diagnostic',
            sourceKind: 'source',
            relativeLocator: 'https://example.com/source.ts',
          },
        ],
      },
    ];
    expectCode(diagnosticEvidence, 'WIS_SEMANTIC_NON_PORTABLE_LOCATOR');
  });
});
