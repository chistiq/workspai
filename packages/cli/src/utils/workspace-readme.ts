import path from 'path';

import fsExtra from 'fs-extra';

import { buildWorkspaceIntelligenceChainContract } from '../contracts/workspace-intelligence-chain-contract.js';
import { writeWorkspaceArtifactText } from './artifact-path-compat.js';

export const WORKSPACE_README_PATH = 'README.md';
export const WORKSPACE_README_MANAGED_START = '<!-- workspai:workspace-intelligence:start -->';
export const WORKSPACE_README_MANAGED_END = '<!-- workspai:workspace-intelligence:end -->';

export interface WorkspaceReadmeInput {
  workspacePath: string;
  workspaceName: string;
  profile: string;
  projectCount: number;
}

type WorkspaceManifest = {
  engine?: {
    install_method?: string;
    python_version?: string | null;
    python_core?: {
      status?: string;
      reason?: string;
    };
  };
};

const PROFILE_SUMMARIES: Record<string, string> = {
  minimal: 'A lightweight workspace boundary that adds runtimes only when you need them.',
  'node-only': 'A Node.js-focused workspace with shared evidence and agent grounding.',
  'python-only': 'A Python-focused workspace with shared evidence and agent grounding.',
  'go-only': 'A Go-focused workspace with shared evidence and agent grounding.',
  'java-only': 'A Java-focused workspace with shared evidence and agent grounding.',
  'dotnet-only': 'A .NET-focused workspace with shared evidence and agent grounding.',
  polyglot: 'A multi-runtime workspace for projects that share contracts, evidence, and agents.',
  enterprise:
    'A governed multi-runtime workspace with the complete evidence, policy, and agent surface.',
};

function normalizeProfile(profile: string | undefined): string {
  const normalized = profile?.trim();
  return normalized || 'minimal';
}

async function readWorkspaceManifest(workspacePath: string): Promise<WorkspaceManifest> {
  const manifestPath = path.join(workspacePath, '.workspai', 'workspace.json');
  if (!(await fsExtra.pathExists(manifestPath))) return {};
  return (await fsExtra.readJson(manifestPath).catch(() => ({}))) as WorkspaceManifest;
}

function renderEngineSummary(manifest: WorkspaceManifest): string | undefined {
  const engine = manifest.engine;
  if (!engine) return undefined;
  const coreStatus = engine.python_core?.status;
  if (coreStatus === 'skipped') {
    return 'Optional Python engine: not installed';
  }
  if (!engine.python_version) return undefined;
  return `Optional Python engine: Python ${engine.python_version} via ${
    engine.install_method || 'local environment'
  }`;
}

export function renderWorkspaceReadmeManagedBlock(
  input: Omit<WorkspaceReadmeInput, 'workspacePath'> & { engineSummary?: string }
): string {
  const profile = normalizeProfile(input.profile);
  const chain = buildWorkspaceIntelligenceChainContract();
  const loop = chain.presentations.standard.nodes.map((node) => node.label).join(' → ');
  const projectLabel = input.projectCount === 1 ? 'project' : 'projects';
  const profileSummary =
    PROFILE_SUMMARIES[profile] ??
    'A governed workspace with shared evidence for developers, tools, CI, IDEs, and AI agents.';

  return `${WORKSPACE_README_MANAGED_START}
# ${input.workspaceName}

This is a **Workspai Workspace Intelligence** workspace. It gives every registered project one shared, evidence-backed view for developers, CI, IDEs, and AI agents.

| Workspace | Current value |
| --- | --- |
| Profile | \`${profile}\` |
| Registered projects | ${input.projectCount} ${projectLabel} |
${input.engineSummary ? `| Runtime foundation | ${input.engineSummary} |\n` : ''}| Evidence index | [\`.workspai/reports/INDEX.json\`](.workspai/reports/INDEX.json) |

${profileSummary}

## Start here

Create a project or add existing software:

\`\`\`bash
npx workspai create
\`\`\`

After the workspace has at least one project, run the complete intelligence loop:

\`\`\`bash
npx workspai workspace intelligence run --for-agent generic --strict --json
\`\`\`

The loop is defined by Workspai's versioned contract—not by this README:

\`\`\`text
${loop}
\`\`\`

An empty workspace can be created and synchronized successfully, but strict intelligence checks will keep missing project evidence visible until software is added.

## Useful workspace views

\`\`\`bash
# Refresh the canonical model and its proof-backed graph
npx workspai workspace model --write --json

# Search the graph without loading the full artifact
npx workspai workspace graph search "authentication service" --limit 12 --json

# Rediscover projects and refresh every consumer projection
npx workspai workspace sync --json

# Inspect workspace and project health
npx workspai doctor workspace

# Re-run the governed decision loop for a specific agent surface
npx workspai workspace intelligence run --for-agent copilot --strict --json
\`\`\`

Generated consumers start with:

- \`AGENTS.md\` for agent instructions and workspace routing.
- \`.workspai/reports/workspace-model.json\` for the canonical workspace model.
- \`.workspai/reports/workspace-knowledge-graph.json\` for proof-backed relationships.
- \`.workspai/reports/INDEX.json\` for the current evidence inventory.

Change the workspace profile only when its intended runtime or governance boundary changes:

\`\`\`bash
npx workspai bootstrap --profile <minimal|node-only|python-only|go-only|java-only|dotnet-only|polyglot|enterprise>
\`\`\`

Documentation: [workspai.dev](https://workspai.dev/)
${WORKSPACE_README_MANAGED_END}`;
}

function isLegacyGeneratedReadme(content: string): boolean {
  return (
    (content.includes('# Workspai Workspace') &&
      content.includes('This directory contains a Workspai development environment.')) ||
    /^# .+\n\nWorkspai \*\*[^*]+\*\* workspace\b/m.test(content)
  );
}

function replaceManagedBlock(content: string, block: string): string {
  const start = content.indexOf(WORKSPACE_README_MANAGED_START);
  const end = content.indexOf(WORKSPACE_README_MANAGED_END);
  if (start >= 0 && end >= start) {
    const after = end + WORKSPACE_README_MANAGED_END.length;
    const prefix = content.slice(0, start).trimEnd();
    const replacement = prefix ? block.replace(/^# .+$/m, '## Workspace Intelligence') : block;
    return `${prefix}${prefix ? '\n\n' : ''}${replacement}${content
      .slice(after)
      .trimStart()
      .replace(/^/, content.slice(after).trim() ? '\n\n' : '')}`.trimEnd();
  }
  if (!content.trim() || isLegacyGeneratedReadme(content)) return block;
  const appendableBlock = block.replace(/^# .+$/m, '## Workspace Intelligence');
  return `${content.trimEnd()}\n\n${appendableBlock}`;
}

export async function syncWorkspaceReadme(input: WorkspaceReadmeInput): Promise<string> {
  const manifest = await readWorkspaceManifest(input.workspacePath);
  const block = renderWorkspaceReadmeManagedBlock({
    workspaceName: input.workspaceName,
    profile: input.profile,
    projectCount: input.projectCount,
    engineSummary: renderEngineSummary(manifest),
  });
  const readmePath = path.join(input.workspacePath, WORKSPACE_README_PATH);
  const existing = (await fsExtra.pathExists(readmePath))
    ? await fsExtra.readFile(readmePath, 'utf-8')
    : '';
  const next = `${replaceManagedBlock(existing, block)}\n`;
  if (next !== existing) {
    await writeWorkspaceArtifactText(input.workspacePath, WORKSPACE_README_PATH, next);
  }
  return readmePath;
}
