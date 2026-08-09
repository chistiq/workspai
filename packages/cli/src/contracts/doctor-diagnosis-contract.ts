export const DOCTOR_DIAGNOSIS_SCHEMA_VERSION = 'workspai.doctor-diagnosis.v1' as const;

export type DoctorDiagnosisFindingStatus = 'blocking' | 'advisory' | 'informational' | 'unknown';

export type DoctorDiagnosisConfidence = 'high' | 'medium' | 'low';

export type DoctorDiagnosisApplicability = 'applicable' | 'not-applicable' | 'unknown';

export type DoctorDiagnosisDomainId =
  'runtime' | 'dependency' | 'security' | 'configuration' | 'test' | 'quality';

export type DoctorDiagnosisDomainCoverage = {
  id: DoctorDiagnosisDomainId;
  status: 'clean' | 'findings' | 'not-applicable' | 'not-run' | 'stale';
  observationCount: number;
  blockingFindings: number;
  advisoryFindings: number;
  reason: string;
};

export type DoctorDiagnosisProof = {
  kind: 'probe' | 'file' | 'dependency' | 'runtime' | 'command' | 'graph' | 'unknown';
  role: 'observation' | 'repair-target' | 'subject' | 'verification' | 'impact';
  ref: string;
  claim: string;
};

export type DoctorDiagnosisFinding = {
  id: string;
  causalKey: string;
  projectName: string;
  projectPath: string;
  probeId: string;
  label: string;
  status: DoctorDiagnosisFindingStatus;
  severity: 'info' | 'warn' | 'error';
  issueClass: string;
  operationalImpact: string;
  applicability: DoctorDiagnosisApplicability;
  confidence: DoctorDiagnosisConfidence;
  confidenceScore: number;
  diagnosisState: 'confirmed' | 'candidate' | 'unknown';
  symptom: string;
  recommendation?: string;
  proofs: DoctorDiagnosisProof[];
  repair: {
    disposition: 'automatic' | 'approval-required' | 'manual' | 'unavailable' | 'not-needed';
    capabilityId?: string;
    operationType?: string;
    verifyCommand?: string;
    requiresFreshEvidence: boolean;
  };
};

export type DoctorDiagnosisCausalGroup = {
  causalKey: string;
  issueClass: string;
  status: DoctorDiagnosisFindingStatus;
  findingIds: string[];
  projectPaths: string[];
  repairable: boolean;
};

export type DoctorDiagnosisCoverage = {
  totalObservations: number;
  evaluatedObservations: number;
  passingObservations: number;
  blockingFindings: number;
  advisoryFindings: number;
  unknownFindings: number;
  repairableFindings: number;
  manualFindings: number;
  unsupportedFindings: number;
  contradictionCount: number;
  diagnosisCompleteness: number;
};

export type DoctorDiagnosis = {
  schemaVersion: typeof DOCTOR_DIAGNOSIS_SCHEMA_VERSION;
  engineVersion: 'universal-diagnosis-v1';
  project: {
    name: string;
    path: string;
    runtimeFamily: string;
    runtimeFamilies: string[];
    framework: string;
    projectKind: string;
  };
  capability: {
    registryVersion: string;
    adapterId: string;
    runtimeFamily: string;
    tier: 'first-class' | 'extended' | 'fallback';
    confidence: DoctorDiagnosisConfidence;
    nativeDomains: DoctorDiagnosisDomainId[];
    portableDomains: DoctorDiagnosisDomainId[];
    observableDomains: DoctorDiagnosisDomainId[];
    unsupportedDomains: DoctorDiagnosisDomainId[];
    limitations: string[];
  };
  domains: DoctorDiagnosisDomainCoverage[];
  coverage: DoctorDiagnosisCoverage;
  findings: DoctorDiagnosisFinding[];
  causalGroups: DoctorDiagnosisCausalGroup[];
  unknowns: Array<{
    id: string;
    reason: string;
    probeId?: string;
  }>;
  contradictions: Array<{
    probeId: string;
    statuses: string[];
    reason: string;
  }>;
};
