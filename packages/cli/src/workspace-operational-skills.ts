import path from 'node:path';

import fsExtra from 'fs-extra';

import { WORKSPACE_CONTEXT_AGENT_REPORT_PATH } from './workspace-context.js';
import { WORKSPACE_VERIFY_REPORT_PATH } from './workspace-verify.js';
import {
  BUILTIN_OPERATIONAL_SKILL_IDS,
  WORKSPAI_COPILOT_DIAGNOSE_PROMPT_PATH,
  WORKSPAI_COPILOT_RELEASE_READINESS_PROMPT_PATH,
  OPERATIONAL_SKILL_PROMPT_STEM,
  WORKSPACE_SKILLS_INDEX_PATH,
  isBuiltinOperationalSkillId,
  type BuiltinOperationalSkillId,
} from './contracts/workspace-artifact-paths.js';
import {
  buildOperationalSkillRecordShell,
  type WorkspaceOperationalSkillRecord,
} from './contracts/workspace-operational-skill-contract.js';
import {
  buildWorkspaceSkillsIndex,
  type WorkspaceSkillsIndex,
} from './contracts/workspace-skills-index-contract.js';
import { computeInputsHash } from './contracts/freshness-metadata-contract.js';
import type { WorkspaceAgentContext } from './workspace-context.js';
import type { WorkspaceModel } from './workspace-model.js';
import type { WorkspaceContract } from './utils/workspace-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';

const CORE_REQUIRED_REPORTS = [
  WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex,
  WORKSPACE_CONTEXT_AGENT_REPORT_PATH,
  WORKSPACE_VERIFY_REPORT_PATH,
] as const;

export const WORKSPAI_GENERATED_OPERATIONAL_SKILL_MARKER =
  '<!-- WORKSPAI:GENERATED-OPERATIONAL-SKILL -->' as const;

type SkillTemplate = {
  skillId: string;
  title: string;
  triggers: string[];
  objective: string;
  steps: string[];
  scopedProjects?: string[];
};

const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    skillId: 'workspai-diagnose-api-failure',
    title: 'Diagnose API failure',
    triggers: ['api failure', '500 error', 'integration test failed', 'service unreachable'],
    objective:
      'Investigate a failing API or service using Workspai evidence before editing application code.',
    steps: [
      `Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\` and identify fail/warn reports for the scoped project.`,
      `Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor}\`, \`doctor-project-last-run.json\`, and project-scoped run evidence if present.`,
      'If a fix was requested, read `artifact-remediation-plan-last-run.json` for cross-artifact next steps, then `doctor-remediation-plan-last-run.json` for Doctor-specific file edits.',
      'Map the failure to workspace vs project scope; cite exit codes and blocker messages.',
      'Propose the smallest safe fix (config, env, dependency) with explicit verification commands.',
    ],
  },
  {
    skillId: 'workspai-release-readiness',
    title: 'Release readiness',
    triggers: ['release', 'ship', 'production', 'readiness gate'],
    objective: 'Assess whether this workspace is release-ready using governed Workspai gates.',
    steps: [
      `Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.readiness}\` and \`pipeline-last-run.json\`.`,
      `Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.verify}\` for verdict and blocking reasons.`,
      `Read \`${WORKSPACE_SUPPLEMENTAL_ARTIFACTS.artifactRemediationPlan}\` when a Studio or agent repair path is needed.`,
      'List blocking gates first; never claim ready without cited report fields.',
      'Provide one safe next command and a verification checklist.',
    ],
  },
  {
    skillId: 'workspai-safe-schema-migration',
    title: 'Safe schema migration',
    triggers: ['migration', 'schema change', 'database migration', 'db migrate'],
    objective: 'Plan and verify a schema migration with blast-radius awareness.',
    steps: [
      'Identify affected projects from workspace model and dependency graph.',
      'Run or review impact/verify evidence for transitive dependents.',
      'Require project-scoped test/build commands before promoting the migration.',
      'Document rollback and verification signals.',
    ],
  },
  {
    skillId: 'workspai-dependency-upgrade',
    title: 'Dependency upgrade',
    triggers: ['upgrade dependency', 'bump package', 'security advisory', 'outdated deps'],
    objective: 'Upgrade dependencies with graph-aware verification.',
    steps: [
      'Scope the upgrade to the owning project from workspace model.',
      'Check transitive dependents via workspace graph / impact reports.',
      'Prefer workspace run test/build for affected projects.',
      'Re-run `workspace verify` after evidence refresh.',
    ],
  },
  {
    skillId: 'workspai-rename-contract',
    title: 'Rename contract safely',
    triggers: ['rename contract', 'rename event', 'breaking api', 'contract change'],
    objective: 'Rename or change a shared contract with consumer awareness.',
    steps: [
      `Read \`${WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract}\` for publishes/consumes/owns edges.`,
      'List all consumer projects before proposing renames.',
      'Update contract file and regenerate workspace model.',
      'Verify contract gate and integration tests for consumers.',
    ],
  },
];

