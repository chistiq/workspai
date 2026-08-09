export type DoctorEvidenceType = 'workspace' | 'project';

import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';
import { DOCTOR_DIAGNOSIS_SCHEMA_VERSION } from '../contracts/doctor-diagnosis-contract.js';
import { parseDoctorRepairOperation } from './doctor-repair-capabilities.js';

export const DOCTOR_WORKSPACE_EVIDENCE_SCHEMA = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.doctor;
export const DOCTOR_PROJECT_EVIDENCE_SCHEMA =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.doctorProject.schemaVersion;

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function isDoctorEvidencePayloadCompatible(
  payload: unknown,
  expectedType?: DoctorEvidenceType
): payload is Record<string, unknown> {
  const report = toObjectRecord(payload);
  if (!report) {
    return false;
  }

  const schemaVersion = report.schemaVersion;
  const evidenceType = report.evidenceType;

  if (schemaVersion !== undefined && typeof schemaVersion !== 'string') {
    return false;
  }
  if (evidenceType !== undefined && typeof evidenceType !== 'string') {
    return false;
  }

  // Schema-less Doctor reports predate the governed evidence contract. Keep
  // those reports readable only when they still expose a recognizable Doctor
  // shape. Accepting an arbitrary object here makes `{}` look like healthy
  // evidence to downstream readiness consumers, which is a fail-open trust
  // boundary violation.
  if (schemaVersion === undefined) {
    const hasWorkspaceShape =
      Array.isArray(report.projects) ||
      toObjectRecord(report.summary) !== null ||
      toObjectRecord(report.healthScore) !== null;
    const hasProjectShape = toObjectRecord(report.project) !== null;
    const hasExpectedShape =
      expectedType === 'workspace'
        ? hasWorkspaceShape
        : expectedType === 'project'
          ? hasProjectShape
          : hasWorkspaceShape || hasProjectShape;
    if (!hasExpectedShape) {
      return false;
    }
  }

  if (typeof schemaVersion === 'string') {
    if (
      schemaVersion !== DOCTOR_WORKSPACE_EVIDENCE_SCHEMA &&
      schemaVersion !== DOCTOR_PROJECT_EVIDENCE_SCHEMA
    ) {
      return false;
    }

    if (expectedType === 'workspace' && schemaVersion !== DOCTOR_WORKSPACE_EVIDENCE_SCHEMA) {
      return false;
    }
    if (expectedType === 'project' && schemaVersion !== DOCTOR_PROJECT_EVIDENCE_SCHEMA) {
      return false;
    }
  }

  if (typeof evidenceType === 'string') {
    if (evidenceType !== 'workspace' && evidenceType !== 'project') {
      return false;
    }
    if (expectedType && evidenceType !== expectedType) {
      return false;
    }
  }

  return true;
}

function integerField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`Doctor evidence ${field} must be a non-negative integer.`);
  }
  return Number(value);
}

function projectRecords(report: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(report.projects)) {
    return report.projects
      .map(toObjectRecord)
      .filter((project): project is Record<string, unknown> => project !== null);
  }
  const project = toObjectRecord(report.project);
  return project ? [project] : [];
}

