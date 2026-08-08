import path from 'node:path';

import fsExtra from 'fs-extra';

import { explainGraphNode } from './workspace-graph.js';
import {
  WORKSPACE_IMPACT_REPORT_PATH,
  WORKSPACE_MODEL_DIFF_REPORT_PATH,
  type WorkspaceImpact,
} from './workspace-intelligence.js';
import {
  buildWorkspaceModel,
  workspaceModelProjectTopology,
  type WorkspaceModel,
} from './workspace-model.js';
import { WORKSPACE_VERIFY_REPORT_PATH, type WorkspaceVerify } from './workspace-verify.js';
import { readWorkspaceContract, type WorkspaceContract } from './utils/workspace-contract.js';
import { attachRunCorrelation } from './observability/run-correlation.js';
import {
  WORKSPACE_EXPLAIN_REPORT_PATH,
  WORKSPACE_EXPLAIN_SCHEMA_VERSION,
  WORKSPACE_TRACE_REPORT_PATH,
  WORKSPACE_WHY_REPORT_PATH,
  type WorkspaceExplainReport,
  type WorkspaceExplainSection,
  type WorkspaceExplainTarget,
} from './contracts/workspace-explain-contract.js';
import { summarizeEmptyWorkspaceExplain } from './workspace-scaffold.js';
import { writeWorkspaceArtifactJson } from './utils/artifact-path-compat.js';
import { assertWorkspaceArtifactContract } from './contracts/artifact-contract-registry.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';

export type WorkspaceExplainArtifactKind = 'explain' | 'why' | 'trace';

export function resolveWorkspaceExplainArtifactPath(
  artifactKind: WorkspaceExplainArtifactKind
): string {
  switch (artifactKind) {
    case 'why':
      return WORKSPACE_WHY_REPORT_PATH;
    case 'trace':
      return WORKSPACE_TRACE_REPORT_PATH;
    default:
      return WORKSPACE_EXPLAIN_REPORT_PATH;
  }
}

async function readJsonFile<T>(
  absolutePath: string,
  artifactPath?: string,
  contractPath?: string
): Promise<T | null> {
  try {
    if (!(await fsExtra.pathExists(absolutePath))) {
      return null;
    }
    const payload = (await fsExtra.readJson(absolutePath)) as T;
    if (artifactPath) {
      assertWorkspaceArtifactContract(artifactPath, payload, absolutePath);
    } else if (contractPath) {
      assertJsonSchemaContract(payload, contractPath, absolutePath);
    }
    return payload;
  } catch (error) {
    if ((artifactPath || contractPath) && (await fsExtra.pathExists(absolutePath))) {
      throw error;
    }
    return null;
  }
}

function findContractProject(contract: WorkspaceContract | null, projectId: string) {
  if (!contract) {
    return null;
  }
  const normalized = projectId.trim().toLowerCase();
  return (
    contract.projects.find(
      (project) =>
        project.slug.toLowerCase() === normalized ||
        project.relativePath.toLowerCase() === normalized
    ) ?? null
  );
}

function resolveGraphProjectId(
  model: WorkspaceModel,
  contract: WorkspaceContract | null,
  projectRef: string
): string {
  const normalized = projectRef.trim().toLowerCase();
  const graphNodeIds =
    workspaceModelProjectTopology(model)?.nodes.map((node) => node.id) ??
    model.projects.map((project) => project.name);
  const exactGraphId = graphNodeIds.find((id) => id.toLowerCase() === normalized);
  if (exactGraphId) {
    return exactGraphId;
  }
  const modelProject = model.projects.find((project) =>
    [project.name, project.path, path.basename(project.path)]
      .filter((value) => value.trim().length > 0)
      .some((value) => value.toLowerCase() === normalized)
  );
  if (modelProject) {
    return modelProject.name;
  }
  const contractProject = findContractProject(contract, projectRef);
  if (contractProject) {
    const byPath = model.projects.find(
      (project) =>
        project.path === contractProject.relativePath ||
        project.path.endsWith(`/${contractProject.relativePath}`)
    );
    if (byPath) {
      return byPath.name;
    }
  }
  return projectRef;
}

