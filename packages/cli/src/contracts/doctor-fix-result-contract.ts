import { WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS } from './workspace-intelligence-runtime-registry.js';

export const DOCTOR_FIX_RESULT_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.doctorFixResult.schemaVersion;

export const DOCTOR_FIX_VERIFY_RECOMMENDED =
  'npx workspai workspace verify --from-impact .workspai/reports/workspace-impact-last-run.json --json';

export type DoctorAppliedFixOutcome = 'applied' | 'failed' | 'skipped' | 'guidance';

export type DoctorAppliedFix = {
  path: string;
  action: string;
  outcome: DoctorAppliedFixOutcome;
  projectName?: string;
  command?: string;
  detail?: string;
};

export type DoctorFixExecutionResult = {
  schemaVersion: typeof DOCTOR_FIX_RESULT_SCHEMA_VERSION;
  generatedAt: string;
  appliedFixes: DoctorAppliedFix[];
  remainingBlockers: string[];
  verifyRecommended: string;
};

export function buildDoctorFixExecutionResult(input: {
  appliedFixes: DoctorAppliedFix[];
  remainingBlockers: string[];
  verifyRecommended?: string;
}): DoctorFixExecutionResult {
  return {
    schemaVersion: DOCTOR_FIX_RESULT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    appliedFixes: input.appliedFixes,
    remainingBlockers: input.remainingBlockers,
    verifyRecommended: input.verifyRecommended ?? DOCTOR_FIX_VERIFY_RECOMMENDED,
  };
}

export function isDoctorFixExecutionResult(value: unknown): value is DoctorFixExecutionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === DOCTOR_FIX_RESULT_SCHEMA_VERSION &&
    typeof record.generatedAt === 'string' &&
    Array.isArray(record.appliedFixes) &&
    Array.isArray(record.remainingBlockers) &&
    typeof record.verifyRecommended === 'string'
  );
}
