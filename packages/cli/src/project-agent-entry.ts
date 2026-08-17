import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import { assertWorkspaceArtifactContract } from './contracts/artifact-contract-registry.js';
import { inspectGoalLifecycle } from './goal-lifecycle.js';
import {
  resolveProjectWorkspaceSync,
  type ProjectWorkspaceRelationship,
} from './project-workspace-link.js';
import type { ProjectContextAgent } from './project-intelligence-lens.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { readWorkspaceKnowledgeGraphSnapshot } from './workspace-knowledge-graph-snapshot.js';
import { hashCanonicalJson } from './workspace-model-hash.js';

export const PROJECT_AGENT_ENTRY_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectAgentEntry.schemaVersion;
export const PROJECT_AGENT_ENTRY_RELATIVE_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectAgentEntry;
export const AGENT_BOOTSTRAP_RECEIPT_SCHEMA_VERSION =
  'workspai.agent-bootstrap-receipt.v1' as const;
export const WORKSPAI_AGENT_ENTRY_START = '<!-- WORKSPAI:AGENT-ENTRY:START -->';
export const WORKSPAI_AGENT_ENTRY_END = '<!-- WORKSPAI:AGENT-ENTRY:END -->';

export const AGENT_ENTRY_HOST_IDS = [
  'generic',
  'codex',
  'claude',
  'gemini',
  'qwen',
  'kimi',
  'grok',
  'copilot',
  'cursor',
  'windsurf',
  'amazon-q',
] as const;

export const PROJECT_AGENT_ADAPTER_ENTRY_FILES = [
  'CLAUDE.md',
  'GEMINI.md',
  'QWEN.md',
  '.amazonq/rules/workspai-agent-entry.md',
] as const;

export type AgentEntryHostId = (typeof AGENT_ENTRY_HOST_IDS)[number];
export type AgentEntryHostStatus = 'ready' | 'degraded' | 'blocked';
export type AgentEntryCheckStatus = 'passed' | 'warning' | 'failed';

export interface AgentEntryHostCoverage {
  id: AgentEntryHostId;
  discovery: 'native' | 'adapter' | 'portable-fallback';
  entryFiles: string[];
  status: AgentEntryHostStatus;
  managed: boolean;
  reason?: string;
}

export interface ProjectAgentEntryManifest {
  schemaVersion: typeof PROJECT_AGENT_ENTRY_SCHEMA_VERSION;
  generatedAt: string;
  project: {
    name: string;
    relativePath: string;
    runtime?: string;
    framework?: string;
  };
  workspace: {
    name: string;
    relationship: ProjectWorkspaceRelationship;
    localBinding: typeof WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectWorkspaceLink;
    identityIsFilesystemPath: false;
    resolverCommand: 'workspai project workspace status --json';
    portableUriScheme: 'workspace:';
    resolvedPathPolicy: 'runtime-private-never-persist';
  };
  canonical: {
    projectContext: typeof WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent;
    projectGrounding: '.workspai/PROJECT-GROUNDING.md';
    goalIndex: `workspace:${typeof WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalIndex}`;
    workspaceIndex: `workspace:${typeof WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}`;
    workspaceContext: `workspace:${typeof WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}`;
    workspaceModel: `workspace:${typeof WORKSPACE_INTELLIGENCE_ARTIFACTS.model}`;
    knowledgeGraph: `workspace:${typeof WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}`;
  };
  protocol: {
    mode: 'canonical-first';
    bootstrapCommand: string;
    verifyCommand: string;
    requiredReadOrder: string[];
    sourcePolicy: {
      liveSourceAuthority: 'exact-implementation';
      workspaceEvidenceAuthority: 'identity-topology-readiness-goals';
      broadScanBeforeBootstrap: false;
      sourceMutation: 'governed-only';
      verificationClaims: 'cli-evidence-only';
    };
    degradedMode: {
      discloseMissingEvidence: true;
      allowCompleteArchitectureClaims: false;
      allowReadOnlySourceInspection: true;
    };
  };
  hosts: AgentEntryHostCoverage[];
  integrity: {
    algorithm: 'sha256';
    projectContextHash: string;
    payloadHash: string;
    portable: true;
    absolutePathsEmitted: false;
  };
}

