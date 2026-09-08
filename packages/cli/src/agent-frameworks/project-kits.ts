import fsExtra from 'fs-extra';
import path from 'node:path';

import { createBuiltinAgentFrameworkRegistry } from './builtins.js';
import type { AgentFrameworkUserRuntime } from './user-flow.js';
import { getVersion } from '../update-checker.js';

export type AgentFrameworkProjectKit = {
  id: string;
  aliases: string[];
  label: string;
  runtime: AgentFrameworkUserRuntime;
  adapterId: string;
};

const PROJECT_KITS: AgentFrameworkProjectKit[] = [
  {
    id: 'agent.microsoft.python',
    aliases: ['agent.microsoft.python', 'microsoft-agent-python', 'agent-framework-python'],
    label: 'Microsoft Agent Framework · Python',
    runtime: 'python',
    adapterId: 'microsoft-agent-framework-python',
  },
  {
    id: 'agent.microsoft.dotnet',
    aliases: ['agent.microsoft.dotnet', 'microsoft-agent-dotnet', 'agent-framework-dotnet'],
    label: 'Microsoft Agent Framework · .NET',
    runtime: 'dotnet',
    adapterId: 'microsoft-agent-framework-dotnet',
  },
];

function admitted(kit: AgentFrameworkProjectKit): boolean {
  return (
    createBuiltinAgentFrameworkRegistry(
      {},
      { trustReviewedReleaseAdmissions: true }
    ).resolveAdapter(kit.adapterId).status === 'admitted'
  );
}

export function listAgentFrameworkProjectKits(): AgentFrameworkProjectKit[] {
  return PROJECT_KITS.filter(admitted).map((kit) => structuredClone(kit));
}

export function resolveAgentFrameworkProjectKit(
  value: string | undefined
): AgentFrameworkProjectKit | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const kit = PROJECT_KITS.find((candidate) =>
    candidate.aliases.some((alias) => alias.toLowerCase() === normalized)
  );
  return kit && admitted(kit) ? structuredClone(kit) : null;
}

export function isAgentFrameworkProjectKit(value: string | undefined): boolean {
  return resolveAgentFrameworkProjectKit(value) !== null;
}

export async function initializeAgentFrameworkProjectRoot(input: {
  projectPath: string;
  projectName: string;
  kit: AgentFrameworkProjectKit;
}): Promise<void> {
  const generatedAt = new Date().toISOString();
  const version = getVersion();
  await fsExtra.ensureDir(input.projectPath);
  await fsExtra.writeFile(
    path.join(input.projectPath, 'README.md'),
    `# ${input.projectName}\n\nThis agent project is governed by Workspai and uses ${input.kit.label}.\n\nThe runtime files under \`agents/\` are created through a Goal-bound, Proof-Carrying Change. Dependencies are pinned recommendations and are not installed automatically.\n\n## Start here\n\n1. Run Workspace Intelligence from the workspace root and resolve any blocking readiness evidence.\n2. Open \`agents/primary/README.md\` for the exact install, verify, and run commands.\n3. Set required credentials only in your shell or approved secret store; never commit them.\n4. Verify the generated Change before treating this scaffold as release-ready.\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  await fsExtra.writeFile(
    path.join(input.projectPath, '.gitignore'),
    '.env\n.venv/\n__pycache__/\nbin/\nobj/\n',
    { encoding: 'utf8', flag: 'wx' }
  );
  // The admitted adapter writes the single authoritative runtime manifest
  // below agents/<instance>. A second empty root manifest previously created
  // a phantom runtime unit and made lifecycle capability claims disagree with
  // the commands that Workspace Run could actually execute.
  await fsExtra.ensureDir(path.join(input.projectPath, '.workspai'));
  await fsExtra.writeJson(
    path.join(input.projectPath, '.workspai', 'context.json'),
    {
      engine: 'npm',
      runtime: input.kit.runtime,
      framework: 'microsoft-agent-framework',
      kind: 'agent',
      category: 'agent',
      kit: input.kit.id,
    },
    { spaces: 2 }
  );
  await fsExtra.writeJson(
    path.join(input.projectPath, '.workspai', 'project.json'),
    {
      schema_version: '1.0',
      name: input.projectName,
      slug: input.projectName,
      kind: 'agent',
      project_type: 'agent',
      category: 'agent',
      runtime: input.kit.runtime,
      framework: 'microsoft-agent-framework',
      framework_display_name: 'Microsoft Agent Framework',
      kit_name: input.kit.id,
      kit: input.kit.id,
      engine: 'npm',
      support_tier: 'extended',
      module_support: false,
      modules: [],
      workspai_version: version,
      rapidkit_version: version,
      generated_by: 'workspai',
      generated_at: generatedAt,
      contracts: {
        owns: [],
        apis: [],
        publishes: [],
        consumes: [],
        dependsOn: [],
        env: ['FOUNDRY_PROJECT_ENDPOINT', 'FOUNDRY_MODEL'],
      },
    },
    { spaces: 2 }
  );
}