function assertDiagnosisInvariants(project: Record<string, unknown>): void {
  const diagnosis = toObjectRecord(project.diagnosis);
  if (!diagnosis) return;
  if (diagnosis.schemaVersion !== DOCTOR_DIAGNOSIS_SCHEMA_VERSION) {
    throw new Error('Doctor diagnosis schemaVersion is missing or unsupported.');
  }
  const findings = Array.isArray(diagnosis.findings)
    ? diagnosis.findings
        .map(toObjectRecord)
        .filter((finding): finding is Record<string, unknown> => finding !== null)
    : [];
  const coverage = toObjectRecord(diagnosis.coverage);
  if (!coverage) throw new Error('Doctor diagnosis must publish coverage.');
  const capability = toObjectRecord(diagnosis.capability);
  if (!capability) throw new Error('Doctor diagnosis must publish capability truth.');
  const domains = Array.isArray(diagnosis.domains)
    ? diagnosis.domains
        .map(toObjectRecord)
        .filter((domain): domain is Record<string, unknown> => domain !== null)
    : [];
  const domainIds = domains.map((domain) => domain.id);
  if (domains.length !== 6 || new Set(domainIds).size !== domains.length) {
    throw new Error('Doctor diagnosis must publish each canonical diagnostic domain exactly once.');
  }
  const capabilityDomainFields = [
    'nativeDomains',
    'portableDomains',
    'observableDomains',
    'unsupportedDomains',
  ] as const;
  const capabilityDomains = capabilityDomainFields.flatMap((field) =>
    Array.isArray(capability[field]) ? capability[field] : []
  );
  if (
    capabilityDomains.length !== 6 ||
    new Set(capabilityDomains).size !== capabilityDomains.length ||
    domainIds.some((domain) => !capabilityDomains.includes(domain))
  ) {
    throw new Error('Doctor capability truth must classify every canonical domain exactly once.');
  }
  if (capability.tier === 'fallback' && capability.confidence !== 'low') {
    throw new Error('Doctor fallback capability cannot claim medium or high confidence.');
  }

  const findingIds = new Set<string>();
  for (const finding of findings) {
    if (typeof finding.id !== 'string' || !finding.id.trim()) {
      throw new Error('Doctor diagnosis finding id must be non-empty.');
    }
    if (findingIds.has(finding.id)) {
      throw new Error(`Doctor diagnosis finding id is duplicated: ${finding.id}`);
    }
    findingIds.add(finding.id);
    if (!Array.isArray(finding.proofs) || finding.proofs.length === 0) {
      throw new Error(`Doctor diagnosis finding ${finding.id} has no proof.`);
    }
  }

  const expectedBlocking = findings.filter((finding) => finding.status === 'blocking').length;
  const expectedAdvisory = findings.filter((finding) => finding.status === 'advisory').length;
  if (integerField(coverage, 'blockingFindings') !== expectedBlocking) {
    throw new Error('Doctor diagnosis blockingFindings contradicts its finding set.');
  }
  if (integerField(coverage, 'advisoryFindings') !== expectedAdvisory) {
    throw new Error('Doctor diagnosis advisoryFindings contradicts its finding set.');
  }
  const totalObservations = integerField(coverage, 'totalObservations');
  const evaluatedObservations = integerField(coverage, 'evaluatedObservations');
  const passingObservations = integerField(coverage, 'passingObservations');
  if (evaluatedObservations > totalObservations || passingObservations > evaluatedObservations) {
    throw new Error('Doctor diagnosis observation accounting is inconsistent.');
  }
  const repairDispositionTotal =
    integerField(coverage, 'repairableFindings') +
    integerField(coverage, 'manualFindings') +
    integerField(coverage, 'unsupportedFindings');
  if (repairDispositionTotal !== findings.length) {
    throw new Error('Doctor diagnosis repair disposition counts contradict its finding set.');
  }
  const unknowns = Array.isArray(diagnosis.unknowns) ? diagnosis.unknowns : [];
  if (integerField(coverage, 'unknownFindings') !== unknowns.length) {
    throw new Error('Doctor diagnosis unknownFindings contradicts its unknown set.');
  }
  const completeness = coverage.diagnosisCompleteness;
  if (typeof completeness !== 'number' || completeness < 0 || completeness > 100) {
    throw new Error('Doctor diagnosis completeness must be between 0 and 100.');
  }
  if (
    completeness === 100 &&
    domains.some((domain) => domain.status === 'not-run' || domain.status === 'stale')
  ) {
    throw new Error(
      'Doctor diagnosis cannot claim complete coverage with missing or stale domains.'
    );
  }
  if (completeness === 100 && unknowns.length > 0) {
    throw new Error('Doctor diagnosis cannot claim complete coverage while unknowns remain.');
  }

  const groupedFindingIds = new Set<string>();
  for (const rawGroup of Array.isArray(diagnosis.causalGroups) ? diagnosis.causalGroups : []) {
    const group = toObjectRecord(rawGroup);
    if (!group || !Array.isArray(group.findingIds)) {
      throw new Error('Doctor diagnosis causal group is malformed.');
    }
    for (const findingId of group.findingIds) {
      if (typeof findingId !== 'string' || !findingIds.has(findingId)) {
        throw new Error('Doctor diagnosis causal group references an unknown finding.');
      }
      if (groupedFindingIds.has(findingId)) {
        throw new Error('Doctor diagnosis finding belongs to more than one causal group.');
      }
      groupedFindingIds.add(findingId);
    }
  }
  if (groupedFindingIds.size !== findingIds.size) {
    throw new Error('Doctor diagnosis causal groups do not cover every finding exactly once.');
  }
}

function assertRepairCapabilityOperations(project: Record<string, unknown>): void {
  const capabilities = [
    ...(Array.isArray(project.repairCapabilities) ? project.repairCapabilities : []),
    ...(Array.isArray(project.probes)
      ? project.probes
          .map(toObjectRecord)
          .map((probe) => probe && toObjectRecord(probe.repairCapability))
      : []),
  ];
  for (const rawCapability of capabilities) {
    const capability = toObjectRecord(rawCapability);
    if (!capability || capability.operation === undefined) continue;
    if (!parseDoctorRepairOperation(capability.operation)) {
      const id = typeof capability.id === 'string' ? capability.id : 'unknown';
      throw new Error(`Doctor repair capability ${id} contains an invalid typed operation.`);
    }
  }
}

