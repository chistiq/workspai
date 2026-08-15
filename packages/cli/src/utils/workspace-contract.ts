import path from 'path';
import fsExtra from 'fs-extra';

import { attachRunCorrelation } from '../observability/run-correlation.js';
import { auditWorkspaceModulePaths } from './module-layout.js';
import {
  readImportedProjectsRegistry,
  type ImportedProjectRegistryEntry,
} from '../imported-projects-registry.js';
import {
  firstExistingWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath,
  withWorkspaceArtifactLock,
  writeWorkspaceArtifactJson,
} from './artifact-path-compat.js';
import { assertWorkspaceArtifactContract } from '../contracts/artifact-contract-registry.js';
import { projectMetadataCandidates, workspaceMetadataCandidates } from './workspace-paths.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';
import {
  resolveProjectCommandCapabilities,
  type ProjectCommandCapabilities,
} from './project-command-capabilities.js';
import {
  WORKSPACE_GRAPH_EDGE_KINDS,
  WORKSPACE_GRAPH_EDGE_SOURCES,
  type WorkspaceDependencyGraph,
  type WorkspaceGraphEdgeKind,
  type WorkspaceGraphEdgeSource,
  type WorkspaceGraphNodeOperationalProfile,
} from '../contracts/workspace-dependency-graph-contract.js';
import type { WorkspaceKnowledgeGraph } from '../contracts/workspace-knowledge-graph-contract.js';
import { isPythonVirtualEnvironmentDirectory } from './workspace-scan-policy.js';

export const WORKSPACE_CONTRACT_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract;
export const WORKSPACE_CONTRACT_VERIFY_REPORT_PATH =
  WORKSPACE_INTELLIGENCE_ARTIFACTS.contractVerify;
export const WORKSPACE_CONTRACT_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceContract.schemaVersion;
export const WORKSPACE_CONTRACT_VERIFY_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.contractVerify;

export type WorkspaceContractVerifyEvidence = {
  schemaVersion: typeof WORKSPACE_CONTRACT_VERIFY_SCHEMA_VERSION;
  generatedAt: string;
  status: 'passed' | 'failed';
  contractPath: string;
  projectCount: number;
  checks: WorkspaceContractVerificationResult['checks'];
  violations: string[];
};

export interface WorkspaceContractPort {
  name: string;
  port: number;
  protocol: 'http' | 'https' | 'grpc' | 'tcp' | 'udp';
}

export interface WorkspaceContractApi {
  name: string;
  basePath: string;
}

export interface WorkspaceContractProject {
  slug: string;
  relativePath: string;
  source?: 'workspace' | 'local-folder' | 'git-url' | 'adopted-local';
  relationship?: 'imported' | 'adopted';
  externalPath?: string;
  runtime?: string;
  framework?: string;
  kit?: string;
  modules: string[];
  ports: WorkspaceContractPort[];
  contracts: {
    owns: string[];
    apis: WorkspaceContractApi[];
    publishes: string[];
    consumes: string[];
    dependsOn: string[];
    env: string[];
  };
}

export interface WorkspaceContract {
  schemaVersion: typeof WORKSPACE_CONTRACT_SCHEMA_VERSION;
  kind: 'rapidkit.workspace.contract';
  generatedAt: string;
  workspace: {
    name: string;
    profile?: string;
  };
  projects: WorkspaceContractProject[];
}

export interface WorkspaceContractVerificationResult {
  status: 'passed' | 'failed';
  contractPath: string;
  projectCount: number;
  checks: Array<{ id: string; status: 'passed' | 'failed'; message: string }>;
  violations: string[];
}

export interface WorkspaceContractSyncResult {
  contractPath: string;
  contract: WorkspaceContract;
  addedProjects: string[];
  updatedProjects: string[];
  verification: WorkspaceContractVerificationResult;
}

export class WorkspaceContractVerificationError extends Error {
  constructor(public readonly verification: WorkspaceContractVerificationResult) {
    super(`Workspace contract verification failed: ${verification.violations.join('; ')}`);
    this.name = 'WorkspaceContractVerificationError';
  }
}

export interface WorkspaceContractGraphNode {
  id: string;
  label: string;
  relativePath: string;
  source?: WorkspaceContractProject['source'];
  relationship?: WorkspaceContractProject['relationship'];
  externalPath?: string;
  runtime?: string;
  framework?: string;
  kit?: string;
  modules: string[];
  ports: WorkspaceContractPort[];
  apis: WorkspaceContractApi[];
  owns: string[];
  env: string[];
  contracts: WorkspaceContractProject['contracts'];
  capabilities: {
    engine: ProjectCommandCapabilities['engine'];
    supportTier: ProjectCommandCapabilities['frameworkSupportTier'];
    runtimeSupportTier: ProjectCommandCapabilities['runtimeSupportTier'];
    doctorSupport: ProjectCommandCapabilities['runtimeDoctorSupport'];
    moduleSupport: boolean;
    fleetStages: string[];
    localOnlyCommands: string[];
    supportedCommands: string[];
  };
  files: {
    metadata: string[];
    manifests: string[];
    entrypoints: string[];
    apiSpecifications: string[];
    infrastructure: string[];
    documentation: string[];
  };
  package?: {
    name?: string;
    version?: string;
    private?: boolean;
    scripts: string[];
    dependencies: {
      runtime: string[];
      development: string[];
      peer: string[];
      optional: string[];
    };
    dependencyCount: number;
  };
  operationalProfile?: WorkspaceGraphNodeOperationalProfile;
}

export interface WorkspaceContractGraphEdge {
  from: string;
  to: string;
  type: 'dependency' | 'event';
  label: string;
}

