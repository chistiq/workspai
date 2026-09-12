import { createHash } from 'node:crypto';

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
      proof: { evidence: readonly { relativeLocator?: string }[] };
    }[];
    unresolved: readonly unknown[];
    diagnostics: readonly { code: string }[];
  };
  quality: {
    unknownZones: readonly { code: string }[];
    unsupportedZones: readonly { code: string }[];
    coverage: readonly { dimension: string; status: string }[];
  };
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
}

export const GRAPH_SHADOW_DEFAULT_LIMITS = Object.freeze({
  maxNodes: 1_000_000,
  maxRelations: 5_000_000,
  maxProofs: 5_000_000,
  maxDiagnostics: 10_000,
});

const BUILTIN_MAPPING_VERSION = 'workspai.graph-shadow-mapping.v1';
const MAX_DIFFERENCE_SAMPLE = 100;

const DEFAULT_KIND_MAPPINGS: Readonly<Record<string, string>> = Object.freeze({
  'test-suite': 'test',
  'runtime-unit': 'runtime',
  'lifecycle-stage': 'gate',
  protocol: 'contract',
});

const DEFAULT_RELATION_MAPPINGS: Readonly<Record<string, string>> = Object.freeze({
  publishes: 'produces',
  deploys: 'deployed-as',
  documents: 'documented-by',
  owns: 'owned-by',
  'generated-by': 'produced-by',
  'implements-protocol': 'implements',
});

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

