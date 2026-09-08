import { describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  defineGraphProviderManifest,
  type GraphFactBatch,
} from '../../src/contracts/index.js';
import {
  admitGraphProviderOutput,
  validateGraphFactBatch,
  validateGraphProviderDetectionRequest,
  validateGraphProviderDetectionResult,
  validateGraphProviderManifest,
} from '../../src/conformance/index.js';

const digest = Object.freeze({ algorithm: 'sha256', value: 'a'.repeat(64) });
const scope = Object.freeze({
  kind: 'project' as const,
  projectIds: ['fixture-project'] as [string],
});

const manifest = defineGraphProviderManifest({
  contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
  id: 'fixture.typescript',
  version: '1.0.0',
  displayName: 'Fixture provider',
  determinism: 'deterministic',
  capabilities: {
    entityKinds: ['file', 'module'],
    relationKinds: ['imports'],
    relationSemantics: ['structural'],
    factFamilies: ['source.import'],
    allowedClaims: ['observed-import'],
  },
  permissions: {
    filesystem: 'read',
    network: 'deny',
    process: 'deny',
    credentials: 'deny',
  },
  limits: { maxDurationMs: 1_000, maxFacts: 10 },
  contractVersions: ['0.1.0-candidate'],
  supportedInputs: ['source-file'],
  incremental: 'input',
  identitySchemes: [GRAPH_IDENTITY_SCHEME],
});

function validBatch(): GraphFactBatch {
  return {
    contract: GRAPH_FACT_BATCH_CONTRACT,
    provider: { id: manifest.id, version: manifest.version },
    batchId: 'batch:fixture:1',
    scope,
    inputs: [{ locator: 'src/consumer.ts', digest }],
    facts: [
      {
        factId: 'fact:fixture:imports:1',
        factType: 'source.import',
        subject: {
          id: 'entity:fixture:consumer',
          identityScheme: GRAPH_IDENTITY_SCHEME,
          kind: 'file',
          scope,
          aliases: [{ id: 'entity:fixture:old-consumer', reason: 'move' }],
        },
        predicate: 'imports',
        object: {
          id: 'entity:fixture:dependency',
          identityScheme: GRAPH_IDENTITY_SCHEME,
          kind: 'module',
          scope,
        },
        scope,
        evidence: [
          {
            id: 'evidence:fixture:1',
            sourceKind: 'source-file',
            relativeLocator: 'src/consumer.ts',
            digest,
          },
        ],
        provenance: { id: manifest.id, version: manifest.version },
        derivation: 'extracted',
        authority: 'observed',
        confidence: 0.98,
        freshness: { status: 'current' },
        truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
        observedAt: '2026-09-08T12:00:00Z',
        inputDigest: digest,
        unknownZones: [],
      },
    ],
    diagnostics: [],
    coverage: [{ dimension: 'source-files', observed: 1, expected: 1 }],
    unknownZones: [],
    unsupportedZones: [],
    redaction: { policy: 'workspai.graph.default', redacted: 0, omitted: 0 },
    status: 'complete',
    processing: [
      {
        input: { locator: 'src/consumer.ts', digest },
        provider: { id: manifest.id, version: manifest.version },
        stage: { id: 'typescript-imports', version: '1' },
        outcome: 'processed',
        outputDigest: digest,
        diagnostics: [],
      },
    ],
  };
}

