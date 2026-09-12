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

export const PROTOBUF_TOPOLOGY_PROVIDER_ID = 'workspai.graph.provider.protobuf-topology';

const MAX_PROTO_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 500_000;
const MAX_DECLARATIONS = 100_000;

interface ProtoService {
  readonly name: string;
  readonly methods: readonly string[];
}

interface ProtoDocument {
  readonly packageName?: string;
  readonly imports: readonly string[];
  readonly schemas: readonly string[];
  readonly services: readonly ProtoService[];
}

function protoInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => input.locator.toLowerCase().endsWith('.proto'))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function stripComments(source: string): string {
  let result = '';
  let state: 'code' | 'line-comment' | 'block-comment' | 'string' = 'code';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') {
        state = 'code';
        result += character;
      }
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        state = 'code';
        index += 1;
      } else if (character === '\n' || character === '\r') result += character;
      continue;
    }
    if (state === 'string') {
      result += character;
      if (character === '\\' && next) {
        result += next;
        index += 1;
      } else if (character === '"') state = 'code';
      continue;
    }
    if (character === '"') {
      state = 'string';
      result += character;
    } else if (character === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
    } else if (character === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
    } else result += character;
  }
  if (state === 'block-comment' || state === 'string')
    throw new Error('Protobuf source ends inside an unterminated comment or string.');
  return result;
}

function declarationName(packageName: string | undefined, name: string): string {
  return packageName ? `${packageName}.${name}` : name;
}

