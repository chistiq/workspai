import { parseDocument } from 'yaml';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphEntityReference,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export const COMPOSE_TOPOLOGY_PROVIDER_ID = 'workspai.graph.provider.compose-topology';

const MAX_COMPOSE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 250_000;
const MAX_SERVICES = 10_000;
const MAX_DEPENDENCIES_PER_SERVICE = 10_000;

interface ComposeService {
  readonly name: string;
  readonly dependencies: readonly string[];
  readonly image?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function composeInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => /(?:^|\/)(?:docker-)?compose(?:\.[^/]+)?\.ya?ml$/iu.test(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function scalarString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function dependencyNames(value: unknown): string[] {
  const names = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : isRecord(value)
      ? Object.keys(value)
      : [];
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function parseCompose(source: string): {
  readonly services: readonly ComposeService[];
  readonly diagnostics: readonly string[];
} {
  const document = parseDocument(source, {
    schema: 'core',
    merge: false,
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (document.errors.length > 0) {
    throw new Error('Compose YAML is not valid under the safe core schema.');
  }
  const value: unknown = document.toJS({ maxAliasCount: 100 });
  if (value === null) return { services: [], diagnostics: [] };
  if (!isRecord(value)) throw new Error('Compose document root must be a mapping.');
  if (value.services === undefined) return { services: [], diagnostics: [] };
  if (!isRecord(value.services)) throw new Error('Compose services must be a mapping.');

  const entries = Object.entries(value.services).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length > MAX_SERVICES) throw new Error('Compose service count exceeds the limit.');
  const diagnostics: string[] = [];
  const services: ComposeService[] = [];
  for (const [name, definition] of entries) {
    if (!name.trim() || !isRecord(definition)) {
      diagnostics.push(name || '<empty>');
      continue;
    }
    const dependencies = dependencyNames(definition.depends_on);
    if (dependencies.length > MAX_DEPENDENCIES_PER_SERVICE) {
      throw new Error('Compose dependency count exceeds the per-service limit.');
    }
    services.push({
      name,
      dependencies,
      ...(scalarString(definition.image) ? { image: scalarString(definition.image) } : {}),
    });
  }
  return { services, diagnostics };
}

function evidence(input: GraphProviderInput, index: number) {
  return {
    id: `evidence:compose-topology:${String(index).padStart(8, '0')}`,
    sourceKind: 'runtime-declaration',
    relativeLocator: input.locator,
    digest: input.digest,
  } as const;
}

function fact(
  input: GraphProviderInput,
  inputIndex: number,
  factIndex: number,
  subject: GraphEntityReference,
  predicate: string,
  object: GraphEntityReference,
  factType: string,
  scope: GraphWorkspaceFact['scope'],
  observedAt: string
): GraphWorkspaceFact {
  return {
    factId: `fact:compose-topology:${String(inputIndex).padStart(8, '0')}:${String(factIndex).padStart(8, '0')}:${input.digest.value}`,
    factType,
    subject,
    predicate,
    object,
    scope,
    evidence: [evidence(input, inputIndex)],
    provenance: { id: COMPOSE_TOPOLOGY_PROVIDER_ID, version: '0.1.0-candidate' },
    derivation: 'extracted',
    authority: 'declared',
    confidence: 1,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change', 'deletion', 'provider-change'] },
    observedAt,
    inputDigest: input.digest,
    unknownZones: [],
  };
}

export function createComposeTopologyProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: COMPOSE_TOPOLOGY_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Docker Compose service topology',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'file', 'service', 'container', 'image'],
      relationKinds: ['contains', 'configured-by', 'depends-on', 'deployed-as', 'requires'],
      relationSemantics: ['structural', 'declarative'] as const,
      factFamilies: [
        'runtime.compose-service',
        'runtime.compose-configuration',
        'runtime.compose-dependency',
        'runtime.compose-container',
        'runtime.compose-image',
      ],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: MAX_FACTS, maxInputBytes: MAX_COMPOSE_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['docker-compose-yaml'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => ({
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: composeInputs(
        request.availableInputs.map((locator) => ({
          locator,
          mediaType: 'application/yaml',
          byteLength: 0,
          digest: { algorithm: 'sha256', value: '0'.repeat(64) },
        }))
      ).length
        ? 'applicable'
        : 'not-applicable',
      matchedInputs: request.availableInputs.some((locator) =>
        /(?:^|\/)(?:docker-)?compose(?:\.[^/]+)?\.ya?ml$/iu.test(locator)
      )
        ? ['docker-compose-yaml']
        : [],
      missingPermissions: [],
      diagnostics: [],
    }),
    collect: async (request) => {
      const inputs = composeInputs(request.inputs);
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const parsedInputs = new Map<string, ReturnType<typeof parseCompose>>();
      const parseFailures = new Map<string, unknown>();
      for (const input of inputs) {
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_COMPOSE_BYTES,
            signal: request.signal,
          });
          parsedInputs.set(
            input.locator,
            parseCompose(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
          );
        } catch (error) {
          parseFailures.set(input.locator, error);
        }
      }
      const globallyDeclaredServices = new Set(
        [...parsedInputs.values()].flatMap((parsed) =>
          parsed.services.map((service) => service.name)
        )
      );
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!repository.accepted)
        throw new Error('Compose repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const parsed = parsedInputs.get(input.locator);
          if (!parsed)
            throw parseFailures.get(input.locator) ?? new Error('Compose input missing.');
          const sourceFile = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'file',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!sourceFile.accepted) throw new Error('Compose file identity could not be resolved.');
          let factIndex = 0;
          for (const service of parsed.services) {
            const serviceIdentity = await request.resolveIdentity({
              namespace: 'compose-service',
              kind: 'service',
              relativeLocator: `services/${encodeURIComponent(service.name)}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            const containerIdentity = await request.resolveIdentity({
              namespace: 'compose-container',
              kind: 'container',
              relativeLocator: `containers/${encodeURIComponent(service.name)}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!serviceIdentity.accepted || !containerIdentity.accepted) {
              throw new Error('Compose service identity could not be resolved.');
            }
            const append = (
              subject: GraphEntityReference,
              predicate: string,
              object: GraphEntityReference,
              factType: string
            ) => {
              if (facts.length >= MAX_FACTS) throw new Error('Compose fact limit exceeded.');
              facts.push(
                fact(
                  input,
                  inputIndex,
                  factIndex++,
                  subject,
                  predicate,
                  object,
                  factType,
                  request.scope,
                  request.observedAt
                )
              );
            };
            append(
              repository.value.reference,
              'contains',
              serviceIdentity.value.reference,
              'runtime.compose-service'
            );
            append(
              serviceIdentity.value.reference,
              'configured-by',
              sourceFile.value.reference,
              'runtime.compose-configuration'
            );
            append(
              serviceIdentity.value.reference,
              'deployed-as',
              containerIdentity.value.reference,
              'runtime.compose-container'
            );
            if (service.image) {
              const imageIdentity = await request.resolveIdentity({
                namespace: 'compose-image',
                kind: 'image',
                relativeLocator: `images/${encodeURIComponent(service.image)}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!imageIdentity.accepted)
                throw new Error('Compose image identity could not be resolved.');
              append(
                containerIdentity.value.reference,
                'requires',
                imageIdentity.value.reference,
                'runtime.compose-image'
              );
            }
            for (const dependency of service.dependencies) {
              const dependencyIdentity = await request.resolveIdentity({
                namespace: 'compose-service',
                kind: 'service',
                relativeLocator: `services/${encodeURIComponent(dependency)}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!dependencyIdentity.accepted) {
                throw new Error('Compose dependency identity could not be resolved.');
              }
              append(
                serviceIdentity.value.reference,
                'depends-on',
                dependencyIdentity.value.reference,
                'runtime.compose-dependency'
              );
              if (!globallyDeclaredServices.has(dependency)) {
                unknownZones.push({
                  code: 'graph.compose-dependency-unresolved',
                  scope: `${input.locator}#services/${service.name}/depends_on/${dependency}`,
                  reason:
                    'The dependency is not declared by any Compose document in the repository inventory.',
                });
              }
            }
          }
          for (const invalidService of parsed.diagnostics) {
            unknownZones.push({
              code: 'graph.compose-service-definition-invalid',
              scope: `${input.locator}#services/${invalidService}`,
              reason: 'The Compose service definition is not a mapping.',
            });
            outcome = 'unsupported';
          }
        } catch (error) {
          const item: GraphDiagnostic = {
            code: 'graph.compose-document-invalid',
            severity: 'warning',
            path: input.locator,
            message:
              error instanceof Error ? error.message : 'Compose input could not be analyzed.',
          };
          diagnostics.push(item);
          inputDiagnostics.push(item);
          unknownZones.push({
            code: 'graph.compose-topology-unknown',
            scope: input.locator,
            reason: 'Compose topology could not be extracted within the safe parser boundary.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'compose-topology', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:compose-topology:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'compose-documents', observed: inputs.length, expected: inputs.length },
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
