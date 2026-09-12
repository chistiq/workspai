import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { collectGraphSemanticDependencies } from '../../src/application/collect-semantic-dependencies.js';
import { GRAPH_STANDARD_COMPOSITION_POLICY } from '../../src/application/composition-types.js';
import { digestCanonicalGraphInput } from '../../src/application/digest-canonical-graph-input.js';
import {
  CORE_GRAPH_ONTOLOGY_PROFILE,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
} from '../../src/contracts/index.js';
import type { GraphDigestPort } from '../../src/ports/index.js';

const digestPort: GraphDigestPort = {
  algorithm: 'sha256',
  digest: async (value) => createHash('sha256').update(value).digest('hex'),
};

const manifest = {
  contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
  id: 'workspai.graph.provider.fixture-a',
  version: '1',
  displayName: 'fixture',
  determinism: 'deterministic' as const,
  capabilities: {
    entityKinds: ['file'],
    relationKinds: ['contains'],
    factFamilies: ['source.file'],
    allowedClaims: ['observed'],
    relationSemantics: ['structural'] as const,
  },
  permissions: {
    filesystem: 'read' as const,
    network: 'deny' as const,
    process: 'deny' as const,
    credentials: 'deny' as const,
  },
  limits: { maxDurationMs: 1_000, maxFacts: 100, maxInputBytes: 1_024 },
  contractVersions: ['0.1.0-candidate'],
  supportedInputs: ['source-file'],
  incremental: 'input' as const,
  identitySchemes: [GRAPH_IDENTITY_SCHEME],
};

describe('collectGraphSemanticDependencies', () => {
  it('matches composition ontology and proof-policy material and isolates provider drift', async () => {
    const stamps = await collectGraphSemanticDependencies({
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      compositionPolicy: GRAPH_STANDARD_COMPOSITION_POLICY,
      redactionProfile: 'portable-default',
      providerManifests: [manifest],
      digest: digestPort,
    });
    const ontology = await digestCanonicalGraphInput(CORE_GRAPH_ONTOLOGY_PROFILE, digestPort);
    const proofPolicy = await digestCanonicalGraphInput(
      CORE_GRAPH_ONTOLOGY_PROFILE.relations.map((relation) => relation.proofPolicy),
      digestPort
    );

    expect(stamps.ontology.value).toBe(ontology.value);
    expect(stamps.proofPolicy.value).toBe(proofPolicy.value);
    expect(stamps.required).toEqual(
      expect.arrayContaining([
        stamps.ontology,
        stamps.proofPolicy,
        stamps.redaction,
        stamps.compositionPolicy,
      ])
    );

    const driftedProvider = await collectGraphSemanticDependencies({
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      compositionPolicy: GRAPH_STANDARD_COMPOSITION_POLICY,
      redactionProfile: 'portable-default',
      providerManifests: [{ ...manifest, version: '2' }],
      digest: digestPort,
    });
    expect(driftedProvider.ontology).toEqual(stamps.ontology);
    expect(driftedProvider.providers[manifest.id]?.value).not.toBe(
      stamps.providers[manifest.id]?.value
    );

    const driftedRedaction = await collectGraphSemanticDependencies({
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      compositionPolicy: GRAPH_STANDARD_COMPOSITION_POLICY,
      redactionProfile: 'strict',
      providerManifests: [manifest],
      digest: digestPort,
    });
    expect(driftedRedaction.redaction.value).not.toBe(stamps.redaction.value);
    expect(driftedRedaction.ontology).toEqual(stamps.ontology);
  });
});
