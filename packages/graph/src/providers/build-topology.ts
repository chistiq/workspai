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

export const BUILD_TOPOLOGY_PROVIDER_ID = 'workspai.graph.provider.build-topology';

const MAX_BUILD_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 500_000;
const MAX_CALLS = 100_000;

interface BuildTarget {
  readonly name: string;
  readonly dependencies: readonly string[];
}

interface BuildDocument {
  readonly targets: readonly BuildTarget[];
  readonly dynamicDependencies: boolean;
}

function basename(locator: string): string {
  return locator.slice(locator.lastIndexOf('/') + 1);
}

function buildKind(locator: string): 'bazel' | 'cmake' | null {
  const name = basename(locator);
  if (
    ['BUILD', 'BUILD.bazel', 'WORKSPACE', 'WORKSPACE.bazel', 'MODULE.bazel'].includes(name) ||
    locator.endsWith('.bzl')
  )
    return 'bazel';
  if (name === 'CMakeLists.txt' || locator.toLowerCase().endsWith('.cmake')) return 'cmake';
  return null;
}

function buildInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => buildKind(input.locator) !== null)
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function balancedCallBody(source: string, opening: number): string | null {
  let depth = 1;
  let quote: '"' | "'" | '"""' | "'''" | null = null;
  let escaped = false;
  let lineComment = false;
  for (let index = opening + 1; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (lineComment) {
      if (character === '\n' || character === '\r') lineComment = false;
      continue;
    }
    if (quote) {
      if ((quote === '"""' || quote === "'''") && source.startsWith(quote, index)) {
        quote = null;
        index += 2;
        continue;
      }
      if (quote === '"""' || quote === "'''") continue;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (source.startsWith('"""', index) || source.startsWith("'''", index)) {
      quote = source.slice(index, index + 3) as '"""' | "'''";
      index += 2;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '#') lineComment = true;
    else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(opening + 1, index);
    }
  }
  return null;
}

