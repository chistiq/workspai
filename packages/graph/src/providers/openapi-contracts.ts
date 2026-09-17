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
import { isOpenApiLocator } from './delivery-locators.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { decodeUtf8, isRecord, scalarString, warning } from './provider-support.js';
import { parseStructuredDocuments } from './structured-documents.js';

export const OPENAPI_CONTRACTS_PROVIDER_ID = 'workspai.graph.provider.openapi-contracts';

const MAX_BYTES = 4 * 1024 * 1024;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export function openApiIdentityLocator(title: string): string {
  return `apis/${encodeURIComponent(title)}`;
}

export function openApiEndpointIdentityLocator(
  title: string,
  method: string,
  route: string
): string {
  return `endpoints/${encodeURIComponent(title)}/${method}${route}`;
}

export function openApiOperationIds(source: string, locator: string): readonly string[] {
  const documents = parseStructuredDocuments(source, locator);
  const ids: string[] = [];
  for (const document of documents) {
    if (!isRecord(document) || (!document.openapi && !document.swagger && !document.asyncapi)) {
      continue;
    }
    const paths = isRecord(document.paths) ? document.paths : {};
    for (const operations of Object.values(paths)) {
      if (!isRecord(operations)) continue;
      for (const [method, operation] of Object.entries(operations)) {
        if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(operation)) continue;
        const operationId = scalarString(operation.operationId);
        if (operationId) ids.push(operationId);
      }
    }
  }
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function contractInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => isOpenApiLocator(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function apiTitle(document: Record<string, unknown>, locator: string): string {
  const info = isRecord(document.info) ? document.info : {};
  return scalarString(info.title) ?? locator.slice(locator.lastIndexOf('/') + 1);
}

export function createOpenApiContractsProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: OPENAPI_CONTRACTS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'OpenAPI, Swagger and AsyncAPI contracts',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'service', 'api', 'endpoint', 'schema', 'event'],
      relationKinds: ['exposes', 'contains', 'declares', 'depends-on'],
      relationSemantics: ['declarative', 'structural'] as const,
      factFamilies: [
        'contract.openapi-api',
        'contract.openapi-endpoint',
        'contract.openapi-schema',
        'contract.asyncapi-event',
      ],
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
    supportedInputs: ['openapi-contracts'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) => isOpenApiLocator(locator));
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['openapi-contracts'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = contractInputs(request.inputs);
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
        throw new Error('OpenAPI repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('OpenAPI collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const source = decodeUtf8(
            await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
          );
          const documents = parseStructuredDocuments(source, input.locator);
          let factIndex = 0;
          let admitted = false;
          for (const document of documents) {
            if (
              !isRecord(document) ||
              (!document.openapi && !document.swagger && !document.asyncapi)
            ) {
              continue;
            }
            admitted = true;
            const title = apiTitle(document, input.locator);
            const service = await request.resolveIdentity({
              namespace: 'openapi',
              kind: 'service',
              relativeLocator: `services/${encodeURIComponent(title)}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            const api = await request.resolveIdentity({
              namespace: 'openapi',
              kind: 'api',
              relativeLocator: openApiIdentityLocator(title),
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!service.accepted || !api.accepted) {
              throw new Error('OpenAPI identity could not be resolved.');
            }
            const edge = (
              subject: (typeof api)['value']['reference'],
              predicate: 'exposes' | 'contains' | 'declares' | 'depends-on',
              object: (typeof api)['value']['reference'],
              factType: string
            ) => {
              if (facts.length >= manifest.limits.maxFacts) {
                throw new Error('OpenAPI facts exceeded the provider output budget.');
              }
              facts.push(
                createObservedEdgeFact({
                  factId: `fact:openapi:${String(inputIndex).padStart(8, '0')}:${String(factIndex).padStart(8, '0')}:${input.digest.value}`,
                  factType,
                  subject,
                  predicate,
                  object,
                  request,
                  source: input,
                  provider: manifest,
                  evidenceId: `evidence:openapi:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'contract-declaration',
                  derivation: 'declared',
                  authority: 'declared',
                  confidence: 1,
                })
              );
              factIndex += 1;
            };
            edge(
              repository.value.reference,
              'contains',
              service.value.reference,
              'contract.openapi-api'
            );
            edge(service.value.reference, 'exposes', api.value.reference, 'contract.openapi-api');

            const schemas =
              (isRecord(document.components) && isRecord(document.components.schemas)
                ? document.components.schemas
                : undefined) ?? (isRecord(document.definitions) ? document.definitions : {});
            const schemaIds = new Map<string, typeof api.value.reference>();
            for (const schemaName of Object.keys(schemas).sort((left, right) =>
              left.localeCompare(right)
            )) {
              const schema = await request.resolveIdentity({
                namespace: 'openapi',
                kind: 'schema',
                relativeLocator: `schemas/${encodeURIComponent(title)}/${encodeURIComponent(schemaName)}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!schema.accepted)
                throw new Error('OpenAPI schema identity could not be resolved.');
              schemaIds.set(schemaName, schema.value.reference);
              edge(
                service.value.reference,
                'declares',
                schema.value.reference,
                'contract.openapi-schema'
              );
            }

            const paths = isRecord(document.paths) ? document.paths : {};
            for (const route of Object.keys(paths).sort((left, right) =>
              left.localeCompare(right)
            )) {
              const operations = isRecord(paths[route]) ? paths[route] : {};
              for (const method of Object.keys(operations)
                .filter((key) => HTTP_METHODS.has(key.toLowerCase()))
                .sort((left, right) => left.localeCompare(right))) {
                const operation = isRecord(operations[method]) ? operations[method] : {};
                const endpoint = await request.resolveIdentity({
                  namespace: 'openapi',
                  kind: 'endpoint',
                  relativeLocator: openApiEndpointIdentityLocator(
                    title,
                    method.toUpperCase(),
                    route
                  ),
                  caseSensitivity: 'sensitive',
                  scope: request.scope,
                });
                if (!endpoint.accepted) {
                  throw new Error('OpenAPI endpoint identity could not be resolved.');
                }
                edge(
                  service.value.reference,
                  'exposes',
                  endpoint.value.reference,
                  'contract.openapi-endpoint'
                );
                const serialized = JSON.stringify(operation);
                for (const [schemaName, schemaRef] of schemaIds) {
                  if (!serialized.includes(`/${schemaName}`)) continue;
                  edge(
                    endpoint.value.reference,
                    'depends-on',
                    schemaRef,
                    'contract.openapi-schema'
                  );
                }
              }
            }

            const channels = isRecord(document.channels) ? document.channels : {};
            for (const channel of Object.keys(channels).sort((left, right) =>
              left.localeCompare(right)
            )) {
              const event = await request.resolveIdentity({
                namespace: 'asyncapi',
                kind: 'event',
                relativeLocator: `events/${encodeURIComponent(title)}/${encodeURIComponent(channel)}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!event.accepted)
                throw new Error('AsyncAPI event identity could not be resolved.');
              edge(
                service.value.reference,
                'exposes',
                event.value.reference,
                'contract.asyncapi-event'
              );
            }
          }
          if (!admitted) {
            outcome = 'unsupported';
            unknownZones.push({
              code: 'graph.openapi-document-unrecognized',
              scope: input.locator,
              reason:
                'The file matched an OpenAPI locator but declared no OpenAPI, Swagger or AsyncAPI document.',
            });
          }
        } catch {
          const failure = warning(
            'graph.openapi-invalid',
            input.locator,
            'OpenAPI input could not be admitted as a portable contract surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.openapi-unreadable',
            scope: input.locator,
            reason: 'OpenAPI topology remained unknown because the contract could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'openapi-contracts', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:openapi-contracts:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'openapi-documents', observed: inputs.length, expected: inputs.length },
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
