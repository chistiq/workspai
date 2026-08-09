type JsonRecord = Record<string, unknown>;

export type CanonicalDoctorAssessment = {
  canonical: boolean;
  projectCount: number;
  diagnosedProjectCount: number;
  missingDiagnosisProjects: number;
  blockingFindings: number;
  advisoryFindings: number;
  unknownFindings: number;
  contradictionCount: number;
  minimumDiagnosisCompleteness: number;
  staleEvidence: boolean;
  unknownFreshness: boolean;
  hasSystemErrors: boolean;
};

export type CanonicalDoctorDependencyAssessment = {
  blockingFindings: number;
  advisoryFindings: number;
  unknownFindings: number;
  missingDependencies: number;
  auditUnavailable: number;
  auditFailed: number;
  vulnerableDependencies: number;
};

export type CanonicalDoctorFindingView = {
  projectName: string;
  id?: string;
  causalKey?: string;
  issueClass?: string;
  status: 'blocking' | 'advisory' | 'unknown';
  message: string;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((entry): entry is JsonRecord => entry !== null)
    : [];
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function boundedPercentage(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

/**
 * Consume Doctor evidence without re-diagnosing it. New evidence is governed by
 * project.diagnosis; legacy evidence remains readable through summary/score fallbacks.
 */
export function assessCanonicalDoctorEvidence(payload: JsonRecord): CanonicalDoctorAssessment {
  const projects = asRecords(payload.projects);
  const summary = asRecord(payload.summary);
  const healthScore = asRecord(payload.healthScore);
  const freshness = asRecord(payload.evidenceFreshness);
  const contract = asRecord(payload.contract);

  let blockingFindings = 0;
  let advisoryFindings = 0;
  let unknownFindings = 0;
  let contradictionCount = 0;
  const completeness: number[] = [];
  let diagnosedProjectCount = 0;

  for (const project of projects) {
    const diagnosis = asRecord(project.diagnosis);
    const coverage = asRecord(diagnosis?.coverage);
    if (!diagnosis || !coverage) continue;
    diagnosedProjectCount += 1;
    blockingFindings += nonNegativeInteger(coverage.blockingFindings);
    advisoryFindings += nonNegativeInteger(coverage.advisoryFindings);
    unknownFindings += nonNegativeInteger(coverage.unknownFindings);
    contradictionCount += nonNegativeInteger(coverage.contradictionCount);
    const value = boundedPercentage(coverage.diagnosisCompleteness);
    if (value !== null) completeness.push(value);
  }

  const canonicalDeclared =
    diagnosedProjectCount > 0 || contract?.scoringPolicyVersion === 'doctor-score-policy-v2';
  const canonical =
    canonicalDeclared && (projects.length === 0 || diagnosedProjectCount === projects.length);
  if (!canonical) {
    // Compatibility fallback is deliberately isolated here. It must never
    // override canonical project diagnosis when that diagnosis is present.
    blockingFindings = Math.max(
      blockingFindings,
      nonNegativeInteger(summary?.blockingFindings),
      nonNegativeInteger(healthScore?.errors)
    );
    advisoryFindings = Math.max(
      advisoryFindings,
      nonNegativeInteger(summary?.advisoryFindings),
      nonNegativeInteger(healthScore?.warnings)
    );
  }

  return {
    canonical,
    projectCount: projects.length,
    diagnosedProjectCount,
    missingDiagnosisProjects: canonicalDeclared
      ? Math.max(0, projects.length - diagnosedProjectCount)
      : 0,
    blockingFindings,
    advisoryFindings,
    unknownFindings,
    contradictionCount,
    minimumDiagnosisCompleteness:
      completeness.length > 0
        ? Math.min(...completeness)
        : projects.length === 0 || !canonicalDeclared
          ? 100
          : 0,
    staleEvidence: freshness?.status === 'stale',
    unknownFreshness: freshness?.status === 'unknown',
    hasSystemErrors:
      summary?.hasSystemErrors === true ||
      nonNegativeInteger(healthScore?.errors) > blockingFindings,
  };
}

export function assessCanonicalDoctorDependencies(
  payload: JsonRecord
): CanonicalDoctorDependencyAssessment {
  const projects = asRecords(payload.projects);
  let blockingFindings = 0;
  let advisoryFindings = 0;
  let unknownFindings = 0;
  let missingDependencies = 0;
  let auditUnavailable = 0;
  let auditFailed = 0;
  let vulnerableDependencies = 0;

  for (const project of projects) {
    if (project.depsInstalled === false) missingDependencies += 1;
    vulnerableDependencies += nonNegativeInteger(project.vulnerabilities);

    const audit = asRecord(project.dependencyAudit);
    if (audit?.status === 'tool-unavailable' || audit?.status === 'unsupported') {
      auditUnavailable += 1;
    } else if (audit?.status === 'failed') {
      auditFailed += 1;
    }

    const diagnosis = asRecord(project.diagnosis);
    for (const finding of asRecords(diagnosis?.findings)) {
      if (finding.issueClass !== 'dependency' && finding.issueClass !== 'security') continue;
      if (finding.status === 'blocking') blockingFindings += 1;
      else if (finding.status === 'advisory') advisoryFindings += 1;
      if (finding.status === 'unknown' || finding.diagnosisState === 'unknown') {
        unknownFindings += 1;
      }
    }
  }

  return {
    blockingFindings,
    advisoryFindings,
    unknownFindings,
    missingDependencies,
    auditUnavailable,
    auditFailed,
    vulnerableDependencies,
  };
}

/**
 * Project the canonical diagnosis into a small consumer-facing finding list.
 * Consumers may render or route these records, but must not infer a different
 * severity from raw probes when canonical findings exist.
 */
export function listCanonicalDoctorFindings(payload: JsonRecord): CanonicalDoctorFindingView[] {
  const findings: CanonicalDoctorFindingView[] = [];
  const singularProject = asRecord(payload.project);
  const projects = asRecords(payload.projects);
  if (singularProject) projects.push(singularProject);
  for (const project of projects) {
    const projectName = typeof project.name === 'string' ? project.name : 'project';
    const diagnosis = asRecord(project.diagnosis);
    const diagnosisFindings = asRecords(diagnosis?.findings);
    if (diagnosisFindings.length > 0) {
      for (const finding of diagnosisFindings) {
        const rawStatus = finding.status;
        if (!['blocking', 'advisory', 'unknown'].includes(String(rawStatus))) continue;
        const message =
          typeof finding.symptom === 'string'
            ? finding.symptom.trim()
            : typeof finding.label === 'string'
              ? finding.label.trim()
              : '';
        if (!message) continue;
        findings.push({
          projectName,
          status: rawStatus as CanonicalDoctorFindingView['status'],
          message,
          ...(typeof finding.id === 'string' ? { id: finding.id } : {}),
          ...(typeof finding.causalKey === 'string' ? { causalKey: finding.causalKey } : {}),
          ...(typeof finding.issueClass === 'string' ? { issueClass: finding.issueClass } : {}),
        });
      }
      continue;
    }

    // Isolated compatibility projection for evidence produced before the
    // diagnosis contract. Do not combine these rows with canonical findings.
    const issues = Array.isArray(project.issues)
      ? project.issues.filter((entry): entry is string => typeof entry === 'string')
      : [];
    for (const issue of issues) {
      findings.push({ projectName, status: 'blocking', message: issue.trim() });
    }
    for (const probe of asRecords(project.probes)) {
      if (probe.status !== 'fail' && probe.status !== 'warn') continue;
      const message =
        typeof probe.reason === 'string'
          ? probe.reason.trim()
          : typeof probe.label === 'string'
            ? probe.label.trim()
            : '';
      if (!message) continue;
      findings.push({
        projectName,
        status: probe.status === 'fail' ? 'blocking' : 'advisory',
        message,
        ...(typeof probe.id === 'string' ? { id: probe.id } : {}),
      });
    }
  }

  return [
    ...new Map(
      findings.map((finding) => [
        `${finding.projectName}:${finding.causalKey ?? finding.id ?? ''}:${finding.status}:${finding.message}`,
        finding,
      ])
    ).values(),
  ];
}
