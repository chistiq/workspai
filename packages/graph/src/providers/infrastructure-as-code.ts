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
import { isInfrastructureLocator } from './delivery-locators.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { basenameOf, decodeUtf8, isRecord, scalarString, warning } from './provider-support.js';
import { parseStructuredDocuments } from './structured-documents.js';

export const INFRASTRUCTURE_AS_CODE_PROVIDER_ID = 'workspai.graph.provider.infrastructure-as-code';

const MAX_BYTES = 4 * 1024 * 1024;

function iacInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => isInfrastructureLocator(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function terraformKind(resourceType: string): 'database' | 'queue' | 'deployment' {
  if (/(?:db|sql|rds|database)/iu.test(resourceType)) return 'database';
  if (/(?:queue|kafka|sqs|pubsub|servicebus)/iu.test(resourceType)) return 'queue';
  return 'deployment';
}

export function createInfrastructureAsCodeProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: INFRASTRUCTURE_AS_CODE_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Dockerfile, Terraform and Helm infrastructure',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'container', 'image', 'deployment', 'database', 'queue'],
      relationKinds: ['deployed-as', 'declares', 'requires'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['runtime.dockerfile', 'runtime.terraform', 'runtime.helm-chart'],
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
    supportedInputs: ['infrastructure-as-code'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        isInfrastructureLocator(locator)
      );
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['infrastructure-as-code'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = iacInputs(request.inputs);
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
        throw new Error('Infrastructure repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('Infrastructure collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const source = decodeUtf8(
            await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
          );
          const name = basenameOf(input.locator);
          let factIndex = 0;
          const emit = async (
            predicate: 'deployed-as' | 'declares' | 'requires',
            kind: 'container' | 'image' | 'deployment' | 'database' | 'queue',
            locator: string,
            factType: string,
            subject = repository.value.reference
          ) => {
            const object = await request.resolveIdentity({
              namespace: 'infrastructure',
              kind,
              relativeLocator: locator,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!object.accepted) throw new Error('Infrastructure identity could not be resolved.');
            if (facts.length >= manifest.limits.maxFacts) {
              throw new Error('Infrastructure facts exceeded the provider output budget.');
            }
            facts.push(
              createObservedEdgeFact({
                factId: `fact:iac:${String(inputIndex).padStart(8, '0')}:${String(factIndex).padStart(8, '0')}:${input.digest.value}`,
                factType,
                subject,
                predicate,
                object: object.value.reference,
                request,
                source: input,
                provider: manifest,
                evidenceId: `evidence:iac:${String(inputIndex).padStart(8, '0')}`,
                sourceKind: 'runtime-declaration',
                derivation: 'declared',
                authority: 'declared',
                confidence: 1,
              })
            );
            factIndex += 1;
            return object.value.reference;
          };
          if (/^Dockerfile(?:\..+)?$/iu.test(name)) {
            const images = [...source.matchAll(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+([^\s]+))?/gimu)].map(
              (match) => match[1] ?? ''
            );
            const container = await emit(
              'deployed-as',
              'container',
              `dockerfile/${input.locator}`,
              'runtime.dockerfile'
            );
            for (const image of images.filter(Boolean)) {
              await emit(
                'requires',
                'image',
                `images/${encodeURIComponent(image)}`,
                'runtime.dockerfile',
                container
              );
            }
          } else if (/\.tf$/iu.test(name)) {
            for (const resource of source.matchAll(
              /^\s*resource\s+["']([^"']+)["']\s+["']([^"']+)["']/gmu
            )) {
              const resourceType = resource[1] ?? 'resource';
              const resourceName = resource[2] ?? 'unnamed';
              const kind = terraformKind(resourceType);
              await emit(
                kind === 'deployment' ? 'deployed-as' : 'declares',
                kind,
                `terraform/${resourceType}/${resourceName}`,
                'runtime.terraform'
              );
            }
          } else {
            const document = parseStructuredDocuments(source, input.locator)[0];
            const chartName =
              (isRecord(document) ? scalarString(document.name) : undefined) ?? name;
            await emit(
              'deployed-as',
              'deployment',
              `helm/${encodeURIComponent(chartName)}`,
              'runtime.helm-chart'
            );
          }
        } catch {
          const failure = warning(
            'graph.infrastructure-invalid',
            input.locator,
            'Infrastructure input could not be admitted as a portable runtime surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.infrastructure-unreadable',
            scope: input.locator,
            reason:
              'Infrastructure topology remained unknown because the definition could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'infrastructure-as-code', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:infrastructure-as-code:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'infrastructure-documents',
            observed: inputs.length,
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
