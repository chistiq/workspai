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
import { maskMatrixSourceLiterals, matchAllInMatrixCodeView } from './matrix-source-mask.js';
import { createObservedEdgeFact, extensionOf } from './observed-edge-fact.js';
import { openApiEndpointIdentityLocator, openApiOperationIds } from './openapi-contracts.js';
import { parseStructuredDocuments } from './structured-documents.js';
import { decodeUtf8, isRecord, scalarString, warning } from './provider-support.js';

export const API_IMPLEMENTATION_BINDING_PROVIDER_ID =
  'workspai.graph.provider.api-implementation-binding';

const MAX_BYTES = 2 * 1024 * 1024;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function handlerDeclaration(
  declarations: readonly { name: string; detail: string }[],
  operationId: string
): boolean {
  return declarations.some(
    (item) =>
      item.name === operationId &&
      (item.detail === 'function' || item.detail === 'method' || item.detail === 'value')
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const HTTP_FRAMEWORK_SPECIFIER =
  /^(?:express|fastify|koa|hono|@hono\/hono|koa-router|@koa\/router|restify|polka|@tinyhttp\/app|oak|@oak\/oak)(?:\/|$)/iu;

function addNamedImportLocals(inner: string, names: Set<string>): void {
  for (const part of inner.split(',')) {
    const item = part.trim();
    if (!item || item.startsWith('type ')) continue;
    const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u.exec(item);
    if (aliased?.[2]) {
      names.add(aliased[2]);
      continue;
    }
    const name = /^([A-Za-z_$][\w$]*)$/u.exec(item)?.[1];
    if (name) names.add(name);
  }
}

function collectionReceiverNames(source: string, codeView: string): Set<string> {
  const names = new Set<string>();
  const pattern =
    /^[^\S\r\n]*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*new\s+(?:globalThis\.)?(?:Map|Set|WeakMap|WeakSet|Headers|URLSearchParams)\b/gmu;
  for (const match of matchAllInMatrixCodeView(source, codeView, pattern)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

function httpFrameworkImportNames(source: string, codeView: string): Set<string> {
  const names = new Set<string>();
  const pattern = /^[^\S\r\n]*import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"\r\n]+)['"]/gmu;
  for (const match of matchAllInMatrixCodeView(source, codeView, pattern)) {
    const specifier = match[2] ?? '';
    if (!HTTP_FRAMEWORK_SPECIFIER.test(specifier)) continue;
    const clause = (match[1] ?? '').trim();
    const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/u.exec(clause);
    const defaultAndNamed = /^([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}$/u.exec(clause);
    const namedOnly = /^\{([^}]*)\}$/u.exec(clause);
    const defaultOnly = /^([A-Za-z_$][\w$]*)$/u.exec(clause);
    if (namespace?.[1]) names.add(namespace[1]);
    else if (defaultAndNamed?.[1]) {
      names.add(defaultAndNamed[1]);
      addNamedImportLocals(defaultAndNamed[2] ?? '', names);
    } else if (namedOnly?.[1] !== undefined) addNamedImportLocals(namedOnly[1], names);
    else if (defaultOnly?.[1]) names.add(defaultOnly[1]);
  }
  return names;
}

function httpFactoryReceiverNames(
  source: string,
  codeView: string,
  frameworkImports: ReadonlySet<string>
): Set<string> {
  const names = new Set<string>();
  const pattern =
    /^[^\S\r\n]*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?(express|fastify|Router|Koa|Hono|polka)\s*(?:<[^>]*>)?\s*\(/gmu;
  for (const match of matchAllInMatrixCodeView(source, codeView, pattern)) {
    if (match[1] && match[2] && frameworkImports.has(match[2])) names.add(match[1]);
  }
  return names;
}

function isHttpRouteReceiver(
  receiver: string,
  collections: ReadonlySet<string>,
  frameworkImports: ReadonlySet<string>,
  factories: ReadonlySet<string>
): boolean {
  if (!receiver || collections.has(receiver)) return false;
  return frameworkImports.has(receiver) || factories.has(receiver);
}

interface HttpRegistrationContext {
  readonly codeView: string;
  readonly collections: ReadonlySet<string>;
  readonly frameworkImports: ReadonlySet<string>;
  readonly factories: ReadonlySet<string>;
}

function createHttpRegistrationContext(source: string, locator: string): HttpRegistrationContext {
  const codeView = maskMatrixSourceLiterals(source, matrixLanguageFor(locator));
  const collections = collectionReceiverNames(source, codeView);
  const frameworkImports = httpFrameworkImportNames(source, codeView);
  return {
    codeView,
    collections,
    frameworkImports,
    factories: httpFactoryReceiverNames(source, codeView, frameworkImports),
  };
}

function isRoutedHandler(
  source: string,
  operationId: string,
  declarations: readonly { name: string; detail: string }[],
  method: string,
  route: string,
  context: HttpRegistrationContext
): boolean {
  if (!handlerDeclaration(declarations, operationId)) return false;
  const ident = escapeRegExp(operationId);
  const path = escapeRegExp(route);
  const methodToken = escapeRegExp(method.toLowerCase());
  const quote = `['"\u0060]`;
  const exact = new RegExp(
    String.raw`\b([A-Za-z_$][\w$]*)\s*\.\s*${methodToken}\s*\(\s*${quote}${path}${quote}\s*,\s*(?:[A-Za-z_$][\w$]*\.)*${ident}\b`,
    'gi'
  );
  const wildcard = new RegExp(
    String.raw`\b([A-Za-z_$][\w$]*)\s*\.\s*(?:use|all)\s*\(\s*${quote}${path}${quote}\s*,\s*(?:[A-Za-z_$][\w$]*\.)*${ident}\b`,
    'gi'
  );
  const routed = (pattern: RegExp): boolean =>
    matchAllInMatrixCodeView(source, context.codeView, pattern).some((match) =>
      isHttpRouteReceiver(
        match[1] ?? '',
        context.collections,
        context.frameworkImports,
        context.factories
      )
    );
  return routed(exact) || routed(wildcard);
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
        {
          file: GraphProviderInput;
          operationId: string;
          contractLocator: string;
          method: string;
          route: string;
          title: string;
        }
      >();
      const ambiguousRegistrations = new Map<
        string,
        { contractLocator: string; operationId: string; locators: Set<string> }
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
          const registration = createHttpRegistrationContext(source, input.locator);
          const declarations = extractMatrixDeclarations(
            source,
            matrixLanguageFor(input.locator),
            registration.codeView
          );
          for (const [contractLocator, contract] of contractSources) {
            for (const operationId of openApiOperationIds(
              contract.source,
              contract.input.locator
            )) {
              for (const endpointSpec of endpointsForOperation(
                contract.source,
                contract.input.locator,
                operationId
              )) {
                if (
                  !isRoutedHandler(
                    source,
                    operationId,
                    declarations,
                    endpointSpec.method,
                    endpointSpec.route,
                    registration
                  )
                ) {
                  continue;
                }
                const key = `${contractLocator}\u0000${operationId}\u0000${endpointSpec.method}\u0000${endpointSpec.route}`;
                const current = operationFiles.get(key);
                const ambiguous = ambiguousRegistrations.get(key);
                if (ambiguous) {
                  ambiguous.locators.add(input.locator);
                  continue;
                }
                if (current && current.file.locator !== input.locator) {
                  operationFiles.delete(key);
                  ambiguousRegistrations.set(key, {
                    contractLocator,
                    operationId,
                    locators: new Set([current.file.locator, input.locator]),
                  });
                  continue;
                }
                operationFiles.set(key, {
                  file: input,
                  operationId,
                  contractLocator,
                  method: endpointSpec.method,
                  route: endpointSpec.route,
                  title: endpointSpec.title,
                });
              }
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

      const ambiguousEndpoints = new Set<string>();
      for (const [endpointKey, ambiguity] of ambiguousRegistrations) {
        ambiguousEndpoints.add(endpointKey);
        unknownZones.push({
          code: 'graph.api-binding-ambiguous',
          scope: ambiguity.contractLocator,
          reason: `Multiple routed handlers named ${ambiguity.operationId} were observed in ${[
            ...ambiguity.locators,
          ]
            .sort((left, right) => left.localeCompare(right))
            .join(', ')}; no implementation edge was selected.`,
        });
      }

      for (const [locator, contract] of [...contractSources.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )) {
        for (const operationId of openApiOperationIds(contract.source, contract.input.locator)) {
          for (const endpoint of endpointsForOperation(
            contract.source,
            contract.input.locator,
            operationId
          )) {
            const endpointKey = `${locator}\u0000${operationId}\u0000${endpoint.method}\u0000${endpoint.route}`;
            if (operationFiles.has(endpointKey) || ambiguousEndpoints.has(endpointKey)) continue;
            unknownZones.push({
              code: 'graph.api-binding-unbound',
              scope: locator,
              reason: `No ${endpoint.method} ${endpoint.route} registration for handler ${operationId} was observed for this contract.`,
            });
          }
        }
      }

      let factIndex = 0;
      for (const [, match] of [...operationFiles.entries()].sort(([left], [right]) =>
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
        const endpoint = await request.resolveIdentity({
          namespace: 'openapi',
          kind: 'endpoint',
          relativeLocator: openApiEndpointIdentityLocator(match.title, match.method, match.route),
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
                count +
                openApiOperationIds(contract.source, contract.input.locator).reduce(
                  (operations, operationId) =>
                    operations +
                    endpointsForOperation(contract.source, contract.input.locator, operationId)
                      .length,
                  0
                ),
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