export interface WorkspaceContractGraph {
  schemaVersion: 1;
  kind: 'rapidkit.workspace.contract.graph';
  workspace: WorkspaceContract['workspace'];
  generatedAt: string;
  nodes: WorkspaceContractGraphNode[];
  edges: WorkspaceContractGraphEdge[];
  /**
   * Evidence-backed canonical dependency projection. The legacy `edges` field
   * remains producer-to-consumer for compatibility; this projection follows
   * workspace-dependency-graph.v1 semantics (`from` depends on `to`).
   */
  dependencyGraph: WorkspaceDependencyGraph;
  /** Rich evidence-backed workspace view; dependencyGraph is its project topology projection. */
  knowledgeGraph: WorkspaceKnowledgeGraph;
  semantics: {
    legacyEdges: 'producer-to-consumer';
    dependencyGraphEdges: 'consumer-to-dependency';
  };
  summary: {
    projectCount: number;
    dependencyEdges: number;
    eventEdges: number;
    portCount: number;
    apiCount: number;
    relationshipEdges: number;
    inferredEdges: number;
    authoritativeEdges: number;
    orphanProjects: number;
    hotspotProjects: number;
    evidenceCoverageRatio: number;
    edgeCoverageRatio: number;
    connectedProjects: number;
    lowConfidenceEdges: number;
    hasCycle: boolean;
    manifestCount: number;
    entrypointCount: number;
    diagnostics: number;
    relationshipKinds: Record<WorkspaceGraphEdgeKind, number>;
    relationshipSources: Record<WorkspaceGraphEdgeSource, number>;
    entityCount: number;
    knowledgeRelations: number;
    proofCount: number;
    providerCount: number;
    knowledgeUnknowns: number;
  };
}

function toPosixPath(input: string): string {
  return input.replace(/\\/g, '/');
}

function isSafeContractRelativePath(inputPath: string): boolean {
  const normalized = toPosixPath(inputPath).trim();
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('~')) {
    return false;
  }
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.includes('\0')) {
    return false;
  }
  return !normalized
    .split('/')
    .filter(Boolean)
    .some((segment) => segment === '..' || segment === '.');
}

