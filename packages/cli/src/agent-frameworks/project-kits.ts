import fsExtra from 'fs-extra';
import path from 'node:path';

import { createBuiltinAgentFrameworkRegistry } from './builtins.js';
import type { AgentFrameworkUserRuntime } from './selection.js';
import { getVersion } from '../update-checker.js';

export type AgentFrameworkProjectKit = {
  id: string;
  aliases: string[];
  label: string;
  runtime: AgentFrameworkUserRuntime;
  adapterId: string;
  frameworkId: string;
  frameworkName: string;
  requiredEnvironment: string[];
};

const PROJECT_KITS: AgentFrameworkProjectKit[] = [
  {
    id: 'agent.microsoft.python',
    aliases: ['agent.microsoft.python', 'microsoft-agent-python', 'agent-framework-python'],
    label: 'Microsoft Agent Framework · Python',
    runtime: 'python',
    adapterId: 'microsoft-agent-framework-python',
    frameworkId: 'microsoft-agent-framework',
    frameworkName: 'Microsoft Agent Framework',
    requiredEnvironment: ['FOUNDRY_PROJECT_ENDPOINT', 'FOUNDRY_MODEL'],
  },
  {
    id: 'agent.microsoft.dotnet',
    aliases: ['agent.microsoft.dotnet', 'microsoft-agent-dotnet', 'agent-framework-dotnet'],
    label: 'Microsoft Agent Framework · .NET',
    runtime: 'dotnet',
    adapterId: 'microsoft-agent-framework-dotnet',
    frameworkId: 'microsoft-agent-framework',
    frameworkName: 'Microsoft Agent Framework',
    requiredEnvironment: ['FOUNDRY_PROJECT_ENDPOINT', 'FOUNDRY_MODEL'],
  },
  {
    id: 'agent.openai.python',
    aliases: ['agent.openai.python', 'openai-agents-python', 'openai-agent-python'],
    label: 'OpenAI Agents SDK · Python',
    runtime: 'python',
    adapterId: 'openai-agents-python',
    frameworkId: 'openai-agents',
    frameworkName: 'OpenAI Agents SDK',
    requiredEnvironment: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
  },
  {
    id: 'agent.openai.typescript',
    aliases: [
      'agent.openai.typescript',
      'agent.openai.node',
      'openai-agents-typescript',
      'openai-agent-typescript',
    ],
    label: 'OpenAI Agents SDK · TypeScript',
    runtime: 'node',
    adapterId: 'openai-agents-typescript',
    frameworkId: 'openai-agents',
    frameworkName: 'OpenAI Agents SDK',
    requiredEnvironment: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
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

export function describeAgentFrameworkProjectKits(): AgentFrameworkProjectKit[] {
  return PROJECT_KITS.map((kit) => structuredClone(kit));
}

export function listAgentFrameworkProjectKits(): AgentFrameworkProjectKit[] {
  return PROJECT_KITS.filter(admitted).map((kit) => structuredClone(kit));
}

export function isAdmittedAgentFrameworkProjectKit(
  value: string | AgentFrameworkProjectKit | undefined
): boolean {
  const kit = typeof value === 'string' ? lookupAgentFrameworkProjectKit(value) : value;
  return Boolean(kit && admitted(kit));
}

export function lookupAgentFrameworkProjectKit(
  value: string | undefined
): AgentFrameworkProjectKit | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const kit = PROJECT_KITS.find((candidate) =>
    candidate.aliases.some((alias) => alias.toLowerCase() === normalized)
  );
  return kit ? structuredClone(kit) : null;
}

export function resolveAgentFrameworkProjectKit(
  value: string | undefined
): AgentFrameworkProjectKit | null {
  const kit = lookupAgentFrameworkProjectKit(value);
  return kit && admitted(kit) ? kit : null;
}

export function isAgentFrameworkProjectKit(value: string | undefined): boolean {
  return lookupAgentFrameworkProjectKit(value) !== null;
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
    `# ${input.projectName}\n\nThis agent project is governed by Workspai and uses ${input.kit.label}.\n\nThe runtime files under \`agents/\` are created through a Goal-bound, Proof-Carrying Change. Dependencies are pinned recommendations and are not installed automatically.\n\n## Start here\n\n1. Create already refreshes Model and Graph for the nested agent runtime. From the workspace root, run Workspace Intelligence \`--strict\` if other projects still block readiness.\n2. Open \`agents/primary/README.md\` for the exact install, verify, and run commands.\n3. Set required credentials only in your shell or approved secret store; never commit them.\n4. Verify the generated Change before treating this scaffold as release-ready.\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  await fsExtra.writeFile(
    path.join(input.projectPath, '.gitignore'),
    '.env\n.venv/\n__pycache__/\nnode_modules/\ndist/\nbin/\nobj/\n',
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
      framework: input.kit.frameworkId,
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
      framework: input.kit.frameworkId,
      framework_display_name: input.kit.frameworkName,
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
        env: [...input.kit.requiredEnvironment],
      },
    },
    { spaces: 2 }
  );
}
