import { buildDoctorDiagnosis, type DoctorDiagnosisProbeInput } from './diagnosis-engine.js';
import { DOCTOR_DIAGNOSTIC_DOMAINS, type DoctorDiagnosticDomain } from './adapter-contract.js';
import {
  createBuiltinDoctorAdapterRegistry,
  DOCTOR_CAPABILITY_REGISTRY_VERSION,
} from './capability-registry.js';
import {
  DOCTOR_VALIDATION_CORPUS_VERSION,
  DOCTOR_VALIDATION_SCHEMA_VERSION,
} from '../contracts/doctor-capabilities-contract.js';
export {
  DOCTOR_VALIDATION_CORPUS_VERSION,
  DOCTOR_VALIDATION_SCHEMA_VERSION,
} from '../contracts/doctor-capabilities-contract.js';

type ExpectedOutcome = {
  finding: boolean;
  domain?: DoctorDiagnosticDomain;
  status?: 'blocking' | 'advisory';
  diagnosisState?: 'confirmed' | 'candidate' | 'unknown';
  repairDisposition?: 'automatic' | 'approval-required' | 'manual' | 'unavailable';
};

export type DoctorDiseaseCase = {
  id: string;
  diseaseClass: string;
  description: string;
  probe: DoctorDiagnosisProbeInput;
  expected: ExpectedOutcome;
};

function findingProbe(input: {
  id: string;
  label: string;
  issueClass: string;
  severity?: 'warn' | 'error';
  confidence?: 'high' | 'medium' | 'low';
  repair?: 'automatic' | 'approval-required' | 'manual' | 'unavailable';
}): DoctorDiagnosisProbeInput {
  const severity = input.severity ?? 'error';
  const disposition = input.repair ?? 'unavailable';
  return {
    id: input.id,
    label: input.label,
    status: severity === 'error' ? 'fail' : 'warn',
    severity,
    reason: `${input.label} detected by the validation corpus.`,
    issueClass: input.issueClass,
    operationalImpact: severity === 'error' ? 'release-risk' : 'ci-risk',
    repairIntent: { confidence: input.confidence ?? 'medium', requiresFreshEvidence: true },
    ...(disposition === 'unavailable'
      ? {}
      : {
          repairCapability: {
            id: `repair.${input.id}`,
            status: disposition === 'manual' ? ('manual' as const) : ('available' as const),
            canAutoFix: disposition === 'automatic' || disposition === 'approval-required',
            requiresApproval: disposition === 'approval-required',
            requiresReview: disposition === 'manual',
            operation: { type: 'validation-operation' },
            verifyCommand: 'npx workspai doctor project --json',
          },
        }),
  };
}