export function createGraphShadowResourceBudgetDigest(
  limits: GraphShadowExecutionRequest['limits']
): string {
  return sha256(limits);
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
    value.graph.contract.id !== 'workspai.graph.canonical-graph'
  ) {
    return false;
  }
  if (
    !Array.isArray(value.graph.nodes) ||
    !Array.isArray(value.graph.edges) ||
    !Array.isArray(value.graph.unresolved) ||
    !Array.isArray(value.graph.diagnostics) ||
    !Array.isArray(value.quality.unknownZones) ||
    !Array.isArray(value.quality.unsupportedZones) ||
    !Array.isArray(value.quality.coverage)
  ) {
    return false;
  }
  return (
    value.graph.nodes.every(
      (node) => isObject(node) && typeof node.id === 'string' && typeof node.kind === 'string'
    ) &&
    value.graph.edges.every(
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
    value.graph.diagnostics.every(
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
    )
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
  if (
    value.approvedDifferences !== undefined &&
    (!isObject(value.approvedDifferences) ||
      Object.values(value.approvedDifferences).some(
        (item) =>
          ![
            'truth-depth-improvement',
            'intentional-contract-change',
            'legacy-false-claim',
          ].includes(String(item))
      ))
  ) {
    return false;
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

function bindingFailures(binding: unknown): GraphShadowDifference[] {
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
  ];
  if (
    locators.some(
      (locator) =>
        typeof locator !== 'string' ||
        locator.includes('\\') ||
        locator.startsWith('/') ||
        /^[A-Za-z]:/u.test(locator) ||
        locator.split('/').includes('..')
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

function mapped(
  value: string,
  defaults: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>> | undefined
): string {
  return overrides?.[value] ?? defaults[value] ?? value;
}

function classify(
  difference: GraphShadowDifference,
  approved: GraphShadowComparisonPolicy['approvedDifferences']
): GraphShadowDifference {
  const classification = approved?.[difference.code] ?? 'regression';
  return { ...difference, classification };
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

function compareSets(
  area: GraphShadowDifference['area'],
  code: string,
  legacy: readonly string[],
  packageValues: readonly string[],
  policy: GraphShadowComparisonPolicy,
  differences: GraphShadowDifference[]
): void {
  const left = sortedUnique(legacy);
  const right = sortedUnique(packageValues);
  if (canonical(left) === canonical(right)) return;
  differences.push(
    classify(
      {
        area,
        code,
        legacy: boundedSetSummary(left),
        package: boundedSetSummary(right),
        reason: `${area} values differ after explicit compatibility normalization.`,
      },
      policy.approvedDifferences
    )
  );
}

function compareGraphs(
  legacy: LegacyGraphShadowInput,
  packageInput: PackageGraphShadowInput,
  policy: GraphShadowComparisonPolicy
): GraphShadowDifference[] {
  const differences: GraphShadowDifference[] = [];
  const identityMappings = policy.identityMappings ?? {};
  const legacyNodes = legacy.entities.map((entity) => {
    const identity = identityMappings[entity.identity.key] ?? entity.identity.key;
    return `${identity}\0${mapped(entity.kind, DEFAULT_KIND_MAPPINGS, policy.kindMappings)}`;
  });
  const packageNodes = packageInput.graph.nodes.map((node) => `${node.id}\0${node.kind}`);
  compareSets(
    'node',
    'GRAPH_SHADOW_NODE_SET_DIFFERENT',
    legacyNodes,
    packageNodes,
    policy,
    differences
  );

  const entityIds = new Map(
    legacy.entities.map((entity) => [
      entity.id,
      identityMappings[entity.identity.key] ?? entity.identity.key,
    ])
  );
  const legacyRelations = legacy.relations.map((relation) => {
    const from = entityIds.get(relation.from) ?? relation.from;
    const to = entityIds.get(relation.to) ?? relation.to;
    const kind = mapped(relation.kind, DEFAULT_RELATION_MAPPINGS, policy.relationMappings);
    return `${from}\0${kind}\0${to}`;
  });
  const packageRelations = packageInput.graph.edges.map(
    (edge) => `${edge.from}\0${edge.relation}\0${edge.to}`
  );
  compareSets(
    'relation',
    'GRAPH_SHADOW_RELATION_SET_DIFFERENT',
    legacyRelations,
    packageRelations,
    policy,
    differences
  );

  const legacyProofLocators = legacy.proofs.map((proof) => proof.artifact);
  const packageProofLocators = packageInput.graph.edges.flatMap((edge) =>
    edge.proof.evidence.flatMap((evidence) =>
      evidence.relativeLocator ? [evidence.relativeLocator] : []
    )
  );
  compareSets(
    'proof',
    'GRAPH_SHADOW_PROOF_LINEAGE_DIFFERENT',
    legacyProofLocators,
    packageProofLocators,
    policy,
    differences
  );

  const packageUnknowns = [
    ...packageInput.graph.unresolved.map(() => 'GRAPH_UNRESOLVED'),
    ...packageInput.quality.unknownZones.map((zone) => zone.code),
    ...packageInput.quality.unsupportedZones.map((zone) => zone.code),
  ];
  if (legacy.quality.unknownCount !== packageUnknowns.length) {
    differences.push(
      classify(
        {
          area: 'unknown',
          code: 'GRAPH_SHADOW_UNKNOWN_ACCOUNTING_DIFFERENT',
          legacy: legacy.quality.unknownCount,
          package: sortedUnique(packageUnknowns),
          reason: 'Unknown or unsupported graph zones differ.',
        },
        policy.approvedDifferences
      )
    );
  }

  const legacyCompleteness = legacy.quality.completeness?.status ?? 'bounded';
  const packageCompleteness =
    packageUnknowns.length === 0 &&
    packageInput.quality.coverage.every((observation) => observation.status === 'pass')
      ? 'complete'
      : 'bounded';
  if (legacyCompleteness !== packageCompleteness) {
    differences.push(
      classify(
        {
          area: 'completeness',
          code: 'GRAPH_SHADOW_COMPLETENESS_DIFFERENT',
          legacy: legacyCompleteness,
          package: packageCompleteness,
          reason: 'Completeness or truncation posture differs between execution paths.',
        },
        policy.approvedDifferences
      )
    );
  }

  compareSets(
    'diagnostic',
    'GRAPH_SHADOW_DIAGNOSTICS_DIFFERENT',
    legacy.diagnostics.map((diagnostic) => diagnostic.code),
    packageInput.graph.diagnostics.map((diagnostic) => diagnostic.code),
    policy,
    differences
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
  const bindingIssues = bindingFailures(request.binding);
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
  const status: GraphShadowComparisonStatus =
    differences.length === 0 ? 'equivalent' : regressions.length > 0 ? 'different' : 'incomparable';
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
