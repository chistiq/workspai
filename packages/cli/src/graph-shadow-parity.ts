import { createHash } from 'node:crypto';

import { GRAPH_INVENTORY_SURFACE } from '@workspai/graph/conformance';

import {
  GRAPH_MODEL_AUTHORITY_RECEIPT_SCHEMA_VERSION,
  GRAPH_SHADOW_PARITY_SCHEMA_VERSION,
  type GraphShadowComparisonBinding,
  type GraphShadowComparisonPolicy,
  type GraphShadowComparisonStatus,
  type GraphShadowDifference,
  type GraphShadowParityReport,
} from './contracts/graph-shadow-parity-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS } from './contracts/workspace-intelligence-runtime-registry.js';
import {
  GRAPH_SHADOW_MAPPING_VERSION,
  GRAPH_SHADOW_UNSAFE_DIFFERENCE_CODES,
  inferLegacyProjectId,
  isUnsafeComparableLocator,
  mapShadowKind,
  mapShadowRelation,
  projectLegacyIdentity,
  projectPackageIdentity,
  projectProofLocator,
} from './graph-shadow-comparison-projection.js';
import {
  projectLegacyUnknownItems,
  projectPackageUnknownItems,
  unknownComparisonToken,
  unknownItemKey,
} from './graph-shadow-unknown-contract.js';

type JsonObject = Record<string, unknown>;

export interface LegacyGraphShadowInput {
  schemaVersion: string;
  entities: readonly {
    id: string;
    kind: string;
    identity: { key: string; aliases?: readonly string[] };
    proofIds?: readonly string[];
  }[];
  relations: readonly {
    id: string;
    from: string;
    to: string;
    kind: string;
    proofIds?: readonly string[];
  }[];
  proofs: readonly { id: string; artifact: string }[];
  quality: {
    unknownCount: number;
    completeness?: { status: 'complete' | 'bounded' };
  };
  diagnostics: readonly { code: string }[];
}

export interface PackageGraphShadowInput {
  graph: {
    contract: { id: string; version: string };
    generation: {
      inputsDigest: { algorithm: string; value: string };
      providerSetDigest: { algorithm: string; value: string };
      compositionPolicyDigest: { algorithm: string; value: string };
    };
    nodes: readonly {
      id: string;
      kind: string;
      aliases?: readonly { id: string }[];
    }[];
    edges: readonly {
      id: string;
      from: string;
      to: string;
      relation: string;
      proof: {
        state?: string;
        authorities?: readonly string[];
        inputDigest?: { algorithm?: string; value?: string };
        evidence: readonly {
          relativeLocator?: string;
          digest?: { algorithm?: string; value?: string };
        }[];
      };
    }[];
    unresolved: readonly unknown[];
    diagnostics: readonly { code: string }[];
  };
  quality: {
    unknownZones: readonly { code: string; scope?: string }[];
    unsupportedZones: readonly { code: string; scope?: string }[];
    coverage: readonly { dimension: string; status: string }[];
    omittedSubtrees?: readonly {
      locator: string;
      class: string;
      count: 'not-enumerated' | number;
      bytes: 'not-measured' | number;
      enumeration?: 'not-enumerated' | 'partially-enumerated';
      enumeratedEntryCount?: number;
      policyDigest?: string;
    }[];
  };
  /** Complete portable proof locators when the host still owns provider batches. */
  evidenceLocators?: readonly string[];
  /** Portable identity renderings observed at the package digest boundary. */
  identityRenderings?: Readonly<Record<string, string>>;
}

export interface GraphShadowExecutionRequest {
  profile: string;
  binding: unknown;
  policy?: unknown;
  legacy: () => Promise<unknown>;
  package: () => Promise<unknown>;
  limits: {
    maxNodes: number;
    maxRelations: number;
    maxProofs: number;
    maxDiagnostics: number;
  };
  signal?: AbortSignal;
  expectedBinding?: Partial<
    Pick<GraphShadowComparisonBinding, 'scopeDigest' | 'redactionAuthorizationDigest'>
  >;
}

export {
  GRAPH_SHADOW_MAPPING_VERSION,
  GRAPH_SHADOW_UNSAFE_DIFFERENCE_CODES,
} from './graph-shadow-comparison-projection.js';
export {
  GRAPH_SHADOW_SEMANTIC_FAMILIES,
  classifyGraphShadowSemanticFamily,
  summarizeGraphShadowSemanticFamilies,
  summarizeGraphShadowStructuralDeltas,
  summarizeGraphShadowUnknownCauses,
  type GraphShadowSemanticFamily,
  type GraphShadowStructuralDeltaSummary,
} from './graph-shadow-semantic-family.js';

const GRAPH_SHADOW_APPROVAL_LOOKUP =
  /^(workspai\.graph-shadow-mapping\.v[0-9]+)::(GRAPH_SHADOW_[A-Z0-9_]+)::([A-Za-z0-9._-]+)::(sha256:[a-f0-9]{64})$/u;
