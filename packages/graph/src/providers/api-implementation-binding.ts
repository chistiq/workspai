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
import { isGeneratedSource } from './generated-source.js';
import {
  MATRIX_SOURCE_EXTENSIONS,
  extractMatrixDeclarations,
  matrixLanguageFor,
} from './matrix-source-language.js';
import { createObservedEdgeFact, extensionOf } from './observed-edge-fact.js';
import { openApiEndpointIdentityLocator, openApiOperationIds } from './openapi-contracts.js';
import { parseStructuredDocuments } from './structured-documents.js';
import { decodeUtf8, isRecord, scalarString, warning } from './provider-support.js';

export const API_IMPLEMENTATION_BINDING_PROVIDER_ID =
  'workspai.graph.provider.api-implementation-binding';

const MAX_BYTES = 2 * 1024 * 1024;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function handlerScore(locator: string): number {
  const artifact = locator.toLowerCase();
  let score = 0;
  if (/(^|\/)(routes?|handlers?|controllers?|server|httpapi)(\/|$)/u.test(artifact)) score += 100;
  if (/(?:^|\/)(?:api|routes?|handlers?|controllers?|server)(?:\.[a-z0-9]+)$/u.test(artifact)) {
    score += 80;
  }
  if (/(^|\/)(src|app|lib)(\/|$)/u.test(artifact)) score += 20;
  if (/(^|\/)(protocol|sdk|client)(\/|$)/u.test(artifact)) score -= 30;
  return score;
}

function handlerDeclaration(source: string, locator: string, operationId: string): boolean {
  return extractMatrixDeclarations(source, matrixLanguageFor(locator)).some(
    (item) =>
      item.name === operationId &&
      (item.detail === 'function' || item.detail === 'method' || item.detail === 'value')
  );
}

function endpointsForOperation(
  source: string,
  locator: string,
  operationId: string
): readonly { title: string; method: string; route: string }[] {
  const documents = parseStructuredDocuments(source, locator);
  const matches: { title: string; method: string; route: string }[] = [];
  for (const document of documents) {
    if (!isRecord(document) || (!document.openapi && !document.swagger)) continue;
    const info = isRecord(document.info) ? document.info : {};
    const title = scalarString(info.title) ?? locator.slice(locator.lastIndexOf('/') + 1);
    const paths = isRecord(document.paths) ? document.paths : {};
    for (const [route, operations] of Object.entries(paths)) {
      if (!isRecord(operations)) continue;
      for (const [method, operation] of Object.entries(operations)) {
        if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(operation)) continue;
        if (scalarString(operation.operationId) === operationId) {
          matches.push({ title, method: method.toUpperCase(), route });
        }
      }
    }
  }
  return matches;
}

