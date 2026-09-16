import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
} from '../contracts/index.js';
import { isArchitectureDecisionLocator } from './delivery-locators.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { warning } from './provider-support.js';

export const ARCHITECTURE_DECISIONS_PROVIDER_ID = 'workspai.graph.provider.architecture-decisions';

const MAX_BYTES = 2 * 1024 * 1024;

function decisionInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => isArchitectureDecisionLocator(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

export function createArchitectureDecisionsProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: ARCHITECTURE_DECISIONS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Architecture decision records',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'decision'],
      relationKinds: ['decided-by'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['governance.decision'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 20_000, maxInputBytes: MAX_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['architecture-decisions'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        isArchitectureDecisionLocator(locator)
      );
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['architecture-decisions'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = decisionInputs(request.inputs);
      const facts: GraphFactBatch['facts'][number][] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!repository.accepted)
        throw new Error('Architecture-decision repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted)
          throw new Error('Architecture-decision collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal });
          const decision = await request.resolveIdentity({
            namespace: 'architecture-decision',
            kind: 'decision',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!decision.accepted)
            throw new Error('Architecture-decision identity could not be resolved.');
          facts.push(
            createObservedEdgeFact({
              factId: `fact:adr:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'governance.decision',
              subject: repository.value.reference,
              predicate: 'decided-by',
              object: decision.value.reference,
              request,
              source: input,
              provider: manifest,
              evidenceId: `evidence:adr:${String(inputIndex).padStart(8, '0')}`,
              sourceKind: 'document',
              derivation: 'declared',
              authority: 'declared',
              confidence: 1,
            })
          );
        } catch {
          const failure = warning(
            'graph.architecture-decision-invalid',
            input.locator,
            'Architecture decision could not be admitted as a portable governance surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.architecture-decision-unreadable',
            scope: input.locator,
            reason:
              'Architecture decisions remained unknown because the document could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'architecture-decisions', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:architecture-decisions:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'architecture-decisions', observed: inputs.length, expected: inputs.length },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status:
          processing.some((entry) => entry.outcome !== 'processed') || unknownZones.length > 0
            ? 'partial'
            : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