const UNSAFE_DIFFERENCE_CODES = new Set<string>(GRAPH_SHADOW_UNSAFE_DIFFERENCE_CODES);

export function graphShadowApprovalLookupKey(
  mappingVersion: string,
  code: string,
  key: string,
  setDigest: string
): string {
  return `${mappingVersion}::${code}::${key}::${setDigest}`;
}

export const GRAPH_SHADOW_DEFAULT_LIMITS: GraphShadowExecutionRequest['limits'] = Object.freeze({
  maxNodes: 1_000_000,
  maxRelations: 5_000_000,
  maxProofs: 5_000_000,
  maxDiagnostics: 10_000,
});

const BUILTIN_MAPPING_VERSION = GRAPH_SHADOW_MAPPING_VERSION;
const MAX_DIFFERENCE_SAMPLE = 100;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

export function createGraphShadowBoundedSetDigest(values: readonly string[]): string {
  return sha256([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

export function createGraphShadowResourceBudgetDigest(
  limits: GraphShadowExecutionRequest['limits']
): string {
  return sha256(limits);
}

export function createGraphShadowProjectScopeDigest(projectId: string): string {
  return sha256({ kind: 'project', projectIds: [projectId] });
}

export function createGraphShadowReadOnlyAuthorizationDigest(): string {
  return sha256({
    network: 'deny',
    packageWrites: 'prohibited',
    sensitiveFiles: 'omit-known',
    secretValuesEmitted: false,
  });
}

function isDigest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isLegacyGraph(value: unknown): value is LegacyGraphShadowInput {
  if (
    !isObject(value) ||
    value.schemaVersion !== WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph
  ) {
    return false;
  }
  if (!Array.isArray(value.entities) || !Array.isArray(value.relations)) return false;
  if (
    !Array.isArray(value.proofs) ||
    !Array.isArray(value.diagnostics) ||
    !isObject(value.quality)
  ) {
    return false;
  }
  return (
    value.entities.every(
      (entity) =>
        isObject(entity) &&
        typeof entity.id === 'string' &&
        typeof entity.kind === 'string' &&
        isObject(entity.identity) &&
        typeof entity.identity.key === 'string' &&
        (entity.proofIds === undefined || isStringArray(entity.proofIds))
    ) &&
    value.relations.every(
      (relation) =>
        isObject(relation) &&
        typeof relation.id === 'string' &&
        typeof relation.from === 'string' &&
        typeof relation.to === 'string' &&
        typeof relation.kind === 'string' &&
        (relation.proofIds === undefined || isStringArray(relation.proofIds))
    ) &&
    value.proofs.every(
      (proof) =>
        isObject(proof) && typeof proof.id === 'string' && typeof proof.artifact === 'string'
    ) &&
    Number.isSafeInteger(value.quality.unknownCount) &&
    value.diagnostics.every(
      (diagnostic) => isObject(diagnostic) && typeof diagnostic.code === 'string'
    )
  );
}

function isPackageGraph(value: unknown): value is PackageGraphShadowInput {
  if (!isObject(value) || !isObject(value.graph) || !isObject(value.quality)) return false;
  if (
    !isObject(value.graph.contract) ||
    value.graph.contract.id !== 'workspai.graph.canonical-graph' ||
    !isObject(value.graph.generation)
  ) {
    return false;
  }
  const graph = value.graph;
  const generation = graph.generation as JsonObject;
  if (
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    !Array.isArray(graph.unresolved) ||
    !Array.isArray(graph.diagnostics) ||
    !Array.isArray(value.quality.unknownZones) ||
    !Array.isArray(value.quality.unsupportedZones) ||
    !Array.isArray(value.quality.coverage)
  ) {
    return false;
  }
  return (
    graph.nodes.every(
      (node) => isObject(node) && typeof node.id === 'string' && typeof node.kind === 'string'
    ) &&
    ['inputsDigest', 'providerSetDigest', 'compositionPolicyDigest'].every((key) => {
      const digest = generation[key];
      return (
        isObject(digest) &&
        digest.algorithm === 'sha256' &&
        typeof digest.value === 'string' &&
        /^[a-f0-9]{64}$/u.test(digest.value)
      );
    }) &&
    graph.edges.every(
      (edge) =>
        isObject(edge) &&
        typeof edge.id === 'string' &&
        typeof edge.from === 'string' &&
        typeof edge.to === 'string' &&
        typeof edge.relation === 'string' &&
        isObject(edge.proof) &&
        Array.isArray(edge.proof.evidence) &&
        edge.proof.evidence.every(
          (evidence) =>
            isObject(evidence) &&
            (evidence.relativeLocator === undefined || typeof evidence.relativeLocator === 'string')
        )
    ) &&
    graph.diagnostics.every(
      (diagnostic) => isObject(diagnostic) && typeof diagnostic.code === 'string'
    ) &&
    value.quality.unknownZones.every((zone) => isObject(zone) && typeof zone.code === 'string') &&
    value.quality.unsupportedZones.every(
      (zone) => isObject(zone) && typeof zone.code === 'string'
    ) &&
    value.quality.coverage.every(
      (coverage) =>
        isObject(coverage) &&
        typeof coverage.dimension === 'string' &&
        typeof coverage.status === 'string'
    ) &&
    (value.quality.omittedSubtrees === undefined ||
      (Array.isArray(value.quality.omittedSubtrees) &&
        value.quality.omittedSubtrees.every(
          (subtree) =>
            isObject(subtree) &&
            typeof subtree.locator === 'string' &&
            typeof subtree.class === 'string'
        ))) &&
    (value.evidenceLocators === undefined || isStringArray(value.evidenceLocators)) &&
    (value.identityRenderings === undefined ||
      (isObject(value.identityRenderings) &&
        Object.keys(value.identityRenderings).length === graph.nodes.length &&
        graph.nodes.every(
          (node) =>
            isObject(node) &&
            typeof node.id === 'string' &&
            typeof (value.identityRenderings as JsonObject)[node.id] === 'string'
        )))
  );
}

function isVersionBinding(value: unknown): value is { version: string; commit: string } {
  return isObject(value) && typeof value.version === 'string' && typeof value.commit === 'string';
}

function isComparisonBinding(value: unknown): value is GraphShadowComparisonBinding {
  if (!isObject(value)) return false;
  const digestKeys = [
    'sourceFixtureDigest',
    'scopeDigest',
    'providerProfileDigest',
    'graphPolicyDigest',
    'redactionAuthorizationDigest',
    'resourceBudgetDigest',
  ] as const;
  return (
    digestKeys.every((key) => typeof value[key] === 'string') &&
    isVersionBinding(value.legacyCli) &&
    isVersionBinding(value.graphPackage)
  );
}

function isComparisonPolicy(value: unknown): value is GraphShadowComparisonPolicy {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  const mappingKeys = ['identityMappings', 'kindMappings', 'relationMappings'] as const;
  if (
    value.mappingVersion !== undefined &&
    (typeof value.mappingVersion !== 'string' || value.mappingVersion.length === 0)
  ) {
    return false;
  }
  for (const key of mappingKeys) {
    const mapping = value[key];
    if (
      mapping !== undefined &&
      (!isObject(mapping) ||
        Object.entries(mapping).some(
          ([source, target]) =>
            source.length === 0 || typeof target !== 'string' || target.length === 0
        ))
    ) {
      return false;
    }
  }
  if (value.approvedDifferences !== undefined) {
    if (!isObject(value.approvedDifferences)) return false;
    const entries = Object.entries(value.approvedDifferences);
    if (entries.length > 0 && typeof value.mappingVersion !== 'string') return false;
    for (const [key, item] of entries) {
      const match = GRAPH_SHADOW_APPROVAL_LOOKUP.exec(key);
      if (!match?.[1] || !match[2] || !match[3] || !match[4]) return false;
      if (UNSAFE_DIFFERENCE_CODES.has(match[2])) return false;
      if (value.mappingVersion !== match[1]) return false;
      if (
        item !== 'truth-depth-improvement' &&
        item !== 'intentional-contract-change' &&
        item !== 'legacy-false-claim'
      ) {
        return false;
      }
    }
  }
  return true;
}

function isExecutionLimits(value: unknown): value is GraphShadowExecutionRequest['limits'] {
  if (!isObject(value)) return false;
  const keys = ['maxNodes', 'maxRelations', 'maxProofs', 'maxDiagnostics'] as const;
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) > 0)
  );
}

