import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export const REPOSITORY_FILES_PROVIDER_ID = 'workspai.graph.provider.repository-files';

export function createRepositoryFilesProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: REPOSITORY_FILES_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Repository files',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'file'],
      relationKinds: ['contains'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['source.file'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 100_000 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['repository-files'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => ({
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: request.availableInputs.length > 0 ? 'applicable' : 'not-applicable',
      matchedInputs: request.availableInputs.length > 0 ? ['repository-files'] : [],
      missingPermissions: [],
      diagnostics: [],
    }),
    collect: async (request) => {
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!repository.accepted) {
        throw new Error(`Repository identity failed: ${repository.issues[0]?.code ?? 'unknown'}`);
      }

      const facts: GraphWorkspaceFact[] = [];
      for (const [index, input] of request.inputs.entries()) {
        if (request.signal?.aborted) throw new Error('Repository file collection was cancelled.');
        const file = await request.resolveIdentity({
          namespace: 'workspai',
          kind: 'file',
          relativeLocator: input.locator,
          caseSensitivity: 'sensitive',
          scope: request.scope,
        });
        if (!file.accepted) {
          throw new Error(
            `File identity failed for ${input.locator}: ${file.issues[0]?.code ?? 'unknown'}`
          );
        }
        facts.push({
          factId: `fact:repository-file:${String(index).padStart(8, '0')}:${input.digest.value}`,
          factType: 'source.file',
          subject: repository.value.reference,
          predicate: 'contains',
          object: file.value.reference,
          scope: request.scope,
          evidence: [
            {
              id: `evidence:repository-file:${String(index).padStart(8, '0')}`,
              sourceKind: 'source-file',
              relativeLocator: input.locator,
              digest: input.digest,
            },
          ],
          provenance: { id: manifest.id, version: manifest.version },
          derivation: 'observed',
          authority: 'observed',
          confidence: 1,
          freshness: { status: 'current' },
          truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
          observedAt: request.observedAt,
          inputDigest: input.digest,
          unknownZones: [],
        });
      }

      const batch: GraphFactBatch = {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:repository-files:${request.inputs.length}`,
        scope: request.scope,
        inputs: request.inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics: [],
        coverage: [
          {
            dimension: 'repository-files',
            observed: request.inputs.length,
            expected: request.inputs.length,
          },
        ],
        unknownZones: [],
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: 'complete',
        processing: request.inputs.map((input) => ({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'repository-file-inventory', version: manifest.version },
          outcome: 'processed',
          outputDigest: input.digest,
          diagnostics: [],
        })),
      };
      return batch;
    },
  };
}