export const DOCTOR_DISEASE_CORPUS: readonly DoctorDiseaseCase[] = [
  {
    id: 'runtime-missing',
    diseaseClass: 'runtime',
    description: 'Required runtime is absent.',
    probe: findingProbe({ id: 'runtime-missing', label: 'Runtime missing', issueClass: 'runtime' }),
    expected: {
      finding: true,
      domain: 'runtime',
      status: 'blocking',
      diagnosisState: 'candidate',
      repairDisposition: 'unavailable',
    },
  },
  {
    id: 'dependencies-missing',
    diseaseClass: 'dependency',
    description: 'Installed dependency tree is absent.',
    probe: findingProbe({
      id: 'dependencies-missing',
      label: 'Dependencies missing',
      issueClass: 'dependency',
      repair: 'automatic',
      confidence: 'high',
    }),
    expected: {
      finding: true,
      domain: 'dependency',
      status: 'blocking',
      diagnosisState: 'confirmed',
      repairDisposition: 'automatic',
    },
  },
  {
    id: 'security-advisory',
    diseaseClass: 'security',
    description: 'A runtime-native audit reports a blocking advisory.',
    probe: findingProbe({
      id: 'security-advisory',
      label: 'Security advisory',
      issueClass: 'security',
      repair: 'approval-required',
      confidence: 'high',
    }),
    expected: {
      finding: true,
      domain: 'security',
      status: 'blocking',
      diagnosisState: 'confirmed',
      repairDisposition: 'approval-required',
    },
  },
  {
    id: 'environment-contract',
    diseaseClass: 'configuration',
    description: 'Environment/configuration contract is incomplete.',
    probe: findingProbe({
      id: 'environment-contract',
      label: 'Environment contract incomplete',
      issueClass: 'environment',
      severity: 'warn',
      repair: 'manual',
    }),
    expected: {
      finding: true,
      domain: 'configuration',
      status: 'advisory',
      diagnosisState: 'candidate',
      repairDisposition: 'manual',
    },
  },
  {
    id: 'container-contract',
    diseaseClass: 'configuration',
    description: 'Container delivery contract is incomplete.',
    probe: findingProbe({
      id: 'container-contract',
      label: 'Container contract incomplete',
      issueClass: 'container',
      severity: 'warn',
    }),
    expected: {
      finding: true,
      domain: 'configuration',
      status: 'advisory',
      diagnosisState: 'candidate',
      repairDisposition: 'unavailable',
    },
  },
  {
    id: 'tests-missing',
    diseaseClass: 'test',
    description: 'No deterministic test surface is declared.',
    probe: findingProbe({
      id: 'tests-missing',
      label: 'Tests missing',
      issueClass: 'test',
      severity: 'warn',
      repair: 'manual',
    }),
    expected: {
      finding: true,
      domain: 'test',
      status: 'advisory',
      diagnosisState: 'candidate',
      repairDisposition: 'manual',
    },
  },
  {
    id: 'quality-missing',
    diseaseClass: 'quality',
    description: 'No lint/format/static-analysis surface is declared.',
    probe: findingProbe({
      id: 'quality-missing',
      label: 'Quality tooling missing',
      issueClass: 'quality',
      severity: 'warn',
    }),
    expected: {
      finding: true,
      domain: 'quality',
      status: 'advisory',
      diagnosisState: 'candidate',
      repairDisposition: 'unavailable',
    },
  },
  {
    id: 'stale-evidence',
    diseaseClass: 'freshness',
    description: 'Evidence is stale and must not be treated as confirmed.',
    probe: {
      ...findingProbe({ id: 'stale-evidence', label: 'Stale evidence', issueClass: 'security' }),
      freshness: { status: 'stale', verifyBeforeUse: true },
    },
    expected: {
      finding: true,
      domain: 'security',
      status: 'blocking',
      diagnosisState: 'unknown',
      repairDisposition: 'unavailable',
    },
  },
  {
    id: 'unknown-disease',
    diseaseClass: 'unknown',
    description: 'A real symptom cannot be bound to a typed disease class.',
    probe: findingProbe({ id: 'unknown-disease', label: 'Unknown disease', issueClass: 'unknown' }),
    expected: {
      finding: true,
      status: 'blocking',
      diagnosisState: 'unknown',
      repairDisposition: 'unavailable',
    },
  },
  {
    id: 'healthy-runtime',
    diseaseClass: 'healthy-control',
    description: 'Healthy evidence must not become a finding.',
    probe: {
      id: 'healthy-runtime',
      label: 'Healthy runtime',
      status: 'pass',
      severity: 'info',
      reason: 'Runtime evidence is healthy.',
      issueClass: 'runtime',
      operationalImpact: 'none',
    },
    expected: { finding: false, domain: 'runtime' },
  },
] as const;