export function createApiImplementationBindingProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: API_IMPLEMENTATION_BINDING_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'OpenAPI operation implementation binding',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'endpoint'],
      relationKinds: ['implements'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['contract.api-implementation'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 50_000, maxInputBytes: MAX_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['openapi-contracts', 'source-declarations'],
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
        matchedInputs: applicable ? [...manifest.supportedInputs] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const contracts = request.inputs
        .filter((input) => isOpenApiLocator(input.locator))
        .sort((left, right) => left.locator.localeCompare(right.locator));
      const sources = request.inputs
        .filter((input) => MATRIX_SOURCE_EXTENSIONS.has(extensionOf(input.locator)))
        .sort((left, right) => left.locator.localeCompare(right.locator));
      const facts: GraphFactBatch['facts'][number][] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const operationFiles = new Map<
        string,
        { file: GraphProviderInput; source: string; score: number }
      >();
      const contractSources = new Map<string, { input: GraphProviderInput; source: string }>();

      for (const input of contracts) {
        if (request.signal?.aborted)
          throw new Error('API implementation collection was cancelled.');
        try {
          const source = decodeUtf8(
            await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
          );
          contractSources.set(input.locator, { input, source });
          processing.push({
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'api-implementation-binding', version: manifest.version },
            outcome: 'processed',
            outputDigest: input.digest,
            diagnostics: [],
          });
        } catch {
          const failure = warning(
            'graph.api-binding-contract-invalid',
            input.locator,
            'OpenAPI contract could not be admitted for implementation binding.'
          );
          diagnostics.push(failure);
          unknownZones.push({
            code: 'graph.api-binding-contract-unreadable',
            scope: input.locator,
            reason:
              'Implementation binding skipped this contract because it could not be admitted.',
          });
          processing.push({
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'api-implementation-binding', version: manifest.version },
            outcome: 'failed',
            diagnostics: [failure],
          });
        }
      }

      for (const input of sources) {
        if (request.signal?.aborted)
          throw new Error('API implementation collection was cancelled.');
        const score = handlerScore(input.locator);
        if (score < 50) continue;
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_BYTES,
            signal: request.signal,
          });
          const source = decodeUtf8(bytes);
          processing.push({
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'api-implementation-binding', version: manifest.version },
            outcome: 'processed',
            outputDigest: input.digest,
            diagnostics: [],
          });
          if (isGeneratedSource(input.locator, source)) continue;
          for (const [, contract] of contractSources) {
            for (const operationId of openApiOperationIds(
              contract.source,
              contract.input.locator
            )) {
              if (!handlerDeclaration(source, input.locator, operationId)) continue;
              const current = operationFiles.get(operationId);
              if (
                current &&
                (current.score > score ||
                  (current.score === score &&
                    current.file.locator.localeCompare(input.locator) <= 0))
              ) {
                continue;
              }
              operationFiles.set(operationId, { file: input, source, score });
            }
          }
        } catch {
          const failure = warning(
            'graph.api-binding-source-unreadable',
            input.locator,
            'A handler candidate could not be admitted for operation-identifier binding.'
          );
          diagnostics.push(failure);
          unknownZones.push({
            code: 'graph.api-binding-source-unreadable',
            scope: input.locator,
            reason: 'A handler candidate could not be admitted for operation-identifier binding.',
          });
          processing.push({
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'api-implementation-binding', version: manifest.version },
            outcome: 'failed',
            diagnostics: [failure],
          });
        }
      }

      for (const [locator, contract] of [...contractSources.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )) {
        for (const operationId of openApiOperationIds(contract.source, contract.input.locator)) {
          if (operationFiles.has(operationId)) continue;
          unknownZones.push({
            code: 'graph.api-binding-unbound',
            scope: locator,
            reason: `No function, method, or value declaration named ${operationId} was observed in handler sources.`,
          });
        }
      }

      let factIndex = 0;
      for (const [operationId, match] of [...operationFiles.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )) {
        const file = await request.resolveIdentity({
          namespace: 'workspai',
          kind: 'file',
          relativeLocator: match.file.locator,
          caseSensitivity: 'sensitive',
          scope: request.scope,
        });
        if (!file.accepted) continue;
        for (const [, contract] of contractSources) {
          for (const endpointSpec of endpointsForOperation(
            contract.source,
            contract.input.locator,
            operationId
          )) {
            const endpoint = await request.resolveIdentity({
              namespace: 'openapi',
              kind: 'endpoint',
              relativeLocator: openApiEndpointIdentityLocator(
                endpointSpec.title,
                endpointSpec.method,
                endpointSpec.route
              ),
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!endpoint.accepted) continue;
            facts.push(
              createObservedEdgeFact({
                factId: `fact:api-binding:${String(factIndex).padStart(8, '0')}:${match.file.digest.value}`,
                factType: 'contract.api-implementation',
                subject: file.value.reference,
                predicate: 'implements',
                object: endpoint.value.reference,
                request,
                source: match.file,
                provider: manifest,
                evidenceId: `evidence:api-binding:${String(factIndex).padStart(8, '0')}`,
                sourceKind: 'source-file',
                derivation: 'extracted',
                authority: 'observed',
                confidence: 0.8,
              })
            );
            factIndex += 1;
          }
        }
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:api-implementation-binding:${contracts.length}`,
        scope: request.scope,
        inputs: processing.map((entry) => entry.input),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'openapi-operation-bindings',
            observed: facts.length,
            expected: [...contractSources.values()].reduce(
              (count, contract) =>
                count + openApiOperationIds(contract.source, contract.input.locator).length,
              0
            ),
          },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: unknownZones.length > 0 ? 'partial' : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
