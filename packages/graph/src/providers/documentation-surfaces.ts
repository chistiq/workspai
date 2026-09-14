import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphUnknownZone,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';

export const DOCUMENTATION_SURFACES_PROVIDER_ID = 'workspai.graph.provider.documentation-surfaces';

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const DOCUMENT_NAME = /(?:^|\/)(?:README|ARCHITECTURE|CONTRIBUTING|SECURITY)\.md$/iu;

function documentInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => DOCUMENT_NAME.test(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function warning(code: string, scope: string, message: string): GraphDiagnostic {
  return { code, severity: 'warning', path: scope, message };
}

export function createDocumentationSurfacesProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: DOCUMENTATION_SURFACES_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Authored documentation surfaces',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'document'],
      relationKinds: ['documented-by'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['governance.document'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 10_000, maxInputBytes: MAX_DOCUMENT_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['documentation-surfaces'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) => DOCUMENT_NAME.test(locator));
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['documentation-surfaces'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = documentInputs(request.inputs);
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphUnknownZone[] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!repository.accepted) {
        throw new Error('Documentation repository identity could not be resolved.');
      }

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('Documentation collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          await request.readInput(input, {
            maxBytes: MAX_DOCUMENT_BYTES,
            signal: request.signal,
          });
          const document = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'document',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!document.accepted) throw new Error('Document identity could not be resolved.');
          if (facts.length >= manifest.limits.maxFacts) {
            outcome = 'omitted';
            unknownZones.push({
              code: 'graph.documentation-truncated',
              scope: input.locator,
              reason: 'Documentation facts exceeded the provider output budget.',
            });
          } else {
            facts.push(
              createObservedEdgeFact({
                factId: `fact:documentation:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'governance.document',
                subject: repository.value.reference,
                predicate: 'documented-by',
                object: document.value.reference,
                request,
                source: input,
                provider: manifest,
                evidenceId: `evidence:documentation:${String(inputIndex).padStart(8, '0')}`,
                sourceKind: 'document',
                derivation: 'declared',
                authority: 'declared',
                confidence: 1,
              })
            );
          }
        } catch {
          const failure = warning(
            'graph.documentation-invalid',
            input.locator,
            'Documentation input could not be admitted as a portable document surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.documentation-unreadable',
            scope: input.locator,
            reason: 'Document identity remained unknown because the file could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'documentation-surfaces', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:documentation-surfaces:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'documentation-surfaces',
            observed: inputs.length,
            expected: inputs.length,
          },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: processing.some((entry) => entry.outcome !== 'processed') ? 'partial' : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
