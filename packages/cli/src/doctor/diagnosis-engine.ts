import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  DOCTOR_DIAGNOSIS_SCHEMA_VERSION,
  type DoctorDiagnosis,
  type DoctorDiagnosisConfidence,
  type DoctorDiagnosisDomainCoverage,
  type DoctorDiagnosisFinding,
  type DoctorDiagnosisFindingStatus,
  type DoctorDiagnosisProof,
} from '../contracts/doctor-diagnosis-contract.js';
import { assessDoctorCapability, type DoctorCapabilityAssessment } from './capability-registry.js';
import type { DoctorAdapterRegistry } from './adapter-contract.js';

const REQUIRED_DIAGNOSIS_DOMAINS = [
  'runtime',
  'dependency',
  'security',
  'configuration',
  'test',
  'quality',
] as const satisfies readonly DoctorDiagnosisDomainCoverage['id'][];

type DiagnosisFreshness = {
  status?: 'fresh' | 'stale' | 'unknown';
  verifyBeforeUse?: boolean;
};

type DiagnosisRepairCapability = {
  id?: string;
  status?: 'available' | 'manual' | 'blocked';
  canAutoFix?: boolean;
  requiresApproval?: boolean;
  requiresReview?: boolean;
  files?: string[];
  operation?: { type?: string };
  invocation?: { executable?: string; args?: string[] };
  verifyCommand?: string;
};

export type DoctorDiagnosisProbeInput = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  severity: 'info' | 'warn' | 'error';
  applicability?: 'applicable' | 'not-applicable' | 'unknown';
  reason: string;
  recommendation?: string;
  issueClass?: string;
  operationalImpact?: string;
  freshness?: DiagnosisFreshness;
  repairIntent?: {
    confidence?: DoctorDiagnosisConfidence;
    requiresFreshEvidence?: boolean;
  };
  repairCapability?: DiagnosisRepairCapability;
};

export type BuildDoctorDiagnosisInput = {
  projectName: string;
  projectPath: string;
  runtimeFamily?: string;
  runtimeFamilies?: string[];
  framework?: string;
  projectKind?: string;
  probes: DoctorDiagnosisProbeInput[];
  legacyIssues?: string[];
  dependencySubjects?: Array<{
    name: string;
    version?: string;
    advisoryIds?: string[];
  }>;
  adapterRegistry?: DoctorAdapterRegistry;
};

function stableToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

