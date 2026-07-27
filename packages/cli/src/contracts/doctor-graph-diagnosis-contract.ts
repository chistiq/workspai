import type {
  WorkspaceKnowledgeEntityKind,
  WorkspaceKnowledgeRelationKind,
} from './workspace-knowledge-graph-contract.js';

export const DOCTOR_GRAPH_DIAGNOSIS_SCHEMA_VERSION = 'doctor-graph-diagnosis.v1' as const;

export type DoctorGraphDiagnosisStatus =
  'available' | 'graph-missing' | 'model-missing' | 'stale' | 'project-unresolved' | 'invalid';

export type DoctorGraphEntityRef = {
  id: string;
  kind: WorkspaceKnowledgeEntityKind;
  label: string;
  projectId?: string;
};

export type DoctorGraphProofPath = {
  from: string;
  to: string;
  entityPath: string[];
  hops: Array<{
    from: string;
    to: string;
    relationId: string;
    kind: WorkspaceKnowledgeRelationKind;
    direction: 'forward' | 'reverse';
    proofIds: string[];
  }>;
  proofIds: string[];
};

export type DoctorGraphFinding = {
  issueId: string;
  issueClass: string;
  status: 'warn' | 'fail';
  reason: string;
  scope: 'structural-impact-candidates';
  subjects: string[];
  unresolvedSubjects: string[];
  rootEntities: DoctorGraphEntityRef[];
  affectedEntities: DoctorGraphEntityRef[];
  verificationTargets: DoctorGraphEntityRef[];
  proofPaths: DoctorGraphProofPath[];
  sourceArtifacts: string[];
  unknowns: string[];
};

/**
 * Proof-carrying bridge between deterministic Doctor findings and the canonical
 * workspace knowledge graph. Paths describe structural reachability; they are
 * deliberately not represented as runtime causality.
 */
export type DoctorGraphDiagnosis = {
  schemaVersion: typeof DOCTOR_GRAPH_DIAGNOSIS_SCHEMA_VERSION;
  generatedAt: string;
  status: DoctorGraphDiagnosisStatus;
  claimBoundary: string;
  graph: {
    artifact: string;
    schemaVersion?: string;
    sourceArtifact?: string;
    sourceHash?: string;
    entityCount?: number;
    relationCount?: number;
    proofCount?: number;
  };
  project: {
    name: string;
    path: string;
    entityId?: string;
  };
  summary: {
    findingCount: number;
    rootEntityCount: number;
    affectedEntityCount: number;
    verificationTargetCount: number;
    proofPathCount: number;
    subjectCount: number;
    unresolvedSubjectCount: number;
    unknownCount: number;
  };
  findings: DoctorGraphFinding[];
  diagnostics: string[];
};