function normalizeProjectSlug(raw: string, fallback: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeProjectPorts(payload: Record<string, unknown>): WorkspaceContractPort[] {
  const explicitPorts = Array.isArray(payload.ports) ? payload.ports : [];
  const normalized = explicitPorts
    .map((entry): WorkspaceContractPort | null => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const port = Number(record.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      const protocol =
        record.protocol === 'https' ||
        record.protocol === 'grpc' ||
        record.protocol === 'tcp' ||
        record.protocol === 'udp'
          ? record.protocol
          : 'http';
      return {
        name: typeof record.name === 'string' && record.name.trim() ? record.name : 'http',
        port,
        protocol,
      };
    })
    .filter((entry): entry is WorkspaceContractPort => entry !== null);
  if (normalized.length > 0) return normalized;

  const frontend =
    payload.frontend && typeof payload.frontend === 'object' && !Array.isArray(payload.frontend)
      ? (payload.frontend as Record<string, unknown>)
      : undefined;
  const scalarPort = Number(payload.port ?? frontend?.default_port);
  return Number.isInteger(scalarPort) && scalarPort >= 1 && scalarPort <= 65535
    ? [{ name: 'http', port: scalarPort, protocol: 'http' }]
    : [];
}

async function discoverDockerPorts(projectPath: string): Promise<WorkspaceContractPort[]> {
  const dockerfile = path.join(projectPath, 'Dockerfile');
  if (!(await fsExtra.pathExists(dockerfile))) return [];
  try {
    const contents = await fsExtra.readFile(dockerfile, 'utf8');
    const ports = new Map<number, WorkspaceContractPort>();
    for (const line of contents.matchAll(/^\s*EXPOSE\s+(.+)$/gim)) {
      for (const token of line[1].split(/\s+/)) {
        const match = token.match(/^(\d{1,5})(?:\/(tcp|udp))?$/i);
        const port = Number(match?.[1]);
        if (!match || !Number.isInteger(port) || port < 1 || port > 65535) continue;
        const transport = match[2]?.toLowerCase();
        ports.set(port, {
          name: 'http',
          port,
          protocol: transport === 'udp' ? 'udp' : 'http',
        });
      }
    }
    return [...ports.values()].sort((left, right) => left.port - right.port);
  } catch {
    return [];
  }
}

async function firstExistingFile(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fsExtra.pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function readWorkspaceMetadata(
  workspacePath: string
): Promise<{ name: string; profile?: string }> {
  for (const workspaceJsonPath of workspaceMetadataCandidates(workspacePath, 'workspace.json')) {
    try {
      const payload = (await fsExtra.readJson(workspaceJsonPath)) as Record<string, unknown>;
      const name =
        (typeof payload.workspace_name === 'string' && payload.workspace_name.trim()) ||
        (typeof payload.name === 'string' && payload.name.trim()) ||
        path.basename(workspacePath);
      return {
        name,
        profile: typeof payload.profile === 'string' ? payload.profile : undefined,
      };
    } catch {
      // Try the next metadata generation.
    }
  }
  return { name: path.basename(workspacePath) };
}

export async function discoverProjectJsonFiles(workspacePath: string): Promise<string[]> {
  const results: string[] = [];
  const queue = [workspacePath];
  const visited = new Set<string>();
  const ignored = new Set([
    '.git',
    '.workspai',
    '.rapidkit',
    'node_modules',
    '.venv',
    'venv',
    'dist',
    'build',
    'target',
    '.next',
    '.turbo',
    '.cache',
  ]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const projectJson = await firstExistingFile(projectMetadataCandidates(current, 'project.json'));
    const contextJson = await firstExistingFile(projectMetadataCandidates(current, 'context.json'));
    if (projectJson || contextJson) {
      results.push(projectJson ?? contextJson ?? '');
      continue;
    }

    let entries: fsExtra.Dirent[];
    try {
      entries = await fsExtra.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        ignored.has(entry.name) ||
        isPythonVirtualEnvironmentDirectory(entry.name)
      )
        continue;
      queue.push(path.join(current, entry.name));
    }
  }

  return results.sort();
}

function projectKindFromKit(kit?: string): string | undefined {
  const value = (kit || '').toLowerCase();
  if (value.includes('fastapi')) return 'fastapi';
  if (value.includes('nestjs')) return 'nestjs';
  if (value.includes('springboot')) return 'springboot';
  if (value.includes('gofiber')) return 'fiber';
  if (value.includes('gogin')) return 'gin';
  return undefined;
}

function defaultPortForKit(kit?: string, runtime?: string): number | null {
  const value = (kit || '').toLowerCase();
  const runtimeValue = (runtime || '').toLowerCase();
  if (value.includes('vscode-extension')) return null;
  if (value.includes('fastapi')) return 8000;
  if (value.includes('nestjs')) return 3000;
  if (value.includes('springboot')) return 8080;
  if (value.includes('gofiber')) return 3000;
  if (value.includes('gogin')) return 8080;
  if (value.startsWith('adopted.')) return null;
  if (runtimeValue === 'node') return 3000;
  if (runtimeValue === 'python') return 8000;
  if (runtimeValue === 'java') return 8080;
  if (runtimeValue === 'go') return 8080;
  return null;
}

function nextAvailablePort(preferred: number, usedPorts: Set<number>): number {
  let port = preferred;
  while (usedPorts.has(port) && port < 65535) {
    port += 1;
  }
  return port;
}

function mergeProjectContract(
  existing: WorkspaceContractProject | undefined,
  discovered: WorkspaceContractProject,
  usedPorts: Set<number>
): { project: WorkspaceContractProject; changed: boolean } {
  const preserveExistingIdentity = existing !== undefined && existing.source === undefined;
  const preferredPort = defaultPortForKit(discovered.kit, discovered.runtime);
  const existingPorts = existing?.ports || [];
  const discoveredPorts = discovered.ports || [];
  const nonServiceExtension = (discovered.kit || '').toLowerCase().includes('vscode-extension');
  const refreshAdoptedPorts =
    discovered.source === 'adopted-local' && existing?.source === 'adopted-local';
  const refreshAdoptedMetadata = refreshAdoptedPorts;
  const selectedPorts =
    nonServiceExtension && discoveredPorts.length === 0
      ? []
      : refreshAdoptedPorts
        ? discoveredPorts.length > 0
          ? discoveredPorts
          : preferredPort
            ? [
                {
                  name: 'http',
                  port: nextAvailablePort(preferredPort, usedPorts),
                  protocol: 'http' as const,
                },
              ]
            : []
        : existingPorts.length > 0
          ? existingPorts
          : discoveredPorts.length > 0
            ? discoveredPorts
            : preferredPort
              ? [
                  {
                    name: 'http',
                    port: nextAvailablePort(preferredPort, usedPorts),
                    protocol: 'http' as const,
                  },
                ]
              : [];
  const ports = selectedPorts.map((port) => ({
    ...port,
    port: nextAvailablePort(port.port, usedPorts),
  }));

  for (const port of ports) {
    usedPorts.add(port.port);
  }

  const project: WorkspaceContractProject = {
    ...discovered,
    ...existing,
    slug: existing?.slug || discovered.slug,
    relativePath:
      preserveExistingIdentity &&
      existing?.relativePath &&
      isSafeContractRelativePath(existing.relativePath)
        ? existing.relativePath
        : discovered.relativePath,
    source: preserveExistingIdentity ? existing?.source || discovered.source : discovered.source,
    relationship: preserveExistingIdentity
      ? existing?.relationship || discovered.relationship
      : discovered.relationship,
    externalPath: preserveExistingIdentity
      ? existing?.externalPath || discovered.externalPath
      : discovered.externalPath,
    runtime: refreshAdoptedMetadata ? discovered.runtime : existing?.runtime || discovered.runtime,
    framework: refreshAdoptedMetadata
      ? discovered.framework
      : existing?.framework || discovered.framework,
    kit: refreshAdoptedMetadata ? discovered.kit : existing?.kit || discovered.kit,
    modules: existing?.modules?.length ? existing.modules : discovered.modules,
    ports,
    contracts: {
      owns: existing?.contracts?.owns || [],
      apis: existing?.contracts?.apis || [],
      publishes: existing?.contracts?.publishes || [],
      consumes: existing?.contracts?.consumes || [],
      dependsOn: existing?.contracts?.dependsOn || [],
      env: existing?.contracts?.env || [],
    },
  };

  const changed = JSON.stringify(existing || null) !== JSON.stringify(project);
  return { project, changed };
}

export async function buildWorkspaceContract(input: {
  workspacePath: string;
  now?: Date;
}): Promise<WorkspaceContract> {
  const workspacePath = path.resolve(input.workspacePath);
  const workspace = await readWorkspaceMetadata(workspacePath);
  const projectJsonFiles = await discoverProjectJsonFiles(workspacePath);
  const importedProjects = await readImportedProjectsRegistry(workspacePath);
  const externalProjectJsonFiles: Array<{
    projectJsonPath: string;
    registryEntry: ImportedProjectRegistryEntry;
  }> = [];
  for (const project of importedProjects) {
    const projectPath = path.resolve(project.path);
    const metadataPath =
      (await firstExistingFile(projectMetadataCandidates(projectPath, 'project.json'))) ??
      (await firstExistingFile(projectMetadataCandidates(projectPath, 'context.json')));
    if (
      !metadataPath ||
      projectJsonFiles.some((item) => path.resolve(item) === path.resolve(metadataPath))
    ) {
      continue;
    }
    externalProjectJsonFiles.push({ projectJsonPath: metadataPath, registryEntry: project });
  }
  const projects: WorkspaceContractProject[] = [];
  const projectInputs: Array<{
    projectJsonPath: string;
    registryEntry?: ImportedProjectRegistryEntry;
  }> = [
    ...projectJsonFiles.map((projectJsonPath) => ({ projectJsonPath })),
    ...externalProjectJsonFiles,
  ];

  for (const { projectJsonPath, registryEntry } of projectInputs) {
    const projectPath = path.dirname(path.dirname(projectJsonPath));
    const discoveredRelativePath = toPosixPath(path.relative(workspacePath, projectPath));
    const isExternalProject =
      registryEntry !== undefined && !isSafeContractRelativePath(discoveredRelativePath);
    const contractSlug = normalizeProjectSlug(
      registryEntry?.name || path.basename(projectPath),
      path.basename(projectPath)
    );
    const relativePath = isExternalProject
      ? `external/${contractSlug}`
      : discoveredRelativePath || contractSlug;
    const payload = (await fsExtra.readJson(projectJsonPath)) as Record<string, unknown>;
    const kit =
      (typeof payload.kit_name === 'string' && payload.kit_name) ||
      (typeof payload.kit === 'string' && payload.kit) ||
      undefined;
    const framework =
      (typeof payload.framework === 'string' && payload.framework) || projectKindFromKit(kit);

    projects.push({
      slug: registryEntry?.name || relativePath || path.basename(projectPath),
      relativePath,
      source: registryEntry?.source ?? 'workspace',
      relationship: registryEntry?.relationship,
      externalPath: isExternalProject ? projectPath : undefined,
      runtime: typeof payload.runtime === 'string' ? payload.runtime : undefined,
      framework,
      kit,
      modules: normalizeStringArray(payload.modules),
      ports:
        normalizeProjectPorts(payload).length > 0
          ? normalizeProjectPorts(payload)
          : await discoverDockerPorts(projectPath),
      contracts: {
        owns: [],
        apis: [],
        publishes: [],
        consumes: [],
        dependsOn: [],
        env: [],
      },
    });
  }

  const projectsBySlug = new Map<string, WorkspaceContractProject>();
  for (const project of projects) {
    const key = normalizeProjectSlug(project.slug, project.relativePath);
    const existing = projectsBySlug.get(key);
    if (!existing || (existing.source !== 'workspace' && project.source === 'workspace')) {
      projectsBySlug.set(key, project);
    }
  }

  return {
    schemaVersion: WORKSPACE_CONTRACT_SCHEMA_VERSION,
    kind: 'rapidkit.workspace.contract',
    generatedAt: (input.now ?? new Date()).toISOString(),
    workspace,
    projects: [...projectsBySlug.values()],
  };
}

export async function writeWorkspaceContract(input: {
  workspacePath: string;
  outputPath?: string;
  force?: boolean;
  now?: Date;
  strict?: boolean;
}): Promise<{ contractPath: string; contract: WorkspaceContract }> {
  const contractPath = path.resolve(
    input.outputPath || resolveWorkspaceArtifactPath(input.workspacePath, WORKSPACE_CONTRACT_PATH)
  );
  if ((await fsExtra.pathExists(contractPath)) && input.force !== true) {
    throw new Error(
      `Workspace contract already exists: ${contractPath}. Use --force to overwrite.`
    );
  }
  const discovered = await buildWorkspaceContract({
    workspacePath: input.workspacePath,
    now: input.now,
  });
  const usedPorts = new Set<number>();
  const contract: WorkspaceContract = {
    ...discovered,
    projects: discovered.projects.map(
      (project) => mergeProjectContract(undefined, project, usedPorts).project
    ),
  };
  const verification = await verifyWorkspaceContract({
    workspacePath: input.workspacePath,
    contractPath,
    contract,
  });
  if (input.strict && verification.status === 'failed') {
    throw new WorkspaceContractVerificationError(verification);
  }
  await publishWorkspaceContractArtifacts({
    workspacePath: input.workspacePath,
    contractPath,
    contract,
    now: input.now,
  });
  return { contractPath, contract };
}

export async function syncWorkspaceContract(input: {
  workspacePath: string;
  now?: Date;
  strict?: boolean;
}): Promise<WorkspaceContractSyncResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const contractPath = resolveWorkspaceArtifactPath(workspacePath, WORKSPACE_CONTRACT_PATH);
  const existingContractPath =
    (await firstExistingWorkspaceArtifactPath(workspacePath, WORKSPACE_CONTRACT_PATH)) ??
    contractPath;
  const discovered = await buildWorkspaceContract({ workspacePath, now: input.now });
  const existing = (await fsExtra.pathExists(existingContractPath))
    ? ((await fsExtra.readJson(existingContractPath)) as WorkspaceContract)
    : null;
  const existingBySlug = new Map(
    (existing?.projects || []).map((project) => [project.slug, project])
  );
  const usedPorts = new Set<number>();
  const addedProjects: string[] = [];
  const updatedProjects: string[] = [];
  const projects: WorkspaceContractProject[] = [];

  for (const project of discovered.projects) {
    const existingProject = existingBySlug.get(project.slug);
    const merged = mergeProjectContract(existingProject, project, usedPorts);
    if (!existingProject) {
      addedProjects.push(project.slug);
    } else if (merged.changed) {
      updatedProjects.push(project.slug);
    }
    projects.push(merged.project);
    existingBySlug.delete(project.slug);
  }

  for (const project of existingBySlug.values()) {
    // Entries managed by discovery/import registries must disappear when their
    // source disappears (archive/delete/import removal). Source-less entries are
    // treated as manually declared contract records and remain authoritative.
    if (project.source) {
      continue;
    }
    const merged = mergeProjectContract(project, project, usedPorts);
    projects.push(merged.project);
  }

  const contract: WorkspaceContract = {
    schemaVersion: WORKSPACE_CONTRACT_SCHEMA_VERSION,
    kind: 'rapidkit.workspace.contract',
    generatedAt: (input.now ?? new Date()).toISOString(),
    workspace: {
      ...(existing?.workspace || {}),
      ...discovered.workspace,
      name: discovered.workspace.name || existing?.workspace?.name || path.basename(workspacePath),
    },
    projects: projects.sort((a, b) => a.slug.localeCompare(b.slug)),
  };

  const verification = await verifyWorkspaceContract({
    workspacePath,
    contractPath,
    contract,
  });
  if (input.strict && verification.status === 'failed') {
    throw new WorkspaceContractVerificationError(verification);
  }
  await publishWorkspaceContractArtifacts({
    workspacePath,
    contractPath,
    contract,
    now: input.now,
  });
  return { contractPath, contract, addedProjects, updatedProjects, verification };
}

