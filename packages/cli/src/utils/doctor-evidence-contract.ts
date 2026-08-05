export type DoctorEvidenceType = 'workspace' | 'project';

import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';

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

export function assertDoctorEvidenceSemanticInvariants(payload: unknown): void {
  const report = toObjectRecord(payload);
  if (!report) throw new Error('Doctor evidence must be an object.');

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

  let failedProbes = 0;
  let legacyIssues = 0;
  for (const project of projectRecords(report)) {
    const probes = Array.isArray(project.probes) ? project.probes : [];
    failedProbes += probes.filter((probe) => toObjectRecord(probe)?.status === 'fail').length;
    legacyIssues += Array.isArray(project.issues) ? project.issues.length : 0;

    const summary = toObjectRecord(project.probeSummary);
    if (summary) {
      const blockingFindings = integerField(summary, 'blockingFindings');
      const expectedBlockingFindings =
        probes.filter((probe) => toObjectRecord(probe)?.status === 'fail').length +
        (Array.isArray(project.issues) ? project.issues.length : 0);
      if (blockingFindings !== expectedBlockingFindings) {
        throw new Error(
          'Doctor project probeSummary.blockingFindings contradicts failed probes and runtime issues.'
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
    }
  }

  if (failedProbes + legacyIssues > 0 && errors === 0) {
    throw new Error('Doctor evidence contains blocking findings but healthScore.errors is zero.');
  }
}
