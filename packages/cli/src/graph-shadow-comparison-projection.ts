import {
  GRAPH_COMPARABLE_SURFACE,
  GRAPH_GENERATED_ARTIFACT,
  GRAPH_INVENTORY_SURFACE,
  GRAPH_LOCATOR_IDENTITY,
  WORKSPACE_IDENTITY_INPUT_LOCATOR,
} from './graph-package-runtime.js';

export const GRAPH_SHADOW_MAPPING_VERSION = 'workspai.graph-shadow-mapping.v2' as const;

const SOURCE_CODE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.dart',
  '.ex',
  '.exs',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.mts',
  '.php',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.scala',
  '.svelte',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
  '.clj',
  '.cljs',
  '.fs',
  '.fsx',
  '.lua',
  '.vb',
]);

export const GRAPH_SHADOW_SOURCE_CODE_EXTENSIONS = Object.freeze([...SOURCE_CODE_EXTENSIONS]);

const TEST_DIRECTORY_NAMES = new Set(['test', 'tests', 'spec', 'specs', '__tests__']);

export const GRAPH_SHADOW_KIND_MAPPINGS = GRAPH_COMPARABLE_SURFACE.kindAliases;
export const GRAPH_SHADOW_RELATION_MAPPINGS = GRAPH_COMPARABLE_SURFACE.relationAliases;

export const GRAPH_SHADOW_UNSAFE_DIFFERENCE_CODES = Object.freeze([
  'GRAPH_SHADOW_UNSAFE_IDENTITY',
  'GRAPH_SHADOW_UNSAFE_PROOF_LOCATOR',
]);

const ENTITY_RENDERING = /^entity:([^:]+):([^:]+):(.+)$/u;
const HTTP_ROUTE_METHOD = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|HTTP|ALL)$/u;
const SOURCE_ENDPOINT_KEY =
  /^source-endpoint:[^:]+:(?:.*):((?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|HTTP|ALL)):(\/.*)?$/u;
const OPENAPI_ENDPOINT_KEY =
  /^endpoint:[^:]+:(?:.*):((?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|HTTP|ALL)):(\/.*)?$/u;

function decodeOpaqueDeclaredLocator(locator: string): string | undefined {
  const classified = GRAPH_LOCATOR_IDENTITY.classify(locator, 'endpoint');
  if (classified.class === 'opaque') {
    const encoded = classified.locator.slice(classified.locator.indexOf('/') + 1);
    try {
      return decodeURIComponent(encoded.replaceAll('%2E', '.'));
    } catch {
      return undefined;
    }
  }
  if (locator.startsWith('encoded/')) {
    return locator.slice('encoded/'.length);
  }
  return undefined;
}

function comparableHttpRouteIdentity(locator: string): GraphShadowProjectedIdentity | undefined {
  const opaque = decodeOpaqueDeclaredLocator(locator);
  const declared = opaque ?? locator;
  const spaced = /^([A-Za-z]+)\s+(\/.*)$/u.exec(declared);
  if (spaced?.[1] && spaced[2] !== undefined) {
    const method = spaced[1].toUpperCase();
    if (HTTP_ROUTE_METHOD.test(method)) {
      return { status: 'comparable', identity: `endpoint:${method}:${spaced[2] || '/'}` };
    }
  }
  const sourceEndpoint = SOURCE_ENDPOINT_KEY.exec(locator);
  if (sourceEndpoint?.[1]) {
    return {
      status: 'comparable',
      identity: `endpoint:${sourceEndpoint[1]}:${sourceEndpoint[2] || '/'}`,
    };
  }
  const openApiEndpoint = OPENAPI_ENDPOINT_KEY.exec(locator);
  if (openApiEndpoint?.[1]) {
    return {
      status: 'comparable',
      identity: `endpoint:${openApiEndpoint[1]}:${openApiEndpoint[2] || '/'}`,
    };
  }
  return undefined;
}
export const MAX_URI_DECODE_ROUNDS = GRAPH_LOCATOR_IDENTITY.maxUriDecodeRounds;

function isContentPathKind(kind: string): boolean {
  const mapped = kind.normalize('NFC').toLowerCase();
  return mapped === 'file' || mapped === 'document' || mapped === 'test';
}

function locatorExtension(locator: string): string {
  const basename = locator.slice(Math.max(locator.lastIndexOf('/'), locator.lastIndexOf('\\')) + 1);
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot).toLowerCase();
}

/**
 * Test-file surfaces that the released CLI models as a project-level
 * test-suite, not as per-file `test` or `file` nodes.
 */