export interface AgentBootstrapReceipt {
  schemaVersion: typeof AGENT_BOOTSTRAP_RECEIPT_SCHEMA_VERSION;
  generatedAt: string;
  receiptId: string;
  status: AgentEntryHostStatus;
  requestedAgent: string;
  resolvedHost: AgentEntryHostId | 'all';
  project: {
    name: string;
    relativePath: string;
    runtime?: string;
    framework?: string;
  };
  workspace: {
    name: string;
    relationship: ProjectWorkspaceRelationship;
    resolved: true;
    identityIsFilesystemPath: false;
    resolverCommand: 'workspai project workspace status --json';
    portableUriScheme: 'workspace:';
    resolvedPathPolicy: 'runtime-private-never-persist';
  };
  entry: {
    artifact: typeof PROJECT_AGENT_ENTRY_RELATIVE_PATH;
    schemaVersion: typeof PROJECT_AGENT_ENTRY_SCHEMA_VERSION;
    hostStatus: AgentEntryHostStatus;
    entryFiles: string[];
  };
  canonicalEvidence: {
    projectContext: typeof WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent;
    workspaceIndex: `workspace:${typeof WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}`;
    workspaceContext: `workspace:${typeof WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}`;
    workspaceModel: `workspace:${typeof WORKSPACE_INTELLIGENCE_ARTIFACTS.model}`;
    knowledgeGraph: `workspace:${typeof WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}`;
    modelFreshness: ProjectContextAgent['intelligence']['freshness']['model'];
    graphFreshness: ProjectContextAgent['intelligence']['freshness']['graph'];
    graphMatchesModel: boolean;
    liveInputsValidated: boolean;
    blockerCount: number;
  };
  activeGoal: {
    present: boolean;
    appliesToProject: boolean;
    status: 'none' | 'ready' | 'stale' | 'invalid';
    id?: string;
    objective?: string;
    lifecycle?: string;
    goalPack?: string;
    agentHandoff?: string;
  };
  requiredReadOrder: string[];
  claims: {
    architecture: 'allowed-with-citations' | 'prohibited';
    sourceInspection: 'bounded-and-targeted';
    sourceMutation: 'governed-cli-transaction-only';
    verification: 'cli-evidence-only';
  };
  checks: Array<{
    id: string;
    status: AgentEntryCheckStatus;
    message: string;
    artifact?: string;
  }>;
  nextActions: string[];
  integrity: {
    algorithm: 'sha256';
    manifestHash: string;
    projectContextHash: string;
    payloadHash: string;
    portable: true;
    absolutePathsEmitted: false;
  };
}

export function normalizeAgentEntryHost(value: string | undefined): AgentEntryHostId {
  const normalized = value?.trim().toLowerCase() || 'generic';
  if (normalized === 'orca') return 'grok';
  if ((AGENT_ENTRY_HOST_IDS as readonly string[]).includes(normalized)) {
    return normalized as AgentEntryHostId;
  }
  throw new Error(
    `Unsupported agent host "${normalized}". Expected one of: ${AGENT_ENTRY_HOST_IDS.join(', ')}.`
  );
}

function assertCompleteHostMatrix(hosts: readonly AgentEntryHostCoverage[]): void {
  const actual = hosts.map((host) => host.id).sort();
  const expected = [...AGENT_ENTRY_HOST_IDS].sort();
  if (actual.length !== expected.length || actual.some((host, index) => host !== expected[index])) {
    throw new Error('Project agent entry must define each supported host exactly once.');
  }
}

function withoutIntegrity<T extends { integrity: unknown }>(value: T): Omit<T, 'integrity'> {
  const { integrity: _integrity, ...payload } = value;
  return payload;
}

function portableHash(value: unknown): string {
  return hashCanonicalJson(value);
}