type ArtifactPreimage = { exists: false } | { exists: true; contents: Buffer };

async function captureArtifactPreimage(artifactPath: string): Promise<ArtifactPreimage> {
  if (!(await fsExtra.pathExists(artifactPath))) {
    return { exists: false };
  }
  return { exists: true, contents: await fsExtra.readFile(artifactPath) };
}

async function restoreArtifactPreimage(
  artifactPath: string,
  preimage: ArtifactPreimage
): Promise<void> {
  if (!preimage.exists) {
    await fsExtra.remove(artifactPath);
    return;
  }
  await fsExtra.outputFile(artifactPath, preimage.contents);
}

async function publishWorkspaceContractArtifacts(input: {
  workspacePath: string;
  contractPath: string;
  contract: WorkspaceContract;
  now?: Date;
}): Promise<void> {
  const { buildWorkspaceRegistrySummary, WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH } =
    await import('./workspace-registry-summary.js');
  const summary = await buildWorkspaceRegistrySummary(input.workspacePath, {
    now: input.now,
    contract: input.contract,
  });

  // `workspace sync` is part of the pre-model preparation path. Rewriting the
  // canonical inputs solely to advance generatedAt makes the chain observe its
  // own execution as a workspace change. When both durable projections are
  // already semantically current, preserve their bytes and timestamps.
  const summaryPath = resolveWorkspaceArtifactPath(
    input.workspacePath,
    WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH
  );
  const semanticPayload = (value: unknown): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return JSON.stringify(value);
    }
    const { generatedAt: _generatedAt, ...rest } = value as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  if ((await fsExtra.pathExists(input.contractPath)) && (await fsExtra.pathExists(summaryPath))) {
    const [currentContract, currentSummary] = await Promise.all([
      fsExtra.readJson(input.contractPath),
      fsExtra.readJson(summaryPath),
    ]);
    if (
      semanticPayload(currentContract) === semanticPayload(input.contract) &&
      semanticPayload(currentSummary) === semanticPayload(summary)
    ) {
      return;
    }
  }

  // Validate both candidates before either canonical artifact is replaced.
  assertWorkspaceArtifactContract(WORKSPACE_CONTRACT_PATH, input.contract);
  assertWorkspaceArtifactContract(WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH, summary);

  await withWorkspaceArtifactLock(input.workspacePath, WORKSPACE_CONTRACT_PATH, async () => {
    const [contractPreimage, summaryPreimage] = await Promise.all([
      captureArtifactPreimage(input.contractPath),
      captureArtifactPreimage(summaryPath),
    ]);

    try {
      if (
        input.contractPath ===
        resolveWorkspaceArtifactPath(input.workspacePath, WORKSPACE_CONTRACT_PATH)
      ) {
        await writeWorkspaceArtifactJson(
          input.workspacePath,
          WORKSPACE_CONTRACT_PATH,
          input.contract
        );
      } else {
        await fsExtra.ensureDir(path.dirname(input.contractPath));
        await fsExtra.writeJson(input.contractPath, input.contract, { spaces: 2 });
      }
      if (process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH === '1') {
        throw new Error('Injected workspace registry summary publication failure.');
      }
      await writeWorkspaceArtifactJson(
        input.workspacePath,
        WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH,
        summary
      );
    } catch (error) {
      const restorations = await Promise.allSettled([
        restoreArtifactPreimage(input.contractPath, contractPreimage),
        restoreArtifactPreimage(summaryPath, summaryPreimage),
      ]);
      const restorationFailures = restorations.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (restorationFailures.length > 0) {
        throw new AggregateError(
          [error, ...restorationFailures.map((result) => result.reason)],
          'Workspace contract publication failed and rollback was incomplete.'
        );
      }
      throw error;
    }
  });
}