function projectConsumers(contract: WorkspaceContract | null, projectId: string): string[] {
  if (!contract) {
    return [];
  }
  const normalized = projectId.trim().toLowerCase();
  const consumers = new Set<string>();
  for (const project of contract.projects) {
    if (project.contracts.dependsOn?.some((dep) => dep.toLowerCase() === normalized)) {
      consumers.add(project.slug);
    }
    for (const event of project.contracts.consumes ?? []) {
      for (const publisher of contract.projects) {
        if (publisher.contracts.publishes?.includes(event) && publisher.slug === normalized) {
          consumers.add(project.slug);
        }
      }
    }
  }
  return [...consumers].sort();
}

function verificationForProject(verify: WorkspaceVerify | null, projectId: string): string[] {
  if (!verify) {
    return [];
  }
  const normalized = projectId.trim().toLowerCase();
  return verify.steps
    .filter(
      (step) =>
        step.scope === 'project' &&
        step.project?.toLowerCase() === normalized &&
        step.command?.display
    )
    .map((step) => step.command.display)
    .slice(0, 8);
}

function section(id: string, title: string, body: string): WorkspaceExplainSection {
  return { id, title, body: body.trim() };
}

export type BuildWorkspaceExplainInput = {
  workspacePath: string;
  target: WorkspaceExplainTarget;
  model?: WorkspaceModel;
  contract?: WorkspaceContract | null;
  verify?: WorkspaceVerify | null;
  impact?: WorkspaceImpact | null;
  now?: Date;
};

