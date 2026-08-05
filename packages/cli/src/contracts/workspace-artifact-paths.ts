/**
 * Single source of truth for Phase 4 canonical artifact paths (roadmap 4.0).
 * Consumed by generators, pack contract, and extension parity tests via sync.
 */
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './workspace-intelligence-runtime-registry.js';

export const WORKSPAI_SKILLS_DIR = '.workspai/skills' as const;
/** @deprecated Use WORKSPAI_SKILLS_DIR. */
export const RAPIDKIT_SKILLS_DIR = '.rapidkit/skills' as const;
export const WORKSPACE_SKILLS_INDEX_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.skillsIndex;
export const WORKSPACE_EXPLAIN_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.explain;
export const WORKSPACE_WHY_REPORT_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceWhy;
export const WORKSPACE_TRACE_REPORT_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceTrace;
export const AGENT_GROUNDING_DOC_PATH = '.workspai/AGENT-GROUNDING.md' as const;
export const LEGACY_AGENT_GROUNDING_DOC_PATH = '.rapidkit/AGENT-GROUNDING.md' as const;
export const WORKSPAI_CURSOR_GROUNDING_RULE_PATH = '.cursor/rules/workspai-grounding.mdc' as const;
export const LEGACY_CURSOR_GROUNDING_RULE_PATH = '.cursor/rules/rapidkit-grounding.mdc' as const;
export const WORKSPAI_CLAUDE_EVIDENCE_RULE_PATH = '.claude/rules/workspai-evidence.md' as const;
export const LEGACY_CLAUDE_EVIDENCE_RULE_PATH = '.claude/rules/rapidkit-evidence.md' as const;
export const WORKSPAI_COPILOT_WORKSPACE_INSTRUCTIONS_PATH =
  '.github/instructions/workspai-workspace.instructions.md' as const;
export const LEGACY_COPILOT_WORKSPACE_INSTRUCTIONS_PATH =
  '.github/instructions/rapidkit-workspace.instructions.md' as const;
export const WORKSPAI_COPILOT_EVIDENCE_INSTRUCTIONS_PATH =
  '.github/instructions/workspai-evidence.instructions.md' as const;
export const LEGACY_COPILOT_EVIDENCE_INSTRUCTIONS_PATH =
  '.github/instructions/rapidkit-evidence.instructions.md' as const;
export const WORKSPAI_COPILOT_DIAGNOSE_PROMPT_PATH =
  '.github/prompts/workspai-diagnose.prompt.md' as const;
export const LEGACY_COPILOT_DIAGNOSE_PROMPT_PATH =
  '.github/prompts/rapidkit-diagnose.prompt.md' as const;
export const WORKSPAI_COPILOT_REPAIR_PROMPT_PATH =
  '.github/prompts/workspai-repair.prompt.md' as const;
export const LEGACY_COPILOT_REPAIR_PROMPT_PATH =
  '.github/prompts/rapidkit-repair.prompt.md' as const;
export const WORKSPAI_COPILOT_RELEASE_READINESS_PROMPT_PATH =
  '.github/prompts/workspai-release-readiness.prompt.md' as const;
export const LEGACY_COPILOT_RELEASE_READINESS_PROMPT_PATH =
  '.github/prompts/rapidkit-release-readiness.prompt.md' as const;
export const WORKSPAI_COPILOT_PROJECT_ONBOARD_PROMPT_PATH =
  '.github/prompts/workspai-project-onboard.prompt.md' as const;
export const LEGACY_COPILOT_PROJECT_ONBOARD_PROMPT_PATH =
  '.github/prompts/rapidkit-project-onboard.prompt.md' as const;
export const WORKSPAI_COPILOT_ADOPT_PROJECT_PROMPT_PATH =
  '.github/prompts/workspai-adopt-project.prompt.md' as const;
export const LEGACY_COPILOT_ADOPT_PROJECT_PROMPT_PATH =
  '.github/prompts/rapidkit-adopt-project.prompt.md' as const;
export const WORKSPAI_COPILOT_GROUNDING_SKILL_PATH =
  '.github/skills/workspai-grounding/SKILL.md' as const;
export const LEGACY_COPILOT_GROUNDING_SKILL_PATH =
  '.github/skills/rapidkit-grounding/SKILL.md' as const;
export const WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH =
  '.github/skills/workspai-workspace-intelligence/SKILL.md' as const;
export const LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH =
  '.github/skills/rapidkit-workspace-intelligence/SKILL.md' as const;
export const WORKSPAI_MCP_DESIGN_REPORT_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaiMcpDesign;
export const LEGACY_MCP_DESIGN_REPORT_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.legacyMcpDesign;
export const WORKSPAI_VSCODE_AGENT_HOOKS_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.agentHooks;
export const LEGACY_VSCODE_AGENT_HOOKS_PATH = '.vscode/rapidkit-agent-hooks.json' as const;

export const BUILTIN_OPERATIONAL_SKILL_PREFIX = 'workspai-' as const;

export const BUILTIN_OPERATIONAL_SKILL_IDS = [
  'workspai-diagnose-api-failure',
  'workspai-release-readiness',
  'workspai-safe-schema-migration',
  'workspai-dependency-upgrade',
  'workspai-rename-contract',
] as const;

export type BuiltinOperationalSkillId = (typeof BUILTIN_OPERATIONAL_SKILL_IDS)[number];

export function operationalSkillPath(skillId: string): string {
  const normalized = skillId.trim();
  if (!normalized || normalized.includes('..') || normalized.includes('/')) {
    throw new Error(`Invalid operational skill id: ${skillId}`);
  }
  return `${WORKSPAI_SKILLS_DIR}/${normalized}.md`;
}

export function isBuiltinOperationalSkillId(value: string): value is BuiltinOperationalSkillId {
  return (BUILTIN_OPERATIONAL_SKILL_IDS as readonly string[]).includes(value);
}

/** L2 canonical Copilot meta-skill path. */
export const WORKSPAI_WORKSPACE_INTELLIGENCE_SKILL_PATH =
  WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH;

/** @deprecated L2 compatibility mirror for older extension/agent consumers. */
export const RAPIDKIT_WORKSPACE_INTELLIGENCE_SKILL_PATH =
  LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH;

export const OPERATIONAL_SKILL_PROMPT_STEM: Record<BuiltinOperationalSkillId, string> = {
  'workspai-diagnose-api-failure': 'workspai-diagnose',
  'workspai-release-readiness': 'workspai-release-readiness',
  'workspai-safe-schema-migration': 'workspai-safe-schema-migration',
  'workspai-dependency-upgrade': 'workspai-dependency-upgrade',
  'workspai-rename-contract': 'workspai-rename-contract',
};
