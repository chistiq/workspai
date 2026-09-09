import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphDiagnostic,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export const REPOSITORY_ROUTES_PROVIDER_ID = 'workspai.graph.provider.repository-routes';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 100_000;
const SUPPORTED_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.py',
  '.go',
  '.java',
  '.cs',
]);

interface LiteralRoute {
  readonly method: string;
  readonly path: string;
}

function extension(locator: string): string {
  const basename = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot).toLowerCase();
}

function routeInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => SUPPORTED_EXTENSIONS.has(extension(input.locator)))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function appendMatches(
  source: string,
  expression: RegExp,
  methodIndex: number,
  pathIndex: number,
  routes: LiteralRoute[]
): void {
  for (const match of source.matchAll(expression)) {
    const method = match[methodIndex]?.toUpperCase();
    const routePath = match[pathIndex];
    if (
      method &&
      routePath &&
      routePath.length <= 2_048 &&
      !routePath.includes('\\') &&
      !routePath.includes('\0') &&
      !routePath.includes('${')
    )
      routes.push({ method, path: routePath });
  }
}

function syntaxView(source: string, sourceExtension: string): string {
  let result = '';
  let quote: string | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  const python = sourceExtension === '.py';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        result += character;
      } else result += ' ';
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        result += '  ';
        index += 1;
      } else result += character === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      result += character;
    } else if (python && character === '#') {
      lineComment = true;
      result += ' ';
    } else if (!python && character === '/' && next === '/') {
      lineComment = true;
      result += '  ';
      index += 1;
    } else if (!python && character === '/' && next === '*') {
      blockComment = true;
      result += '  ';
      index += 1;
    } else result += character;
  }
  return result;
}

function extractLiteralRoutes(source: string, sourceExtension: string): LiteralRoute[] {
  source = syntaxView(source, sourceExtension);
  const routes: LiteralRoute[] = [];
  if (['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'].includes(sourceExtension)) {
    appendMatches(
      source,
      /\b(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*(['"`])([^'"`\r\n]+)\2/gimu,
      1,
      3,
      routes
    );
  } else if (sourceExtension === '.py') {
    appendMatches(
      source,
      /@\s*(?:app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(['"])([^'"\r\n]+)\2/gimu,
      1,
      3,
      routes
    );
  } else if (sourceExtension === '.go') {
    appendMatches(
      source,
      /\b[A-Za-z_]\w*\s*\.\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any)\s*\(\s*(['"])([^'"\r\n]+)\2/gmu,
      1,
      3,
      routes
    );
  } else if (sourceExtension === '.java') {
    appendMatches(
      source,
      /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?(['"])([^'"\r\n]+)\2/gmu,
      1,
      3,
      routes
    );
  } else if (sourceExtension === '.cs') {
    appendMatches(
      source,
      /\[Http(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*(['"])([^'"\r\n]+)\2/gmu,
      1,
      3,
      routes
    );
    appendMatches(
      source,
      /\bMap(Get|Post|Put|Patch|Delete)\s*\(\s*(['"])([^'"\r\n]+)\2/gmu,
      1,
      3,
      routes
    );
  }
  return [
    ...new Map(routes.map((route) => [`${route.method}\0${route.path}`, route])).values(),
  ].sort(
    (left, right) => left.method.localeCompare(right.method) || left.path.localeCompare(right.path)
  );
}

function containsUnresolvedRouteSyntax(source: string, sourceExtension: string): boolean {
  source = syntaxView(source, sourceExtension);
  const candidate =
    sourceExtension === '.py'
      ? /@\s*(?:app|router)\s*\.\s*(?:get|post|put|patch|delete|options|head)\s*\(/giu
      : sourceExtension === '.java'
        ? /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\s*\(/gu
        : sourceExtension === '.cs'
          ? /(?:\[Http(?:Get|Post|Put|Patch|Delete|Options|Head)\s*\(|\bMap(?:Get|Post|Put|Patch|Delete|Methods)\s*\()/gu
          : /\b(?:app|router|server|[A-Za-z_]\w*)\s*\.\s*(?:get|post|put|patch|delete|options|head|all|any)\s*\(/giu;
  return (
    [...source.matchAll(candidate)].length > extractLiteralRoutes(source, sourceExtension).length
  );
}

export function createRepositoryRoutesProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: REPOSITORY_ROUTES_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Repository literal routes',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'endpoint'],
      relationKinds: ['exposes'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['source.literal-route'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: MAX_FACTS, maxInputBytes: 128 * 1024 * 1024 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['node-source', 'python-source', 'go-source', 'java-source', 'dotnet-source'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        SUPPORTED_EXTENSIONS.has(extension(locator))
      );
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
      const inputs = routeInputs(request.inputs);
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      for (const [inputIndex, input] of inputs.entries()) {
        const sourceExtension = extension(input.locator);
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_SOURCE_BYTES,
            signal: request.signal,
          });
          const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          const routes = extractLiteralRoutes(source, sourceExtension);
          const subject = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'file',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!subject.accepted) throw new Error('Route source identity could not be resolved.');
          for (const [routeIndex, route] of routes.entries()) {
            if (facts.length >= manifest.limits.maxFacts) {
              unknownZones.push({
                code: 'graph.literal-routes-truncated',
                scope: input.locator,
                reason: 'Literal route facts exceeded the provider output budget.',
              });
              outcome = 'omitted';
              break;
            }
            const endpoint = await request.resolveIdentity({
              namespace: 'route',
              kind: 'endpoint',
              relativeLocator: `${route.method} ${route.path}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!endpoint.accepted) {
              unknownZones.push({
                code: 'graph.literal-route-identity-unsupported',
                scope: input.locator,
                reason: 'A literal route could not be represented as a portable endpoint identity.',
              });
              outcome = 'unsupported';
              continue;
            }
            facts.push({
              factId: `fact:literal-route:${String(inputIndex).padStart(8, '0')}:${String(routeIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'source.literal-route',
              subject: subject.value.reference,
              predicate: 'exposes',
              object: endpoint.value.reference,
              scope: request.scope,
              evidence: [
                {
                  id: `evidence:literal-route:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'source-file',
                  relativeLocator: input.locator,
                  digest: input.digest,
                },
              ],
              provenance: { id: manifest.id, version: manifest.version },
              derivation: 'extracted',
              authority: 'observed',
              confidence: 1,
              freshness: { status: 'current' },
              truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
              observedAt: request.observedAt,
              inputDigest: input.digest,
              unknownZones: [],
            });
          }
          if (containsUnresolvedRouteSyntax(source, sourceExtension)) {
            unknownZones.push({
              code: 'graph.dynamic-route-unsupported',
              scope: input.locator,
              reason: 'A route declaration exists but its path is not a supported literal.',
            });
            if (outcome === 'processed') outcome = 'unsupported';
          }
        } catch {
          const diagnostic = {
            code: 'graph.route-source-invalid',
            severity: 'warning' as const,
            path: input.locator,
            message: 'Route source could not be decoded or analyzed within the admitted boundary.',
          };
          diagnostics.push(diagnostic);
          inputDiagnostics.push(diagnostic);
          unknownZones.push({
            code: 'graph.route-source-unreadable',
            scope: input.locator,
            reason: 'Literal routes are unknown because source input could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'literal-route-extraction', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }
      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:repository-routes:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [{ dimension: 'literal-routes', observed: facts.length }],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: processing.some((entry) => entry.outcome !== 'processed') ? 'partial' : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
