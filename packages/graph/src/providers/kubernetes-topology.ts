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
import { isKubernetesLocator } from './delivery-locators.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { decodeUtf8, isRecord, scalarString, warning } from './provider-support.js';
import { parseStructuredDocuments } from './structured-documents.js';

export const KUBERNETES_TOPOLOGY_PROVIDER_ID = 'workspai.graph.provider.kubernetes-topology';

const MAX_BYTES = 4 * 1024 * 1024;
const KUBERNETES_PATH =
  /(?:^|\/)(?:k8s|kubernetes|manifests)(?:\/|$)|(?:^|\/)charts\/[^/]+\/templates(?:\/|$)/iu;
const RECORDED_INTERACTION_PATH = /(?:^|\/)(?:cassettes?|recordings?|snapshots?)(?:\/|$)/iu;

function isProbableKubernetesInput(source: string, locator: string): boolean {
  if (KUBERNETES_PATH.test(locator)) return true;
  return (
    /^apiVersion\s*:/mu.test(source) && /^kind\s*:/mu.test(source) && /^metadata\s*:/mu.test(source)
  );
}

function kubernetesInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter(
      (input) =>
        isKubernetesLocator(input.locator) && !RECORDED_INTERACTION_PATH.test(input.locator)
    )
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function resourceKind(kind: string): 'deployment' | 'service' | 'environment' {
  if (/^(?:Deployment|StatefulSet|DaemonSet|Job|CronJob|ReplicaSet)$/u.test(kind))
    return 'deployment';
  if (/^(?:Service|Ingress|Route)$/u.test(kind)) return 'service';
  return 'environment';
}

export function createKubernetesTopologyProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: KUBERNETES_TOPOLOGY_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Kubernetes resource topology',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'deployment', 'service', 'environment'],
      relationKinds: ['contains', 'deployed-as', 'runs-on'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['runtime.kubernetes-resource', 'runtime.kubernetes-namespace'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 250_000, maxInputBytes: MAX_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['kubernetes-manifests'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) => isKubernetesLocator(locator));
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['kubernetes-manifests'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = kubernetesInputs(request.inputs);
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
        throw new Error('Kubernetes repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('Kubernetes collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const source = decodeUtf8(
            await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
          );
          let admitted = 0;
          let factIndex = 0;
          if (isProbableKubernetesInput(source, input.locator)) {
            const documents = parseStructuredDocuments(source, input.locator);
            for (const document of documents) {
              if (!isRecord(document)) continue;
              const kind = scalarString(document.kind);
              const metadata = isRecord(document.metadata) ? document.metadata : {};
              const name = scalarString(metadata.name);
              const apiVersion = scalarString(document.apiVersion);
              if (!kind || !name || !apiVersion) continue;
              admitted += 1;
              const entityKind = resourceKind(kind);
              const namespace = scalarString(metadata.namespace) ?? 'default';
              const entity = await request.resolveIdentity({
                namespace: 'kubernetes',
                kind: entityKind,
                relativeLocator: `${kind}/${namespace}/${name}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              const environment = await request.resolveIdentity({
                namespace: 'kubernetes',
                kind: 'environment',
                relativeLocator: `namespaces/${namespace}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!entity.accepted || !environment.accepted) {
                throw new Error('Kubernetes identity could not be resolved.');
              }
              const predicate = entityKind === 'deployment' ? 'deployed-as' : 'contains';
              facts.push(
                createObservedEdgeFact({
                  factId: `fact:k8s:${String(inputIndex).padStart(8, '0')}:${String(factIndex).padStart(8, '0')}:${input.digest.value}`,
                  factType: 'runtime.kubernetes-resource',
                  subject: repository.value.reference,
                  predicate,
                  object: entity.value.reference,
                  request,
                  source: input,
                  provider: manifest,
                  evidenceId: `evidence:k8s:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'runtime-declaration',
                  derivation: 'declared',
                  authority: 'declared',
                  confidence: 1,
                })
              );
              factIndex += 1;
              facts.push(
                createObservedEdgeFact({
                  factId: `fact:k8s-ns:${String(inputIndex).padStart(8, '0')}:${String(factIndex).padStart(8, '0')}:${input.digest.value}`,
                  factType: 'runtime.kubernetes-namespace',
                  subject: entity.value.reference,
                  predicate: 'runs-on',
                  object: environment.value.reference,
                  request,
                  source: input,
                  provider: manifest,
                  evidenceId: `evidence:k8s:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'runtime-declaration',
                  derivation: 'declared',
                  authority: 'declared',
                  confidence: 1,
                })
              );
              factIndex += 1;
            }
          }
          if (admitted === 0) {
            outcome = 'processed';
          }
        } catch {
          const failure = warning(
            'graph.kubernetes-invalid',
            input.locator,
            'Kubernetes input could not be admitted as a portable manifest surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.kubernetes-unreadable',
            scope: input.locator,
            reason:
              'Kubernetes topology remained unknown because the manifest could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'kubernetes-topology', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:kubernetes-topology:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'kubernetes-documents',
            observed: processing.filter((entry) => entry.outcome === 'processed').length,
            expected: inputs.length,
          },
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