export function parseProtobufDocument(source: string): ProtoDocument {
  const syntax = stripComments(source);
  let balance = 0;
  for (const character of syntax.replace(/"(?:\\.|[^"\\])*"/gu, '')) {
    if (character === '{') balance += 1;
    if (character === '}') balance -= 1;
    if (balance < 0) throw new Error('Protobuf declaration braces are not balanced.');
  }
  if (balance !== 0) throw new Error('Protobuf declaration braces are not balanced.');

  const packageName = /^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/mu.exec(syntax)?.[1];
  const imports = [...syntax.matchAll(/^\s*import\s+(?:(?:public|weak)\s+)?"([^"\r\n]+)"\s*;/gmu)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const schemas = [...syntax.matchAll(/^\s*(?:message|enum)\s+([A-Za-z_]\w*)\s*\{/gmu)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const services: ProtoService[] = [];
  const servicePattern = /\bservice\s+([A-Za-z_]\w*)\s*\{/gu;
  for (const serviceMatch of syntax.matchAll(servicePattern)) {
    const name = serviceMatch[1];
    if (!name || serviceMatch.index === undefined) continue;
    const bodyStart = serviceMatch.index + serviceMatch[0].length;
    let depth = 1;
    let cursor = bodyStart;
    for (; cursor < syntax.length && depth > 0; cursor += 1) {
      if (syntax[cursor] === '{') depth += 1;
      else if (syntax[cursor] === '}') depth -= 1;
    }
    if (depth !== 0) throw new Error('Protobuf service braces are not balanced.');
    const body = syntax.slice(bodyStart, cursor - 1);
    const methods = [...body.matchAll(/\brpc\s+([A-Za-z_]\w*)\s*\(/gu)]
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value));
    services.push({ name, methods: [...new Set(methods)].sort() });
  }
  if (imports.length + schemas.length + services.length > MAX_DECLARATIONS)
    throw new Error('Protobuf declaration count exceeds the provider limit.');
  return {
    ...(packageName ? { packageName } : {}),
    imports: [...new Set(imports)].sort(),
    schemas: [...new Set(schemas)].sort(),
    services: services.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function diagnostic(path: string): GraphDiagnostic {
  return {
    code: 'graph.protobuf-source-invalid',
    severity: 'warning',
    path,
    message: 'Protobuf source could not be decoded or parsed within the admitted boundary.',
  };
}

export function createProtobufTopologyProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: PROTOBUF_TOPOLOGY_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Protobuf service and contract topology',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'contract', 'service', 'endpoint', 'schema'],
      relationKinds: ['declares', 'contains', 'requires', 'implements', 'exposes'],
      relationSemantics: ['declarative', 'structural'] as const,
      factFamilies: [
        'contract.protobuf',
        'contract.protobuf-import',
        'contract.protobuf-schema',
        'contract.protobuf-service',
        'contract.protobuf-rpc',
      ],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: MAX_FACTS, maxInputBytes: 128 * 1024 * 1024 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['protobuf-source'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        locator.toLowerCase().endsWith('.proto')
      );
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['protobuf-source'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = protoInputs(request.inputs);
      const facts: GraphWorkspaceFact[] = [];
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
        throw new Error('Protobuf repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        const inputDiagnostics: GraphDiagnostic[] = [];
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        try {
          const source = new TextDecoder('utf-8', { fatal: true }).decode(
            await request.readInput(input, { maxBytes: MAX_PROTO_BYTES, signal: request.signal })
          );
          const parsed = parseProtobufDocument(source);
          const contract = await request.resolveIdentity({
            namespace: 'repository-contract',
            kind: 'contract',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!contract.accepted)
            throw new Error('Protobuf contract identity could not be resolved.');
          let factIndex = 0;
          const append = (
            subject: GraphEntityReference,
            predicate: string,
            object: GraphEntityReference,
            factType: string
          ) => {
            if (facts.length >= MAX_FACTS) throw new Error('Protobuf fact limit exceeded.');
            facts.push({
              factId: `fact:protobuf:${String(inputIndex).padStart(8, '0')}:${String(factIndex++).padStart(8, '0')}:${input.digest.value}`,
              factType,
              subject,
              predicate,
              object,
              scope: request.scope,
              evidence: [
                {
                  id: `evidence:protobuf:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'contract-declaration',
                  relativeLocator: input.locator,
                  digest: input.digest,
                },
              ],
              provenance: { id: manifest.id, version: manifest.version },
              derivation: 'extracted',
              authority: 'declared',
              confidence: 1,
              freshness: { status: 'current' },
              truthLifecycle: { invalidatedBy: ['input-change', 'deletion', 'provider-change'] },
              observedAt: request.observedAt,
              inputDigest: input.digest,
              unknownZones: [],
            });
          };
          append(
            repository.value.reference,
            'declares',
            contract.value.reference,
            'contract.protobuf'
          );
          for (const imported of parsed.imports) {
            const importedContract = await request.resolveIdentity({
              namespace: 'repository-contract',
              kind: 'contract',
              relativeLocator: imported,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!importedContract.accepted)
              throw new Error('Imported Protobuf identity could not be resolved.');
            append(
              contract.value.reference,
              'requires',
              importedContract.value.reference,
              'contract.protobuf-import'
            );
          }
          for (const schemaName of parsed.schemas) {
            const schema = await request.resolveIdentity({
              namespace: 'protobuf-schema',
              kind: 'schema',
              relativeLocator: declarationName(parsed.packageName, schemaName),
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!schema.accepted)
              throw new Error('Protobuf schema identity could not be resolved.');
            append(
              contract.value.reference,
              'declares',
              schema.value.reference,
              'contract.protobuf-schema'
            );
          }
          for (const serviceDefinition of parsed.services) {
            const qualifiedService = declarationName(parsed.packageName, serviceDefinition.name);
            const service = await request.resolveIdentity({
              namespace: 'protobuf-service',
              kind: 'service',
              relativeLocator: qualifiedService,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!service.accepted)
              throw new Error('Protobuf service identity could not be resolved.');
            append(
              repository.value.reference,
              'contains',
              service.value.reference,
              'contract.protobuf-service'
            );
            append(
              service.value.reference,
              'implements',
              contract.value.reference,
              'contract.protobuf-service'
            );
            for (const method of serviceDefinition.methods) {
              const endpoint = await request.resolveIdentity({
                namespace: 'protobuf-rpc',
                kind: 'endpoint',
                relativeLocator: `${qualifiedService}/${method}`,
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!endpoint.accepted)
                throw new Error('Protobuf RPC identity could not be resolved.');
              append(
                service.value.reference,
                'exposes',
                endpoint.value.reference,
                'contract.protobuf-rpc'
              );
            }
          }
        } catch (error) {
          const failure = {
            ...diagnostic(input.locator),
            message: `${diagnostic(input.locator).message} ${
              error instanceof Error ? error.message : 'The parser returned an unknown error.'
            }`,
          };
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.protobuf-topology-unknown',
            scope: input.locator,
            reason: 'Protobuf declarations are unknown because the source was not admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'protobuf-topology', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }
      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:protobuf-topology:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'protobuf-source', observed: inputs.length, expected: inputs.length },
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