function calls(source: string): readonly { name: string; body: string }[] {
  const result: { name: string; body: string }[] = [];
  const pattern = /^\s*([A-Za-z_]\w*)\s*\(/gmu;
  for (const match of source.matchAll(pattern)) {
    if (result.length >= MAX_CALLS) throw new Error('Build declaration count exceeds the limit.');
    if (!match[1] || match.index === undefined) continue;
    const opening = source.indexOf('(', match.index);
    const body = balancedCallBody(source, opening);
    if (body === null) throw new Error('Build declaration parentheses are not balanced.');
    result.push({ name: match[1], body });
  }
  return result;
}

function quotedValues(source: string): string[] {
  return [...source.matchAll(/["']([^"'\r\n]+)["']/gu)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

function bazelLabel(locator: string, value: string): string {
  if (value.startsWith('//') || value.startsWith('@')) return value;
  const directory = locator.includes('/') ? locator.slice(0, locator.lastIndexOf('/')) : '';
  return value.startsWith(':') ? `//${directory}${value}` : value;
}

export function parseBazelBuildDocument(locator: string, source: string): BuildDocument {
  const targets: BuildTarget[] = [];
  let dynamicDependencies = false;
  for (const call of calls(source)) {
    const name = /\bname\s*=\s*["']([^"']+)["']/u.exec(call.body)?.[1];
    if (!name) continue;
    const depsMatch = /\bdeps\s*=\s*\[([\s\S]*?)\]/u.exec(call.body);
    if (/\bdeps\s*=/u.test(call.body) && !depsMatch) dynamicDependencies = true;
    targets.push({
      name: bazelLabel(locator, `:${name}`),
      dependencies: depsMatch
        ? [
            ...new Set(quotedValues(depsMatch[1] ?? '').map((value) => bazelLabel(locator, value))),
          ].sort()
        : [],
    });
  }
  return { targets, dynamicDependencies };
}

function cmakeArguments(body: string): string[] {
  return (
    body
      .replace(/#[^\r\n]*/gu, '')
      .match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/gu)
      ?.map((value) => value.replace(/^["']|["']$/gu, '')) ?? []
  );
}

export function parseCmakeBuildDocument(source: string): BuildDocument {
  const targets = new Map<string, Set<string>>();
  let dynamicDependencies = false;
  for (const call of calls(source)) {
    const command = call.name.toLowerCase();
    const args = cmakeArguments(call.body);
    if ((command === 'add_library' || command === 'add_executable') && args[0]) {
      if (!args[0].includes('${')) {
        const targetName = `cmake:${args[0]}`;
        targets.set(targetName, targets.get(targetName) ?? new Set());
      } else dynamicDependencies = true;
    }
    if (command === 'target_link_libraries' && args[0]) {
      const targetName = `cmake:${args[0]}`;
      const dependencies = targets.get(targetName) ?? new Set<string>();
      for (const dependency of args.slice(1)) {
        if (
          ['PRIVATE', 'PUBLIC', 'INTERFACE', 'debug', 'optimized', 'general'].includes(dependency)
        )
          continue;
        if (dependency.includes('${') || dependency.includes('$<')) dynamicDependencies = true;
        else dependencies.add(`cmake:${dependency}`);
      }
      targets.set(targetName, dependencies);
    }
  }
  return {
    targets: [...targets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, dependencies]) => ({ name, dependencies: [...dependencies].sort() })),
    dynamicDependencies,
  };
}

function safeTargetLocator(value: string): string {
  return `targets/${encodeURIComponent(value).replaceAll('.', '%2E')}`;
}

export function createBuildTopologyProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: BUILD_TOPOLOGY_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Bazel and CMake declared build topology',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'file', 'module'],
      relationKinds: ['contains', 'depends-on'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['build.target', 'build.configuration', 'build.dependency'],
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
    supportedInputs: ['bazel-declaration', 'cmake-declaration'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const kinds = new Set(request.availableInputs.map(buildKind).filter(Boolean));
      const matchedInputs = [...kinds].sort().map((kind) => `${kind}-declaration`);
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: matchedInputs.length ? 'applicable' : 'not-applicable',
        matchedInputs,
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = buildInputs(request.inputs);
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
      if (!repository.accepted) throw new Error('Build repository identity could not be resolved.');
      for (const [inputIndex, input] of inputs.entries()) {
        const inputDiagnostics: GraphDiagnostic[] = [];
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        try {
          const source = new TextDecoder('utf-8', { fatal: true }).decode(
            await request.readInput(input, { maxBytes: MAX_BUILD_BYTES, signal: request.signal })
          );
          const kind = buildKind(input.locator);
          if (!kind) continue;
          const parsed =
            kind === 'bazel'
              ? parseBazelBuildDocument(input.locator, source)
              : parseCmakeBuildDocument(source);
          const file = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'file',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!file.accepted) throw new Error('Build file identity could not be resolved.');
          let factIndex = 0;
          const append = (
            subject: GraphEntityReference,
            predicate: string,
            object: GraphEntityReference,
            factType: string
          ) => {
            if (facts.length >= MAX_FACTS) throw new Error('Build topology fact limit exceeded.');
            facts.push({
              factId: `fact:build-topology:${String(inputIndex).padStart(8, '0')}:${String(factIndex++).padStart(8, '0')}:${input.digest.value}`,
              factType,
              subject,
              predicate,
              object,
              scope: request.scope,
              evidence: [
                {
                  id: `evidence:build-topology:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: `${kind}-declaration`,
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
          for (const targetDefinition of parsed.targets) {
            const target = await request.resolveIdentity({
              namespace: `${kind}-target`,
              kind: 'module',
              relativeLocator: safeTargetLocator(targetDefinition.name),
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!target.accepted) throw new Error('Build target identity could not be resolved.');
            append(repository.value.reference, 'contains', target.value.reference, 'build.target');
            append(file.value.reference, 'contains', target.value.reference, 'build.configuration');
            for (const dependencyName of targetDefinition.dependencies) {
              const dependency = await request.resolveIdentity({
                namespace: `${kind}-target`,
                kind: 'module',
                relativeLocator: safeTargetLocator(dependencyName),
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!dependency.accepted)
                throw new Error('Build dependency identity could not be resolved.');
              append(
                target.value.reference,
                'depends-on',
                dependency.value.reference,
                'build.dependency'
              );
            }
          }
          if (parsed.dynamicDependencies) {
            unknownZones.push({
              code: 'graph.build-dependency-dynamic',
              scope: input.locator,
              reason: 'Computed build dependencies remain outside the static declaration profile.',
            });
            outcome = 'unsupported';
          }
        } catch (error) {
          const failure: GraphDiagnostic = {
            code: 'graph.build-source-invalid',
            severity: 'warning',
            path: input.locator,
            message: `Build declaration could not be decoded or parsed within the admitted boundary. ${
              error instanceof Error ? error.message : 'The parser returned an unknown error.'
            }`,
          };
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.build-topology-unknown',
            scope: input.locator,
            reason: 'Build topology is unknown because the declaration was not admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'build-topology', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }
      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:build-topology:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'build-declaration', observed: inputs.length, expected: inputs.length },
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
