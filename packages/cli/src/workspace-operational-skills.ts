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
  type WorkspaceOperationalSkillDecision,
  type WorkspaceSkillsIndex,
} from './contracts/workspace-skills-index-contract.js';
import { computeInputsHash } from './contracts/freshness-metadata-contract.js';
import type { WorkspaceAgentContext } from './workspace-context.js';
import type { WorkspaceModel } from './workspace-model.js';
import type {
  WorkspaceKnowledgeEntity,
  WorkspaceKnowledgeGraph,
} from './contracts/workspace-knowledge-graph-contract.js';
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
  applicability: 'workspace' | 'api' | 'schema' | 'dependency' | 'contract' | 'derived';
};

export type WorkspaceOperationalSkillsPlan = {
  skills: WorkspaceOperationalSkillRecord[];
  decisions: WorkspaceOperationalSkillDecision[];
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
    applicability: 'api',
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
    applicability: 'workspace',
  },
  {
    skillId: 'workspai-safe-schema-migration',
    title: 'Safe schema migration',
    triggers: ['migration', 'schema change', 'database migration', 'db migrate'],
    objective: 'Plan and verify a schema migration with blast-radius awareness.',
    steps: [
      'Identify affected projects from workspace model and dependency graph.',
      'Run or review impact/verify evidence for transitive dependents.',
      'Run a registered project-scoped test/build command when available; otherwise resolve the repository-authored validation command from cited manifests before promoting the migration.',
      'Document rollback and verification signals.',
    ],
    applicability: 'schema',
  },
  {
    skillId: 'workspai-dependency-upgrade',
    title: 'Dependency upgrade',
    triggers: ['upgrade dependency', 'bump package', 'security advisory', 'outdated deps'],
    objective: 'Upgrade dependencies with graph-aware verification.',
    steps: [
      'Scope the upgrade to the owning project from workspace model.',
      'Check transitive dependents via workspace graph / impact reports.',
      'Use registered test/build commands for affected projects; when none are registered, resolve repository-authored commands from cited manifests instead of inventing one.',
      'Re-run `workspace verify` after evidence refresh.',
    ],
    applicability: 'dependency',
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
    applicability: 'contract',
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
  decision: WorkspaceOperationalSkillDecision;
  projectEvidence: string[];
  retrievalCommands: string[];
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
    '## Why this skill exists here',
    '',
    `Applicability: **${input.decision.confidence} confidence**.`,
    '',
    ...input.decision.reasons.map((reason) => `- ${reason}`),
    ...(input.decision.signals.length > 0
      ? ['', 'Evidence signals:', '', ...input.decision.signals.map((signal) => `- \`${signal}\``)]
      : []),
    '',
    '## Project-aware execution boundary',
    '',
    ...input.projectEvidence,
    '',
    ...(input.retrievalCommands.length > 0
      ? [
          '## Scoped retrieval commands',
          '',
          ...input.retrievalCommands.map((command) => `- \`${command}\``),
          '',
        ]
      : []),
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
    const runtimes = new Set(
      [project.runtime, ...(project.runtimeCandidates ?? [])]
        .map(normalizedSkillSegment)
        .filter((runtime) => runtime && runtime !== 'unknown')
    );
    for (const runtime of runtimes) {
      const projects = projectsByRuntime.get(runtime) ?? [];
      if (!projects.includes(project.name)) projects.push(project.name);
      projectsByRuntime.set(runtime, projects);
    }
  }

  const templates: SkillTemplate[] = [];
  for (const [runtime, projects] of [...projectsByRuntime.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    templates.push({
      skillId: `workspai-${runtime}-runtime-validation`,
      title: `${runtime.toUpperCase()} runtime validation`,
      triggers: [`${runtime} build`, `${runtime} test`, `${runtime} runtime failure`],
      objective: `Validate ${runtime} changes against the detected runtime boundary, registered project commands, and canonical Workspai evidence.`,
      steps: [
        'Read the scoped project lens and current fail/warn evidence before changing source.',
        `Use a registered ${runtime} command only when the project model identifies ${runtime} as the primary runtime; for a composite secondary boundary, inspect its manifest and Graph proofs instead of assuming the primary adapter covers it.`,
        'Run only the affected project validation first, then verify the workspace when the change crosses a contract boundary.',
      ],
      scopedProjects: [...projects].sort(),
      applicability: 'derived',
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
      scopedProjects: uniqueSorted([...projectsByRuntime.values()].flat()),
      applicability: 'derived',
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
      applicability: 'derived',
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
      applicability: 'derived',
    });
  }

  return templates;
}