export async function readWorkspaceContract(input: {
  workspacePath: string;
  contractPath?: string;
}): Promise<{ contractPath: string; contract: WorkspaceContract }> {
  const contractPath =
    input.contractPath ??
    ((await firstExistingWorkspaceArtifactPath(input.workspacePath, WORKSPACE_CONTRACT_PATH)) ||
      resolveWorkspaceArtifactPath(input.workspacePath, WORKSPACE_CONTRACT_PATH));
  const contract = (await fsExtra.readJson(contractPath)) as WorkspaceContract;
  return { contractPath, contract };
}

const GRAPH_FILE_CANDIDATES = {
  metadata: [
    '.workspai/project.json',
    '.workspai/context.json',
    '.rapidkit/project.json',
    '.rapidkit/context.json',
  ],
  manifests: [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'pyproject.toml',
    'poetry.lock',
    'requirements.txt',
    'go.mod',
    'go.sum',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'Cargo.toml',
    'Gemfile',
    'composer.json',
  ],
  entrypoints: [
    'src/main.ts',
    'src/index.ts',
    'src/app.ts',
    'src/main.js',
    'src/index.js',
    'main.py',
    'app/main.py',
    'manage.py',
    'main.go',
    'cmd/main.go',
    'Program.cs',
  ],
  apiSpecifications: [
    'openapi.yaml',
    'openapi.yml',
    'openapi.json',
    'swagger.yaml',
    'swagger.yml',
    'swagger.json',
  ],
  infrastructure: [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
    'k8s',
    'kubernetes',
    'terraform',
  ],
  documentation: ['README.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'docs'],
} as const;

function resolveContractProjectRoot(
  workspacePath: string,
  project: WorkspaceContractProject
): string {
  return project.externalPath
    ? path.resolve(project.externalPath)
    : path.resolve(workspacePath, project.relativePath);
}

async function discoverContractGraphFiles(
  projectRoot: string
): Promise<WorkspaceContractGraphNode['files']> {
  const result: WorkspaceContractGraphNode['files'] = {
    metadata: [],
    manifests: [],
    entrypoints: [],
    apiSpecifications: [],
    infrastructure: [],
    documentation: [],
  };
  for (const [group, candidates] of Object.entries(GRAPH_FILE_CANDIDATES) as Array<
    [keyof typeof GRAPH_FILE_CANDIDATES, readonly string[]]
  >) {
    for (const candidate of candidates) {
      if (await fsExtra.pathExists(path.join(projectRoot, candidate))) {
        result[group].push(candidate);
      }
    }
  }
  try {
    const rootEntries = await fsExtra.readdir(projectRoot, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && (entry.name.endsWith('.csproj') || entry.name.endsWith('.sln'))) {
        result.manifests.push(entry.name);
      }
      if (entry.isFile() && entry.name.endsWith('.tf')) {
        result.infrastructure.push(entry.name);
      }
    }
  } catch {
    // Missing/unreadable project roots remain visible as contract nodes.
  }
  for (const values of Object.values(result)) {
    values.sort((a, b) => a.localeCompare(b));
  }
  return result;
}

function sortedDependencyNames(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
}

