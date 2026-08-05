import fs from 'fs';
import path from 'path';

import type {
  WorkspaceRunReport,
  WorkspaceRunStage,
  WorkspaceRunStageName,
} from '../workspace-run.js';
import { workspaceMetadataCandidates } from './workspace-paths.js';
import { withWorkspaceArtifactLock, writeWorkspaceArtifactJson } from './artifact-path-compat.js';
import {
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';

export const WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceRunLast.schemaVersion;
export const WORKSPACE_RUN_LAST_REPORT_FILENAME = 'workspace-run-last.json';
export const WORKSPACE_RUN_LAST_REPORT_RELATIVE_PATH =
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceRunLast;

/** @deprecated Autopilot no longer writes separate stage files; use workspace-run-last.json stages map. */
export const LEGACY_AUTOPILOT_WORKSPACE_RUN_TEST_FILENAME = 'autopilot-workspace-run-test.json';
/** @deprecated Autopilot no longer writes separate stage files; use workspace-run-last.json stages map. */
export const LEGACY_AUTOPILOT_WORKSPACE_RUN_BUILD_FILENAME = 'autopilot-workspace-run-build.json';

export interface WorkspaceRunEvidence {
  schemaVersion: typeof WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION;
  generatedAt: string;
  workspacePath: string;
  latestStage: WorkspaceRunStageName;
  stages: Partial<Record<WorkspaceRunStageName, WorkspaceRunReport>>;
  enterpriseControls: {
    jsonReady: boolean;
    evidencePath: string;
  };
}

const STAGE_SET: ReadonlySet<WorkspaceRunStage> = new Set(['init', 'test', 'build', 'start']);

function isWorkspaceRunStage(value: string): value is WorkspaceRunStage {
  return STAGE_SET.has(value as WorkspaceRunStage);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isWorkspaceRunStageReport(payload: Record<string, unknown>): boolean {
  const stage = payload.stage;
  if (typeof stage !== 'string' || stage.trim().length === 0 || !Array.isArray(payload.projects)) {
    return false;
  }
  return isWorkspaceRunStage(stage) || /^[a-z][a-z0-9_-]*$/i.test(stage);
}

export function isLegacyWorkspaceRunStageReport(payload: unknown): payload is WorkspaceRunReport {
  const record = asRecord(payload);
  if (!record) {
    return false;
  }
  if (record.schemaVersion === WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION) {
    return false;
  }
  return isWorkspaceRunStageReport(record);
}

export function isWorkspaceRunEvidenceAggregate(payload: unknown): payload is WorkspaceRunEvidence {
  const record = asRecord(payload);
  if (!record) {
    return false;
  }
  return record.schemaVersion === WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION && record.stages != null;
}

export function normalizeWorkspaceRunEvidence(payload: unknown): WorkspaceRunEvidence | null {
  if (isWorkspaceRunEvidenceAggregate(payload)) {
    return payload;
  }
  if (isLegacyWorkspaceRunStageReport(payload)) {
    const stage = payload.stage;
    return {
      schemaVersion: WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION,
      generatedAt: payload.generatedAt,
      workspacePath: payload.workspacePath,
      latestStage: stage,
      stages: { [stage]: payload },
      enterpriseControls: payload.enterpriseControls ?? {
        jsonReady: true,
        evidencePath: WORKSPACE_RUN_LAST_REPORT_RELATIVE_PATH,
      },
    };
  }
  return null;
}

export function resolveWorkspaceRunStageReport(
  payload: unknown,
  stage?: WorkspaceRunStageName
): WorkspaceRunReport | null {
  const aggregate = normalizeWorkspaceRunEvidence(payload);
  if (!aggregate) {
    return null;
  }
  const targetStage = stage ?? aggregate.latestStage;
  const report = aggregate.stages[targetStage];
  return report ?? null;
}

export async function readWorkspaceRunEvidence(
  workspacePath: string
): Promise<WorkspaceRunEvidence | null> {
  const reportPath = (
    await Promise.all(
      workspaceMetadataCandidates(
        path.resolve(workspacePath),
        'reports',
        WORKSPACE_RUN_LAST_REPORT_FILENAME
      ).map(async (candidate) => ((await pathExists(candidate)) ? candidate : null))
    )
  ).find((candidate): candidate is string => typeof candidate === 'string');
  if (!reportPath) {
    return null;
  }
  const raw = await readJsonFile<unknown>(reportPath);
  return normalizeWorkspaceRunEvidence(raw);
}

export async function publishWorkspaceRunStageReport(
  workspacePath: string,
  stageReport: WorkspaceRunReport
): Promise<WorkspaceRunEvidence> {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  return withWorkspaceArtifactLock(
    resolvedWorkspacePath,
    WORKSPACE_RUN_LAST_REPORT_RELATIVE_PATH,
    async () => {
      const existingPath = (
        await Promise.all(
          workspaceMetadataCandidates(
            resolvedWorkspacePath,
            'reports',
            WORKSPACE_RUN_LAST_REPORT_FILENAME
          ).map(async (candidate) => ((await pathExists(candidate)) ? candidate : null))
        )
      ).find((candidate): candidate is string => typeof candidate === 'string');
      const existing = existingPath ? await readJsonFile<unknown>(existingPath) : null;
      const normalized = normalizeWorkspaceRunEvidence(existing);
      if (existingPath && !normalized) {
        throw new Error(
          `Workspace run evidence is unreadable or invalid; refusing to overwrite: ${existingPath}`
        );
      }
      const stages: Partial<Record<WorkspaceRunStageName, WorkspaceRunReport>> = normalized
        ? { ...normalized.stages }
        : {};

      stages[stageReport.stage] = stageReport;

      const evidence: WorkspaceRunEvidence = {
        schemaVersion: WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION,
        generatedAt: stageReport.generatedAt,
        workspacePath: stageReport.workspacePath,
        latestStage: stageReport.stage,
        stages,
        enterpriseControls: {
          jsonReady: true,
          evidencePath: WORKSPACE_RUN_LAST_REPORT_RELATIVE_PATH,
        },
      };

      await writeWorkspaceArtifactJson(
        resolvedWorkspacePath,
        WORKSPACE_RUN_LAST_REPORT_RELATIVE_PATH,
        evidence
      );
      return evidence;
    }
  );
}