function collectVerificationCommands(
  context: WorkspaceAgentContext | null,
  scopedProjects: string[]
): string[] {
  if (!context?.safeCommands?.length) {
    return [
      displayRapidkitCommand('workspace verify --json'),
      displayRapidkitCommand('doctor workspace --json'),
    ];
  }
  const scope = new Set(scopedProjects);
  return context.safeCommands
    .filter((entry) => entry.scope === 'workspace' || (entry.project && scope.has(entry.project)))
    .slice(0, 8)
    .map((entry) => entry.display);
}

function summarizeContract(
  contract: WorkspaceContract | null,
  scopedProjects: string[]
): string | undefined {
  if (!contract?.projects?.length) {
    return undefined;
  }
  const scope = new Set(scopedProjects);
  const lines = contract.projects
    .filter((project) => scope.has(project.slug))
    .filter(
      (project) =>
        (project.contracts?.owns?.length ?? 0) > 0 ||
        (project.contracts?.publishes?.length ?? 0) > 0 ||
        (project.contracts?.consumes?.length ?? 0) > 0 ||
        (project.contracts?.apis?.length ?? 0) > 0
    )
    .slice(0, 12)
    .map((project) => {
      const owns = project.contracts?.owns?.join(', ') || 'none';
      const publishes = project.contracts?.publishes?.join(', ') || 'none';
      const consumes = project.contracts?.consumes?.join(', ') || 'none';
      return `- **${project.slug}**: owns \`${owns}\`; publishes \`${publishes}\`; consumes \`${consumes}\``;
    });
  return lines.length > 0 ? lines.join('\n') : undefined;
}

const DEPENDENCY_MANIFEST_PATTERN =
  /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|pyproject\.toml|poetry\.lock|requirements[^/]*\.txt|Pipfile(?:\.lock)?|uv\.lock|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|Gemfile(?:\.lock)?|composer\.(?:json|lock)|mix\.exs|deps\.edn|project\.clj|[^/]+\.(?:csproj|fsproj|vbproj)|Directory\.Packages\.props)$/i;
const API_ARTIFACT_PATTERN =
  /(?:^|\/)(?:openapi|swagger|asyncapi)\.(?:json|ya?ml)$|(?:^|\/)(?:routes?|controllers?|endpoints?|proto)(?:\/|\.)/i;
const SCHEMA_ARTIFACT_PATTERN =
  /(?:^|\/)(?:migrations?|database|db|prisma)(?:\/|\.)|(?:^|\/)schema\.(?:sql|prisma)$/i;

function entityArtifact(entity: WorkspaceKnowledgeEntity): string | null {
  const artifact = entity.attributes.artifact;
  return typeof artifact === 'string' && artifact.trim() ? artifact.trim() : null;
}

function entityHasNetworkPort(entity: WorkspaceKnowledgeEntity): boolean {
  const ports = entity.attributes.ports;
  return Array.isArray(ports) && ports.length > 0;
}

function projectGraphEntities(
  graph: WorkspaceKnowledgeGraph | null,
  projectName: string
): WorkspaceKnowledgeEntity[] {
  return graph?.entities.filter((entity) => entity.projectId === projectName) ?? [];
}