async function readContractGraphPackage(
  projectRoot: string
): Promise<WorkspaceContractGraphNode['package']> {
  try {
    const payload = (await fsExtra.readJson(path.join(projectRoot, 'package.json'))) as Record<
      string,
      unknown
    >;
    const dependencies = {
      runtime: sortedDependencyNames(payload.dependencies),
      development: sortedDependencyNames(payload.devDependencies),
      peer: sortedDependencyNames(payload.peerDependencies),
      optional: sortedDependencyNames(payload.optionalDependencies),
    };
    return {
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
      ...(typeof payload.version === 'string' ? { version: payload.version } : {}),
      ...(typeof payload.private === 'boolean' ? { private: payload.private } : {}),
      scripts: sortedDependencyNames(payload.scripts),
      dependencies,
      dependencyCount: new Set(Object.values(dependencies).flat()).size,
    };
  } catch {
    return undefined;
  }
}

async function readContractGraphEnvironmentKeys(projectRoot: string): Promise<string[]> {
  for (const candidate of ['.env.example', '.env.sample', '.env.template']) {
    try {
      const contents = await fsExtra.readFile(path.join(projectRoot, candidate), 'utf8');
      return contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('='))
        .map((line) => line.slice(0, line.indexOf('=')).trim())
        .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      // Try the next public environment template; never inspect .env values.
    }
  }
  return [];
}

function resolveContractGraphCapabilities(
  projectRoot: string,
  project: WorkspaceContractProject
): ProjectCommandCapabilities {
  try {
    const capabilities = resolveProjectCommandCapabilities(projectRoot);
    if (capabilities.engine !== 'unknown') return capabilities;
    const engine = fsExtra.pathExistsSync(path.join(projectRoot, 'package.json'))
      ? 'npm'
      : fsExtra.pathExistsSync(path.join(projectRoot, 'pyproject.toml'))
        ? 'python'
        : fsExtra.pathExistsSync(path.join(projectRoot, 'requirements.txt'))
          ? 'pip'
          : 'unknown';
    return {
      ...capabilities,
      engine,
      runtime: project.runtime ?? capabilities.runtime,
      framework: project.framework ?? capabilities.framework,
      frameworkDisplayName: project.framework ?? capabilities.frameworkDisplayName,
    };
  } catch {
    return {
      schemaVersion: 1,
      scope: 'project',
      projectRoot: null,
      engine: 'unknown',
      runtime: 'unknown',
      runtimeCandidates: ['unknown'],
      compositeRuntime: false,
      lifecycleCoverage: 'complete',
      framework: 'unknown',
      frameworkDisplayName: 'Unknown',
      frameworkConfidence: 'low',
      frameworkSupportTier: 'observed',
      runtimeSupportTier: 'observed',
      runtimeDoctorSupport: 'observed',
      moduleSupport: false,
      fleetStages: [],
      localOnlyCommands: [],
      commandMap: {},
      supportedCommands: [],
      unsupportedCommands: [],
      globalCommands: [],
    };
  }
}

function emptyDependencyGraph(
  contract: WorkspaceContract,
  generatedAt: string,
  message: string
): WorkspaceDependencyGraph {
  const nodes = contract.projects.map((project) => ({
    id: project.slug,
    path: project.relativePath,
    runtime: project.runtime,
    framework: project.framework,
  }));
  return {
    schemaVersion: 'workspace-dependency-graph.v1',
    generatedAt,
    nodes,
    edges: [],
    stats: {
      nodeCount: nodes.length,
      edgeCount: 0,
      inferredEdges: 0,
      contractEdges: 0,
      manualEdges: 0,
      authoritativeEdges: 0,
      lowConfidenceEdges: 0,
      orphanCount: nodes.length,
      connectedNodeCount: 0,
      density: 0,
      edgeCoverageRatio: nodes.length === 0 ? 1 : 0,
      evidenceCoverageRatio: 1,
      hotspotCount: 0,
      hasCycle: false,
    },
    diagnostics: [
      {
        code: 'graph.enrichment.failed',
        severity: 'warning',
        message,
        recommendation:
          'Review project manifests and graph overrides, then rerun workspace contract graph.',
      },
    ],
  };
}