export async function buildWorkspaceExplain(
  input: BuildWorkspaceExplainInput
): Promise<WorkspaceExplainReport> {
  const workspacePath = path.resolve(input.workspacePath);
  const generatedAt = (input.now ?? new Date()).toISOString();

  const model =
    input.model ??
    (await buildWorkspaceModel({
      workspacePath,
      includeEvidence: true,
    }));

  let contract = input.contract;
  if (contract === undefined) {
    try {
      contract = (await readWorkspaceContract({ workspacePath })).contract;
    } catch {
      contract = null;
    }
  }

  let verify = input.verify;
  if (verify === undefined) {
    verify = await readJsonFile<WorkspaceVerify>(
      path.join(workspacePath, WORKSPACE_VERIFY_REPORT_PATH),
      WORKSPACE_VERIFY_REPORT_PATH
    );
  }

  let impact = input.impact;
  if (impact === undefined) {
    impact = await readJsonFile<WorkspaceImpact>(
      path.join(workspacePath, WORKSPACE_IMPACT_REPORT_PATH),
      WORKSPACE_IMPACT_REPORT_PATH
    );
  }

  if (input.target.kind === 'release-blocked') {
    const blockingReasons = verify?.blockingReasons ?? [];
    const projectCount = model.summary?.projectCount ?? model.projects.length;
    const emptyWorkspaceShell = projectCount === 0;
    const sections: WorkspaceExplainSection[] = [
      section(
        'verdict',
        emptyWorkspaceShell ? 'Workspace scaffold posture' : 'Release verdict',
        verify
          ? emptyWorkspaceShell
            ? `Scaffold posture: **${verify.summary.verdict}** (exit ${verify.summary.exitCode}). Freshness: **${verify.freshness.verdict}**. No registered projects yet — release gates apply after the first project is added.`
            : `Verdict: **${verify.summary.verdict}** (exit ${verify.summary.exitCode}). Risk: **${verify.impact.risk}**. Freshness: **${verify.freshness.verdict}**.`
          : 'No workspace verify report found. Run `npx workspai workspace verify --json --write` first.'
      ),
      section(
        'blockers',
        emptyWorkspaceShell ? 'Pre-project signals' : 'Blocking reasons',
        blockingReasons.length
          ? blockingReasons.map((reason) => `- ${reason}`).join('\n')
          : emptyWorkspaceShell
            ? 'No pre-project signals in the latest verify report.'
            : 'No blocking reasons in the latest verify report.'
      ),
    ];
    if (verify?.resolutionHints?.length) {
      sections.push(
        section(
          'resolution',
          'Resolution hints',
          verify.resolutionHints
            .map(
              (hint) =>
                `- **${hint.blockerId}** (${hint.resolutionClass}): ${hint.commandRetryHint ?? hint.fixHints[0]?.detail ?? 'See fix hints'}`
            )
            .join('\n')
        )
      );
    }
    return {
      schemaVersion: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
      generatedAt,
      workspacePath,
      target: input.target,
      summary: verify
        ? emptyWorkspaceShell
          ? summarizeEmptyWorkspaceExplain(blockingReasons.length, verify.summary.verdict)
          : `${blockingReasons.length > 0 || verify.summary.verdict === 'blocked' ? 'Release blocked' : 'Release posture'}: ${verify.summary.verdict} with ${blockingReasons.length} blocking reason(s).`
        : 'Release posture unknown — verify report missing.',
      sections,
      releaseVerdict: verify?.summary.verdict,
      evidenceFreshness: verify?.freshness.verdict,
      blocking: Boolean(
        verify && (verify.summary.verdict === 'blocked' || blockingReasons.length > 0)
      ),
      releaseRisk: verify?.impact.risk,
      blockingReasons,
      resolutionHints: verify?.resolutionHints,
    };
  }

  if (input.target.kind === 'blocker') {
    const blockerTarget = input.target;
    const hint = verify?.resolutionHints?.find(
      (entry) => entry.blockerId === blockerTarget.blockerId
    );
    const reason =
      verify?.blockingReasons.find((entry) => entry.includes(blockerTarget.blockerId)) ??
      verify?.blockingReasons[0];
    return {
      schemaVersion: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
      generatedAt,
      workspacePath,
      target: blockerTarget,
      summary: hint
        ? `Blocker ${blockerTarget.blockerId}: ${hint.resolutionClass}`
        : `Blocker ${blockerTarget.blockerId} (no structured hint)`,
      sections: [
        section('reason', 'Blocking signal', reason ?? 'No matching blocking reason in verify.'),
        section(
          'hint',
          'Resolution class',
          hint
            ? `${hint.resolutionClass}\n\n${hint.commandRetryHint ?? ''}\n\n${hint.fixHints.map((f) => `- ${f.detail}`).join('\n')}`
            : 'Run workspace verify to emit resolutionHints for this blocker.'
        ),
      ],
      blockingReasons: reason ? [reason] : [],
      resolutionHints: hint ? [hint] : [],
    };
  }

  if (input.target.kind === 'trace') {
    const diffPath = path.isAbsolute(input.target.diffRef)
      ? input.target.diffRef
      : path.join(workspacePath, input.target.diffRef);
    const diff = await readJsonFile<{
      summary?: { changedProjects?: string[] };
      changes?: Array<{ project?: string; type?: string }>;
    }>(diffPath, undefined, 'contracts/workspace-intelligence/workspace-model-diff.v1.json');
    const changed = diff?.summary?.changedProjects ?? [
      ...new Set((diff?.changes ?? []).map((change) => change.project).filter(Boolean)),
    ];
    const projectCount = model.summary?.projectCount ?? model.projects.length;
    const emptyWorkspaceShell = projectCount === 0;
    const transitive =
      impact?.transitiveImpact?.map(
        (entry) =>
          `${entry.project?.name ?? entry.target} (d${entry.distance ?? 0}, via ${entry.via ?? '—'})`
      ) ?? [];
    const subgraph = verify?.affectedSubgraph;
    return {
      schemaVersion: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
      generatedAt,
      workspacePath,
      target: input.target,
      summary: changed?.length
        ? `Trace from ${changed.length} changed project(s) through blast radius to gate coverage.`
        : emptyWorkspaceShell
          ? 'Trace: workspace scaffold baseline — no project changes in the latest diff.'
          : 'Trace: diff baseline present with no project changes.',
      sections: [
        section(
          'origin',
          'Change origin',
          changed?.length
            ? changed.map((project) => `- ${project}`).join('\n')
            : 'No changed projects in diff.'
        ),
        section(
          'blast-radius',
          'Transitive impact',
          transitive.length
            ? transitive.map((line) => `- ${line}`).join('\n')
            : 'No transitive impact report.'
        ),
        section(
          'gate',
          'Subgraph gate',
          subgraph
            ? `Directly changed: ${subgraph.directlyChanged}; transitive dependents: ${subgraph.transitiveDependents}; covered: ${subgraph.covered}; uncovered: ${subgraph.uncovered}; unverifiable: ${subgraph.unverifiable}.`
            : 'No verify subgraph coverage available.'
        ),
      ],
      releaseRisk: impact?.summary?.risk ?? verify?.impact.risk,
      blockingReasons: verify?.blockingReasons,
    };
  }

  const projectId = input.target.project;
  const graphProjectId = resolveGraphProjectId(model, contract, projectId);
  const graph = workspaceModelProjectTopology(model);
  const graphExplain = graph
    ? explainGraphNode(graph, graphProjectId)
    : {
        project: projectId,
        found: false,
        centrality: null,
        directDependents: [],
        directDependencies: [],
        transitiveDependents: [],
        transitiveDependencies: [],
      };
  const contractProject = findContractProject(contract, projectId);
  const consumers = projectConsumers(contract, projectId);
  const verification = verificationForProject(verify, projectId);
  const projectModel = model.projects.find(
    (project) => project.name.toLowerCase() === projectId.toLowerCase()
  );

  const sections: WorkspaceExplainSection[] = [
    section(
      'overview',
      'Project overview',
      projectModel
        ? `${projectModel.name} (${projectModel.frameworkDisplayName}, ${projectModel.runtime}) at \`${projectModel.path}\`.`
        : `Project **${projectId}** ${graphExplain.found ? 'exists in graph' : 'not found in workspace model'}.`
    ),
    section(
      'consumers',
      'Consumers / dependents',
      [
        `Direct dependents: ${graphExplain.directDependents.join(', ') || 'none'}`,
        `Contract consumers: ${consumers.join(', ') || 'none'}`,
        `Transitive dependents (blast radius): ${graphExplain.transitiveDependents.length}`,
      ].join('\n')
    ),
    section(
      'contracts',
      'Critical contracts',
      contractProject
        ? [
            `Owns: ${contractProject.contracts?.owns?.join(', ') || 'none'}`,
            `Publishes: ${contractProject.contracts.publishes.join(', ') || 'none'}`,
            `Consumes: ${contractProject.contracts.consumes.join(', ') || 'none'}`,
            `APIs: ${contractProject.contracts.apis.map((api) => api.name).join(', ') || 'none'}`,
          ].join('\n')
        : 'No workspace.contract.json entry for this project.'
    ),
    section(
      'verification',
      'Required verification',
      verification.length
        ? verification.map((command) => `- ${command}`).join('\n')
        : '- `npx workspai workspace verify --json`\n- Project test/build via `workspace run` when configured'
    ),
  ];

  if (graphExplain.centrality) {
    sections.push(
      section(
        'centrality',
        'Graph centrality',
        `fanIn ${graphExplain.centrality.fanIn}, fanOut ${graphExplain.centrality.fanOut}, reach ${graphExplain.centrality.reach}, hotspot ${graphExplain.centrality.isHotspot ? 'yes' : 'no'}.`
      )
    );
  }

  const normalizedProjectId = projectId.trim().toLowerCase();
  const matchesProject = (entry: { project?: { name?: string }; target: string }): boolean =>
    entry.project?.name?.toLowerCase() === normalizedProjectId ||
    entry.target.toLowerCase() === normalizedProjectId;
  const releaseRisk =
    impact?.affectedProjects?.find(matchesProject)?.risk ??
    impact?.transitiveImpact?.find(matchesProject)?.risk ??
    verify?.impact.risk ??
    'unknown';

  return {
    schemaVersion: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
    generatedAt,
    workspacePath,
    target: input.target,
    summary: `${projectId}: ${consumers.length} consumer(s), release risk **${releaseRisk}**.`,
    sections,
    releaseRisk: String(releaseRisk),
  };
}

export async function writeWorkspaceExplainReport(
  report: WorkspaceExplainReport,
  workspacePath: string,
  artifactKind: WorkspaceExplainArtifactKind = 'explain'
): Promise<string> {
  const relativePath = resolveWorkspaceExplainArtifactPath(artifactKind);
  await writeWorkspaceArtifactJson(workspacePath, relativePath, attachRunCorrelation(report));
  return relativePath;
}

export {
  WORKSPACE_EXPLAIN_REPORT_PATH,
  WORKSPACE_MODEL_DIFF_REPORT_PATH,
  WORKSPACE_TRACE_REPORT_PATH,
  WORKSPACE_WHY_REPORT_PATH,
};