describe('Graph G1 foundation admission', () => {
  it('admits an evidence-backed portable batch', () => {
    expect(validateGraphProviderManifest(manifest)).toMatchObject({ accepted: true });
    expect(validateGraphFactBatch(validBatch(), manifest)).toMatchObject({ accepted: true });
  });

  it('admits provider detection only when capability and status evidence agree', () => {
    const request = {
      availableInputs: ['source-file'],
      scopeKind: 'project',
      networkAllowed: false,
    };
    const detection = {
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: 'applicable',
      matchedInputs: ['source-file'],
      missingPermissions: [],
      diagnostics: [],
    };
    expect(validateGraphProviderDetectionRequest(request)).toMatchObject({ accepted: true });
    expect(validateGraphProviderDetectionResult(detection, manifest)).toMatchObject({
      accepted: true,
    });
    expect(
      validateGraphProviderDetectionResult(
        { ...detection, status: 'blocked', missingPermissions: [] },
        manifest
      )
    ).toMatchObject({ accepted: false });
    expect(
      validateGraphProviderDetectionResult(
        { ...detection, matchedInputs: ['unclaimed-input'] },
        manifest
      )
    ).toMatchObject({ accepted: false });
  });

  it('exposes one fail-closed provider-to-composer admission boundary', () => {
    expect(admitGraphProviderOutput(manifest, validBatch())).toMatchObject({ accepted: true });
    expect(
      admitGraphProviderOutput(
        { ...manifest, permissions: { ...manifest.permissions, credentials: 'allow' } },
        validBatch()
      )
    ).toMatchObject({ accepted: false });
    expect(
      admitGraphProviderOutput(manifest, {
        ...validBatch(),
        provider: { id: 'substituted.provider', version: manifest.version },
      })
    ).toMatchObject({ accepted: false });
  });

  it.each([
    [
      'absolute POSIX evidence path',
      '/facts/0/evidence/0/relativeLocator',
      '/private/source.ts',
      'GRAPH_EVIDENCE_LOCATOR_NON_PORTABLE',
    ],
    [
      'Windows evidence path',
      '/facts/0/evidence/0/relativeLocator',
      'C:\\private\\source.ts',
      'GRAPH_EVIDENCE_LOCATOR_NON_PORTABLE',
    ],
    ['path traversal', '/inputs/0/locator', '../secret.env', 'GRAPH_FACT_BATCH_INPUT_INVALID'],
  ])('rejects %s', (_name, pointer, value, expectedCode) => {
    const batch = structuredClone(validBatch()) as unknown as Record<string, unknown>;
    const segments = pointer.split('/').slice(1);
    let cursor: unknown = batch;
    for (const segment of segments.slice(0, -1)) {
      cursor = Array.isArray(cursor)
        ? cursor[Number(segment)]
        : (cursor as Record<string, unknown>)[segment];
    }
    (cursor as Record<string, unknown>)[segments.at(-1)!] = value;

    const result = validateGraphFactBatch(batch, manifest);
    expect(result.accepted).toBe(false);
    if (!result.accepted)
      expect(result.issues.map((candidate) => candidate.code)).toContain(expectedCode);
  });

  it('rejects inferred authority inflation and provenance substitution', () => {
    const original = validBatch();
    const batch = {
      ...original,
      facts: [
        {
          ...original.facts[0],
          derivation: 'inferred' as const,
          authority: 'verified' as const,
          provenance: { id: 'foreign.provider', version: manifest.version },
        },
      ],
    };

    const result = validateGraphFactBatch(batch, manifest);
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.issues.map((candidate) => candidate.code)).toEqual(
        expect.arrayContaining([
          'GRAPH_INFERRED_FACT_CANNOT_BE_VERIFIED',
          'GRAPH_FACT_PROVENANCE_MISMATCH',
        ])
      );
    }
  });

  it('does not treat omitted input as complete or tolerate duplicate fact identity', () => {
    const original = validBatch();
    const batch = {
      ...original,
      facts: [...original.facts, original.facts[0]],
      processing: [{ ...original.processing[0], outcome: 'omitted' as const }],
    };

    const result = validateGraphFactBatch(batch, manifest);
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.issues.map((candidate) => candidate.code)).toEqual(
        expect.arrayContaining(['GRAPH_FACT_ID_DUPLICATE', 'GRAPH_COMPLETE_BATCH_HAS_GAPS'])
      );
    }
  });

  it('rejects facts outside the provider capability envelope', () => {
    const original = validBatch();
    const batch = {
      ...original,
      facts: [{ ...original.facts[0], factType: 'security.finding', predicate: 'executes' }],
    };

    const result = validateGraphFactBatch(batch, manifest);
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.issues.map((candidate) => candidate.code)).toEqual(
        expect.arrayContaining(['GRAPH_FACT_FAMILY_NOT_DECLARED', 'GRAPH_RELATION_NOT_DECLARED'])
      );
    }
  });

  it('rejects duplicate or substituted input accounting', () => {
    const original = validBatch();
    const batch = {
      ...original,
      inputs: [...original.inputs, { locator: 'src/dependency.ts', digest }],
      processing: [...original.processing, original.processing[0]],
    };

    const result = validateGraphFactBatch(batch, manifest);
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.issues.map((candidate) => candidate.code)).toContain(
        'GRAPH_INPUT_ACCOUNTING_MISMATCH'
      );
    }
  });

  it('fails closed when a provider asks for credentials or unbounded work', () => {
    const unsafe = {
      ...manifest,
      permissions: { ...manifest.permissions, credentials: 'allow' },
      limits: { ...manifest.limits, maxFacts: 0 },
    };
    const result = validateGraphProviderManifest(unsafe);
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.issues.map((candidate) => candidate.code)).toEqual(
        expect.arrayContaining([
          'GRAPH_PROVIDER_CREDENTIAL_POLICY_INVALID',
          'GRAPH_PROVIDER_LIMITS_INVALID',
        ])
      );
    }
  });
});
