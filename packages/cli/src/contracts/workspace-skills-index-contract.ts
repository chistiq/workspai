import { computeInputsHash } from './freshness-metadata-contract.js';
import { WORKSPACE_SKILLS_INDEX_PATH } from './workspace-artifact-paths.js';
import type { WorkspaceOperationalSkillRecord } from './workspace-operational-skill-contract.js';

import { WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS } from './workspace-intelligence-runtime-registry.js';

export const WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.skillsIndex;

export type WorkspaceSkillsIndexEntry = {
  skillId: string;
  path: string;
  schemaVersion: string;
  title: string;
};

export type WorkspaceOperationalSkillDecision = {
  skillId: string;
  title: string;
  status: 'generated' | 'suppressed';
  confidence: 'high' | 'medium';
  reasons: string[];
  signals: string[];
  scopedProjects: string[];
};

export type WorkspaceSkillsIndex = {
  schemaVersion: typeof WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION;
  generatedAt: string;
  inputsHash: string;
  skills: WorkspaceSkillsIndexEntry[];
  selection?: {
    generatedCount: number;
    suppressedCount: number;
    decisions: WorkspaceOperationalSkillDecision[];
  };
};

export { WORKSPACE_SKILLS_INDEX_PATH };

export function buildWorkspaceSkillsIndex(input: {
  generatedAt: string;
  skills: WorkspaceOperationalSkillRecord[];
  inputsHash?: string;
  decisions?: WorkspaceOperationalSkillDecision[];
}): WorkspaceSkillsIndex {
  const sorted = [...input.skills].sort((a, b) => a.skillId.localeCompare(b.skillId));
  const inputsHash =
    input.inputsHash ??
    computeInputsHash({
      skillIds: sorted.map((skill) => skill.skillId),
      paths: sorted.map((skill) => skill.canonicalPath),
      decisions: input.decisions ?? [],
    });
  const decisions = input.decisions
    ? [...input.decisions].sort((left, right) => left.skillId.localeCompare(right.skillId))
    : undefined;
  return {
    schemaVersion: WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    inputsHash,
    skills: sorted.map((skill) => ({
      skillId: skill.skillId,
      path: skill.canonicalPath,
      schemaVersion: skill.schemaVersion,
      title: skill.title,
    })),
    ...(decisions
      ? {
          selection: {
            generatedCount: decisions.filter((decision) => decision.status === 'generated').length,
            suppressedCount: decisions.filter((decision) => decision.status === 'suppressed')
              .length,
            decisions,
          },
        }
      : {}),
  };
}

export function isWorkspaceSkillsIndex(value: unknown): value is WorkspaceSkillsIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const selection = record.selection;
  const selectionIsValid =
    selection === undefined ||
    (selection !== null &&
      typeof selection === 'object' &&
      !Array.isArray(selection) &&
      typeof (selection as Record<string, unknown>).generatedCount === 'number' &&
      typeof (selection as Record<string, unknown>).suppressedCount === 'number' &&
      Array.isArray((selection as Record<string, unknown>).decisions));
  return (
    record.schemaVersion === WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION &&
    typeof record.generatedAt === 'string' &&
    Array.isArray(record.skills) &&
    selectionIsValid
  );
}