export async function buildWorkspaceContractGraph(input: {
  workspacePath: string;
  contractPath?: string;
  now?: Date;
}): Promise<{ contractPath: string; graph: WorkspaceContractGraph }> {
  const { contractPath, contract } = await readWorkspaceContract(input);
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const { buildWorkspaceModel, workspaceModelProjectTopology } =
    await import('../workspace-model.js');
  const { hashWorkspaceModel } = await import('../workspace-model-hash.js');
  const model = await buildWorkspaceModel({
    workspacePath: input.workspacePath,
    includeEvidence: false,
    now,
  });
  const dependencyGraph =
    workspaceModelProjectTopology(model) ??
    emptyDependencyGraph(
      contract,
      generatedAt,
      'The canonical Workspace Model did not provide a project dependency topology.'
    );
  const operationalProfiles = new Map(
    dependencyGraph.nodes.map((node) => [node.id, node.operationalProfile])
  );
  const { buildWorkspaceKnowledgeGraph } = await import('../workspace-knowledge-graph.js');
  const knowledgeGraph = await buildWorkspaceKnowledgeGraph({
    workspacePath: input.workspacePath,
    workspace: {
      name: model.workspace.name,
      ...(model.workspace.profile ? { profile: model.workspace.profile } : {}),
    },
    contract,
    projectTopology: dependencyGraph,
    now,
    projects: model.projects.map((project) => ({
      id: project.name,
      path: project.path,
      ...(project.absolutePath ? { absolutePath: project.absolutePath } : {}),
      runtime: project.runtime,
      runtimeCandidates: project.runtimeCandidates,
      framework: project.framework,
      ...(project.kit ? { kit: project.kit } : {}),
    })),
    source: {
      kind: 'workspace-model',
      artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
      hashAlgorithm: 'sha256',
      hash: hashWorkspaceModel(model),
    },
  });
  const nodes: WorkspaceContractGraphNode[] = await Promise.all(
    contract.projects.map(async (project) => {
      const projectRoot = resolveContractProjectRoot(input.workspacePath, project);
      const [files, packageMetadata, environmentKeys] = await Promise.all([
        discoverContractGraphFiles(projectRoot),
        readContractGraphPackage(projectRoot),
        readContractGraphEnvironmentKeys(projectRoot),
      ]);
      const capabilities = resolveContractGraphCapabilities(projectRoot, project);
      return {
        id: project.slug,
        label: project.slug,
        relativePath: project.relativePath,
        source: project.source,
        relationship: project.relationship,
        externalPath: project.externalPath,
        runtime: project.runtime ?? capabilities.runtime,
        framework: project.framework ?? capabilities.framework,
        kit: project.kit,
        modules: project.modules,
        ports: project.ports,
        apis: project.contracts.apis,
        owns: project.contracts.owns,
        env: [...new Set([...project.contracts.env, ...environmentKeys])].sort((a, b) =>
          a.localeCompare(b)
        ),
        contracts: {
          owns: [...project.contracts.owns],
          apis: [...project.contracts.apis],
          publishes: [...project.contracts.publishes],
          consumes: [...project.contracts.consumes],
          dependsOn: [...project.contracts.dependsOn],
          env: [...project.contracts.env],
        },
        capabilities: {
          engine: capabilities.engine,
          supportTier: capabilities.frameworkSupportTier,
          runtimeSupportTier: capabilities.runtimeSupportTier,
          doctorSupport: capabilities.runtimeDoctorSupport,
          moduleSupport: capabilities.moduleSupport,
          fleetStages: [...capabilities.fleetStages],
          localOnlyCommands: [...capabilities.localOnlyCommands],
          supportedCommands: [...capabilities.supportedCommands],
        },
        files,
        ...(packageMetadata ? { package: packageMetadata } : {}),
        ...(operationalProfiles.get(project.slug)
          ? { operationalProfile: operationalProfiles.get(project.slug) }
          : {}),
      };
    })
  );
  const knownProjects = new Set(nodes.map((node) => node.id));
  const publishersByEvent = new Map<string, Set<string>>();
  const edges: WorkspaceContractGraphEdge[] = [];

  for (const project of contract.projects) {
    for (const dependency of project.contracts.dependsOn || []) {
      if (!knownProjects.has(dependency)) continue;
      edges.push({
        from: dependency,
        to: project.slug,
        type: 'dependency',
        label: 'dependsOn',
      });
    }
    for (const eventName of project.contracts.publishes || []) {
      if (!publishersByEvent.has(eventName)) {
        publishersByEvent.set(eventName, new Set<string>());
      }
      publishersByEvent.get(eventName)?.add(project.slug);
    }
  }

  for (const project of contract.projects) {
    for (const eventName of project.contracts.consumes || []) {
      const publishers = publishersByEvent.get(eventName);
      if (!publishers) continue;
      for (const publisher of publishers) {
        if (publisher === project.slug) continue;
        edges.push({
          from: publisher,
          to: project.slug,
          type: 'event',
          label: eventName,
        });
      }
    }
  }

  const graph: WorkspaceContractGraph = {
    schemaVersion: 1,
    kind: 'rapidkit.workspace.contract.graph',
    workspace: contract.workspace,
    generatedAt,
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) =>
      `${a.from}:${a.to}:${a.type}:${a.label}`.localeCompare(
        `${b.from}:${b.to}:${b.type}:${b.label}`
      )
    ),
    dependencyGraph,
    knowledgeGraph,
    semantics: {
      legacyEdges: 'producer-to-consumer',
      dependencyGraphEdges: 'consumer-to-dependency',
    },
    summary: {
      projectCount: nodes.length,
      dependencyEdges: edges.filter((edge) => edge.type === 'dependency').length,
      eventEdges: edges.filter((edge) => edge.type === 'event').length,
      portCount: nodes.reduce((total, node) => total + node.ports.length, 0),
      apiCount: nodes.reduce((total, node) => total + node.apis.length, 0),
      relationshipEdges: dependencyGraph.stats.edgeCount,
      inferredEdges: dependencyGraph.stats.inferredEdges,
      authoritativeEdges: dependencyGraph.stats.authoritativeEdges,
      orphanProjects: dependencyGraph.stats.orphanCount,
      hotspotProjects: dependencyGraph.stats.hotspotCount,
      evidenceCoverageRatio: dependencyGraph.stats.evidenceCoverageRatio,
      edgeCoverageRatio: dependencyGraph.stats.edgeCoverageRatio,
      connectedProjects: dependencyGraph.stats.connectedNodeCount,
      lowConfidenceEdges: dependencyGraph.stats.lowConfidenceEdges,
      hasCycle: dependencyGraph.stats.hasCycle,
      manifestCount: nodes.reduce((total, node) => total + node.files.manifests.length, 0),
      entrypointCount: nodes.reduce((total, node) => total + node.files.entrypoints.length, 0),
      diagnostics: dependencyGraph.diagnostics?.length ?? 0,
      relationshipKinds: Object.fromEntries(
        WORKSPACE_GRAPH_EDGE_KINDS.map((kind) => [
          kind,
          dependencyGraph.edges.filter((edge) => edge.kind === kind).length,
        ])
      ) as Record<WorkspaceGraphEdgeKind, number>,
      relationshipSources: Object.fromEntries(
        WORKSPACE_GRAPH_EDGE_SOURCES.map((source) => [
          source,
          dependencyGraph.edges.filter((edge) => edge.source === source).length,
        ])
      ) as Record<WorkspaceGraphEdgeSource, number>,
      entityCount: knowledgeGraph.quality.entityCount,
      knowledgeRelations: knowledgeGraph.quality.relationCount,
      proofCount: knowledgeGraph.quality.proofCount,
      providerCount: knowledgeGraph.providers.length,
      knowledgeUnknowns: knowledgeGraph.quality.unknownCount,
    },
  };

  return { contractPath, graph };
}