export type DoctorValidationReport = {
  schemaVersion: typeof DOCTOR_VALIDATION_SCHEMA_VERSION;
  corpusVersion: typeof DOCTOR_VALIDATION_CORPUS_VERSION;
  capabilityRegistryVersion: typeof DOCTOR_CAPABILITY_REGISTRY_VERSION;
  scope: 'synthetic-contract-corpus';
  summary: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    truePositives: number;
    trueNegatives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    domainCoverage: number;
    runtimeAdapterCoverage: number;
    runtimeAdaptersExercised: number;
    declaredPlatforms: number;
  };
  cases: Array<{
    id: string;
    passed: boolean;
    expected: ExpectedOutcome;
    actual: {
      finding: boolean;
      domain?: DoctorDiagnosticDomain;
      status?: string;
      diagnosisState?: string;
      repairDisposition?: string;
    };
    failures: string[];
  }>;
  limitations: string[];
};

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function runDoctorValidationCorpus(): DoctorValidationReport {
  const registry = createBuiltinDoctorAdapterRegistry();
  const adapters = registry.list();
  const cases = adapters.flatMap((adapter) =>
    DOCTOR_DISEASE_CORPUS.map((entry) => {
      const runtimeFamily = adapter.runtimeFamilies[0] ?? 'unknown';
      const framework = adapter.frameworks[0] ?? 'Unknown';
      const diagnosis = buildDoctorDiagnosis({
        projectName: `validation-${adapter.id}-${entry.id}`,
        projectPath: `/virtual/doctor-validation/${adapter.id}/${entry.id}`,
        runtimeFamily,
        framework,
        projectKind: 'generic',
        probes: [entry.probe],
      });
      const finding = diagnosis.findings.find((candidate) => candidate.probeId === entry.probe.id);
      const domain = diagnosis.domains.find((candidate) => candidate.observationCount > 0)?.id;
      const actual = {
        finding: Boolean(finding),
        ...(domain ? { domain } : {}),
        ...(finding?.status ? { status: finding.status } : {}),
        ...(finding?.diagnosisState ? { diagnosisState: finding.diagnosisState } : {}),
        ...(finding?.repair.disposition ? { repairDisposition: finding.repair.disposition } : {}),
      };
      const failures: string[] = [];
      if (actual.finding !== entry.expected.finding) failures.push('finding-presence');
      if (entry.expected.domain && actual.domain !== entry.expected.domain) failures.push('domain');
      if (entry.expected.status && actual.status !== entry.expected.status) failures.push('status');
      if (entry.expected.diagnosisState && actual.diagnosisState !== entry.expected.diagnosisState)
        failures.push('diagnosis-state');
      if (
        entry.expected.repairDisposition &&
        actual.repairDisposition !== entry.expected.repairDisposition
      )
        failures.push('repair-disposition');
      if (diagnosis.capability.adapterId !== adapter.id) failures.push('adapter-binding');
      return {
        id: `${adapter.id}:${entry.id}`,
        passed: failures.length === 0,
        expected: entry.expected,
        actual,
        failures,
      };
    })
  );

  const positives = cases.filter((entry) => entry.expected.finding);
  const negatives = cases.filter((entry) => !entry.expected.finding);
  const truePositives = positives.filter((entry) => entry.actual.finding).length;
  const falseNegatives = positives.length - truePositives;
  const trueNegatives = negatives.filter((entry) => !entry.actual.finding).length;
  const falsePositives = negatives.length - trueNegatives;
  const observedDomains = new Set(
    cases
      .map((entry) => entry.actual.domain)
      .filter((domain): domain is DoctorDiagnosticDomain => Boolean(domain))
  );

  return {
    schemaVersion: DOCTOR_VALIDATION_SCHEMA_VERSION,
    corpusVersion: DOCTOR_VALIDATION_CORPUS_VERSION,
    capabilityRegistryVersion: DOCTOR_CAPABILITY_REGISTRY_VERSION,
    scope: 'synthetic-contract-corpus',
    summary: {
      totalCases: cases.length,
      passedCases: cases.filter((entry) => entry.passed).length,
      failedCases: cases.filter((entry) => !entry.passed).length,
      truePositives,
      trueNegatives,
      falsePositives,
      falseNegatives,
      precision: roundMetric(truePositives / Math.max(1, truePositives + falsePositives)),
      recall: roundMetric(truePositives / Math.max(1, truePositives + falseNegatives)),
      domainCoverage: roundMetric(observedDomains.size / DOCTOR_DIAGNOSTIC_DOMAINS.length),
      runtimeAdapterCoverage: roundMetric(
        new Set(cases.map((entry) => entry.id.split(':', 1)[0])).size / Math.max(1, adapters.length)
      ),
      runtimeAdaptersExercised: adapters.length,
      declaredPlatforms: new Set(adapters.flatMap((adapter) => adapter.platforms)).size,
    },
    cases,
    limitations: [
      'Precision and recall describe the versioned synthetic contract corpus, not every public repository.',
      'Every registered runtime adapter is exercised against the same disease corpus; this proves contract behavior, not tool availability on a host.',
      'Runtime-native fixture and real Linux, macOS, and Windows acceptance gates remain separate evidence surfaces.',
    ],
  };
}