function bindingFailures(
  binding: unknown,
  expected: GraphShadowExecutionRequest['expectedBinding']
): GraphShadowDifference[] {
  const failures: GraphShadowDifference[] = [];
  if (!isComparisonBinding(binding)) {
    return [
      {
        area: 'binding',
        code: 'GRAPH_SHADOW_BINDING_INVALID',
        reason: 'Comparison binding failed its exact structural contract.',
      },
    ];
  }
  for (const [key, value] of Object.entries(binding)) {
    if (key === 'legacyCli' || key === 'graphPackage') continue;
    if (typeof value !== 'string' || !isDigest(value)) {
      failures.push({
        area: 'binding',
        code: 'GRAPH_SHADOW_BINDING_INVALID',
        key,
        reason: `${key} must be an exact sha256 digest.`,
      });
    }
  }
  for (const [key, version] of [
    ['legacyCli', binding.legacyCli],
    ['graphPackage', binding.graphPackage],
  ] as const) {
    if (!version.version || !/^[a-f0-9]{40}$/u.test(version.commit)) {
      failures.push({
        area: 'binding',
        code: 'GRAPH_SHADOW_VERSION_BINDING_INVALID',
        key,
        reason: `${key} must bind a version and a full Git commit.`,
      });
    }
  }
  for (const key of ['scopeDigest', 'redactionAuthorizationDigest'] as const) {
    const expectedDigest = expected?.[key];
    if (expectedDigest && binding[key] !== expectedDigest) {
      failures.push({
        area: 'binding',
        code: 'GRAPH_SHADOW_CONTEXT_BINDING_MISMATCH',
        key,
        reason: `${key} does not match the prepared execution context.`,
      });
    }
  }
  return failures;
}