export async function verifyWorkspaceContract(input: {
  workspacePath: string;
  contractPath?: string;
  contract?: WorkspaceContract;
  strict?: boolean;
}): Promise<WorkspaceContractVerificationResult> {
  const loaded = input.contract
    ? {
        contractPath:
          input.contractPath ??
          resolveWorkspaceArtifactPath(input.workspacePath, WORKSPACE_CONTRACT_PATH),
        contract: input.contract,
      }
    : await readWorkspaceContract(input);
  const { contractPath, contract } = loaded;
  const violations: string[] = [];
  const checks: WorkspaceContractVerificationResult['checks'] = [];

  if (contract.kind !== 'rapidkit.workspace.contract') {
    violations.push('Contract kind must be rapidkit.workspace.contract.');
  }
  if (contract.schemaVersion !== WORKSPACE_CONTRACT_SCHEMA_VERSION) {
    violations.push(`Contract schemaVersion must be ${WORKSPACE_CONTRACT_SCHEMA_VERSION}.`);
  }
  if (!contract.workspace?.name) {
    violations.push('Contract workspace.name is required.');
  }
  if (!Array.isArray(contract.projects)) {
    violations.push('Contract projects must be an array.');
  }

  const projectSlugs = new Set<string>();
  const claimedPorts = new Map<number, string>();
  for (const project of contract.projects || []) {
    if (!project.slug) {
      violations.push('Every project must declare slug.');
      continue;
    }
    if (projectSlugs.has(project.slug)) {
      violations.push(`Duplicate project slug: ${project.slug}.`);
    }
    projectSlugs.add(project.slug);
    if (!project.relativePath) {
      violations.push(`Project ${project.slug} must declare relativePath.`);
    } else if (!isSafeContractRelativePath(project.relativePath)) {
      violations.push(
        `Project ${project.slug} declares unsafe relativePath: ${project.relativePath}.`
      );
    }
    if (project.externalPath) {
      const externalSource =
        project.relationship === 'adopted' ||
        project.source === 'adopted-local' ||
        project.source === 'local-folder' ||
        project.source === 'git-url';
      if (!externalSource) {
        violations.push(
          `Project ${project.slug} declares externalPath without imported/adopted provenance.`
        );
      }
      if (!path.isAbsolute(project.externalPath)) {
        violations.push(`Project ${project.slug} declares non-absolute externalPath.`);
      }
    }
    for (const port of project.ports || []) {
      if (!Number.isInteger(port.port) || port.port < 1 || port.port > 65535) {
        violations.push(`Project ${project.slug} declares invalid port: ${port.port}.`);
      }
      const owner = claimedPorts.get(port.port);
      if (owner) {
        violations.push(`Port ${port.port} is claimed by both ${owner} and ${project.slug}.`);
      }
      claimedPorts.set(port.port, project.slug);
    }
    for (const api of project.contracts?.apis || []) {
      if (!api.name?.trim() || !api.basePath?.startsWith('/')) {
        violations.push(`Project ${project.slug} declares invalid API contract.`);
      }
    }
    for (const eventName of [
      ...(project.contracts?.publishes || []),
      ...(project.contracts?.consumes || []),
    ]) {
      if (!eventName.trim()) {
        violations.push(`Project ${project.slug} declares an empty event contract.`);
      }
    }
    for (const envName of project.contracts?.env || []) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(envName)) {
        violations.push(`Project ${project.slug} declares invalid env contract: ${envName}.`);
      }
    }
    for (const dependency of project.contracts?.dependsOn || []) {
      if (!projectSlugs.has(dependency)) {
        // checked again after full set is built below
      }
    }
  }

  for (const project of contract.projects || []) {
    for (const dependency of project.contracts?.dependsOn || []) {
      if (!projectSlugs.has(dependency)) {
        violations.push(`Project ${project.slug} depends on unknown project: ${dependency}.`);
      }
    }
  }

  checks.push({
    id: 'schema',
    status:
      contract.kind === 'rapidkit.workspace.contract' &&
      contract.schemaVersion === WORKSPACE_CONTRACT_SCHEMA_VERSION
        ? 'passed'
        : 'failed',
    message: 'Contract schema and kind are valid.',
  });
  checks.push({
    id: 'projects',
    status: Array.isArray(contract.projects) ? 'passed' : 'failed',
    message: `Contract declares ${Array.isArray(contract.projects) ? contract.projects.length : 0} project(s).`,
  });
  checks.push({
    id: 'ports',
    status: violations.some((item) => item.toLowerCase().includes('port')) ? 'failed' : 'passed',
    message: 'Project port declarations are valid and collision-free.',
  });
  checks.push({
    id: 'dependencies',
    status: violations.some((item) => item.includes('depends on unknown project'))
      ? 'failed'
      : 'passed',
    message: 'Project dependencies point to known project slugs.',
  });
  checks.push({
    id: 'contracts',
    status: violations.some(
      (item) =>
        item.includes('unsafe relativePath') ||
        item.includes('invalid API contract') ||
        item.includes('event contract') ||
        item.includes('env contract')
    )
      ? 'failed'
      : 'passed',
    message: 'Project path, API, event, and env contracts are valid.',
  });

  const moduleAudit = await auditWorkspaceModulePaths(input.workspacePath);
  if (moduleAudit.moduleCount > 0) {
    for (const issue of moduleAudit.issues) {
      violations.push(`${path.basename(issue.projectRoot)}: ${issue.message} (slug=${issue.slug})`);
    }
    checks.push({
      id: 'module-paths',
      status: moduleAudit.status,
      message:
        moduleAudit.status === 'passed'
          ? `All ${moduleAudit.moduleCount} registered module(s) resolve under canonical paths.`
          : `${moduleAudit.issues.length} registered module(s) missing canonical install paths.`,
    });
  } else if (input.strict) {
    checks.push({
      id: 'module-paths',
      status: 'passed',
      message: 'No registry-backed modules declared in workspace projects.',
    });
  }

  const result: WorkspaceContractVerificationResult = {
    status: violations.length > 0 ? 'failed' : 'passed',
    contractPath,
    projectCount: Array.isArray(contract.projects) ? contract.projects.length : 0,
    checks,
    violations,
  };
  return result;
}

export async function writeWorkspaceContractVerifyEvidence(input: {
  workspacePath: string;
  result: WorkspaceContractVerificationResult;
  generatedAt?: string;
}): Promise<string> {
  const workspacePath = path.resolve(input.workspacePath);
  const payload: WorkspaceContractVerifyEvidence = {
    schemaVersion: WORKSPACE_CONTRACT_VERIFY_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: input.result.status,
    contractPath: input.result.contractPath,
    projectCount: input.result.projectCount,
    checks: input.result.checks,
    violations: input.result.violations,
  };
  return writeWorkspaceArtifactJson(
    workspacePath,
    WORKSPACE_CONTRACT_VERIFY_REPORT_PATH,
    attachRunCorrelation(payload)
  );
}
