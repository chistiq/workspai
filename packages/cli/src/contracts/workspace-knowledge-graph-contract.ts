import type { WorkspaceDependencyGraph } from './workspace-dependency-graph-contract.js';

import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
} from './workspace-intelligence-runtime-registry.js';

export const WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph;

export const WORKSPACE_KNOWLEDGE_ENTITY_KINDS = [
  'workspace',
  'project',
  'service',
  'api',
  'endpoint',
  'schema',
  'package',
  'module',
  'file',
  'symbol',
  'database',
  'queue',
  'container',
  'deployment',
  'pipeline',
  'environment',
  'document',
  'decision',
  'test-suite',
  'owner',
] as const;

export const WORKSPACE_KNOWLEDGE_RELATION_KINDS = [
  'contains',
  'defines',
  'imports',
  'depends-on',
  'exposes',
  'implements',
  'calls',
  'reads-from',
  'writes-to',
  'publishes',
  'consumes',
  'deploys',
  'runs-on',
  'routes-to',
  'documents',
  'decided-by',
  'tests',
  'owns',
  'generated-by',
  'configured-by',
  'references',
] as const;

export const WORKSPACE_KNOWLEDGE_DERIVATIONS = ['extracted', 'inferred', 'authored'] as const;
export const WORKSPACE_KNOWLEDGE_TRUST_LEVELS = [
  'authoritative',
  'corroborated',
  'observed',
  'ambiguous',
] as const;
export const WORKSPACE_KNOWLEDGE_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export const WORKSPACE_KNOWLEDGE_FRESHNESS_LEVELS = ['fresh', 'stale', 'unknown'] as const;

export type WorkspaceKnowledgeEntityKind = (typeof WORKSPACE_KNOWLEDGE_ENTITY_KINDS)[number];
export type WorkspaceKnowledgeRelationKind = (typeof WORKSPACE_KNOWLEDGE_RELATION_KINDS)[number];
export type WorkspaceKnowledgeDerivation = (typeof WORKSPACE_KNOWLEDGE_DERIVATIONS)[number];
export type WorkspaceKnowledgeTrust = (typeof WORKSPACE_KNOWLEDGE_TRUST_LEVELS)[number];
export type WorkspaceKnowledgeConfidence = (typeof WORKSPACE_KNOWLEDGE_CONFIDENCE_LEVELS)[number];
export type WorkspaceKnowledgeFreshness = (typeof WORKSPACE_KNOWLEDGE_FRESHNESS_LEVELS)[number];

export type WorkspaceKnowledgeScalar = string | number | boolean | null;
export type WorkspaceKnowledgeAttribute = WorkspaceKnowledgeScalar | WorkspaceKnowledgeScalar[];

export type WorkspaceKnowledgeIdentity = {
  /** Stable, provider-neutral identity key. Paths may be aliases, never the only identity. */
  key: string;
  scope: 'workspace' | 'project';
  aliases: string[];
  fingerprint: string;
};

/** Portable proof locator. Absolute paths and secret values are forbidden. */
export type WorkspaceKnowledgeProof = {
  id: string;
  provider: string;
  artifact: string;
  pointer?: string;
  line?: number;
  column?: number;
  contentHash?: string;
  observedAt: string;
  derivation: WorkspaceKnowledgeDerivation;
  trust: WorkspaceKnowledgeTrust;
  confidence: WorkspaceKnowledgeConfidence;
  freshness: WorkspaceKnowledgeFreshness;
  detail?: string;
};

export type WorkspaceKnowledgeEntity = {
  id: string;
  kind: WorkspaceKnowledgeEntityKind;
  label: string;
  projectId?: string;
  identity: WorkspaceKnowledgeIdentity;
  attributes: Record<string, WorkspaceKnowledgeAttribute>;
  proofIds: string[];
};

export type WorkspaceKnowledgeRelation = {
  id: string;
  from: string;
  to: string;
  kind: WorkspaceKnowledgeRelationKind;
  derivation: WorkspaceKnowledgeDerivation;
  trust: WorkspaceKnowledgeTrust;
  confidence: WorkspaceKnowledgeConfidence;
  proofIds: string[];
};

export type WorkspaceKnowledgeProviderRun = {
  id: string;
  version: string;
  status: 'passed' | 'partial' | 'skipped' | 'failed';
  permission: 'filesystem-read' | 'git-read' | 'runtime-probe' | 'network';
  discoveredEntities: number;
  discoveredRelations: number;
  proofCount: number;
  diagnostics: string[];
};

export type WorkspaceKnowledgeDiagnostic = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  entityIds?: string[];
  relationIds?: string[];
  recommendation?: string;
};

export type WorkspaceKnowledgeBindingCoverage = {
  eligibleCount: number;
  boundCount: number;
  unknownCount: number;
  /** Null means the binding dimension is not applicable to the observed workspace. */
  coverageRatio: number | null;
};

export type WorkspaceKnowledgeGraph = {
  schemaVersion: typeof WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION;
  generatedAt: string;
  source: {
    /** The integrated CLI always derives the graph from the canonical Workspace Model. */
    kind: 'workspace-model';
    /** Canonical model artifact whose structural identity authorizes this graph. */
    artifact: (typeof WORKSPACE_INTELLIGENCE_ARTIFACTS)['model'];
    hashAlgorithm: 'sha256';
    /** SHA-256 of the model's stable structural projection, not its raw file bytes. */
    hash: string;
  };
  workspace: { name: string; profile?: string };
  /** Canonical project-level projection used by impact, verify and blast radius. */
  projectTopology: WorkspaceDependencyGraph;
  entities: WorkspaceKnowledgeEntity[];
  relations: WorkspaceKnowledgeRelation[];
  proofs: WorkspaceKnowledgeProof[];
  providers: WorkspaceKnowledgeProviderRun[];
  quality: {
    entityCount: number;
    relationCount: number;
    proofCount: number;
    entityProofCoverageRatio: number;
    relationProofCoverageRatio: number;
    providerSuccessRatio: number;
    conflictCount: number;
    unknownCount: number;
    bindingCoverage?: {
      apiImplementation: WorkspaceKnowledgeBindingCoverage;
      projectTests: WorkspaceKnowledgeBindingCoverage;
      projectDeployment: WorkspaceKnowledgeBindingCoverage;
      projectOwnership: WorkspaceKnowledgeBindingCoverage;
    };
    portable: boolean;
    secretValuesEmitted: false;
  };
  diagnostics: WorkspaceKnowledgeDiagnostic[];
};
