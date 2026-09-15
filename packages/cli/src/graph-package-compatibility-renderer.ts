import {
  WORKSPACE_KNOWLEDGE_ENTITY_KINDS,
  WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  WORKSPACE_KNOWLEDGE_RELATION_KINDS,
  type WorkspaceKnowledgeEntity,
  type WorkspaceKnowledgeEntityKind,
  type WorkspaceKnowledgeGraph,
  type WorkspaceKnowledgeProof,
  type WorkspaceKnowledgeRelation,
  type WorkspaceKnowledgeRelationKind,
} from './contracts/workspace-knowledge-graph-contract.js';
import type { WorkspaceDependencyGraph } from './contracts/workspace-dependency-graph-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import {
  GRAPH_SHADOW_KIND_MAPPINGS,
  GRAPH_SHADOW_RELATION_MAPPINGS,
  projectPackageIdentity,
} from './graph-shadow-comparison-projection.js';
import type { PackageGraphShadowInput } from './graph-shadow-parity.js';
import { hashCanonicalJson } from './workspace-model-hash.js';

export const GRAPH_PACKAGE_COMPATIBILITY_RENDERER_VERSION =
  'workspai.graph-package-compat-renderer.v1' as const;

const WORKSPACE_ENTITY_KIND_SET = new Set<string>(WORKSPACE_KNOWLEDGE_ENTITY_KINDS);
const WORKSPACE_RELATION_KIND_SET = new Set<string>(WORKSPACE_KNOWLEDGE_RELATION_KINDS);

const PACKAGE_KIND_TO_WORKSPACE: Readonly<Record<string, WorkspaceKnowledgeEntityKind>> =
  Object.freeze({
    workspace: 'workspace',
    repository: 'project',
    project: 'project',
    service: 'service',
    api: 'api',
    endpoint: 'endpoint',
    schema: 'schema',
    contract: 'protocol',
    language: 'language',
    package: 'package',
    runtime: 'runtime-unit',
    gate: 'lifecycle-stage',
    module: 'module',
    file: 'file',
    symbol: 'symbol',
    database: 'database',
    queue: 'queue',
    container: 'container',
    deployment: 'deployment',
    pipeline: 'pipeline',
    environment: 'environment',
    document: 'document',
    decision: 'decision',
    test: 'test-suite',
    owner: 'owner',
  });

const PACKAGE_RELATION_TO_WORKSPACE: Readonly<Record<string, WorkspaceKnowledgeRelationKind>> =
  Object.freeze({
    contains: 'contains',
    defines: 'defines',
    imports: 'imports',
    'depends-on': 'depends-on',
    exposes: 'exposes',
    implements: 'implements',
    'uses-language': 'uses-language',
    calls: 'calls',
    'reads-from': 'reads-from',
    'writes-to': 'writes-to',
    produces: 'publishes',
    consumes: 'consumes',
    'deployed-as': 'deploys',
    'runs-on': 'runs-on',
    'routes-to': 'routes-to',
    'documented-by': 'documents',
    'decided-by': 'decided-by',
    'owned-by': 'owns',
    'produced-by': 'generated-by',
    'configured-by': 'configured-by',
  });

function reverseShadowKind(kind: string): string {
  for (const [legacy, mapped] of Object.entries(GRAPH_SHADOW_KIND_MAPPINGS)) {
    if (mapped === kind) return legacy;
  }
  return kind;
}

function reverseShadowRelation(relation: string): string {
  for (const [legacy, mapped] of Object.entries(GRAPH_SHADOW_RELATION_MAPPINGS)) {
    if (mapped === relation) return legacy;
  }
  return relation;
}

function workspaceEntityKind(kind: string): WorkspaceKnowledgeEntityKind | undefined {
  const mapped = PACKAGE_KIND_TO_WORKSPACE[kind] ?? reverseShadowKind(kind);
  return WORKSPACE_ENTITY_KIND_SET.has(mapped)
    ? (mapped as WorkspaceKnowledgeEntityKind)
    : undefined;
}

