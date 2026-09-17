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
import { isGraphqlLocator } from './delivery-locators.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { decodeUtf8, warning } from './provider-support.js';

export const GRAPHQL_CONTRACTS_PROVIDER_ID = 'workspai.graph.provider.graphql-contracts';

const MAX_BYTES = 4 * 1024 * 1024;
const SCHEMA_KINDS = new Set([
  'schema',
  'scalar',
  'type',
  'interface',
  'union',
  'enum',
  'input',
  'directive',
]);
const EXECUTABLE_KINDS = new Set(['query', 'mutation', 'subscription', 'fragment']);

interface GraphqlDefinition {
  readonly kind: string;
  readonly name: string;
  readonly line: number;
  readonly extended: boolean;
}

function graphqlInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => isGraphqlLocator(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

export function graphqlDefinitions(source: string): readonly GraphqlDefinition[] {
  const stripped = source.replace(/"""[\s\S]*?"""/gu, (block) => block.replace(/[^\n]/gu, ' '));
  const definitions: GraphqlDefinition[] = [];
  const pattern =
    /^(extend\s+)?(schema|scalar|type|interface|union|enum|input|directive|query|mutation|subscription|fragment)\b(?:\s+([A-Za-z_][\w]*))?/gmu;
  for (const match of stripped.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const kind = match[2] ?? 'type';
    const line = stripped.slice(0, match.index).split(/\r?\n/u).length;
    const name = match[3] ?? (kind === 'schema' ? 'schema' : `anonymous-${String(line)}`);
    definitions.push({
      kind,
      name,
      line,
      extended: Boolean(match[1]),
    });
  }
  return definitions;
}

export function createGraphqlContractsProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: GRAPHQL_CONTRACTS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'GraphQL schema and executable contracts',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'file', 'api', 'schema', 'symbol'],
      relationKinds: ['contains', 'exposes', 'defines', 'consumes'],
      relationSemantics: ['declarative', 'structural'] as const,
      factFamilies: ['contract.graphql-schema', 'contract.graphql-operation'],
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
    supportedInputs: ['graphql-contracts'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) => isGraphqlLocator(locator));
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['graphql-contracts'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = graphqlInputs(request.inputs);
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
        throw new Error('GraphQL repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('GraphQL collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const source = decodeUtf8(
            await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
          );
          const definitions = graphqlDefinitions(source);
          const file = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'file',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!file.accepted) throw new Error('GraphQL file identity could not be resolved.');
          facts.push(
            createObservedEdgeFact({
              factId: `fact:graphql-file:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'contract.graphql-schema',
              subject: repository.value.reference,
              predicate: 'contains',
              object: file.value.reference,
              request,
              source: input,
              provider: manifest,
              evidenceId: `evidence:graphql:${String(inputIndex).padStart(8, '0')}`,
              sourceKind: 'contract-declaration',
              derivation: 'declared',
              authority: 'declared',
              confidence: 1,
            })
          );
          const exposesApi = definitions.some(
            (definition) =>
              !definition.extended &&
              (definition.kind === 'schema' ||
                (definition.kind === 'type' &&
                  ['Query', 'Mutation', 'Subscription'].includes(definition.name)))
          );
          const api = exposesApi
            ? await request.resolveIdentity({
                namespace: 'graphql',
                kind: 'api',
                relativeLocator: 'api',
                caseSensitivity: 'sensitive',
                scope: request.scope,
              })
            : undefined;
          if (api?.accepted) {
            facts.push(
              createObservedEdgeFact({
                factId: `fact:graphql-api:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'contract.graphql-schema',
                subject: repository.value.reference,
                predicate: 'exposes',
                object: api.value.reference,
                request,
                source: input,
                provider: manifest,
                evidenceId: `evidence:graphql:${String(inputIndex).padStart(8, '0')}`,
                sourceKind: 'contract-declaration',
                derivation: 'declared',
                authority: 'declared',
                confidence: 1,
              })
            );
          }
          for (const [definitionIndex, definition] of definitions.entries()) {
            if (facts.length >= manifest.limits.maxFacts) {
              throw new Error('GraphQL facts exceeded the provider output budget.');
            }
            if (SCHEMA_KINDS.has(definition.kind)) {
              const schema = await request.resolveIdentity({
                namespace: 'graphql',
                kind: 'schema',
                relativeLocator: `${input.locator}:${definition.kind}:${definition.name}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!schema.accepted)
                throw new Error('GraphQL schema identity could not be resolved.');
              facts.push(
                createObservedEdgeFact({
                  factId: `fact:graphql-schema:${String(inputIndex).padStart(8, '0')}:${String(definitionIndex).padStart(8, '0')}:${input.digest.value}`,
                  factType: 'contract.graphql-schema',
                  subject: file.value.reference,
                  predicate: 'defines',
                  object: schema.value.reference,
                  request,
                  source: input,
                  provider: manifest,
                  evidenceId: `evidence:graphql:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'contract-declaration',
                  derivation: 'declared',
                  authority: 'declared',
                  confidence: 1,
                })
              );
            } else if (EXECUTABLE_KINDS.has(definition.kind)) {
              const operation = await request.resolveIdentity({
                namespace: 'graphql',
                kind: 'symbol',
                relativeLocator: `${input.locator}:${definition.kind}:${definition.name}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!operation.accepted)
                throw new Error('GraphQL operation identity could not be resolved.');
              facts.push(
                createObservedEdgeFact({
                  factId: `fact:graphql-op:${String(inputIndex).padStart(8, '0')}:${String(definitionIndex).padStart(8, '0')}:${input.digest.value}`,
                  factType: 'contract.graphql-operation',
                  subject: file.value.reference,
                  predicate: 'defines',
                  object: operation.value.reference,
                  request,
                  source: input,
                  provider: manifest,
                  evidenceId: `evidence:graphql:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'contract-declaration',
                  derivation: 'declared',
                  authority: 'declared',
                  confidence: 1,
                })
              );
              if (api?.accepted) {
                facts.push(
                  createObservedEdgeFact({
                    factId: `fact:graphql-consume:${String(inputIndex).padStart(8, '0')}:${String(definitionIndex).padStart(8, '0')}:${input.digest.value}`,
                    factType: 'contract.graphql-operation',
                    subject: operation.value.reference,
                    predicate: 'consumes',
                    object: api.value.reference,
                    request,
                    source: input,
                    provider: manifest,
                    evidenceId: `evidence:graphql:${String(inputIndex).padStart(8, '0')}`,
                    sourceKind: 'contract-declaration',
                    derivation: 'declared',
                    authority: 'declared',
                    confidence: 1,
                  })
                );
              }
            }
          }
        } catch {
          const failure = warning(
            'graph.graphql-invalid',
            input.locator,
            'GraphQL input could not be admitted as a portable contract surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.graphql-unreadable',
            scope: input.locator,
            reason: 'GraphQL topology remained unknown because the document could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'graphql-contracts', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:graphql-contracts:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'graphql-documents', observed: inputs.length, expected: inputs.length },
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