function normalizedStatement(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function legacyIssueCoveredByProbe(
  issue: string,
  probes: readonly DoctorDiagnosisProbeInput[]
): boolean {
  const normalizedIssue = normalizedStatement(issue);
  if (!normalizedIssue) return true;
  return probes.some((probe) => {
    const candidates = [probe.reason, probe.recommendation ?? '']
      .map(normalizedStatement)
      .filter(Boolean);
    return candidates.some(
      (candidate) =>
        candidate === normalizedIssue ||
        candidate.includes(normalizedIssue) ||
        normalizedIssue.includes(candidate)
    );
  });
}

function findingStatus(probe: DoctorDiagnosisProbeInput): DoctorDiagnosisFindingStatus {
  if (probe.status === 'fail') return 'blocking';
  if (probe.status === 'warn') return 'advisory';
  return 'informational';
}

function domainForProbe(
  probe: DoctorDiagnosisProbeInput
): DoctorDiagnosisDomainCoverage['id'] | null {
  if (probe.issueClass === 'dependency') return 'dependency';
  if (probe.issueClass === 'security') return 'security';
  if (
    probe.issueClass === 'environment' ||
    probe.issueClass === 'configuration' ||
    probe.issueClass === 'container' ||
    probe.issueClass === 'deployment' ||
    probe.issueClass === 'workspace-contract'
  ) {
    return 'configuration';
  }
  if (probe.issueClass === 'test') return 'test';
  if (probe.issueClass === 'quality' || probe.issueClass === 'custom') return 'quality';
  if (
    probe.issueClass === 'runtime' ||
    probe.issueClass === 'framework' ||
    probe.issueClass === 'source-tree'
  ) {
    return 'runtime';
  }
  return null;
}

function buildDomainCoverage(
  observations: DoctorDiagnosisProbeInput[],
  capability: DoctorCapabilityAssessment
): DoctorDiagnosisDomainCoverage[] {
  return REQUIRED_DIAGNOSIS_DOMAINS.map((id) => {
    const allDomainObservations = observations.filter((probe) => domainForProbe(probe) === id);
    const domainObservations = observations.filter(
      (probe) => probe.applicability !== 'not-applicable' && domainForProbe(probe) === id
    );
    const unsupported = capability.unsupportedDomains.includes(id);
    if (domainObservations.length === 0) {
      const explicitlyNotApplicable = allDomainObservations.some(
        (probe) => probe.applicability === 'not-applicable'
      );
      return {
        id,
        status: explicitlyNotApplicable ? 'not-applicable' : 'not-run',
        observationCount: 0,
        blockingFindings: 0,
        advisoryFindings: 0,
        reason: explicitlyNotApplicable
          ? `${id} checks ran and found no declared intent requiring this domain.`
          : unsupported
            ? `${id} is unsupported by Doctor adapter ${capability.adapterId}; no healthy claim is allowed.`
            : `No ${id} diagnostic observation was produced.`,
      };
    }
    const stale = domainObservations.some(
      (probe) => probe.freshness?.status === 'stale' || probe.freshness?.status === 'unknown'
    );
    const blockingFindings = domainObservations.filter((probe) => probe.status === 'fail').length;
    const advisoryFindings = domainObservations.filter((probe) => probe.status === 'warn').length;
    const findingsPresent = blockingFindings > 0 || advisoryFindings > 0;
    return {
      id,
      status: stale ? 'stale' : findingsPresent ? 'findings' : unsupported ? 'not-run' : 'clean',
      observationCount: domainObservations.length,
      blockingFindings,
      advisoryFindings,
      reason: stale
        ? `${id} evidence is stale or has unknown freshness.`
        : findingsPresent
          ? `${id} diagnostics produced findings.`
          : unsupported
            ? `${id} observations cannot establish complete health because adapter ${capability.adapterId} declares the domain unsupported.`
            : `${id} diagnostics completed without findings.`,
    };
  });
}

function repairDisposition(
  probe: DoctorDiagnosisProbeInput
): DoctorDiagnosisFinding['repair']['disposition'] {
  if (probe.status === 'pass') return 'not-needed';
  const capability = probe.repairCapability;
  if (!capability) return 'unavailable';
  if (capability.status === 'manual' || capability.requiresReview) return 'manual';
  if (capability.status !== 'available' || !capability.canAutoFix) return 'unavailable';
  return capability.requiresApproval ? 'approval-required' : 'automatic';
}

function confidenceForProbe(probe: DoctorDiagnosisProbeInput): {
  label: DoctorDiagnosisConfidence;
  score: number;
  state: DoctorDiagnosisFinding['diagnosisState'];
} {
  if (probe.freshness?.status === 'stale' || probe.freshness?.status === 'unknown') {
    return { label: 'low', score: 0.35, state: 'unknown' };
  }
  const issueKnown = Boolean(probe.issueClass && probe.issueClass !== 'unknown');
  const structuredRepair = Boolean(
    probe.repairCapability?.operation?.type || probe.repairCapability?.invocation?.executable
  );
  if (issueKnown && structuredRepair && probe.repairIntent?.confidence === 'high') {
    return { label: 'high', score: 0.95, state: 'confirmed' };
  }
  if (issueKnown && (probe.status === 'fail' || probe.status === 'warn')) {
    return { label: 'medium', score: structuredRepair ? 0.82 : 0.68, state: 'candidate' };
  }
  if (probe.status === 'pass') {
    return { label: 'high', score: 0.98, state: 'confirmed' };
  }
  return { label: 'low', score: 0.3, state: 'unknown' };
}

function proofSet(
  probe: DoctorDiagnosisProbeInput,
  dependencySubjects: BuildDoctorDiagnosisInput['dependencySubjects']
): DoctorDiagnosisProof[] {
  const proofs: DoctorDiagnosisProof[] = [
    {
      kind: 'probe',
      role: 'observation',
      ref: `probe:${probe.id}`,
      claim: probe.reason,
    },
  ];
  for (const file of probe.repairCapability?.files ?? []) {
    proofs.push({
      kind: 'file',
      role: 'repair-target',
      ref: file.split(path.sep).join('/'),
      claim: 'Structured repair capability declared this path as an affected target.',
    });
  }
  if (probe.repairCapability?.invocation?.executable) {
    const invocation = probe.repairCapability.invocation;
    proofs.push({
      kind: 'command',
      role: 'verification',
      ref: [invocation.executable, ...(invocation.args ?? [])].join(' '),
      claim: 'Structured command invocation is available for this diagnostic path.',
    });
  }
  const dependencyAuditObservation =
    probe.issueClass === 'security' &&
    /(?:dependency|audit|vulnerab|security-hygiene)/i.test(`${probe.id} ${probe.label}`);
  if (dependencyAuditObservation) {
    for (const subject of dependencySubjects ?? []) {
      proofs.push({
        kind: 'dependency',
        role: 'subject',
        ref: subject.version ? `${subject.name}@${subject.version}` : subject.name,
        claim:
          subject.advisoryIds && subject.advisoryIds.length > 0
            ? `Dependency is referenced by ${subject.advisoryIds.join(', ')}.`
            : 'Dependency is present in security audit evidence.',
      });
    }
  }
  return proofs;
}

function probeFinding(
  input: BuildDoctorDiagnosisInput,
  probe: DoctorDiagnosisProbeInput
): DoctorDiagnosisFinding {
  const issueClass = probe.issueClass?.trim() || 'unknown';
  const confidence = confidenceForProbe(probe);
  const findingId = `${slug(probe.id)}:${stableToken(`${input.projectPath}\0${probe.id}`)}`;
  return {
    id: findingId,
    causalKey: [
      slug(input.projectName),
      stableToken(input.projectPath),
      slug(issueClass),
      slug(probe.id),
    ].join(':'),
    projectName: input.projectName,
    projectPath: input.projectPath,
    probeId: probe.id,
    label: probe.label,
    status: findingStatus(probe),
    severity: probe.severity,
    issueClass,
    operationalImpact: probe.operationalImpact?.trim() || 'developer-friction',
    applicability: probe.applicability ?? 'applicable',
    confidence: confidence.label,
    confidenceScore: confidence.score,
    diagnosisState: confidence.state,
    symptom: probe.reason,
    ...(probe.recommendation ? { recommendation: probe.recommendation } : {}),
    proofs: proofSet(probe, input.dependencySubjects),
    repair: {
      disposition: repairDisposition(probe),
      ...(probe.repairCapability?.id ? { capabilityId: probe.repairCapability.id } : {}),
      ...(probe.repairCapability?.operation?.type
        ? { operationType: probe.repairCapability.operation.type }
        : {}),
      ...(probe.repairCapability?.verifyCommand
        ? { verifyCommand: probe.repairCapability.verifyCommand }
        : {}),
      requiresFreshEvidence:
        probe.repairIntent?.requiresFreshEvidence === true ||
        probe.freshness?.verifyBeforeUse === true,
    },
  };
}

function legacyIssueFinding(
  input: BuildDoctorDiagnosisInput,
  issue: string,
  index: number
): DoctorDiagnosisFinding {
  const probeId = `legacy-runtime-issue-${index + 1}`;
  return {
    id: `${probeId}:${stableToken(`${input.projectPath}\0${issue}`)}`,
    causalKey: [
      slug(input.projectName),
      stableToken(input.projectPath),
      'unknown',
      stableToken(issue),
    ].join(':'),
    projectName: input.projectName,
    projectPath: input.projectPath,
    probeId,
    label: 'Runtime diagnostic issue',
    status: 'blocking',
    severity: 'error',
    issueClass: 'unknown',
    operationalImpact: 'runtime-risk',
    applicability: 'applicable',
    confidence: 'low',
    confidenceScore: 0.25,
    diagnosisState: 'unknown',
    symptom: issue,
    proofs: [
      {
        kind: 'unknown',
        role: 'observation',
        ref: `legacy-issue:${index + 1}`,
        claim: issue,
      },
    ],
    repair: { disposition: 'unavailable', requiresFreshEvidence: true },
  };
}

export function buildDoctorDiagnosis(input: BuildDoctorDiagnosisInput): DoctorDiagnosis {
  const observations = [...input.probes];
  const runtimeFamilies = [
    ...new Set(
      (input.runtimeFamilies && input.runtimeFamilies.length > 0
        ? input.runtimeFamilies
        : [input.runtimeFamily ?? 'unknown']
      ).filter(Boolean)
    ),
  ];
  const primaryRuntime = input.runtimeFamily ?? runtimeFamilies[0] ?? 'unknown';
  const unevaluatedRuntimeFamilies = runtimeFamilies.filter(
    (runtime) => runtime !== primaryRuntime && runtime !== 'unknown'
  );
  const capability = assessDoctorCapability(
    {
      runtimeFamily: input.runtimeFamily,
      framework: input.framework,
    },
    input.adapterRegistry
  );
  const domains = buildDomainCoverage(observations, capability);
  const uncoveredLegacyIssues = (input.legacyIssues ?? []).filter(
    (issue) => !legacyIssueCoveredByProbe(issue, observations)
  );
  const statusByProbe = new Map<string, Set<string>>();
  for (const probe of observations) {
    const statuses = statusByProbe.get(probe.id) ?? new Set<string>();
    statuses.add(probe.status);
    statusByProbe.set(probe.id, statuses);
  }
  const contradictions = [...statusByProbe.entries()]
    .filter(([, statuses]) => statuses.size > 1)
    .map(([probeId, statuses]) => ({
      probeId,
      statuses: [...statuses].sort(),
      reason: 'The same diagnostic probe produced contradictory states in one project scan.',
    }));

  const rawFindings = [
    ...observations
      .filter((probe) => probe.applicability !== 'not-applicable' && probe.status !== 'pass')
      .map((probe) => probeFinding(input, probe)),
    ...uncoveredLegacyIssues.map((issue, index) => legacyIssueFinding(input, issue, index)),
  ];
  const statusRank: Record<DoctorDiagnosisFindingStatus, number> = {
    blocking: 4,
    unknown: 3,
    advisory: 2,
    informational: 1,
  };
  const rawCausalMap = new Map<string, DoctorDiagnosisFinding[]>();
  for (const finding of rawFindings) {
    const group = rawCausalMap.get(finding.causalKey) ?? [];
    group.push(finding);
    rawCausalMap.set(finding.causalKey, group);
  }
  const findings = [...rawCausalMap.values()]
    .map((group) => {
      const ordered = [...group].sort(
        (left, right) =>
          statusRank[right.status] - statusRank[left.status] ||
          right.confidenceScore - left.confidenceScore ||
          left.id.localeCompare(right.id)
      );
      const representativeFinding = ordered.at(0);
      if (!representativeFinding) {
        throw new Error('Doctor diagnosis causal group cannot be empty.');
      }
      const representative = structuredClone(representativeFinding);
      representative.proofs = [
        ...new Map(
          group
            .flatMap((finding) => finding.proofs)
            .map((proof) => [`${proof.kind}:${proof.role}:${proof.ref}:${proof.claim}`, proof])
        ).values(),
      ];
      return representative;
    })
    .sort(
      (left, right) =>
        left.causalKey.localeCompare(right.causalKey) || left.id.localeCompare(right.id)
    );

  const causalMap = new Map<string, DoctorDiagnosisFinding[]>();
  for (const finding of findings) {
    const group = causalMap.get(finding.causalKey) ?? [];
    group.push(finding);
    causalMap.set(finding.causalKey, group);
  }
  const causalGroups = [...causalMap.entries()].map(([causalKey, group]) => ({
    causalKey,
    issueClass: group[0]?.issueClass ?? 'unknown',
    status: group.some((entry) => entry.status === 'blocking')
      ? ('blocking' as const)
      : group.some((entry) => entry.status === 'advisory')
        ? ('advisory' as const)
        : group.some((entry) => entry.status === 'unknown')
          ? ('unknown' as const)
          : ('informational' as const),
    findingIds: group.map((entry) => entry.id),
    projectPaths: [...new Set(group.map((entry) => entry.projectPath))],
    repairable: group.some(
      (entry) =>
        entry.repair.disposition === 'automatic' || entry.repair.disposition === 'approval-required'
    ),
  }));

  const findingUnknowns = findings
    .filter(
      (finding) =>
        finding.diagnosisState === 'unknown' ||
        finding.issueClass === 'unknown' ||
        finding.applicability === 'unknown'
    )
    .map((finding) => ({
      id: `unknown:${finding.id}`,
      probeId: finding.probeId,
      reason:
        finding.issueClass === 'unknown'
          ? 'The observation is real, but Doctor cannot yet bind it to a typed issue class.'
          : 'Evidence is insufficient or stale for a confirmed diagnosis.',
    }));
  const unknowns = [
    ...findingUnknowns,
    ...domains
      .filter((domain) => domain.status === 'not-run' || domain.status === 'stale')
      .map((domain) => ({
        id: `unknown:domain:${domain.id}:${stableToken(input.projectPath)}`,
        reason: domain.reason,
      })),
    ...unevaluatedRuntimeFamilies.map((runtime) => ({
      id: `unknown:runtime:${slug(runtime)}:${stableToken(input.projectPath)}`,
      reason: `${runtime} was detected inside this composite project boundary, but the ${primaryRuntime} adapter is the only runtime-specific adapter evaluated for this scan. Declare a nested project boundary or a typed Doctor adapter before treating ${runtime} as healthy.`,
    })),
  ];
  const diagnosedFindings = findings.filter(
    (finding) => finding.diagnosisState !== 'unknown'
  ).length;
  const findingCompleteness =
    findings.length === 0 ? 100 : (diagnosedFindings / findings.length) * 100;
  const domainCompleteness =
    (domains.filter((domain) => domain.status !== 'not-run' && domain.status !== 'stale').length /
      domains.length) *
    100;
  const knownRuntimeCount = runtimeFamilies.filter((runtime) => runtime !== 'unknown').length;
  const evaluatedRuntimeCount =
    primaryRuntime !== 'unknown' && runtimeFamilies.includes(primaryRuntime) ? 1 : 0;
  const runtimeCompleteness =
    knownRuntimeCount === 0 ? 0 : (evaluatedRuntimeCount / knownRuntimeCount) * 100;
  const diagnosisCompleteness =
    Math.round(Math.min(findingCompleteness, domainCompleteness, runtimeCompleteness) * 100) / 100;
  return {
    schemaVersion: DOCTOR_DIAGNOSIS_SCHEMA_VERSION,
    engineVersion: 'universal-diagnosis-v1',
    project: {
      name: input.projectName,
      path: input.projectPath,
      runtimeFamily: input.runtimeFamily ?? 'unknown',
      runtimeFamilies,
      framework: input.framework ?? 'Unknown',
      projectKind: input.projectKind ?? 'generic',
    },
    capability,
    domains,
    coverage: {
      totalObservations: observations.length + uncoveredLegacyIssues.length,
      evaluatedObservations: observations.filter(
        (probe) => probe.applicability !== 'not-applicable'
      ).length,
      passingObservations: observations.filter(
        (probe) => probe.applicability !== 'not-applicable' && probe.status === 'pass'
      ).length,
      blockingFindings: findings.filter((finding) => finding.status === 'blocking').length,
      advisoryFindings: findings.filter((finding) => finding.status === 'advisory').length,
      unknownFindings: unknowns.length,
      repairableFindings: findings.filter(
        (finding) =>
          finding.repair.disposition === 'automatic' ||
          finding.repair.disposition === 'approval-required'
      ).length,
      manualFindings: findings.filter((finding) => finding.repair.disposition === 'manual').length,
      unsupportedFindings: findings.filter(
        (finding) => finding.repair.disposition === 'unavailable'
      ).length,
      contradictionCount: contradictions.length,
      diagnosisCompleteness,
    },
    findings,
    causalGroups,
    unknowns,
    contradictions,
  };
}