export function assertDoctorEvidenceSemanticInvariants(payload: unknown): void {
  const report = toObjectRecord(payload);
  if (!report) throw new Error('Doctor evidence must be an object.');

  const projects = projectRecords(report);
  const contract = toObjectRecord(report.contract);
  for (const project of projects) {
    assertDiagnosisInvariants(project);
    assertRepairCapabilityOperations(project);
  }
  if (
    contract?.scoringPolicyVersion === 'doctor-score-policy-v2' &&
    projects.some((project) => !toObjectRecord(project.diagnosis))
  ) {
    throw new Error('Canonical Doctor evidence contains a project without diagnosis.');
  }

  const score = toObjectRecord(report.healthScore);
  if (!score || typeof score.verdict !== 'string') {
    // Legacy evidence remains readable; v2 scoring invariants apply to newly
    // generated payloads that publish a verdict.
    return;
  }

  const total = integerField(score, 'total');
  const passed = integerField(score, 'passed');
  const warnings = integerField(score, 'warnings');
  const errors = integerField(score, 'errors');
  if (total !== passed + warnings + errors) {
    throw new Error('Doctor healthScore total must equal passed + warnings + errors.');
  }
  const expectedVerdict = errors > 0 ? 'blocked' : warnings > 0 ? 'attention' : 'passed';
  if (score.verdict !== expectedVerdict) {
    throw new Error(
      `Doctor healthScore verdict ${String(score.verdict)} contradicts score counts (${expectedVerdict}).`
    );
  }

  const components = toObjectRecord(score.components);
  if (components) {
    const host = toObjectRecord(components.host);
    const projectComponent = toObjectRecord(components.projects);
    if (!host || !projectComponent) {
      throw new Error('Doctor healthScore components must publish host and projects.');
    }
    for (const [label, component] of [
      ['host', host],
      ['projects', projectComponent],
    ] as const) {
      const componentTotal = integerField(component, 'total');
      const componentPassed = integerField(component, 'passed');
      const componentWarnings = integerField(component, 'warnings');
      const componentErrors = integerField(component, 'errors');
      if (componentTotal !== componentPassed + componentWarnings + componentErrors) {
        throw new Error(`Doctor ${label} score total contradicts its component counts.`);
      }
    }
    if (
      passed !== integerField(host, 'passed') + integerField(projectComponent, 'passed') ||
      warnings !== integerField(host, 'warnings') + integerField(projectComponent, 'warnings') ||
      errors !== integerField(host, 'errors') + integerField(projectComponent, 'errors')
    ) {
      throw new Error('Doctor healthScore contradicts its host/project components.');
    }
  }

  let blockingProjectFindings = 0;
  let advisoryProjectFindings = 0;
  for (const project of projects) {
    const probes = Array.isArray(project.probes) ? project.probes : [];
    const diagnosis = toObjectRecord(project.diagnosis);
    const diagnosisCoverage = diagnosis ? toObjectRecord(diagnosis.coverage) : null;
    const rawBlockingFindings =
      probes.filter((probe) => toObjectRecord(probe)?.status === 'fail').length +
      (Array.isArray(project.issues) ? project.issues.length : 0);
    const canonicalBlockingFindings = diagnosisCoverage
      ? integerField(diagnosisCoverage, 'blockingFindings')
      : rawBlockingFindings;
    blockingProjectFindings += canonicalBlockingFindings;

    const summary = toObjectRecord(project.probeSummary);
    if (summary) {
      if (
        integerField(summary, 'total') !==
        integerField(summary, 'passed') +
          integerField(summary, 'warnings') +
          integerField(summary, 'failed')
      ) {
        throw new Error('Doctor project probeSummary total contradicts its probe counts.');
      }
      const blockingFindings = integerField(summary, 'blockingFindings');
      if (blockingFindings !== canonicalBlockingFindings) {
        throw new Error(
          'Doctor project probeSummary.blockingFindings contradicts its canonical diagnosis.'
        );
      }
      const expectedProjectVerdict =
        blockingFindings > 0
          ? 'blocked'
          : integerField(summary, 'advisoryFindings') > 0
            ? 'attention'
            : 'passed';
      if (
        summary.verdict !== expectedProjectVerdict ||
        project.verdict !== expectedProjectVerdict
      ) {
        throw new Error('Doctor project verdict contradicts its probe summary.');
      }
      advisoryProjectFindings += integerField(summary, 'advisoryFindings');
    }
  }

  if (blockingProjectFindings > 0 && errors === 0) {
    throw new Error('Doctor evidence contains blocking findings but healthScore.errors is zero.');
  }
  const reportSummary = toObjectRecord(report.summary);
  if (reportSummary && Array.isArray(report.projects)) {
    if (
      reportSummary.blockingFindings !== undefined &&
      integerField(reportSummary, 'blockingFindings') !== blockingProjectFindings
    ) {
      throw new Error('Doctor workspace summary blockingFindings contradicts project diagnosis.');
    }
    if (
      reportSummary.advisoryFindings !== undefined &&
      integerField(reportSummary, 'advisoryFindings') !== advisoryProjectFindings
    ) {
      throw new Error('Doctor workspace summary advisoryFindings contradicts project diagnosis.');
    }
  }
}