function uniqueBounded(values: Iterable<string>, limit = 12): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function selectTemplateProjects(input: {
  template: SkillTemplate;
  model: WorkspaceModel;
  contract: WorkspaceContract | null;
  graph: WorkspaceKnowledgeGraph | null;
}): {
  projects: string[];
  reasons: string[];
  signals: string[];
  confidence: 'high' | 'medium';
  applicable: boolean;
} {
  if (input.template.scopedProjects) {
    return {
      projects: [...input.template.scopedProjects].sort(),
      reasons: ['The canonical workspace model directly derived this capability.'],
      signals: uniqueBounded(
        input.template.scopedProjects.map(
          (project) => `model:project:${project}:${input.template.skillId}`
        )
      ),
      confidence: 'high',
      applicable: true,
    };
  }

  if (input.template.applicability === 'workspace') {
    return {
      projects: input.model.projects.map((project) => project.name).sort(),
      reasons: ['Workspace-level release and verification gates are always available.'],
      signals: ['model:workspace', `model:project-count:${input.model.projects.length}`],
      confidence: 'high',
      applicable: true,
    };
  }

  const projects: string[] = [];
  const signals: string[] = [];
  const reasons = new Set<string>();
  for (const project of input.model.projects) {
    const entities = projectGraphEntities(input.graph, project.name);
    const artifacts = uniqueSorted([
      ...project.importantFiles,
      ...entities.map(entityArtifact).filter((value): value is string => Boolean(value)),
    ]);
    const contractProject = input.contract?.projects.find(
      (candidate) => candidate.slug === project.name
    );
    let applicable = false;

    switch (input.template.applicability) {
      case 'dependency': {
        const manifests = artifacts.filter((artifact) =>
          DEPENDENCY_MANIFEST_PATTERN.test(artifact)
        );
        const packages = entities.filter((entity) => entity.kind === 'package');
        applicable = manifests.length > 0 || packages.length > 0;
        signals.push(
          ...manifests.map((artifact) => `artifact:${artifact}`),
          ...packages.slice(0, 4).map((entity) => `graph:package:${entity.label}`)
        );
        if (applicable) reasons.add('Dependency manifests or package entities were observed.');
        break;
      }
      case 'api': {
        const apiEntities = entities.filter(
          (entity) =>
            entity.kind === 'api' ||
            entity.kind === 'endpoint' ||
            (entity.kind === 'service' && entityHasNetworkPort(entity))
        );
        const apiArtifacts = artifacts.filter((artifact) => API_ARTIFACT_PATTERN.test(artifact));
        const contractApis = contractProject?.contracts?.apis ?? [];
        const contractPorts = (contractProject?.ports ?? []).filter((port) =>
          ['http', 'https', 'grpc'].includes(port.protocol)
        );
        applicable =
          apiEntities.length > 0 ||
          apiArtifacts.length > 0 ||
          contractApis.length > 0 ||
          contractPorts.length > 0;
        signals.push(
          ...apiEntities.slice(0, 4).map((entity) => `graph:${entity.kind}:${entity.label}`),
          ...apiArtifacts.map((artifact) => `artifact:${artifact}`),
          ...contractApis.map((api) => `contract:api:${api.name}:${api.basePath}`),
          ...contractPorts.map((port) => `contract:port:${port.name}:${port.protocol}:${port.port}`)
        );
        if (applicable)
          reasons.add('An API, endpoint, routed artifact, or network contract was observed.');
        break;
      }
      case 'schema': {
        const schemaEntities = entities.filter((entity) => {
          if (entity.kind === 'database') return true;
          if (entity.kind !== 'schema') return false;
          const semanticText = `${entity.label} ${JSON.stringify(entity.attributes)}`;
          return /database|migration|sql|prisma|orm/i.test(semanticText);
        });
        const schemaArtifacts = artifacts.filter((artifact) =>
          SCHEMA_ARTIFACT_PATTERN.test(artifact)
        );
        applicable = schemaEntities.length > 0 || schemaArtifacts.length > 0;
        signals.push(
          ...schemaEntities.slice(0, 4).map((entity) => `graph:${entity.kind}:${entity.label}`),
          ...schemaArtifacts.map((artifact) => `artifact:${artifact}`)
        );
        if (applicable) reasons.add('A database, schema, or migration artifact was observed.');
        break;
      }
      case 'contract': {
        const contractValues = contractProject
          ? [
              ...(contractProject.contracts?.owns ?? []),
              ...(contractProject.contracts?.publishes ?? []),
              ...(contractProject.contracts?.consumes ?? []),
              ...(contractProject.contracts?.apis ?? []).map((api) => api.name),
            ]
          : [];
        const contractEntities = entities.filter((entity) =>
          ['api', 'protocol'].includes(entity.kind)
        );
        applicable = contractValues.length > 0 || contractEntities.length > 0;
        signals.push(
          ...contractValues.map((value) => `contract:${project.name}:${value}`),
          ...contractEntities.slice(0, 6).map((entity) => `graph:${entity.kind}:${entity.label}`)
        );
        if (applicable)
          reasons.add('A shared API, protocol, schema, or authored contract edge was observed.');
        break;
      }
      case 'derived':
        applicable = true;
        break;
    }
    if (applicable) projects.push(project.name);
  }

  return {
    projects: uniqueBounded(projects, input.model.projects.length),
    reasons: [...reasons],
    signals: uniqueBounded(signals),
    confidence: input.graph || input.contract ? 'high' : 'medium',
    applicable: projects.length > 0,
  };
}