export function isGraphShadowTestSurfaceLocator(locator: string): boolean {
  const normalized = locator.normalize('NFC').replaceAll('\\', '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => TEST_DIRECTORY_NAMES.has(segment))) return true;
  const name = segments.at(-1) ?? '';
  const extensionIndex = name.lastIndexOf('.');
  if (extensionIndex <= 0) return false;
  const stem = name.slice(0, extensionIndex);
  return (
    stem.endsWith('.test') ||
    stem.endsWith('.spec') ||
    stem.endsWith('_test') ||
    stem.startsWith('test_')
  );
}

export function isGraphShadowSourceCodeLocator(locator: string): boolean {
  return SOURCE_CODE_EXTENSIONS.has(locatorExtension(locator));
}

function collapseProjectTestIdentity(mapped: string, projectId: string): string | undefined {
  if (!projectId) return undefined;
  for (const prefix of [`tests:${projectId}`, `test:${projectId}`]) {
    if (mapped === prefix) return `test:${projectId}`;
    if (!mapped.startsWith(`${prefix}:`)) continue;
    const rest = mapped.slice(prefix.length + 1);
    if (rest.length > 0 && !rest.includes('/') && !rest.includes('\\')) {
      return `test:${projectId}`;
    }
  }
  return undefined;
}

/**
 * Binding-precision call KPIs. They report examined/resolved/ambiguous/unresolved
 * sites and are not inventory truncation. The released CLI composer has no
 * equivalent coverage surface, so G8 completeness must not treat their
 * `attention` statuses as `GRAPH_SHADOW_COMPLETENESS_DIFFERENT`.
 */
export const GRAPH_SHADOW_BINDING_PRECISION_COVERAGE_DIMENSIONS = Object.freeze([
  'source-calls-examined',
  'source-calls-resolved',
  'source-calls-ambiguous',
  'source-calls-unresolved',
  'source-calls-external',
] as const);

export function isGraphShadowTruncatingCoverage(observation: {
  readonly dimension: string;
  readonly status: string;
}): boolean {
  if (
    (GRAPH_SHADOW_BINDING_PRECISION_COVERAGE_DIMENSIONS as readonly string[]).includes(
      observation.dimension
    )
  ) {
    return false;
  }
  return observation.status !== 'pass';
}

/**
 * Mapped relation kinds the released CLI composer actually emits. Package
 * ontology relations such as `exports` stay outside the G8 shadow surface
 * until the official composer claims them too.
 */
export const GRAPH_SHADOW_CLI_COMPATIBLE_RELATIONS = Object.freeze([
  'calls',
  'configured-by',
  'consumes',
  'contains',
  'decided-by',
  'defines',
  'deployed-as',
  'deploys',
  'depends-on',
  'documented-by',
  'documents',
  'equivalent-to',
  'exposes',
  'generated-by',
  'generated-from',
  'implements',
  'implements-protocol',
  'imports',
  'owned-by',
  'owns',
  'produced-by',
  'produces',
  'publishes',
  'references',
  'runs-on',
  'tests',
  'uses-language',
]);

const CLI_COMPATIBLE_RELATION_SET = new Set<string>(GRAPH_SHADOW_CLI_COMPATIBLE_RELATIONS);

/**
 * Released-CLI comparable claims for G8 shadow. Package truth-depth extras
 * that the official composer does not emit stay outside this surface.
 */
export function isGraphShadowCliCompatibleIdentity(identity: string, kind: string): boolean {
  const mappedKind = mapShadowKind(kind);
  if (mappedKind === 'command' && identity.includes('.#')) return false;
  if (mappedKind === 'module' && identity.startsWith('module:node:')) return false;
  if (mappedKind === 'file' && identity.startsWith('file:')) {
    const locator = identity.slice('file:'.length);
    return isGraphShadowSourceCodeLocator(locator) && !isGraphShadowTestSurfaceLocator(locator);
  }
  if (mappedKind === 'symbol' && identity.startsWith('symbol:')) {
    const rest = identity.slice('symbol:'.length);
    const parts = rest.split(':');
    const file = parts.length >= 3 ? parts.slice(0, -2).join(':') : rest;
    return !isGraphShadowTestSurfaceLocator(file);
  }
  if (mappedKind === 'document' && identity.startsWith('document:')) {
    return isGraphShadowSourceCodeLocator(identity.slice('document:'.length));
  }
  return true;
}

export function isGraphShadowCliCompatibleRelation(
  relation: string,
  overrides?: Readonly<Record<string, string>>
): boolean {
  const mapped = mapShadowRelation(relation, overrides);
  return CLI_COMPATIBLE_RELATION_SET.has(relation) || CLI_COMPATIBLE_RELATION_SET.has(mapped);
}

export function isGraphShadowComparableSourceProofLocator(locator: string): boolean {
  if (locator === WORKSPACE_IDENTITY_INPUT_LOCATOR) return false;
  if (GRAPH_INVENTORY_SURFACE.classifyLocator(locator).class !== 'source') return false;
  if (isGraphShadowTestSurfaceLocator(locator)) return false;
  return isGraphShadowSourceCodeLocator(locator);
}

export function isGraphShadowComparableDiagnostic(code: string): boolean {
  return !code.endsWith('.empty_result');
}

export type GraphShadowProjectedIdentity =
  | { readonly status: 'comparable'; readonly identity: string }
  | { readonly status: 'unsafe'; readonly locator: string };

export type GraphShadowProjectedLocator =
  | { readonly status: 'source'; readonly locator: string }
  | { readonly status: 'generated-artifact'; readonly locator: string }
  | { readonly status: 'unsafe'; readonly locator: string };

export type GraphShadowLocatorDecode =
  | { readonly status: 'stable'; readonly value: string }
  | { readonly status: 'unstable'; readonly value: string }
  | { readonly status: 'malformed'; readonly value: string };

export function decodeComparableLocatorState(
  value: string,
  kind = 'file'
): GraphShadowLocatorDecode {
  const decoded = GRAPH_LOCATOR_IDENTITY.decode(value, {
    freezeOpaqueDeclared: !isContentPathKind(kind),
  });
  return decoded.status === 'unstable'
    ? { status: 'unstable', value: decoded.value }
    : { status: 'stable', value: decoded.value };
}

export function decodeComparableLocator(value: string, kind = 'file'): string {
  const decoded = decodeComparableLocatorState(value, kind);
  return decoded.status === 'stable' ? decoded.value : value;
}

export function normalizeComparablePath(value: string, kind = 'file'): string {
  const classified = GRAPH_LOCATOR_IDENTITY.classify(value, kind);
  if (classified.class === 'opaque') return classified.locator;
  return decodeComparableLocator(value, kind)
    .normalize('NFC')
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/')
    .replace(/\/+$/u, '');
}

export function isUnsafeComparableLocator(value: string, kind = 'file'): boolean {
  return GRAPH_LOCATOR_IDENTITY.classify(value, kind).class === 'unsafe';
}

export function isGeneratedWorkspaceControlLocator(value: string, projectId = ''): boolean {
  if (isUnsafeComparableLocator(value, 'file')) return false;
  const normalized = stripDuplicatedProjectPrefix(value, projectId);
  return GRAPH_GENERATED_ARTIFACT.classifyLocator(normalized).class === 'generated-artifact';
}

export function stripDuplicatedProjectPrefix(locator: string, projectId: string): string {
  const classified = GRAPH_LOCATOR_IDENTITY.classify(locator, 'file');
  if (classified.class === 'opaque') return classified.locator;
  const normalized = normalizeComparablePath(locator, 'file');
  if (!projectId) return normalized;
  if (normalized === projectId) return '.';
  const prefix = `${projectId}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

export function mapShadowKind(kind: string, overrides?: Readonly<Record<string, string>>): string {
  return GRAPH_COMPARABLE_SURFACE.mapKind(kind, overrides);
}

export function mapShadowRelation(
  relation: string,
  overrides?: Readonly<Record<string, string>>
): string {
  return GRAPH_COMPARABLE_SURFACE.mapRelation(relation, overrides);
}

export function parseRenderedPackageIdentity(
  value: string
): { readonly namespace: string; readonly kind: string; readonly locator: string } | null {
  const match = ENTITY_RENDERING.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  if (match[3].startsWith('sha256:')) return null;
  const decoded = decodeComparableLocatorState(match[3], match[2]);
  if (decoded.status !== 'stable') return null;
  return {
    namespace: match[1],
    kind: match[2],
    locator: decoded.value,
  };
}

function preparedPath(
  locator: string,
  projectId: string,
  kind = 'file'
): GraphShadowProjectedLocator {
  const classified = GRAPH_LOCATOR_IDENTITY.classify(locator, kind);
  if (classified.class === 'unsafe') {
    const decoded = decodeComparableLocatorState(locator, kind);
    return {
      status: 'unsafe',
      locator: decoded.status === 'stable' ? decoded.value : classified.locator,
    };
  }
  if (classified.class === 'opaque') {
    return { status: 'source', locator: classified.locator };
  }
  const stripped = stripDuplicatedProjectPrefix(classified.locator, projectId);
  if (isUnsafeComparableLocator(stripped, kind)) {
    return { status: 'unsafe', locator: stripped };
  }
  if (GRAPH_GENERATED_ARTIFACT.classifyLocator(stripped).class === 'generated-artifact') {
    return { status: 'generated-artifact', locator: stripped };
  }
  return { status: 'source', locator: stripped };
}

function comparablePackageLocator(
  namespace: string,
  kind: string,
  locator: string,
  projectId: string
): GraphShadowProjectedIdentity {
  if (kind === 'module') {
    const classified = GRAPH_LOCATOR_IDENTITY.classify(locator, 'module');
    if (classified.class === 'unsafe') {
      return { status: 'unsafe', locator: classified.locator };
    }
    return { status: 'comparable', identity: `module:${classified.locator}` };
  }
  if (kind === 'endpoint') {
    const endpoint = comparableHttpRouteIdentity(locator);
    if (endpoint) return endpoint;
  }
  const path = preparedPath(locator, projectId, isContentPathKind(kind) ? kind : 'file');
  if (path.status === 'unsafe') return path;
  const safeLocator = path.locator;
  if (kind === 'test') {
    if (isGraphShadowTestSurfaceLocator(locator) || isGraphShadowTestSurfaceLocator(safeLocator)) {
      return { status: 'comparable', identity: `test:${projectId}` };
    }
    return { status: 'comparable', identity: `test:${safeLocator}` };
  }
  if (kind === 'file' || kind === 'document') {
    return { status: 'comparable', identity: `${mapShadowKind(kind)}:${safeLocator}` };
  }
  if (kind === 'symbol') {
    const parts = locator.split(':');
    if (parts.length >= 3) {
      const name = parts.at(-1) ?? '';
      const symbolKind = parts.at(-2) ?? '';
      const filePath = preparedPath(parts.slice(0, -2).join(':'), projectId);
      if (filePath.status === 'unsafe') return filePath;
      const file = filePath.status === 'source' ? filePath.locator : filePath.locator;
      return { status: 'comparable', identity: `symbol:${file}:${symbolKind}:${name}` };
    }
    return { status: 'comparable', identity: `symbol:${safeLocator}` };
  }
  if (kind === 'language') {
    return { status: 'comparable', identity: `language:${projectId}:${locator}` };
  }
  if (kind === 'package' || namespace === 'npm-project') {
    const hash = locator.lastIndexOf('#');
    const name = hash >= 0 ? locator.slice(hash + 1) : locator;
    return { status: 'comparable', identity: `package:npm:${name}` };
  }
  if (kind === 'repository' || kind === 'project') {
    return { status: 'comparable', identity: `project:${projectId || locator}` };
  }
  if (kind === 'workspace') {
    return {
      status: 'comparable',
      identity: `workspace:${locator === '.' ? projectId : locator}`,
    };
  }
  if (kind === 'command') {
    return { status: 'comparable', identity: `command:${locator}` };
  }
  if (kind === 'module') {
    return { status: 'comparable', identity: `module:${locator}` };
  }
  if (kind === 'endpoint') {
    const endpoint = comparableHttpRouteIdentity(locator);
    if (endpoint) return endpoint;
  }
  return { status: 'comparable', identity: `${mapShadowKind(kind)}:${locator}` };
}

export function projectLegacyIdentity(
  key: string,
  kind: string,
  projectId: string,
  kindOverrides?: Readonly<Record<string, string>>,
  identityOverrides?: Readonly<Record<string, string>>
): GraphShadowProjectedIdentity {
  const mapped = identityOverrides?.[key] ?? key;
  const mappedKind = mapShadowKind(kind, kindOverrides);
  const fileMatch = /^file:([^:]+):(.*)$/u.exec(mapped);
  if (fileMatch?.[1] && fileMatch[2] !== undefined) {
    const filePath = preparedPath(fileMatch[2], fileMatch[1] || projectId);
    if (filePath.status === 'unsafe') return filePath;
    return { status: 'comparable', identity: `file:${filePath.locator}` };
  }
  const symbolMatch = /^symbol:([^:]+):(.*)$/u.exec(mapped);
  if (symbolMatch?.[2]) {
    const rest = symbolMatch[2];
    const parts = rest.split(':');
    if (parts.length >= 3) {
      const name = parts.at(-1) ?? '';
      const symbolKind = parts.at(-2) ?? '';
      const filePath = preparedPath(parts.slice(0, -2).join(':'), projectId);
      if (filePath.status === 'unsafe') return filePath;
      return {
        status: 'comparable',
        identity: `symbol:${filePath.locator}:${symbolKind}:${name}`,
      };
    }
  }
  const packageMatch = /^package:[^:]+:npm:([^:]+):/u.exec(mapped);
  if (packageMatch?.[1])
    return { status: 'comparable', identity: `package:npm:${packageMatch[1]}` };
  const documentMatch = /^document:(.+)$/u.exec(mapped);
  if (documentMatch?.[1]) {
    const documentPath = preparedPath(documentMatch[1], projectId);
    if (documentPath.status === 'unsafe') return documentPath;
    return { status: 'comparable', identity: `document:${documentPath.locator}` };
  }
  const languageMatch = /^language:([^:]+):(.+)$/u.exec(mapped);
  if (languageMatch?.[1] && languageMatch[2]) {
    return { status: 'comparable', identity: `language:${languageMatch[1]}:${languageMatch[2]}` };
  }
  if (mappedKind === 'project' && mapped.startsWith('project:')) {
    return { status: 'comparable', identity: `project:${mapped.slice('project:'.length)}` };
  }
  if (mappedKind === 'workspace' && mapped.startsWith('workspace:')) {
    return { status: 'comparable', identity: mapped };
  }
  const collapsedTest = collapseProjectTestIdentity(mapped, projectId);
  if (mappedKind === 'test' && collapsedTest) {
    return { status: 'comparable', identity: collapsedTest };
  }
  if (mappedKind === 'test' && mapped.startsWith('tests:')) {
    return { status: 'comparable', identity: mapped.replace(/^tests:/u, 'test:') };
  }
  if (mappedKind === 'endpoint') {
    const endpoint = comparableHttpRouteIdentity(mapped);
    if (endpoint) return endpoint;
  }
  if (isUnsafeComparableLocator(mapped, mappedKind === 'module' ? 'module' : 'file')) {
    return { status: 'unsafe', locator: normalizeComparablePath(mapped, mappedKind) || mapped };
  }
  return { status: 'comparable', identity: mapped };
}

export function projectPackageIdentity(
  renderedOrId: string,
  kind: string,
  projectId: string,
  kindOverrides?: Readonly<Record<string, string>>
): GraphShadowProjectedIdentity {
  const match = ENTITY_RENDERING.exec(renderedOrId);
  if (match?.[1] && match[2] && match[3] && !match[3].startsWith('sha256:')) {
    const decoded = decodeComparableLocatorState(match[3], match[2]);
    if (decoded.status !== 'stable') {
      return { status: 'unsafe', locator: match[3] };
    }
    return comparablePackageLocator(match[1], match[2], decoded.value, projectId);
  }
  if (isUnsafeComparableLocator(renderedOrId, kind)) {
    return {
      status: 'unsafe',
      locator: normalizeComparablePath(renderedOrId, kind) || renderedOrId,
    };
  }
  const mappedKind = mapShadowKind(kind, kindOverrides);
  if (mappedKind === 'project' || mappedKind === 'repository') {
    return { status: 'comparable', identity: `project:${projectId || renderedOrId}` };
  }
  return { status: 'comparable', identity: renderedOrId };
}

export function comparableLegacyIdentity(
  key: string,
  kind: string,
  projectId: string,
  kindOverrides?: Readonly<Record<string, string>>,
  identityOverrides?: Readonly<Record<string, string>>
): string {
  const projected = projectLegacyIdentity(key, kind, projectId, kindOverrides, identityOverrides);
  if (projected.status !== 'comparable') {
    throw new Error('Unsafe comparable identity cannot be rendered for equivalence.');
  }
  return projected.identity;
}

export function comparablePackageIdentity(
  renderedOrId: string,
  kind: string,
  projectId: string,
  kindOverrides?: Readonly<Record<string, string>>
): string {
  const projected = projectPackageIdentity(renderedOrId, kind, projectId, kindOverrides);
  if (projected.status !== 'comparable') {
    throw new Error('Unsafe comparable identity cannot be rendered for equivalence.');
  }
  return projected.identity;
}

export function projectProofLocator(
  locator: string,
  projectId: string
): GraphShadowProjectedLocator {
  return preparedPath(locator, projectId);
}

export function comparableProofLocator(locator: string, projectId: string): string | null {
  const projected = projectProofLocator(locator, projectId);
  return projected.status === 'source' ? projected.locator : null;
}

export function inferLegacyProjectId(
  entities: readonly { kind: string; identity: { key: string } }[]
): string {
  const project = entities.find((entity) => entity.kind === 'project');
  if (project?.identity.key.startsWith('project:')) {
    return project.identity.key.slice('project:'.length);
  }
  const file = entities.find((entity) => entity.kind === 'file');
  const fileMatch = file ? /^file:([^:]+):/u.exec(file.identity.key) : null;
  return fileMatch?.[1] ?? '';
}