function runtimeFailures(
  legacy: LegacyGraphShadowInput,
  packageInput: PackageGraphShadowInput,
  request: GraphShadowExecutionRequest & {
    readonly binding: GraphShadowComparisonBinding;
    readonly policy?: GraphShadowComparisonPolicy;
  }
): GraphShadowDifference[] {
  const failures: GraphShadowDifference[] = [];
  const counts = [
    ['legacy nodes', legacy.entities?.length, request.limits.maxNodes],
    ['package nodes', packageInput.graph?.nodes?.length, request.limits.maxNodes],
    ['legacy relations', legacy.relations?.length, request.limits.maxRelations],
    ['package relations', packageInput.graph?.edges?.length, request.limits.maxRelations],
    ['legacy proofs', legacy.proofs?.length, request.limits.maxProofs],
    [
      'package proofs',
      packageInput.graph?.edges?.reduce((count, edge) => count + edge.proof.evidence.length, 0),
      request.limits.maxProofs,
    ],
    ['legacy diagnostics', legacy.diagnostics?.length, request.limits.maxDiagnostics],
    ['package diagnostics', packageInput.graph?.diagnostics?.length, request.limits.maxDiagnostics],
  ] as const;
  if (
    legacy.schemaVersion !== WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph ||
    packageInput.graph?.contract?.id !== 'workspai.graph.canonical-graph'
  ) {
    failures.push({
      area: 'binding',
      code: 'GRAPH_SHADOW_ARTIFACT_CONTRACT_INVALID',
      reason: 'Both inputs must use the exact released CLI and package Graph contracts.',
    });
  }
  for (const [label, count, limit] of counts) {
    if (!Number.isSafeInteger(count) || count < 0 || count > limit) {
      failures.push({
        area: 'binding',
        code: 'GRAPH_SHADOW_RESOURCE_LIMIT_EXCEEDED',
        key: label,
        legacy: count,
        package: limit,
        reason: `${label} exceeds its admitted comparison limit.`,
      });
    }
  }
  const locators = [
    ...(Array.isArray(legacy.proofs) ? legacy.proofs.map((proof) => proof.artifact) : []),
    ...(Array.isArray(packageInput.graph?.edges)
      ? packageInput.graph.edges.flatMap(
          (edge: PackageGraphShadowInput['graph']['edges'][number]) =>
            edge.proof.evidence.flatMap(
              (
                evidence: PackageGraphShadowInput['graph']['edges'][number]['proof']['evidence'][number]
              ) => (evidence.relativeLocator ? [evidence.relativeLocator] : [])
            )
        )
      : []),
    ...(packageInput.evidenceLocators ?? []),
  ];
  if (
    locators.some(
      (locator) =>
        typeof locator !== 'string' || locator.includes('\\') || isUnsafeComparableLocator(locator)
    )
  ) {
    failures.push({
      area: 'proof',
      code: 'GRAPH_SHADOW_NON_PORTABLE_EVIDENCE',
      reason: 'Shadow evidence must use safe workspace-relative portable locators.',
    });
  }
  if (
    request.binding.resourceBudgetDigest !== createGraphShadowResourceBudgetDigest(request.limits)
  ) {
    failures.push({
      area: 'binding',
      code: 'GRAPH_SHADOW_RESOURCE_BINDING_MISMATCH',
      reason: 'Resource limits do not match the comparison binding digest.',
    });
  }
  const semanticBindings = [
    ['sourceFixtureDigest', packageInput.graph.generation.inputsDigest.value],
    ['providerProfileDigest', packageInput.graph.generation.providerSetDigest.value],
    ['graphPolicyDigest', packageInput.graph.generation.compositionPolicyDigest.value],
  ] as const;
  for (const [bindingKey, actualDigest] of semanticBindings) {
    if (request.binding[bindingKey] !== `sha256:${actualDigest}`) {
      failures.push({
        area: 'binding',
        code: 'GRAPH_SHADOW_SEMANTIC_BINDING_MISMATCH',
        key: bindingKey,
        reason: `${bindingKey} does not match the package generation that was executed.`,
      });
    }
  }
  const policy = request.policy ?? {};
  const customMappings = [
    policy.identityMappings,
    policy.kindMappings,
    policy.relationMappings,
  ].some((mapping) => mapping && Object.keys(mapping).length > 0);
  if (customMappings && !policy.mappingVersion) {
    failures.push({
      area: 'binding',
      code: 'GRAPH_SHADOW_MAPPING_VERSION_MISSING',
      reason: 'Custom compatibility mappings require an explicit migration version.',
    });
  }
  return failures;
}