function displayRapidkitCommand(args: string): string {
  return `npx workspai ${args}`.trim();
}

function buildSkillMarkdown(input: {
  template: SkillTemplate;
  workspaceName: string;
  scopedProjects: string[];
  verificationCommands: string[];
  contractSummary?: string;
}): string {
  const lines = [
    '---',
    `name: ${input.template.skillId}`,
    `description: ${input.template.objective}`,
    '---',
    '',
    WORKSPAI_GENERATED_OPERATIONAL_SKILL_MARKER,
    '',
    `# ${input.template.title}`,
    '',
    `> Workspace: **${input.workspaceName}** · Skill: \`${input.template.skillId}\``,
    '',
    '## Objective',
    '',
    input.template.objective,
    '',
    '## Triggers',
    '',
    ...input.template.triggers.map((trigger) => `- ${trigger}`),
    '',
    '## Required evidence (read first)',
    '',
    ...CORE_REQUIRED_REPORTS.map((report) => `- \`${report}\``),
    '',
    '## Procedure',
    '',
    ...input.template.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
  ];

  if (input.scopedProjects.length > 0) {
    lines.push('## Scoped projects', '', ...input.scopedProjects.map((p) => `- ${p}`), '');
  }

  if (input.contractSummary) {
    lines.push('## Contract context', '', input.contractSummary, '');
  }

  if (input.verificationCommands.length > 0) {
    lines.push('## Verification commands (this workspace)', '');
    for (const command of input.verificationCommands) {
      lines.push(`- \`${command}\``);
    }
    lines.push('');
  }

  lines.push(
    '## Answer contract',
    '',
    'Return: Scope, Evidence, Diagnosis, Fix Plan, Run, Verify, Assumptions.',
    '',
    '## Refresh stale evidence',
    '',
    '```bash',
    displayRapidkitCommand('workspace agent-sync --write --refresh-context'),
    '```',
    ''
  );

  return lines.join('\n');
}

function normalizedSkillSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dynamicSkillTemplates(model: WorkspaceModel): SkillTemplate[] {
  const projectsByRuntime = new Map<string, string[]>();
  for (const project of model.projects) {
    const runtime = normalizedSkillSegment(project.runtime);
    if (!runtime || runtime === 'unknown') continue;
    const projects = projectsByRuntime.get(runtime) ?? [];
    projects.push(project.name);
    projectsByRuntime.set(runtime, projects);
  }

  const templates: SkillTemplate[] = [];
  for (const [runtime, projects] of [...projectsByRuntime.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    templates.push({
      skillId: `workspai-${runtime}-runtime-validation`,
      title: `${runtime.toUpperCase()} runtime validation`,
      triggers: [`${runtime} build`, `${runtime} test`, `${runtime} runtime failure`],
      objective: `Validate ${runtime} changes against the detected project commands and canonical Workspai evidence.`,
      steps: [
        'Read the scoped project lens and current fail/warn evidence before changing source.',
        'Use the registered project commands; do not substitute a different runtime toolchain.',
        'Run only the affected project validation first, then verify the workspace when the change crosses a contract boundary.',
      ],
      scopedProjects: [...projects].sort(),
    });
  }

  if (projectsByRuntime.size > 1) {
    templates.push({
      skillId: 'workspai-polyglot-change-validation',
      title: 'Polyglot change validation',
      triggers: [
        'cross-language change',
        'polyglot change',
        'binding change',
        'multi-runtime validation',
      ],
      objective:
        'Plan and verify a cross-runtime change without assuming that one runtime command proves the whole system.',
      steps: [
        'Use the project topology and bounded Graph query to identify runtime and contract boundaries.',
        'Validate each affected runtime with its registered project command.',
        'Run workspace impact and canonical verification before declaring the change complete.',
      ],
    });
  }

  const testProjects = model.projects
    .filter((project) => project.commands.supported.includes('test'))
    .map((project) => project.name)
    .sort();
  if (testProjects.length > 0) {
    templates.push({
      skillId: 'workspai-test-evidence-recovery',
      title: 'Test evidence recovery',
      triggers: ['test failure', 'coverage', 'regression', 'test evidence'],
      objective:
        'Repair a test or coverage blocker by proving changed behavior, not merely improving a metric.',
      steps: [
        'Read the exact Analyze, Doctor, or Goal evidence that owns the test finding.',
        'Inspect the behavior and relevant test boundary before proposing a source change.',
        'Run the scoped test command, then the exact producer and canonical verification.',
      ],
      scopedProjects: testProjects,
    });
  }

  const deliveryProjects = model.projects
    .filter((project) =>
      project.importantFiles.some((file) =>
        /(?:^|\/)(?:Dockerfile|docker-compose|compose\.|Chart\.yaml|\.github\/workflows)/i.test(
          file
        )
      )
    )
    .map((project) => project.name)
    .sort();
  if (deliveryProjects.length > 0) {
    templates.push({
      skillId: 'workspai-delivery-evidence',
      title: 'Delivery evidence and CI recovery',
      triggers: ['ci failure', 'workflow failure', 'container build', 'deployment evidence'],
      objective:
        'Diagnose delivery evidence with the owning project and CI/container artifacts before changing application source.',
      steps: [
        'Identify whether the failing evidence is project-owned or workspace-owned.',
        'Inspect the referenced workflow or delivery artifact and its bounded proof paths.',
        'Validate the affected project first, then refresh the exact evidence producer and verify the workspace.',
      ],
      scopedProjects: deliveryProjects,
    });
  }

  return templates;
}

function collectVerificationCommands(context: WorkspaceAgentContext | null): string[] {
  if (!context?.safeCommands?.length) {
    return [
      displayRapidkitCommand('workspace verify --json'),
      displayRapidkitCommand('doctor workspace --json'),
    ];
  }
  return context.safeCommands.slice(0, 8).map((entry) => entry.display);
}

function summarizeContract(contract: WorkspaceContract | null): string | undefined {
  if (!contract?.projects?.length) {
    return undefined;
  }
  const lines = contract.projects.slice(0, 12).map((project) => {
    const owns = project.contracts?.owns?.join(', ') || 'none';
    const publishes = project.contracts?.publishes?.join(', ') || 'none';
    const consumes = project.contracts?.consumes?.join(', ') || 'none';
    return `- **${project.slug}**: owns \`${owns}\`; publishes \`${publishes}\`; consumes \`${consumes}\``;
  });
  return lines.join('\n');
}

export type BuildWorkspaceOperationalSkillsInput = {
  workspacePath: string;
  model: WorkspaceModel;
  context?: WorkspaceAgentContext | null;
  contract?: WorkspaceContract | null;
  generatedAt?: Date;
};

export function buildWorkspaceOperationalSkills(
  input: BuildWorkspaceOperationalSkillsInput
): WorkspaceOperationalSkillRecord[] {
  const workspaceName = input.model.workspace.name;
  const verificationCommands = collectVerificationCommands(input.context ?? null);
  const contractSummary = summarizeContract(input.contract ?? null);

  return [...SKILL_TEMPLATES, ...dynamicSkillTemplates(input.model)].map((template) => {
    const scopedProjects =
      template.scopedProjects ?? input.model.projects.map((project) => project.name);
    const markdown = buildSkillMarkdown({
      template,
      workspaceName,
      scopedProjects,
      verificationCommands,
      contractSummary,
    });
    return buildOperationalSkillRecordShell({
      skillId: template.skillId,
      title: template.title,
      triggers: template.triggers,
      requiredReports: [...CORE_REQUIRED_REPORTS],
      scopedProjects,
      verificationCommands,
      ...(isBuiltinOperationalSkillId(template.skillId)
        ? { promptStem: OPERATIONAL_SKILL_PROMPT_STEM[template.skillId] }
        : {}),
      markdown,
    });
  });
}

export type WriteWorkspaceOperationalSkillsResult = {
  skills: WorkspaceOperationalSkillRecord[];
  index: WorkspaceSkillsIndex;
  writtenPaths: string[];
  removedSkillIds: string[];
};

export async function writeWorkspaceOperationalSkills(input: {
  workspacePath: string;
  skills: WorkspaceOperationalSkillRecord[];
  generatedAt: string;
  write: boolean;
}): Promise<WriteWorkspaceOperationalSkillsResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const writtenPaths: string[] = [];
  const inputsHash = computeInputsHash({
    skills: input.skills.map((skill) => ({
      id: skill.skillId,
      path: skill.canonicalPath,
      hash: computeInputsHash({ markdown: skill.markdown }),
    })),
  });
  const index = buildWorkspaceSkillsIndex({
    generatedAt: input.generatedAt,
    skills: input.skills,
    inputsHash,
  });
  const activeSkillIds = new Set(input.skills.map((skill) => skill.skillId));
  const removedSkillIds: string[] = [];

  if (input.write) {
    const skillsDirectory = path.join(workspacePath, '.workspai', 'skills');
    if (await fsExtra.pathExists(skillsDirectory)) {
      for (const entry of await fsExtra.readdir(skillsDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const skillId = entry.name.slice(0, -'.md'.length);
        if (activeSkillIds.has(skillId)) continue;
        const stalePath = path.join(skillsDirectory, entry.name);
        const markdown = await fsExtra.readFile(stalePath, 'utf8');
        if (!markdown.includes(WORKSPAI_GENERATED_OPERATIONAL_SKILL_MARKER)) continue;
        await fsExtra.remove(stalePath);
        removedSkillIds.push(skillId);
      }
    }
    for (const skill of input.skills) {
      const absolutePath = path.join(workspacePath, skill.canonicalPath);
      await fsExtra.ensureDir(path.dirname(absolutePath));
      await fsExtra.writeFile(absolutePath, skill.markdown, 'utf8');
      writtenPaths.push(skill.canonicalPath);
    }
    const indexPath = path.join(workspacePath, WORKSPACE_SKILLS_INDEX_PATH);
    await fsExtra.ensureDir(path.dirname(indexPath));
    await fsExtra.writeJson(indexPath, index, { spaces: 2 });
    writtenPaths.push(WORKSPACE_SKILLS_INDEX_PATH);
  }

  return { skills: input.skills, index, writtenPaths, removedSkillIds: removedSkillIds.sort() };
}

export function buildOperationalSkillsCatalogSection(index: WorkspaceSkillsIndex): string {
  const lines = [
    '## Operational skills (canonical)',
    '',
    'Read workspace-native playbooks from `.workspai/skills/` before generic repo scans. Legacy `.rapidkit/skills/` playbooks are read only when already present from older workspaces:',
    '',
    ...index.skills.map((skill) => `- \`${skill.path}\` — ${skill.title} (\`${skill.skillId}\`)`),
    '',
    'Regenerate:',
    '',
    '```bash',
    displayRapidkitCommand('workspace agent-sync --write --refresh-context'),
    '```',
    '',
  ];
  return lines.join('\n');
}

export { BUILTIN_OPERATIONAL_SKILL_IDS };

export const OPERATIONAL_SKILL_PROMPT_PATHS: Partial<Record<BuiltinOperationalSkillId, string>> = {
  'workspai-diagnose-api-failure': WORKSPAI_COPILOT_DIAGNOSE_PROMPT_PATH,
  'workspai-release-readiness': WORKSPAI_COPILOT_RELEASE_READINESS_PROMPT_PATH,
};

const HYDRATED_PROMPT_MARKER = '## Workspace verification (hydrated)';

export function buildHydratedPromptSection(skill: WorkspaceOperationalSkillRecord): string {
  const lines = [
    HYDRATED_PROMPT_MARKER,
    '',
    'Verification commands for this workspace:',
    '',
    ...(skill.verificationCommands.length
      ? skill.verificationCommands.map((command) => `- \`${command}\``)
      : ['- `npx workspai workspace verify --json`']),
  ];
  if (skill.scopedProjects.length > 0) {
    lines.push(
      '',
      'Scoped projects:',
      '',
      ...skill.scopedProjects.map((project) => `- ${project}`)
    );
  }
  lines.push('');
  return lines.join('\n');
}

export async function hydrateOperationalPrompts(input: {
  workspacePath: string;
  skills: WorkspaceOperationalSkillRecord[];
  write: boolean;
}): Promise<string[]> {
  const workspacePath = path.resolve(input.workspacePath);
  const hydratedPaths: string[] = [];
  for (const skill of input.skills) {
    const relativePath = OPERATIONAL_SKILL_PROMPT_PATHS[skill.skillId as BuiltinOperationalSkillId];
    if (!relativePath) {
      continue;
    }
    const absolutePath = path.join(workspacePath, relativePath);
    if (!(await fsExtra.pathExists(absolutePath))) {
      continue;
    }
    const existing = await fsExtra.readFile(absolutePath, 'utf8');
    const section = buildHydratedPromptSection(skill);
    const next = existing.includes(HYDRATED_PROMPT_MARKER)
      ? existing.replace(new RegExp(`${HYDRATED_PROMPT_MARKER}[\\s\\S]*$`), section.trimEnd())
      : `${existing.trimEnd()}\n\n${section}`;
    if (input.write) {
      await fsExtra.writeFile(absolutePath, `${next.trimEnd()}\n`, 'utf8');
    }
    hydratedPaths.push(relativePath);
  }
  return hydratedPaths;
}