export function buildProjectAgentEntryManifest(input: {
  context: ProjectContextAgent;
  hosts: AgentEntryHostCoverage[];
}): ProjectAgentEntryManifest {
  assertCompleteHostMatrix(input.hosts);
  const payload: Omit<ProjectAgentEntryManifest, 'integrity'> = {
    schemaVersion: PROJECT_AGENT_ENTRY_SCHEMA_VERSION,
    generatedAt: input.context.generatedAt,
    project: {
      name: input.context.project.name,
      relativePath: input.context.project.relativePath,
      ...(input.context.project.runtime ? { runtime: input.context.project.runtime } : {}),
      ...(input.context.project.framework ? { framework: input.context.project.framework } : {}),
    },
    workspace: {
      name: input.context.workspace.name,
      relationship: input.context.workspace.relationship,
      localBinding: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectWorkspaceLink,
      identityIsFilesystemPath: false,
      resolverCommand: 'workspai project workspace status --json',
      portableUriScheme: 'workspace:',
      resolvedPathPolicy: 'runtime-private-never-persist',
    },
    canonical: {
      projectContext: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent,
      projectGrounding: '.workspai/PROJECT-GROUNDING.md',
      goalIndex: `workspace:${WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalIndex}`,
      workspaceIndex: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}` as const,
      workspaceContext: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}` as const,
      workspaceModel: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.model}` as const,
      knowledgeGraph: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}` as const,
    },
    protocol: {
      mode: 'canonical-first',
      bootstrapCommand: 'workspai agent bootstrap --for-agent generic --strict --json',
      verifyCommand: 'workspai project agent-entry verify --for-agent all --strict --json',
      requiredReadOrder: [
        PROJECT_AGENT_ENTRY_RELATIVE_PATH,
        'command:workspai agent bootstrap --for-agent generic --strict --json',
        'command:workspai project workspace status --json',
        WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent,
        `workspace:${WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalIndex}`,
        `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}`,
        `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}`,
        `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.model}`,
        `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}`,
        'command:workspai workspace graph search <task-query> --scope project:<project> --limit 12 --json',
        'source:targeted-live-files',
      ],
      sourcePolicy: {
        liveSourceAuthority: 'exact-implementation',
        workspaceEvidenceAuthority: 'identity-topology-readiness-goals',
        broadScanBeforeBootstrap: false,
        sourceMutation: 'governed-only',
        verificationClaims: 'cli-evidence-only',
      },
      degradedMode: {
        discloseMissingEvidence: true,
        allowCompleteArchitectureClaims: false,
        allowReadOnlySourceInspection: true,
      },
    },
    hosts: [...input.hosts].sort((left, right) => left.id.localeCompare(right.id)),
  };
  const manifest: ProjectAgentEntryManifest = {
    ...payload,
    integrity: {
      algorithm: 'sha256',
      projectContextHash: input.context.integrity.payloadHash,
      payloadHash: portableHash(payload),
      portable: true,
      absolutePathsEmitted: false,
    },
  };
  if (!isPortableValue(manifest)) {
    throw new Error('Project agent entry rejected a non-portable local path.');
  }
  assertJsonSchemaContract(
    manifest,
    'contracts/workspace-intelligence/project-agent-entry.v1.json',
    'Project agent entry'
  );
  return manifest;
}

function isPortableValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return !(
      /^[A-Za-z]:[\\/]/.test(value) ||
      /(?:^|[\s("'`])[A-Za-z]:[\\/]/.test(value) ||
      /(?:^|[\s("'`])file:\/\//i.test(value) ||
      /(?:^|[\s("'`])\\\\[^\\\s]+[\\]/.test(value) ||
      /(?:^|[\s("'`])\/(?:Users|home|private|var|opt|srv|mnt|Volumes|tmp)\//.test(value)
    );
  }
  if (Array.isArray(value)) return value.every(isPortableValue);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isPortableValue);
  }
  return true;
}

async function readAndValidateManifest(projectPath: string): Promise<ProjectAgentEntryManifest> {
  const manifestPath = path.join(projectPath, PROJECT_AGENT_ENTRY_RELATIVE_PATH);
  const manifest = JSON.parse(
    await fsp.readFile(manifestPath, 'utf8')
  ) as ProjectAgentEntryManifest;
  assertJsonSchemaContract(
    manifest,
    'contracts/workspace-intelligence/project-agent-entry.v1.json',
    'Project agent entry'
  );
  if (manifest.integrity.payloadHash !== portableHash(withoutIntegrity(manifest))) {
    throw new Error('Project agent entry integrity validation failed.');
  }
  assertCompleteHostMatrix(manifest.hosts);
  if (!isPortableValue(manifest) || manifest.integrity.absolutePathsEmitted) {
    throw new Error('Project agent entry contains a non-portable local path.');
  }
  return manifest;
}

async function readAndValidateProjectContext(projectPath: string): Promise<ProjectContextAgent> {
  const contextPath = path.join(projectPath, WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent);
  const context = JSON.parse(await fsp.readFile(contextPath, 'utf8')) as ProjectContextAgent;
  assertJsonSchemaContract(
    context,
    'contracts/workspace-intelligence/project-context-agent.v1.json',
    'Project context agent'
  );
  const rawWithoutIntegrity = withoutIntegrity(context);
  const legacyHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(rawWithoutIntegrity))
    .digest('hex');
  if (context.integrity.payloadHash !== legacyHash) {
    throw new Error('Project context agent integrity validation failed.');
  }
  if (!isPortableValue(context) || context.integrity.absolutePathsEmitted) {
    throw new Error('Project context agent contains a non-portable local path.');
  }
  return context;
}

function mergedStatus(statuses: readonly AgentEntryHostStatus[]): AgentEntryHostStatus {
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('degraded')) return 'degraded';
  return 'ready';
}

export async function buildAgentBootstrapReceipt(input: {
  startPath?: string;
  forAgent?: string;
  validateLiveInputs?: boolean;
  now?: Date;
}): Promise<AgentBootstrapReceipt> {
  const resolution = resolveProjectWorkspaceSync({
    startPath: path.resolve(input.startPath ?? process.cwd()),
    strict: true,
    requireProjectMembership: true,
  });
  if (!resolution?.projectPath) {
    throw new Error('No canonically bound Workspai project was resolved.');
  }
  const projectPath = resolution.projectPath;
  const workspacePath = resolution.workspacePath;
  const manifest = await readAndValidateManifest(projectPath);
  const context = await readAndValidateProjectContext(projectPath);
  if (
    manifest.integrity.projectContextHash !== context.integrity.payloadHash ||
    manifest.project.name !== context.project.name ||
    manifest.workspace.name !== context.workspace.name
  ) {
    throw new Error('Project agent entry is not bound to the current project context.');
  }

  const rawRequestedAgent = input.forAgent?.trim().toLowerCase() || 'generic';
  const verifyAllHosts = rawRequestedAgent === 'all';
  const resolvedHost: AgentEntryHostId | 'all' = verifyAllHosts
    ? 'all'
    : normalizeAgentEntryHost(rawRequestedAgent);
  const requestedAgent = resolvedHost;
  const selectedHosts = verifyAllHosts
    ? manifest.hosts
    : manifest.hosts.filter((candidate) => candidate.id === resolvedHost);
  const genericHost = manifest.hosts.find((candidate) => candidate.id === 'generic');
  if (selectedHosts.length === 0 && genericHost) selectedHosts.push(genericHost);
  if (selectedHosts.length === 0) {
    throw new Error('Project agent entry does not define generic host coverage.');
  }

  const checks: AgentBootstrapReceipt['checks'] = [];
  const check = (id: string, status: AgentEntryCheckStatus, message: string, artifact?: string) =>
    checks.push({ id, status, message, ...(artifact ? { artifact } : {}) });

  check('workspace-binding', 'passed', 'Canonical workspace membership is resolved.');
  check(
    'entry-integrity',
    'passed',
    'Project entry manifest integrity is valid.',
    PROJECT_AGENT_ENTRY_RELATIVE_PATH
  );
  check(
    'project-context-integrity',
    'passed',
    'Project context integrity and manifest binding are valid.',
    WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent
  );

  const entryFiles = [...new Set(selectedHosts.flatMap((host) => host.entryFiles))].sort();
  const missingHostFiles = entryFiles.filter(
    (relativePath) => !fs.existsSync(path.join(projectPath, relativePath))
  );
  const runtimeHostStatus: AgentEntryHostStatus =
    selectedHosts.some((host) => host.status === 'blocked') || missingHostFiles.length > 0
      ? 'blocked'
      : selectedHosts.some((host) => host.status === 'degraded')
        ? 'degraded'
        : 'ready';
  check(
    'host-discovery',
    runtimeHostStatus === 'ready'
      ? 'passed'
      : runtimeHostStatus === 'degraded'
        ? 'warning'
        : 'failed',
    runtimeHostStatus === 'ready'
      ? `${resolvedHost} has discoverable Workspai entry coverage.`
      : runtimeHostStatus === 'degraded'
        ? (selectedHosts.find((host) => host.reason)?.reason ??
          `${resolvedHost} entry coverage is degraded.`)
        : `${resolvedHost} entry coverage is missing required files.`,
    entryFiles[0]
  );

  const canonicalFiles = [
    WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph,
  ];
  const missingCanonical = canonicalFiles.filter(
    (relativePath) => !fs.existsSync(path.join(workspacePath, relativePath))
  );
  check(
    'canonical-evidence',
    missingCanonical.length === 0 ? 'passed' : 'failed',
    missingCanonical.length === 0
      ? 'Required canonical workspace evidence is present.'
      : `Required canonical evidence is missing: ${missingCanonical.join(', ')}.`
  );

  const invalidCanonical: string[] = [];
  let canonicalModel: Record<string, unknown> | null = null;
  let canonicalGraph: Record<string, unknown> | null = null;
  for (const relativePath of canonicalFiles) {
    if (missingCanonical.includes(relativePath)) continue;
    try {
      const payload = JSON.parse(
        await fsp.readFile(path.join(workspacePath, relativePath), 'utf8')
      );
      assertWorkspaceArtifactContract(relativePath, payload, relativePath);
      if (relativePath === WORKSPACE_INTELLIGENCE_ARTIFACTS.model) {
        canonicalModel = payload as Record<string, unknown>;
      }
      if (relativePath === WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph) {
        canonicalGraph = payload as Record<string, unknown>;
      }
    } catch {
      invalidCanonical.push(relativePath);
    }
  }
  check(
    'canonical-contracts',
    invalidCanonical.length === 0 ? 'passed' : 'failed',
    invalidCanonical.length === 0
      ? 'Canonical workspace evidence satisfies its published schemas.'
      : `Canonical evidence failed contract validation: ${invalidCanonical.join(', ')}.`
  );

  const modelWorkspace = canonicalModel?.workspace as Record<string, unknown> | undefined;
  const graphWorkspace = canonicalGraph?.workspace as Record<string, unknown> | undefined;
  const modelProjects = Array.isArray(canonicalModel?.projects)
    ? (canonicalModel.projects as Array<Record<string, unknown>>)
    : [];
  const canonicalMembershipValid =
    invalidCanonical.length === 0 &&
    modelWorkspace?.name === context.workspace.name &&
    graphWorkspace?.name === context.workspace.name &&
    modelProjects.some((project) => project.name === context.project.name);
  check(
    'canonical-project-membership',
    canonicalMembershipValid ? 'passed' : 'failed',
    canonicalMembershipValid
      ? 'The project and workspace identities agree across the entry, Model, and Graph.'
      : 'The project or workspace identity is missing or inconsistent in canonical evidence.'
  );

  const freshnessStatus: AgentEntryCheckStatus =
    !context.intelligence.freshness.graphMatchesModel ||
    ['missing', 'stale'].includes(context.intelligence.freshness.model) ||
    ['missing', 'stale'].includes(context.intelligence.freshness.graph)
      ? 'failed'
      : context.intelligence.freshness.model === 'unknown' ||
          context.intelligence.freshness.graph === 'unknown'
        ? 'warning'
        : 'passed';

  let liveInputsValidated = false;
  let liveInputCheck: AgentBootstrapReceipt['checks'][number];
  if (input.validateLiveInputs !== false) {
    try {
      const snapshot = await readWorkspaceKnowledgeGraphSnapshot(workspacePath);
      liveInputsValidated = snapshot.status === 'hit';
      const liveInputMessage =
        snapshot.status === 'hit'
          ? 'Live project inputs match the persisted Model and Knowledge Graph snapshot.'
          : `Live project inputs require an intelligence refresh (${snapshot.reason}).`;
      liveInputCheck = {
        id: 'live-inputs',
        status: liveInputsValidated ? 'passed' : 'failed',
        message: liveInputMessage,
      };
    } catch {
      liveInputCheck = {
        id: 'live-inputs',
        status: 'failed',
        message: 'Live project inputs could not be validated against canonical graph evidence.',
      };
    }
  } else {
    liveInputCheck = {
      id: 'live-inputs',
      status: 'warning',
      message: 'Live input validation was skipped; persisted compatibility was checked only.',
    };
  }
  const effectiveFreshnessStatus =
    freshnessStatus === 'warning' &&
    context.intelligence.freshness.model === 'unknown' &&
    context.intelligence.freshness.graph === 'fresh' &&
    context.intelligence.freshness.graphMatchesModel &&
    liveInputsValidated
      ? 'passed'
      : freshnessStatus;
  check(
    'persisted-freshness',
    effectiveFreshnessStatus,
    effectiveFreshnessStatus === 'passed'
      ? context.intelligence.freshness.model === 'unknown'
        ? 'Model and Graph bindings are current; live input validation closes structural freshness while verify-before-use facts remain individually governed.'
        : 'Persisted Model and Knowledge Graph bindings are current.'
      : effectiveFreshnessStatus === 'warning'
        ? 'Persisted evidence is compatible, but at least one freshness state is unknown.'
        : 'Persisted Model or Knowledge Graph evidence is missing, stale, or mismatched.'
  );
  checks.push(liveInputCheck);

  let activeGoal: AgentBootstrapReceipt['activeGoal'] = {
    present: false,
    appliesToProject: false,
    status: 'none',
  };
  const goalRecoveryActions: string[] = [];
  const goalIndexPath = path.join(workspacePath, WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalIndex);
  if (fs.existsSync(goalIndexPath)) {
    let unvalidatedLifecycle: Awaited<ReturnType<typeof inspectGoalLifecycle>> | null = null;
    try {
      unvalidatedLifecycle = await inspectGoalLifecycle({
        workspacePath,
        validateBindings: false,
      });
    } catch {
      goalRecoveryActions.push('workspai goal --list --json');
      check('active-goal', 'failed', 'The Goal index is present but invalid.');
    }
    if (unvalidatedLifecycle?.active) {
      const appliesToProject = unvalidatedLifecycle.active.scope.projects.includes(
        context.project.name
      );
      activeGoal = {
        present: true,
        appliesToProject,
        status: 'invalid',
        id: unvalidatedLifecycle.active.id,
        objective: unvalidatedLifecycle.active.objective,
        lifecycle: unvalidatedLifecycle.active.lifecycle,
        goalPack: `workspace:${unvalidatedLifecycle.active.goalPack}`,
        agentHandoff: `workspace:${unvalidatedLifecycle.active.agentHandoff}`,
      };
    }
    if (unvalidatedLifecycle)
      try {
        const lifecycle = await inspectGoalLifecycle({ workspacePath, validateBindings: true });
        if (lifecycle.active) {
          const appliesToProject = lifecycle.active.scope.projects.includes(context.project.name);
          activeGoal = {
            present: true,
            appliesToProject,
            status: 'ready',
            id: lifecycle.active.id,
            objective: lifecycle.active.objective,
            lifecycle: lifecycle.active.lifecycle,
            goalPack: `workspace:${lifecycle.active.goalPack}`,
            agentHandoff: `workspace:${lifecycle.active.agentHandoff}`,
          };
        }
        check(
          'active-goal',
          'passed',
          lifecycle.active
            ? 'The active Goal Pack and agent handoff have valid canonical bindings.'
            : 'No active Goal Pack is selected.'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stale = activeGoal.present && /\bstale\b|--refresh/i.test(message);
        if (activeGoal.present) activeGoal.status = stale ? 'stale' : 'invalid';
        if (stale && activeGoal.objective) {
          const activeEntry = unvalidatedLifecycle.active;
          const scope =
            activeEntry?.scope.kind === 'project' && activeEntry.scope.projects.length === 1
              ? `project:${activeEntry.scope.projects[0]}`
              : 'workspace';
          goalRecoveryActions.push(
            `workspai goal ${JSON.stringify(activeGoal.objective)} --scope ${scope} --for-agent generic --refresh --json`
          );
        } else {
          goalRecoveryActions.push('workspai goal --status --json');
        }
        check(
          'active-goal',
          'failed',
          stale
            ? 'The selected Goal Pack is present but stale; regenerate it against current canonical evidence before acting.'
            : activeGoal.present
              ? 'The selected Goal Pack is present but its canonical binding or handoff is invalid.'
              : 'The Goal index could not be validated.'
        );
      }
  } else {
    check('active-goal', 'passed', 'No Goal index is present for this workspace.');
  }

  const evidenceStatus: AgentEntryHostStatus = checks.some((item) => item.status === 'failed')
    ? 'blocked'
    : checks.some((item) => item.status === 'warning')
      ? 'degraded'
      : 'ready';
  const status = mergedStatus([runtimeHostStatus, evidenceStatus]);
  const resolvedBootstrapCommand = `command:workspai agent bootstrap --for-agent ${resolvedHost} --strict --json`;
  const requiredReadOrder = manifest.protocol.requiredReadOrder.map((entry) =>
    entry === 'command:workspai agent bootstrap --for-agent generic --strict --json'
      ? resolvedBootstrapCommand
      : entry
  );
  const payloadWithoutIdentity = {
    schemaVersion: AGENT_BOOTSTRAP_RECEIPT_SCHEMA_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    status,
    requestedAgent,
    resolvedHost,
    project: {
      name: context.project.name,
      relativePath: context.project.relativePath,
      ...(context.project.runtime ? { runtime: context.project.runtime } : {}),
      ...(context.project.framework ? { framework: context.project.framework } : {}),
    },
    workspace: {
      name: context.workspace.name,
      relationship: context.workspace.relationship,
      resolved: true as const,
      identityIsFilesystemPath: false as const,
      resolverCommand: 'workspai project workspace status --json' as const,
      portableUriScheme: 'workspace:' as const,
      resolvedPathPolicy: 'runtime-private-never-persist' as const,
    },
    entry: {
      artifact: PROJECT_AGENT_ENTRY_RELATIVE_PATH,
      schemaVersion: PROJECT_AGENT_ENTRY_SCHEMA_VERSION,
      hostStatus: runtimeHostStatus,
      entryFiles,
    },
    canonicalEvidence: {
      projectContext: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent,
      workspaceIndex: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}` as const,
      workspaceContext: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}` as const,
      workspaceModel: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.model}` as const,
      knowledgeGraph: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}` as const,
      modelFreshness: context.intelligence.freshness.model,
      graphFreshness: context.intelligence.freshness.graph,
      graphMatchesModel: context.intelligence.freshness.graphMatchesModel,
      liveInputsValidated,
      blockerCount: context.blockers.length,
    },
    activeGoal,
    requiredReadOrder,
    claims: {
      architecture:
        status === 'ready' ? ('allowed-with-citations' as const) : ('prohibited' as const),
      sourceInspection: 'bounded-and-targeted' as const,
      sourceMutation: 'governed-cli-transaction-only' as const,
      verification: 'cli-evidence-only' as const,
    },
    checks,
    nextActions:
      status === 'ready'
        ? [
            ...(activeGoal.present && activeGoal.appliesToProject && activeGoal.agentHandoff
              ? [`read:${activeGoal.agentHandoff}`]
              : []),
            `workspai workspace graph search <task-query> --scope project:${context.project.name} --limit 12 --json`,
            'inspect only the returned proof paths and target source files',
          ]
        : [
            ...goalRecoveryActions,
            'workspai workspace intelligence run --for-agent generic --strict --json',
            `workspai agent bootstrap --for-agent ${resolvedHost} --strict --json`,
          ],
  };
  const manifestHash = portableHash(withoutIntegrity(manifest));
  const receiptId = portableHash({
    manifestHash,
    projectContextHash: context.integrity.payloadHash,
    requestedAgent,
    status,
    generatedAt: payloadWithoutIdentity.generatedAt,
  });
  const receiptPayload = { ...payloadWithoutIdentity, receiptId };
  const receipt: AgentBootstrapReceipt = {
    ...receiptPayload,
    integrity: {
      algorithm: 'sha256',
      manifestHash,
      projectContextHash: context.integrity.payloadHash,
      payloadHash: portableHash(receiptPayload),
      portable: true,
      absolutePathsEmitted: false,
    },
  };
  if (!isPortableValue(receipt)) {
    throw new Error('Agent bootstrap receipt rejected a non-portable local path.');
  }
  assertJsonSchemaContract(
    receipt,
    'contracts/workspace-intelligence/agent-bootstrap-receipt.v1.json',
    'Agent bootstrap receipt'
  );
  return receipt;
}