export function graphShadowDifferenceSetDigest(difference: GraphShadowDifference): string {
  const asSummary = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object' || !('digest' in value) || !('count' in value)) {
      return undefined;
    }
    const count = (value as { count?: unknown }).count;
    const digest = (value as { digest?: unknown }).digest;
    return typeof count === 'number' && count > 0 && typeof digest === 'string'
      ? digest
      : undefined;
  };
  return (
    asSummary(difference.package) ??
    asSummary(difference.legacy) ??
    sha256({
      code: difference.code,
      key: difference.key ?? '',
      legacy: difference.legacy ?? null,
      package: difference.package ?? null,
    })
  );
}

function classify(
  difference: GraphShadowDifference,
  policy: GraphShadowComparisonPolicy
): GraphShadowDifference {
  if (UNSAFE_DIFFERENCE_CODES.has(difference.code)) {
    return { ...difference, classification: 'regression' };
  }
  const mappingVersion = policy.mappingVersion ?? BUILTIN_MAPPING_VERSION;
  const digest = graphShadowDifferenceSetDigest(difference);
  if (!difference.key || !digest) {
    return { ...difference, classification: 'regression' };
  }
  const lookup = graphShadowApprovalLookupKey(
    mappingVersion,
    difference.code,
    difference.key,
    digest
  );
  return {
    ...difference,
    classification: policy.approvedDifferences?.[lookup] ?? 'regression',
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function boundedSetSummary(values: readonly string[]): {
  count: number;
  digest: string;
  sample: readonly string[];
  truncated: boolean;
} {
  return {
    count: values.length,
    digest: sha256(values),
    sample: values.slice(0, MAX_DIFFERENCE_SAMPLE),
    truncated: values.length > MAX_DIFFERENCE_SAMPLE,
  };
}

function groupByKind(items: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const parts = item.split('\0');
    const kind = parts.length >= 2 ? parts[1]! : 'item';
    const group = groups.get(kind) ?? [];
    group.push(item);
    groups.set(kind, group);
  }
  return groups;
}

function pushDirectional(
  area: GraphShadowDifference['area'],
  legacyOnlyCode: string,
  packageOnlyCode: string,
  legacyValues: readonly string[],
  packageValues: readonly string[],
  policy: GraphShadowComparisonPolicy,
  differences: GraphShadowDifference[],
  reason: string
): void {
  const left = sortedUnique(legacyValues);
  const right = sortedUnique(packageValues);
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  const onlyLegacy = left.filter((item) => !rightSet.has(item));
  const onlyPackage = right.filter((item) => !leftSet.has(item));
  for (const [kind, items] of [...groupByKind(onlyLegacy).entries()].sort(
    ([leftKind], [rightKind]) => leftKind.localeCompare(rightKind)
  )) {
    differences.push(
      classify(
        {
          area,
          code: legacyOnlyCode,
          key: kind,
          legacy: boundedSetSummary(sortedUnique(items)),
          package: boundedSetSummary([]),
          reason,
        },
        policy
      )
    );
  }
  for (const [kind, items] of [...groupByKind(onlyPackage).entries()].sort(
    ([leftKind], [rightKind]) => leftKind.localeCompare(rightKind)
  )) {
    differences.push(
      classify(
        {
          area,
          code: packageOnlyCode,
          key: kind,
          legacy: boundedSetSummary([]),
          package: boundedSetSummary(sortedUnique(items)),
          reason,
        },
        policy
      )
    );
  }
}

function mapLegacyRelation(
  from: string,
  relation: string,
  to: string,
  overrides?: Readonly<Record<string, string>>
): string {
  const mappedRelation = mapShadowRelation(relation, overrides);
  if (relation === 'documents' && mappedRelation === 'documented-by') {
    return `${to}\0${mappedRelation}\0${from}`;
  }
  return `${from}\0${mappedRelation}\0${to}`;
}

function compareGraphs(
  legacy: LegacyGraphShadowInput,
  packageInput: PackageGraphShadowInput,
  policy: GraphShadowComparisonPolicy
): GraphShadowDifference[] {
  const differences: GraphShadowDifference[] = [];
  const identityMappings = policy.identityMappings ?? {};
  const projectId = inferLegacyProjectId(legacy.entities);
  const unsafeLegacyIdentities: string[] = [];
  const unsafePackageIdentities: string[] = [];
  const legacyNodeById = new Map<string, string>();
  for (const entity of legacy.entities) {
    const projected = projectLegacyIdentity(
      entity.identity.key,
      entity.kind,
      projectId,
      policy.kindMappings,
      identityMappings
    );
    if (projected.status === 'unsafe') {
      unsafeLegacyIdentities.push(`${projected.locator}\0identity`);
      continue;
    }
    legacyNodeById.set(entity.id, projected.identity);
  }
  const legacyNodes = legacy.entities.flatMap((entity) => {
    const identity = legacyNodeById.get(entity.id);
    return identity ? [`${identity}\0${mapShadowKind(entity.kind, policy.kindMappings)}`] : [];
  });
  const packageComparable = new Map<string, string>();
  for (const node of packageInput.graph.nodes) {
    const projected = projectPackageIdentity(
      packageInput.identityRenderings?.[node.id] ?? node.id,
      node.kind,
      projectId,
      policy.kindMappings
    );
    if (projected.status === 'unsafe') {
      unsafePackageIdentities.push(`${projected.locator}\0identity`);
      continue;
    }
    packageComparable.set(node.id, projected.identity);
  }
  if (unsafeLegacyIdentities.length > 0 || unsafePackageIdentities.length > 0) {
    differences.push({
      area: 'identity',
      code: 'GRAPH_SHADOW_UNSAFE_IDENTITY',
      key: 'locator',
      classification: 'regression',
      legacy: boundedSetSummary(sortedUnique(unsafeLegacyIdentities)),
      package: boundedSetSummary(sortedUnique(unsafePackageIdentities)),
      reason:
        'Decoded identity locators failed portable-path validation and cannot participate in equivalence.',
    });
  }
  const packageNodes = packageInput.graph.nodes.flatMap((node) => {
    const identity = packageComparable.get(node.id);
    return identity ? [`${identity}\0${mapShadowKind(node.kind, policy.kindMappings)}`] : [];
  });
  pushDirectional(
    'node',
    'GRAPH_SHADOW_NODE_LEGACY_ONLY',
    'GRAPH_SHADOW_NODE_PACKAGE_ONLY',
    legacyNodes,
    packageNodes,
    policy,
    differences,
    'Directional node identities differ after explicit compatibility projection onto the Graph comparable-surface corpus.'
  );

  const legacyRelations = legacy.relations.flatMap((relation) => {
    const from = legacyNodeById.get(relation.from);
    const to = legacyNodeById.get(relation.to);
    return from && to ? [mapLegacyRelation(from, relation.kind, to, policy.relationMappings)] : [];
  });
  const packageRelations = packageInput.graph.edges.flatMap((edge) => {
    const from = packageComparable.get(edge.from);
    const to = packageComparable.get(edge.to);
    return from && to
      ? [`${from}\0${mapShadowRelation(edge.relation, policy.relationMappings)}\0${to}`]
      : [];
  });
  pushDirectional(
    'relation',
    'GRAPH_SHADOW_RELATION_LEGACY_ONLY',
    'GRAPH_SHADOW_RELATION_PACKAGE_ONLY',
    legacyRelations,
    packageRelations,
    policy,
    differences,
    'Directional relations differ after explicit compatibility projection onto the Graph comparable-surface corpus.'
  );

  const unsafeLegacyProofs: string[] = [];
  const unsafePackageProofs: string[] = [];
  const generatedLegacyControl: string[] = [];
  const generatedPackageControl: string[] = [];
  const legacyProofLocators: string[] = [];
  for (const proof of legacy.proofs) {
    const projected = projectProofLocator(proof.artifact, projectId);
    if (projected.status === 'unsafe') unsafeLegacyProofs.push(`${projected.locator}\0locator`);
    else if (projected.status === 'generated-artifact')
      generatedLegacyControl.push(projected.locator);
    else legacyProofLocators.push(`${projected.locator}\0locator`);
  }
  const packageProofSources =
    packageInput.evidenceLocators ??
    packageInput.graph.edges.flatMap((edge) =>
      edge.proof.evidence.flatMap((evidence) =>
        evidence.relativeLocator ? [evidence.relativeLocator] : []
      )
    );
  const packageProofLocators: string[] = [];
  for (const locator of packageProofSources) {
    const projected = projectProofLocator(locator, projectId);
    if (projected.status === 'unsafe') unsafePackageProofs.push(`${projected.locator}\0locator`);
    else if (projected.status === 'generated-artifact')
      generatedPackageControl.push(projected.locator);
    else packageProofLocators.push(`${projected.locator}\0locator`);
  }
  if (unsafeLegacyProofs.length > 0 || unsafePackageProofs.length > 0) {
    differences.push({
      area: 'proof',
      code: 'GRAPH_SHADOW_UNSAFE_PROOF_LOCATOR',
      key: 'locator',
      classification: 'regression',
      legacy: boundedSetSummary(sortedUnique(unsafeLegacyProofs)),
      package: boundedSetSummary(sortedUnique(unsafePackageProofs)),
      reason:
        'Decoded proof locators failed portable-path validation and cannot participate in equivalence.',
    });
  }
  if (generatedLegacyControl.length > 0) {
    differences.push(
      classify(
        {
          area: 'proof',
          code: 'GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL',
          key: 'generatedLegacyControl',
          legacy: boundedSetSummary(sortedUnique(generatedLegacyControl)),
          package: boundedSetSummary([]),
          reason:
            'Legacy generated-artifact proof locators are separated from source-repository proof under the Graph generated-artifact policy.',
        },
        policy
      )
    );
  }
  if (generatedPackageControl.length > 0) {
    differences.push(
      classify(
        {
          area: 'proof',
          code: 'GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL',
          key: 'generatedPackageControl',
          legacy: boundedSetSummary([]),
          package: boundedSetSummary(sortedUnique(generatedPackageControl)),
          reason:
            'Package generated-artifact proof locators are separated from source-repository proof under the Graph generated-artifact policy.',
        },
        policy
      )
    );
  }
  pushDirectional(
    'proof',
    'GRAPH_SHADOW_PROOF_LEGACY_ONLY',
    'GRAPH_SHADOW_PROOF_PACKAGE_ONLY',
    legacyProofLocators,
    packageProofLocators,
    policy,
    differences,
    'Source-repository proof locators differ after path normalization.'
  );

  const legacyUnknowns = projectLegacyUnknownItems({
    unknownCount: legacy.quality.unknownCount,
    diagnostics: legacy.diagnostics,
  });
  const packageUnknowns = projectPackageUnknownItems({
    unresolved: packageInput.graph.unresolved,
    unknownZones: packageInput.quality.unknownZones,
    unsupportedZones: packageInput.quality.unsupportedZones,
  });
  const unmappedLegacy = sortedUnique(
    legacyUnknowns
      .filter((item) => item.family === 'legacy-binding-coverage')
      .map((item) => unknownItemKey(item))
  );
  if (unmappedLegacy.length > 0) {
    differences.push(
      classify(
        {
          area: 'unknown',
          code: 'GRAPH_SHADOW_UNKNOWN_FAMILY_UNMAPPED',
          key: 'legacy-binding-coverage',
          legacy: boundedSetSummary(unmappedLegacy),
          package: boundedSetSummary([]),
          reason:
            'Legacy binding-coverage unknowns remain unmapped-legacy-coverage: they have no package unknown-zone counterpart and stay bounded-unknown.',
        },
        policy
      )
    );
  }
  pushDirectional(
    'unknown',
    'GRAPH_SHADOW_UNKNOWN_ZONE_LEGACY_ONLY',
    'GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY',
    legacyUnknowns
      .filter((item) => item.family !== 'legacy-binding-coverage')
      .map((item) => unknownComparisonToken(item)),
    packageUnknowns.map((item) => unknownComparisonToken(item)),
    policy,
    differences,
    'Mapped unknown or unsupported zones differ by leftover identity. Cause grouping is a sidecar summary only and does not equate leftovers, reduce regressions, or make unclassified or unmapped-legacy-coverage benign.'
  );

  const packageOmittedSubtrees = (packageInput.quality.omittedSubtrees ?? []).map((subtree) =>
    GRAPH_INVENTORY_SURFACE.omittedSubtreeComparisonToken(subtree)
  );
  pushDirectional(
    'unknown',
    'GRAPH_SHADOW_OMITTED_SUBTREE_LEGACY_ONLY',
    'GRAPH_SHADOW_OMITTED_SUBTREE_PACKAGE_ONLY',
    [],
    packageOmittedSubtrees,
    policy,
    differences,
    'Omitted subtrees are compared by class and portable locator. Unmeasured cardinality is not treated as zero, equivalent, or suppressed.'
  );

  const packageUnknownCount = packageUnknowns.length;
  const legacyCompleteness = legacy.quality.completeness?.status ?? 'bounded';
  const packageCompleteness =
    packageUnknownCount === 0 &&
    packageInput.quality.coverage.every((observation) => observation.status === 'pass')
      ? 'complete'
      : 'bounded';
  if (legacyCompleteness !== packageCompleteness) {
    differences.push(
      classify(
        {
          area: 'completeness',
          code: 'GRAPH_SHADOW_COMPLETENESS_DIFFERENT',
          key: 'status',
          legacy: legacyCompleteness,
          package: packageCompleteness,
          reason: 'Completeness or truncation posture differs between execution paths.',
        },
        policy
      )
    );
  }

  pushDirectional(
    'diagnostic',
    'GRAPH_SHADOW_DIAGNOSTIC_LEGACY_ONLY',
    'GRAPH_SHADOW_DIAGNOSTIC_PACKAGE_ONLY',
    legacy.diagnostics.map(
      (diagnostic) =>
        `${diagnostic.code}:${'path' in diagnostic && typeof diagnostic.path === 'string' ? diagnostic.path : ''}\0${diagnostic.code}`
    ),
    packageInput.graph.diagnostics.map(
      (diagnostic) =>
        `${diagnostic.code}:${'path' in diagnostic && typeof diagnostic.path === 'string' ? diagnostic.path : ''}\0${diagnostic.code}`
    ),
    policy,
    differences,
    'Diagnostic codes differ after comparison projection.'
  );
  return differences;
}

function report(
  profile: string,
  binding: GraphShadowComparisonBinding | null,
  status: GraphShadowComparisonStatus,
  differences: GraphShadowDifference[],
  mappingVersion: string,
  counts: Omit<GraphShadowParityReport['metrics'], 'regressions' | 'approvedDifferences'>
): GraphShadowParityReport {
  const metrics = {
    ...counts,
    regressions: differences.filter((item) => item.classification === 'regression').length,
    approvedDifferences: differences.filter(
      (item) => item.classification && item.classification !== 'regression'
    ).length,
  };
  const reportDigest = sha256({
    schemaVersion: GRAPH_SHADOW_PARITY_SCHEMA_VERSION,
    profile,
    binding,
    status,
    mappingVersion,
    differences,
    metrics,
  });
  return {
    schemaVersion: GRAPH_SHADOW_PARITY_SCHEMA_VERSION,
    binding,
    status,
    profile,
    mappingVersion,
    differences,
    metrics,
    receipt: {
      schemaVersion: GRAPH_MODEL_AUTHORITY_RECEIPT_SCHEMA_VERSION,
      epoch: 'package-shadow',
      executionPath: 'compared',
      comparison: { status, profile, reportDigest },
      authority: 'released-cli',
      packageWrites: 'prohibited',
      fallback: 'prohibited',
    },
  };
}

export async function runGraphShadowComparison(
  request: GraphShadowExecutionRequest
): Promise<GraphShadowParityReport> {
  const bindingIssues = bindingFailures(request.binding, request.expectedBinding);
  if (!isComparisonPolicy(request.policy)) {
    bindingIssues.push({
      area: 'binding',
      code: 'GRAPH_SHADOW_POLICY_INVALID',
      reason: 'Comparison policy failed its structural contract.',
    });
  }
  if (!isExecutionLimits(request.limits)) {
    bindingIssues.push({
      area: 'binding',
      code: 'GRAPH_SHADOW_RESOURCE_LIMIT_INVALID',
      reason: 'All shadow comparison limits must be positive safe integers.',
    });
  }
  const emptyCounts = {
    legacyNodes: 0,
    packageNodes: 0,
    legacyRelations: 0,
    packageRelations: 0,
    comparedNodes: 0,
    comparedRelations: 0,
  };
  if (bindingIssues.length > 0) {
    return report(
      request.profile,
      isComparisonBinding(request.binding) ? request.binding : null,
      'failed',
      bindingIssues,
      isComparisonPolicy(request.policy)
        ? (request.policy?.mappingVersion ?? BUILTIN_MAPPING_VERSION)
        : BUILTIN_MAPPING_VERSION,
      emptyCounts
    );
  }
  const binding = request.binding as GraphShadowComparisonBinding;
  const policy = request.policy as GraphShadowComparisonPolicy | undefined;
  if (request.signal?.aborted) {
    return report(
      request.profile,
      binding,
      'failed',
      [
        {
          area: 'binding',
          code: 'GRAPH_SHADOW_CANCELLED',
          reason: 'Shadow comparison was cancelled.',
        },
      ],
      policy?.mappingVersion ?? BUILTIN_MAPPING_VERSION,
      emptyCounts
    );
  }

  let legacyCandidate: unknown;
  let packageCandidate: unknown;
  try {
    [legacyCandidate, packageCandidate] = await Promise.all([request.legacy(), request.package()]);
  } catch {
    return report(
      request.profile,
      binding,
      'failed',
      [
        {
          area: 'diagnostic',
          code: 'GRAPH_SHADOW_EXECUTION_FAILED',
          reason: 'One or both Graph execution paths failed before comparison.',
        },
      ],
      policy?.mappingVersion ?? BUILTIN_MAPPING_VERSION,
      emptyCounts
    );
  }

  if (!isLegacyGraph(legacyCandidate) || !isPackageGraph(packageCandidate)) {
    return report(
      request.profile,
      binding,
      'failed',
      [
        {
          area: 'binding',
          code: 'GRAPH_SHADOW_ARTIFACT_CONTRACT_INVALID',
          reason: 'Shadow inputs failed their exact structural contract checks.',
        },
      ],
      policy?.mappingVersion ?? BUILTIN_MAPPING_VERSION,
      emptyCounts
    );
  }
  const legacy = legacyCandidate;
  const packageInput = packageCandidate;

  const runtimeIssues = runtimeFailures(legacy, packageInput, {
    ...request,
    binding,
    policy,
  });
  if (runtimeIssues.length > 0) {
    return report(
      request.profile,
      binding,
      'failed',
      runtimeIssues,
      policy?.mappingVersion ?? BUILTIN_MAPPING_VERSION,
      emptyCounts
    );
  }

  const differences = compareGraphs(legacy, packageInput, policy ?? {});
  const regressions = differences.filter((item) => item.classification === 'regression');
  const hasUnsafeIdentity = differences.some(
    (item) => item.code === 'GRAPH_SHADOW_UNSAFE_IDENTITY'
  );
  const status: GraphShadowComparisonStatus = hasUnsafeIdentity
    ? 'failed'
    : differences.length === 0
      ? 'equivalent'
      : regressions.length > 0
        ? 'different'
        : 'incomparable';
  return report(
    request.profile,
    binding,
    status,
    differences,
    policy?.mappingVersion ?? BUILTIN_MAPPING_VERSION,
    {
      legacyNodes: legacy.entities.length,
      packageNodes: packageInput.graph.nodes.length,
      legacyRelations: legacy.relations.length,
      packageRelations: packageInput.graph.edges.length,
      comparedNodes: Math.min(legacy.entities.length, packageInput.graph.nodes.length),
      comparedRelations: Math.min(legacy.relations.length, packageInput.graph.edges.length),
    }
  );
}