function buildProjectEvidenceLines(
  model: WorkspaceModel,
  scopedProjects: string[],
  signals: string[]
): string[] {
  const lines: string[] = [];
  for (const projectName of scopedProjects) {
    const project = model.projects.find((candidate) => candidate.name === projectName);
    if (!project) continue;
    const lifecycleCommands = project.commands.supported.filter((command) =>
      ['build', 'test', 'lint', 'format'].includes(command)
    );
    const evidenceCommands = project.commands.supported.filter((command) =>
      ['docs', 'doctor'].includes(command)
    );
    const relevantArtifacts = signals
      .filter((signal) => signal.startsWith('artifact:'))
      .map((signal) => signal.slice('artifact:'.length))
      .filter(
        (artifact) => project.importantFiles.includes(artifact) || artifact.includes(project.name)
      );
    lines.push(
      `- **${project.name}** — runtime \`${project.runtime}\`, framework \`${project.framework}\`, confidence \`${project.confidence}\`.`
    );
    lines.push(
      lifecycleCommands.length > 0
        ? `  Registered lifecycle commands: ${lifecycleCommands.map((command) => `\`${command}\``).join(', ')}.`
        : '  No project-native build/test command is registered; inspect repository-authored manifests and Graph proofs before running a command.'
    );
    if (evidenceCommands.length > 0) {
      lines.push(
        `  Registered evidence commands: ${evidenceCommands.map((command) => `\`${command}\``).join(', ')}.`
      );
    }
    if (relevantArtifacts.length > 0) {
      lines.push(
        `  Relevant artifacts: ${uniqueBounded(relevantArtifacts, 6)
          .map((artifact) => `\`${artifact}\``)
          .join(', ')}.`
      );
    }
  }
  return lines.length > 0
    ? lines
    : ['- No project boundary was proven; do not infer repository-specific commands or files.'];
}

function buildSkillRetrievalCommands(template: SkillTemplate, scopedProjects: string[]): string[] {
  const query =
    template.applicability === 'api'
      ? 'api endpoint route service failure'
      : template.applicability === 'schema'
        ? 'database schema migration persistence'
        : template.applicability === 'dependency'
          ? 'package dependency manifest lockfile'
          : template.applicability === 'contract'
            ? 'api protocol published consumed contract'
            : template.applicability === 'workspace'
              ? 'release pipeline deployment verification'
              : `${template.title.toLowerCase()} manifest command test`;
  return scopedProjects
    .slice(0, 8)
    .map((project) =>
      displayRapidkitCommand(
        `workspace graph search "${query}" --scope project:${project} --limit 12 --json`
      )
    );
}

export type BuildWorkspaceOperationalSkillsInput = {
  workspacePath: string;
  model: WorkspaceModel;
  context?: WorkspaceAgentContext | null;
  contract?: WorkspaceContract | null;
  graph?: WorkspaceKnowledgeGraph | null;
  generatedAt?: Date;
};

export function buildWorkspaceOperationalSkillsPlan(
  input: BuildWorkspaceOperationalSkillsInput
): WorkspaceOperationalSkillsPlan {
  const workspaceName = input.model.workspace.name;
  const skills: WorkspaceOperationalSkillRecord[] = [];
  const decisions: WorkspaceOperationalSkillDecision[] = [];

  for (const template of [...SKILL_TEMPLATES, ...dynamicSkillTemplates(input.model)]) {
    const selection = selectTemplateProjects({
      template,
      model: input.model,
      contract: input.contract ?? null,
      graph: input.graph ?? null,
    });
    const decision: WorkspaceOperationalSkillDecision = {
      skillId: template.skillId,
      title: template.title,
      status: selection.applicable ? 'generated' : 'suppressed',
      confidence: selection.confidence,
      reasons:
        selection.reasons.length > 0
          ? selection.reasons
          : ['No authoritative workspace signal proves this capability is present.'],
      signals: selection.signals,
      scopedProjects: selection.projects,
    };
    decisions.push(decision);
    if (decision.status === 'suppressed') continue;

    const scopedProjects = decision.scopedProjects;
    const verificationCommands = collectVerificationCommands(input.context ?? null, scopedProjects);
    const contractSummary = summarizeContract(input.contract ?? null, scopedProjects);
    const markdown = buildSkillMarkdown({
      template,
      workspaceName,
      scopedProjects,
      verificationCommands,
      contractSummary,
      decision,
      projectEvidence: buildProjectEvidenceLines(input.model, scopedProjects, decision.signals),
      retrievalCommands: buildSkillRetrievalCommands(template, scopedProjects),
    });
    skills.push(
      buildOperationalSkillRecordShell({
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
      })
    );
  }

  return { skills, decisions };
}

export function buildWorkspaceOperationalSkills(
  input: BuildWorkspaceOperationalSkillsInput
): WorkspaceOperationalSkillRecord[] {
  return buildWorkspaceOperationalSkillsPlan(input).skills;
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
  decisions?: WorkspaceOperationalSkillDecision[];
}): Promise<WriteWorkspaceOperationalSkillsResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const writtenPaths: string[] = [];
  const inputsHash = computeInputsHash({
    skills: input.skills.map((skill) => ({
      id: skill.skillId,
      path: skill.canonicalPath,
      hash: computeInputsHash({ markdown: skill.markdown }),
    })),
    decisions: input.decisions ?? [],
  });
  const index = buildWorkspaceSkillsIndex({
    generatedAt: input.generatedAt,
    skills: input.skills,
    inputsHash,
    decisions: input.decisions,
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