function workspaceRelationKind(relation: string): WorkspaceKnowledgeRelationKind | undefined {
  const mapped = PACKAGE_RELATION_TO_WORKSPACE[relation] ?? reverseShadowRelation(relation);
  return WORKSPACE_RELATION_KIND_SET.has(mapped)
    ? (mapped as WorkspaceKnowledgeRelationKind)
    : undefined;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

type CompatProofPresentation = Pick<
  WorkspaceKnowledgeProof,
  'derivation' | 'trust' | 'confidence' | 'freshness'
>;

/**
 * Compatibility renderer must not fabricate, upgrade, or delete proof.
 * Presentation fields are a conservative workspace-schema translation of the
 * package edge proof that already exists. Missing state is never treated as
 * observed or verified.
 */
function proofPresentation(input: {
  readonly state?: string;
  readonly authorities?: readonly string[];
}): CompatProofPresentation {
  const inferred = input.authorities?.includes('inferred') === true;
  const derivation: WorkspaceKnowledgeProof['derivation'] = inferred ? 'inferred' : 'extracted';
  switch (input.state) {
    case 'verified':
      return { derivation, trust: 'authoritative', confidence: 'high', freshness: 'fresh' };
    case 'corroborated':
      return { derivation, trust: 'corroborated', confidence: 'high', freshness: 'fresh' };
    case 'supported':
      return { derivation, trust: 'observed', confidence: 'medium', freshness: 'fresh' };
    case 'disputed':
      return { derivation, trust: 'ambiguous', confidence: 'low', freshness: 'fresh' };
    case 'insufficient':
      return { derivation, trust: 'observed', confidence: 'low', freshness: 'unknown' };
    case 'unresolved':
      return { derivation, trust: 'ambiguous', confidence: 'low', freshness: 'unknown' };
    default:
      return { derivation, trust: 'ambiguous', confidence: 'low', freshness: 'unknown' };
  }
}

export type GraphPackageCompatibilitySourceBinding =
  | {
      readonly status: 'bound';
      readonly modelHash: string;
      readonly packageInputsDigest: string;
      readonly bindingDigest: string;
    }
  | {
      readonly status: 'unbound';
      readonly modelHash: string;
    };

export interface GraphPackageCompatibilityRenderRequest {
  readonly projectId: string;
  readonly workspaceName: string;
  readonly generatedAt: string;
  readonly package: PackageGraphShadowInput;
  readonly projectTopology: WorkspaceDependencyGraph;
  readonly sourceBinding: GraphPackageCompatibilitySourceBinding;
}

function sourceBindingIsProven(
  binding: GraphPackageCompatibilitySourceBinding,
  packageInputsDigest: string
): binding is Extract<GraphPackageCompatibilitySourceBinding, { status: 'bound' }> {
  if (binding.status !== 'bound') return false;
  if (binding.packageInputsDigest !== packageInputsDigest) return false;
  return (
    binding.bindingDigest ===
    hashCanonicalJson({
      modelHash: binding.modelHash,
      packageInputsDigest: binding.packageInputsDigest,
    })
  );
}

/**
 * Renders a package canonical Graph into the supported workspace-knowledge-graph.v1
 * artifact. Unmapped ontology is omitted with diagnostics; it is never forced into
 * an unsupported schema field. Completeness is bounded whenever anything is omitted
 * or the workspace-model source field is not proven bound to this generation.
 */
export function renderCanonicalGraphAsWorkspaceKnowledgeGraph(
  request: GraphPackageCompatibilityRenderRequest
): WorkspaceKnowledgeGraph {
  if (
    !request.projectTopology ||
    !Array.isArray(request.projectTopology.nodes) ||
    request.projectTopology.nodes.length === 0
  ) {
    throw new Error('Compatibility renderer requires a host-supplied project topology.');
  }
  const diagnostics: WorkspaceKnowledgeGraph['diagnostics'] = [];
  const entities: WorkspaceKnowledgeEntity[] = [];
  const entityIds = new Map<string, string>();
  const proofs: WorkspaceKnowledgeProof[] = [];
  const proofIdsByKey = new Map<string, string>();
  let omittedOntology = false;

  const rememberProof = (
    edge: PackageGraphShadowInput['graph']['edges'][number]
  ): string | undefined => {
    const locator = edge.proof.evidence.find((item) => item.relativeLocator)?.relativeLocator;
    const digest =
      edge.proof.inputDigest?.value ??
      edge.proof.evidence.find((item) => item.digest?.value)?.digest?.value;
    if (!locator) {
      if (digest || edge.proof.state || (edge.proof.authorities?.length ?? 0) > 0) {
        omittedOntology = true;
        diagnostics.push({
          code: 'GRAPH_COMPAT_PROOF_WITHOUT_LOCATOR',
          severity: 'warning',
          message:
            'Package edge proof was not projected because it has no relative locator; the renderer does not invent a locator.',
        });
      }
      return undefined;
    }
    const presentation = proofPresentation({
      state: edge.proof.state,
      authorities: edge.proof.authorities,
    });
    const key = `${locator}\0${edge.proof.state ?? 'unknown'}\0${digest ?? ''}`;
    const existing = proofIdsByKey.get(key);
    if (existing) return existing;
    const id = `proof:package:${String(proofs.length).padStart(8, '0')}`;
    proofIdsByKey.set(key, id);
    proofs.push({
      id,
      provider: 'workspai.graph.package',
      artifact: locator,
      observedAt: request.generatedAt,
      ...presentation,
      ...(digest ? { contentHash: digest } : {}),
      ...(edge.proof.state ? { detail: `packageProofState=${edge.proof.state}` } : {}),
    });
    return id;
  };

  for (const node of request.package.graph.nodes) {
    const kind = workspaceEntityKind(node.kind);
    if (!kind) {
      omittedOntology = true;
      diagnostics.push({
        code: 'GRAPH_COMPAT_UNMAPPED_KIND',
        severity: 'info',
        message: `Package entity kind ${node.kind} is omitted from workspace-knowledge-graph.v1.`,
      });
      continue;
    }
    const rendered = request.package.identityRenderings?.[node.id] ?? node.id;
    const projected = projectPackageIdentity(rendered, node.kind, request.projectId);
    if (projected.status !== 'comparable') {
      omittedOntology = true;
      diagnostics.push({
        code: 'GRAPH_COMPAT_UNSAFE_IDENTITY',
        severity: 'warning',
        message: `Package entity ${node.kind} was omitted because its identity is not portable.`,
      });
      continue;
    }
    const entityId = node.id;
    entityIds.set(node.id, entityId);
    entities.push({
      id: entityId,
      kind,
      label: projected.identity,
      projectId: request.projectId,
      identity: {
        key: projected.identity,
        scope: kind === 'workspace' ? 'workspace' : 'project',
        aliases: (node.aliases ?? []).map((alias) => alias.id),
        fingerprint: hashCanonicalJson({ id: node.id, kind, identity: projected.identity }),
      },
      attributes: {
        packageKind: node.kind,
        renderer: GRAPH_PACKAGE_COMPATIBILITY_RENDERER_VERSION,
      },
      proofIds: [],
    });
  }

  const relations: WorkspaceKnowledgeRelation[] = [];
  for (const edge of request.package.graph.edges) {
    const kind = workspaceRelationKind(edge.relation);
    if (!kind) {
      omittedOntology = true;
      diagnostics.push({
        code: 'GRAPH_COMPAT_UNMAPPED_RELATION',
        severity: 'info',
        message: `Package relation ${edge.relation} is omitted from workspace-knowledge-graph.v1.`,
      });
      continue;
    }
    const from = entityIds.get(edge.from);
    const to = entityIds.get(edge.to);
    if (!from || !to) {
      omittedOntology = true;
      diagnostics.push({
        code: 'GRAPH_COMPAT_RELATION_ENDPOINT_OMITTED',
        severity: 'info',
        message: `Package relation ${edge.relation} was omitted because an endpoint is not in the v1 projection.`,
      });
      continue;
    }
    const presentation = proofPresentation({
      state: edge.proof.state,
      authorities: edge.proof.authorities,
    });
    const proofId = rememberProof(edge);
    relations.push({
      id: edge.id,
      from,
      to,
      kind,
      derivation: presentation.derivation,
      trust: presentation.trust,
      confidence: presentation.confidence,
      proofIds: proofId ? [proofId] : [],
    });
  }

  const packageInputsDigest = request.package.graph.generation.inputsDigest.value;
  const bound = sourceBindingIsProven(request.sourceBinding, packageInputsDigest);
  if (!bound) {
    diagnostics.push({
      code: 'GRAPH_COMPAT_SOURCE_UNBOUND_TO_MODEL',
      severity: 'warning',
      message:
        'workspace-model source.hash is not proven bound to this package Graph generation; the schema field does not authorize the graph.',
    });
  }
  diagnostics.push({
    code: 'GRAPH_COMPAT_SOURCE_KIND_SCHEMA_CONSTRAINT',
    severity: 'info',
    message:
      'workspace-knowledge-graph.v1 requires source.kind workspace-model even when the Graph was composed from repository facts.',
  });

  const qualityBounded =
    request.package.quality.coverage.some((item) => item.status !== 'pass') ||
    request.package.quality.unknownZones.length > 0 ||
    request.package.quality.unsupportedZones.length > 0;
  const completeness = omittedOntology || qualityBounded || !bound ? 'bounded' : 'complete';

  diagnostics.push({
    code: 'GRAPH_COMPAT_PACKAGE_GENERATION_BOUND',
    severity: 'info',
    message: `Rendered from package Graph generation ${packageInputsDigest}.`,
  });

  return {
    schemaVersion: WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    generatedAt: request.generatedAt,
    source: {
      kind: 'workspace-model',
      artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
      hashAlgorithm: 'sha256',
      hash: request.sourceBinding.modelHash,
    },
    workspace: { name: request.workspaceName },
    projectTopology: request.projectTopology,
    entities,
    relations,
    proofs,
    providers: [
      {
        id: 'workspai.graph.package',
        version: GRAPH_PACKAGE_COMPATIBILITY_RENDERER_VERSION,
        status: completeness === 'complete' ? 'passed' : 'partial',
        permission: 'filesystem-read',
        discoveredEntities: entities.length,
        discoveredRelations: relations.length,
        proofCount: proofs.length,
        diagnostics: diagnostics.map((item) => item.code),
      },
    ],
    quality: {
      entityCount: entities.length,
      relationCount: relations.length,
      proofCount: proofs.length,
      entityProofCoverageRatio: ratio(
        entities.filter((entity) => entity.proofIds.length > 0).length,
        entities.length
      ),
      relationProofCoverageRatio: ratio(
        relations.filter((relation) => relation.proofIds.length > 0).length,
        relations.length
      ),
      providerSuccessRatio: 1,
      conflictCount: 0,
      unknownCount: request.package.quality.unknownZones.length,
      completeness: {
        status: completeness,
        inventory: {
          scopeCount: 1,
          completeScopes: completeness === 'complete' ? 1 : 0,
          boundedScopes: completeness === 'complete' ? 0 : 1,
          eligibleFiles: request.package.evidenceLocators?.length ?? 0,
          indexedFiles: request.package.evidenceLocators?.length ?? 0,
          eligibleFileCountExact: true,
        },
        providers: {
          complete: completeness === 'complete' ? 1 : 0,
          bounded: completeness === 'complete' ? 0 : 1,
          notApplicable: 0,
          failed: 0,
        },
      },
      portable: true,
      secretValuesEmitted: false,
    },
    diagnostics,
  };
}
