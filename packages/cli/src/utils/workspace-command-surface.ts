/**
 * Canonical `workspai workspace <action>` command surface.
 *
 * Single source of truth consumed by:
 * - `rapidkit commands --json` (runtime capability detection for IDE/CI)
 * - the generated `runtime-command-surface.v1` contract
 * - the `workspace <action>` unknown-action help text
 *
 * Workspai (the VS Code extension) and any other IDE/CI integration MUST detect
 * these capabilities from the contract or `commands --json`, never by
 * regex-parsing `rapidkit --help` text.
 */
export const WORKSPACE_SUBCOMMANDS = [
  'list',
  'sync',
  'registry',
  'foundation',
  'intelligence',
  'model',
  'snapshot',
  'diff',
  'impact',
  'verify',
  'graph',
  'watch',
  'context',
  'agent-sync',
  'remediation-plan',
  'explain',
  'why',
  'trace',
  'feedback',
  'eval',
  'mcp',
  'policy',
  'contract',
  'share',
  'export',
  'archive',
  'hydrate',
  'import',
  'connect',
  'run',
  'init',
] as const;

export type WorkspaceSubcommand = (typeof WORKSPACE_SUBCOMMANDS)[number];

/**
 * Complete Workspace Intelligence command family: canonical chain stages,
 * evidence gates, observation/rendering, feedback, and consumer bridges.
 *
 * These are the capabilities the extension gates on before running the
 * intelligence chain, advisor, or agent context pack. Order follows the
 * canonical capability set. Execution order is defined exclusively by
 * `workspace-intelligence-chain.v1.json`; do not infer orchestration from this list.
 */
export const WORKSPACE_INTELLIGENCE_SUBCOMMANDS = [
  'intelligence',
  'model',
  'snapshot',
  'diff',
  'impact',
  'contract',
  'verify',
  'graph',
  'watch',
  'context',
  'agent-sync',
  'remediation-plan',
  'explain',
  'why',
  'trace',
  'feedback',
  'eval',
  'mcp',
] as const;

export type WorkspaceIntelligenceSubcommand = (typeof WORKSPACE_INTELLIGENCE_SUBCOMMANDS)[number];

export function isWorkspaceSubcommand(value: string): value is WorkspaceSubcommand {
  return (WORKSPACE_SUBCOMMANDS as readonly string[]).includes(value);
}

export function isWorkspaceIntelligenceSubcommand(
  value: string
): value is WorkspaceIntelligenceSubcommand {
  return (WORKSPACE_INTELLIGENCE_SUBCOMMANDS as readonly string[]).includes(value);
}
