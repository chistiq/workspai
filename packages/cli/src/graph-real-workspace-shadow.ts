import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GraphShadowComparisonPolicy } from './contracts/graph-shadow-parity-contract.js';
import {
  GRAPH_G8_REAL_WORKSPACE_PLATFORM_REPORT_SCHEMA_VERSION,
  GRAPH_REAL_WORKSPACE_APPROVALS_SCHEMA_VERSION,
  GRAPH_REAL_WORKSPACE_INVENTORY_SCHEMA_VERSION,
  GRAPH_REAL_WORKSPACE_PRIMARY_DIFFERENCE_CODES,
  GRAPH_REAL_WORKSPACE_PROFILE,
  GRAPH_REAL_WORKSPACE_QUALIFICATION_SCHEMA_VERSION,
  type GraphG8RealWorkspacePlatformReport,
  type GraphRealWorkspaceApprovalRecord,
  type GraphRealWorkspaceApprovals,
  type GraphRealWorkspaceInventory,
  type GraphRealWorkspaceInventoryEntry,
  type GraphRealWorkspaceLimits,
  type GraphRealWorkspaceObservation,
  type GraphRealWorkspaceQualificationResult,
} from './contracts/graph-real-workspace-shadow-contract.js';
import {
  GRAPH_MODEL_AUTHORITY_RECEIPT_SCHEMA_VERSION,
  GRAPH_SHADOW_PARITY_SCHEMA_VERSION,
} from './contracts/graph-shadow-parity-contract.js';
import { runPreparedProjectGraphShadow } from './graph-package-shadow-bridge.js';
import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  createGraphShadowProjectScopeDigest,
  createGraphShadowReadOnlyAuthorizationDigest,
  createGraphShadowResourceBudgetDigest,
  type LegacyGraphShadowInput,
  type PackageGraphShadowInput,
} from './graph-shadow-parity.js';
import { projectWorkspaceKnowledgeGraph } from './workspace-knowledge-graph-projection.js';
import { buildWorkspaceKnowledgeGraph } from './workspace-knowledge-graph.js';
import type { WorkspaceDependencyGraph } from './contracts/workspace-dependency-graph-contract.js';
import {
  WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  type WorkspaceKnowledgeGraph,
} from './contracts/workspace-knowledge-graph-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import { hashCanonicalJson } from './workspace-model-hash.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '../..');
const INVENTORY_RELATIVE = 'packages/cli/test-data/graph-shadow/real-workspace-inventory.v1.json';
const POLICY_RELATIVE = 'packages/cli/test-data/graph-shadow/real-workspace-policy.v1.json';
const APPROVALS_RELATIVE = 'packages/cli/test-data/graph-shadow/real-workspace-approvals.v1.json';
const CANONICAL_WRITE_NAMES = new Set(['.workspai', 'graph-generation.json']);
const PRIMARY_DIFFERENCE_CODES = new Set(GRAPH_REAL_WORKSPACE_PRIMARY_DIFFERENCE_CODES);
const LOCAL_PATH_LEAK = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\\\\)/u;
const PORTABLE_RELATIVE =
  /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/u;
const PORTABLE_PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const MAPPING_VERSION = /^workspai\.graph-shadow-mapping\.v[0-9]+$/u;
const FIXED_GENERATED_AT = '2026-09-12T00:00:00.000Z';

export const GRAPH_REAL_WORKSPACE_DEFAULT_LIMITS: GraphRealWorkspaceLimits = Object.freeze({
  ...GRAPH_SHADOW_DEFAULT_LIMITS,
  maxFileBytes: 256 * 1024 * 1024,
  maxControlBytes: 1024 * 1024,
  timeoutMs: 120_000,
  inventoryFileLimit: 400,
  maxFilesPerProject: 80,
  maxCopyDepth: 12,
  maxEntriesPerDirectory: 64,
  maxCopiedFileBytes: 256 * 1024,
  maxCopiedFiles: 128,
});

type JsonObject = Record<string, unknown>;

export interface GraphRealWorkspaceQualificationRequest {
  readonly repositoryRoot: string;
  readonly referenceRoot?: string;
  readonly mode: 'regression' | 'local-observation' | 'platform-report';
  readonly signal?: AbortSignal;
  readonly limits?: Partial<GraphRealWorkspaceLimits>;
  readonly output?: string;
  readonly legacyBuilder?: (input: {
    readonly projectId: string;
    readonly projectRoot: string;
    readonly signal?: AbortSignal;
  }) => Promise<unknown>;
  readonly packageBuilder?: () => Promise<PackageGraphShadowInput | undefined>;
  readonly policy?: GraphShadowComparisonPolicy;
  readonly approvals?: readonly GraphRealWorkspaceApprovalRecord[];
  readonly testUninterruptibleHang?: boolean;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sha256Bytes(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function createGraphRealWorkspaceQualificationDigest(input: {
  readonly schemaVersion: string;
  readonly profile: string;
  readonly inventoryDigest: string;
  readonly mappingVersion: string;
  readonly observations: readonly unknown[];
  readonly mutatedCanonicalArtifacts: boolean;
  readonly usedProcessCwdAsAuthority: boolean;
}): string {
  return sha256Bytes(
    JSON.stringify({
      schemaVersion: input.schemaVersion,
      profile: input.profile,
      inventoryDigest: input.inventoryDigest,
      mappingVersion: input.mappingVersion,
      observations: input.observations,
      mutatedCanonicalArtifacts: input.mutatedCanonicalArtifacts,
      usedProcessCwdAsAuthority: input.usedProcessCwdAsAuthority,
    })
  );
}

export function createGraphRealWorkspaceResourceBudgetDigest(
  limits: GraphRealWorkspaceLimits
): string {
  return sha256Bytes(JSON.stringify(limits));
}

export function resolveGraphRealWorkspaceLimits(
  overrides?: Partial<GraphRealWorkspaceLimits>
): GraphRealWorkspaceLimits {
  const limits: GraphRealWorkspaceLimits = {
    ...GRAPH_REAL_WORKSPACE_DEFAULT_LIMITS,
    ...overrides,
  };
  const fields: (keyof GraphRealWorkspaceLimits)[] = [
    'maxNodes',
    'maxRelations',
    'maxProofs',
    'maxDiagnostics',
    'maxFileBytes',
    'maxControlBytes',
    'timeoutMs',
    'inventoryFileLimit',
    'maxFilesPerProject',
    'maxCopyDepth',
    'maxEntriesPerDirectory',
    'maxCopiedFileBytes',
    'maxCopiedFiles',
  ];
  for (const field of fields) {
    const value = limits[field];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Real-workspace limit ${field} must be a positive integer.`);
    }
  }
  if (limits.maxCopyDepth > 24 || limits.maxEntriesPerDirectory > 256) {
    throw new Error('Real-workspace copy limits exceeded their contract bounds.');
  }
  if (limits.maxCopiedFileBytes > limits.maxFileBytes || limits.maxCopiedFiles > 10_000) {
    throw new Error('Real-workspace copy file budget exceeded its contract bounds.');
  }
  if (limits.timeoutMs > 600_000) {
    throw new Error('Real-workspace timeout exceeded its contract bound.');
  }
  return limits;
}

function comparisonLimitsOf(limits: GraphRealWorkspaceLimits): typeof GRAPH_SHADOW_DEFAULT_LIMITS {
  return {
    maxNodes: limits.maxNodes,
    maxRelations: limits.maxRelations,
    maxProofs: limits.maxProofs,
    maxDiagnostics: limits.maxDiagnostics,
  };
}

export function assertSafePortableRelativePath(value: string, label: string): string {
  if (!PORTABLE_RELATIVE.test(value)) {
    throw new Error(`${label} must be a portable repository-relative path.`);
  }
  return value;
}

export function normalizeComparablePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '');
}

export function pathsUseRejectedWindowsOrMacSpellings(value: string): boolean {
  return (
    value.includes('\\') ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith('/Users/') ||
    value.startsWith('/home/') ||
    value.startsWith('/private/var/') ||
    value.startsWith('/var/folders/')
  );
}

async function assertRealDirectory(candidate: string, label: string): Promise<string> {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute.`);
  if (candidate.includes('\0')) throw new Error(`${label} is invalid.`);
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  const resolved = await realpath(candidate);
  const resolvedMetadata = await lstat(resolved);
  if (resolvedMetadata.isSymbolicLink() || !resolvedMetadata.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return resolved;
}

async function assertRealRegularFile(candidate: string, maxBytes: number): Promise<string> {
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maxBytes) {
    throw new Error('Evidence must be a bounded regular file.');
  }
  const resolved = await realpath(candidate);
  const opened = await open(resolved, 'r');
  try {
    const stat = await opened.stat();
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new Error('Evidence must be a bounded regular file.');
    }
    return resolved;
  } finally {
    await opened.close();
  }
}

async function readBoundedJson(file: string, maxBytes: number): Promise<unknown> {
  const resolved = await assertRealRegularFile(file, maxBytes);
  const handle = await open(resolved, 'r');
  try {
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

export async function writeAtomicJson(file: string, value: unknown): Promise<void> {
  const target = path.resolve(file);
  const parent = await assertRealDirectory(path.dirname(target), 'artifact directory');
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink() || existing.isFile()) {
      throw new Error('Qualification output cannot overwrite existing evidence.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    await link(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function singleProjectTopology(projectId: string): WorkspaceDependencyGraph {
  return {
    schemaVersion: 'workspace-dependency-graph.v1',
    generatedAt: FIXED_GENERATED_AT,
    nodes: [{ id: projectId, path: '.' }],
    edges: [],
    stats: {
      nodeCount: 1,
      edgeCount: 0,
      inferredEdges: 0,
      contractEdges: 0,
      manualEdges: 0,
      authoritativeEdges: 0,
      lowConfidenceEdges: 0,
      orphanCount: 1,
      connectedNodeCount: 0,
      density: 0,
      edgeCoverageRatio: 0,
      evidenceCoverageRatio: 0,
      hotspotCount: 0,
      hasCycle: false,
    },
  };
}

function isInventory(value: unknown): value is GraphRealWorkspaceInventory {
  if (!isObject(value)) return false;
  if (value.schemaVersion !== GRAPH_REAL_WORKSPACE_INVENTORY_SCHEMA_VERSION) return false;
  if (value.profile !== GRAPH_REAL_WORKSPACE_PROFILE) return false;
  if (typeof value.mappingVersion !== 'string' || !MAPPING_VERSION.test(value.mappingVersion)) {
    return false;
  }
  return (
    Array.isArray(value.required) &&
    Array.isArray(value.optionalLocalReferences) &&
    [...value.required, ...value.optionalLocalReferences].every((entry) => {
      if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.projectId !== 'string') {
        return false;
      }
      if (!PORTABLE_PROJECT_ID.test(entry.id) || !PORTABLE_PROJECT_ID.test(entry.projectId)) {
        return false;
      }
      if (entry.kind === 'committed-fixture') {
        return (
          typeof entry.relativeRoot === 'string' &&
          PORTABLE_RELATIVE.test(entry.relativeRoot) &&
          entry.trustedBaseline === true
        );
      }
      if (entry.kind === 'local-reference') {
        return (
          typeof entry.directoryName === 'string' &&
          PORTABLE_RELATIVE.test(entry.directoryName) &&
          entry.trustedBaseline === false
        );
      }
      return false;
    })
  );
}

export async function loadGraphRealWorkspaceInventory(
  repositoryRoot: string,
  maxControlBytes: number
): Promise<{ readonly inventory: GraphRealWorkspaceInventory; readonly digest: string }> {
  const root = await assertRealDirectory(repositoryRoot, 'repository root');
  const inventoryPath = path.resolve(root, ...INVENTORY_RELATIVE.split('/'));
  if (!inventoryPath.startsWith(`${root}${path.sep}`)) {
    throw new Error('Inventory path escapes the repository.');
  }
  const bytes = await readFile(await assertRealRegularFile(inventoryPath, maxControlBytes));
  const inventory = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!isInventory(inventory)) {
    throw new Error('Real-workspace inventory failed its semantic contract.');
  }
  const crossPlatform = inventory.required.filter((entry) =>
    entry.requiredFor.includes('cross-platform')
  );
  if (
    crossPlatform.length !== 1 ||
    crossPlatform[0]?.kind !== 'committed-fixture' ||
    crossPlatform[0]?.trustedBaseline !== true
  ) {
    throw new Error('Inventory must declare exactly one trusted committed cross-platform corpus.');
  }
  return { inventory, digest: sha256Bytes(bytes) };
}

async function loadPolicy(
  repositoryRoot: string,
  maxControlBytes: number
): Promise<GraphShadowComparisonPolicy> {
  const policyPath = path.resolve(repositoryRoot, ...POLICY_RELATIVE.split('/'));
  const parsed = (await readBoundedJson(
    policyPath,
    maxControlBytes
  )) as GraphShadowComparisonPolicy;
  if (!isObject(parsed) || typeof parsed.mappingVersion !== 'string') {
    throw new Error('Real-workspace policy failed its semantic contract.');
  }
  if (!MAPPING_VERSION.test(parsed.mappingVersion)) {
    throw new Error('Custom compatibility mappings require an explicit migration version.');
  }
  const approvedDifferences = parsed.approvedDifferences ?? {};
  if (Object.keys(approvedDifferences).length > 0) {
    throw new Error('Real-workspace policy cannot carry unbound approved differences.');
  }
  return { ...parsed, approvedDifferences: {} };
}

async function resolveCommittedFixture(
  repositoryRoot: string,
  entry: GraphRealWorkspaceInventoryEntry
): Promise<string> {
  const relative = assertSafePortableRelativePath(entry.relativeRoot ?? '', entry.id);
  const candidate = path.resolve(repositoryRoot, ...relative.split('/'));
  if (!candidate.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('Committed fixture escapes the repository.');
  }
  return assertRealDirectory(candidate, 'committed fixture');
}

async function resolveLocalReference(
  referenceRoot: string | undefined,
  entry: GraphRealWorkspaceInventoryEntry
): Promise<
  | { readonly status: 'resolved'; readonly root: string }
  | { readonly status: 'unavailable'; readonly reason: string }
> {
  if (!referenceRoot) {
    return { status: 'unavailable', reason: 'reference-root-not-provided' };
  }
  const directoryName = assertSafePortableRelativePath(entry.directoryName ?? '', entry.id);
  const candidate = path.resolve(referenceRoot, directoryName);
  if (candidate === referenceRoot || !candidate.startsWith(`${referenceRoot}${path.sep}`)) {
    return { status: 'unavailable', reason: 'reference-path-rejected' };
  }
  try {
    const root = await assertRealDirectory(candidate, 'local reference');
    return { status: 'resolved', root };
  } catch {
    return { status: 'unavailable', reason: 'reference-unavailable' };
  }
}

async function copyRealTree(
  source: string,
  destination: string,
  limits: GraphRealWorkspaceLimits,
  state: { files: number },
  depth = 0
): Promise<void> {
  if (depth > limits.maxCopyDepth) throw new Error('Fixture copy exceeded its directory budget.');
  const entries = await readdir(source, { withFileTypes: true });
  if (entries.length > limits.maxEntriesPerDirectory) {
    throw new Error('Fixture copy exceeded its file budget.');
  }
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !CANONICAL_WRITE_NAMES.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const metadata = await lstat(from);
    if (metadata.isSymbolicLink()) throw new Error('Fixture copy cannot follow symbolic links.');
    if (metadata.isDirectory()) {
      await copyRealTree(from, to, limits, state, depth + 1);
      continue;
    }
    if (!metadata.isFile() || metadata.size > limits.maxCopiedFileBytes) {
      throw new Error('Fixture copy requires bounded regular files.');
    }
    state.files += 1;
    if (state.files > limits.maxCopiedFiles) {
      throw new Error('Fixture copy exceeded its file budget.');
    }
    await writeFile(to, await readFile(from));
  }
}

export async function digestRealWorkspaceSourceTree(
  root: string,
  limits: GraphRealWorkspaceLimits
): Promise<{ readonly digest: string; readonly files: Readonly<Record<string, string>> }> {
  const files: Record<string, string> = {};
  const visit = async (directory: string, relative: string, depth: number): Promise<void> => {
    if (depth > limits.maxCopyDepth) throw new Error('Source tree exceeded its directory budget.');
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > limits.maxEntriesPerDirectory) {
      throw new Error('Source tree exceeded its file budget.');
    }
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.') && !CANONICAL_WRITE_NAMES.has(entry.name)) continue;
      const from = path.join(directory, entry.name);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const metadata = await lstat(from);
      if (metadata.isSymbolicLink()) throw new Error('Source tree cannot follow symbolic links.');
      if (metadata.isDirectory()) {
        await visit(from, nextRelative, depth + 1);
        continue;
      }
      if (!metadata.isFile() || metadata.size > limits.maxCopiedFileBytes) {
        throw new Error('Source tree requires bounded regular files.');
      }
      files[nextRelative] = sha256Bytes(await readFile(from));
    }
  };
  await visit(root, '', 0);
  if (Object.keys(files).length > limits.maxCopiedFiles) {
    throw new Error('Source tree exceeded its file budget.');
  }
  return {
    digest: sha256Bytes(JSON.stringify(files)),
    files,
  };
}

function treeChanged(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>
): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (before[key] !== after[key]) return true;
    if (CANONICAL_WRITE_NAMES.has(key.split('/')[0] ?? '')) return true;
  }
  return Object.keys(after).some((key) => CANONICAL_WRITE_NAMES.has(key.split('/')[0] ?? ''));
}

function isApprovals(value: unknown): value is GraphRealWorkspaceApprovals {
  if (!isObject(value)) return false;
  if (value.schemaVersion !== GRAPH_REAL_WORKSPACE_APPROVALS_SCHEMA_VERSION) return false;
  if (typeof value.mappingVersion !== 'string' || !MAPPING_VERSION.test(value.mappingVersion)) {
    return false;
  }
  if (!Array.isArray(value.records) || value.records.length > 32) return false;
  const seen = new Set<string>();
  return value.records.every((record) => {
    if (
      !isObject(record) ||
      typeof record.corpusId !== 'string' ||
      typeof record.sourceTreeDigest !== 'string' ||
      typeof record.code !== 'string' ||
      typeof record.reason !== 'string'
    ) {
      return false;
    }
    if (!PORTABLE_PROJECT_ID.test(record.corpusId) || !SHA256.test(record.sourceTreeDigest)) {
      return false;
    }
    if (record.reason.length < 24 || record.reason.length > 512) return false;
    if (
      record.classification !== 'intentional-contract-change' &&
      record.classification !== 'truth-depth-improvement' &&
      record.classification !== 'legacy-false-claim'
    ) {
      return false;
    }
    const key = `${record.corpusId}:${record.sourceTreeDigest}:${record.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rejectBlanketApprovals(records: readonly GraphRealWorkspaceApprovalRecord[]): void {
  const byCorpus = new Map<string, Set<string>>();
  for (const record of records) {
    const codes = byCorpus.get(`${record.corpusId}:${record.sourceTreeDigest}`) ?? new Set();
    codes.add(record.code);
    byCorpus.set(`${record.corpusId}:${record.sourceTreeDigest}`, codes);
  }
  for (const codes of byCorpus.values()) {
    if ([...PRIMARY_DIFFERENCE_CODES].every((code) => codes.has(code))) {
      throw new Error('Blanket semantic-difference approval is prohibited.');
    }
  }
}

async function loadApprovals(
  repositoryRoot: string,
  maxControlBytes: number
): Promise<readonly GraphRealWorkspaceApprovalRecord[]> {
  const parsed = await readBoundedJson(
    path.resolve(repositoryRoot, ...APPROVALS_RELATIVE.split('/')),
    maxControlBytes
  );
  if (!isApprovals(parsed)) {
    throw new Error('Real-workspace approvals failed their semantic contract.');
  }
  rejectBlanketApprovals(parsed.records);
  return parsed.records;
}

function policyForCorpus(
  records: readonly GraphRealWorkspaceApprovalRecord[],
  corpusId: string,
  sourceTreeDigest: string,
  mappingVersion: string
): GraphShadowComparisonPolicy {
  const approvedDifferences: Record<
    string,
    'intentional-contract-change' | 'truth-depth-improvement' | 'legacy-false-claim'
  > = {};
  for (const record of records) {
    if (record.corpusId === corpusId && record.sourceTreeDigest === sourceTreeDigest) {
      approvedDifferences[record.code] = record.classification;
    }
  }
  rejectBlanketApprovals(records);
  return { mappingVersion, approvedDifferences };
}

function semanticOutputDigestFrom(report: {
  readonly status: string;
  readonly differences: readonly { readonly code: string }[];
  readonly metrics: {
    readonly regressions: number;
    readonly approvedDifferences: number;
    readonly legacyNodes: number;
    readonly packageNodes: number;
    readonly legacyRelations: number;
    readonly packageRelations: number;
  };
}): { readonly digest: string; readonly codes: readonly string[] } {
  const codes = [...new Set(report.differences.map((item) => item.code))].sort((left, right) =>
    left.localeCompare(right)
  );
  return {
    codes,
    digest: sha256Bytes(
      JSON.stringify({
        status: report.status,
        differenceCodes: codes,
        regressions: report.metrics.regressions,
        approvedDifferences: report.metrics.approvedDifferences,
        legacyNodes: report.metrics.legacyNodes,
        packageNodes: report.metrics.packageNodes,
        legacyRelations: report.metrics.legacyRelations,
        packageRelations: report.metrics.packageRelations,
      })
    ),
  };
}

function sourceHash(projectId: string, inventoryDigest: string): string {
  return hashCanonicalJson({
    kind: 'g8-real-workspace-shadow',
    projectId,
    inventoryDigest,
  });
}

async function defaultLegacyGraph(input: {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly inventoryDigest: string;
  readonly limits: GraphRealWorkspaceLimits;
}): Promise<WorkspaceKnowledgeGraph> {
  return buildWorkspaceKnowledgeGraph({
    workspacePath: input.projectRoot,
    workspace: { name: input.projectId },
    projects: [
      {
        id: input.projectId,
        path: '.',
        absolutePath: input.projectRoot,
      },
    ],
    projectTopology: singleProjectTopology(input.projectId),
    now: new Date(FIXED_GENERATED_AT),
    inventoryFileLimitPerProject: input.limits.inventoryFileLimit,
    maxFilesPerProject: input.limits.maxFilesPerProject,
    semanticFilesPerProject: input.limits.maxFilesPerProject,
    sourceFilesPerProject: input.limits.maxFilesPerProject,
    source: {
      kind: 'workspace-model',
      artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
      hashAlgorithm: 'sha256',
      hash: sourceHash(input.projectId, input.inventoryDigest),
    },
  });
}

function failedReceipt(
  profile: string,
  reportDigest: string,
  status: GraphRealWorkspaceQualificationResult['receipt']['comparison']['status']
): GraphRealWorkspaceQualificationResult['receipt'] {
  return {
    schemaVersion: GRAPH_MODEL_AUTHORITY_RECEIPT_SCHEMA_VERSION,
    epoch: 'package-shadow',
    executionPath: 'compared',
    comparison: { status, profile, reportDigest },
    authority: 'released-cli',
    packageWrites: 'prohibited',
    fallback: 'prohibited',
  };
}

function assertNoPathLeak(value: unknown, forbidden: readonly string[]): void {
  const serialized = JSON.stringify(value);
  if (LOCAL_PATH_LEAK.test(serialized)) {
    throw new Error('Qualification evidence leaked a machine-local path.');
  }
  for (const item of forbidden) {
    if (!item || item.length < 4) continue;
    const raw = item;
    const normalized = normalizeComparablePath(item);
    const jsonSlice = JSON.stringify(item).slice(1, -1);
    if (
      serialized.includes(raw) ||
      (normalized.length > 3 && serialized.includes(normalized)) ||
      (jsonSlice.length > 3 && serialized.includes(jsonSlice))
    ) {
      throw new Error('Qualification evidence leaked an execution path.');
    }
  }
}

async function sameRealPath(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

export async function qualifyGraphRealWorkspaceObservation(input: {
  readonly entry: GraphRealWorkspaceInventoryEntry;
  readonly projectRoot: string;
  readonly inventoryDigest: string;
  readonly sourceTreeDigest: string;
  readonly mappingVersion: string;
  readonly approvals: readonly GraphRealWorkspaceApprovalRecord[];
  readonly limits: GraphRealWorkspaceLimits;
  readonly versions: {
    readonly cli: { readonly version: string; readonly commit: string };
    readonly graphPackage: { readonly version: string; readonly commit: string };
  };
}): Promise<GraphRealWorkspaceObservation> {
  return qualifyOne(input);
}

async function qualifyOne(input: {
  readonly entry: GraphRealWorkspaceInventoryEntry;
  readonly projectRoot: string;
  readonly inventoryDigest: string;
  readonly sourceTreeDigest: string;
  readonly mappingVersion: string;
  readonly approvals: readonly GraphRealWorkspaceApprovalRecord[];
  readonly limits: GraphRealWorkspaceLimits;
  readonly signal?: AbortSignal;
  readonly legacyBuilder?: GraphRealWorkspaceQualificationRequest['legacyBuilder'];
  readonly packageBuilder?: GraphRealWorkspaceQualificationRequest['packageBuilder'];
  readonly versions: {
    readonly cli: { readonly version: string; readonly commit: string };
    readonly graphPackage: { readonly version: string; readonly commit: string };
  };
}): Promise<GraphRealWorkspaceObservation> {
  if (input.signal?.aborted) {
    return {
      id: input.entry.id,
      kind: input.entry.kind,
      projectId: input.entry.projectId,
      status: 'failed',
      reason: 'cancelled',
    };
  }
  const comparisonLimits = comparisonLimitsOf(input.limits);
  const policy = policyForCorpus(
    input.approvals,
    input.entry.id,
    input.sourceTreeDigest,
    input.mappingVersion
  );
  const placeholderBinding = {
    sourceFixtureDigest: input.inventoryDigest,
    scopeDigest: createGraphShadowProjectScopeDigest(input.entry.projectId),
    providerProfileDigest: input.inventoryDigest,
    graphPolicyDigest: input.inventoryDigest,
    redactionAuthorizationDigest: createGraphShadowReadOnlyAuthorizationDigest(),
    resourceBudgetDigest: createGraphShadowResourceBudgetDigest(comparisonLimits),
    legacyCli: input.versions.cli,
    graphPackage: input.versions.graphPackage,
  };
  const legacy = async (): Promise<LegacyGraphShadowInput> => {
    const graph = input.legacyBuilder
      ? await input.legacyBuilder({
          projectId: input.entry.projectId,
          projectRoot: input.projectRoot,
          signal: input.signal,
        })
      : await defaultLegacyGraph({
          projectId: input.entry.projectId,
          projectRoot: input.projectRoot,
          inventoryDigest: input.inventoryDigest,
          limits: input.limits,
        });
    if (
      isObject(graph) &&
      graph.schemaVersion === WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION &&
      isObject(graph.source) &&
      Array.isArray(graph.providers)
    ) {
      return projectWorkspaceKnowledgeGraph(
        graph as unknown as WorkspaceKnowledgeGraph,
        input.entry.projectId
      ) as unknown as LegacyGraphShadowInput;
    }
    return graph as LegacyGraphShadowInput;
  };
  const discovery = await runPreparedProjectGraphShadow({
    context: { projectId: input.entry.projectId, projectRoot: input.projectRoot },
    profile: GRAPH_REAL_WORKSPACE_PROFILE,
    binding: placeholderBinding,
    policy,
    limits: comparisonLimits,
    signal: input.signal,
    legacy,
    ...(input.packageBuilder ? { package: input.packageBuilder } : {}),
  });
  const semanticBinding = discovery.packageExecution.semanticBinding;
  if (!semanticBinding || discovery.packageExecution.status !== 'complete') {
    return {
      id: input.entry.id,
      kind: input.entry.kind,
      projectId: input.entry.projectId,
      status: 'failed',
      reason: 'partial-package-execution',
      packageExecution: {
        status: discovery.packageExecution.status,
        inputFiles: discovery.packageExecution.inputFiles,
        providerFacts: discovery.packageExecution.providerFacts,
      },
    };
  }
  const result = await runPreparedProjectGraphShadow({
    context: { projectId: input.entry.projectId, projectRoot: input.projectRoot },
    profile: GRAPH_REAL_WORKSPACE_PROFILE,
    binding: {
      ...placeholderBinding,
      sourceFixtureDigest: semanticBinding.sourceFixtureDigest,
      providerProfileDigest: semanticBinding.providerProfileDigest,
      graphPolicyDigest: semanticBinding.graphPolicyDigest,
    },
    policy,
    limits: comparisonLimits,
    signal: input.signal,
    legacy,
    ...(input.packageBuilder ? { package: input.packageBuilder } : {}),
  });
  const report = result.report;
  const semantic = semanticOutputDigestFrom(report);
  const boundCodes = input.approvals
    .filter(
      (record) =>
        record.corpusId === input.entry.id && record.sourceTreeDigest === input.sourceTreeDigest
    )
    .map((record) => record.code)
    .sort((left, right) => left.localeCompare(right));
  const exactApprovalMatch =
    semantic.codes.length === boundCodes.length &&
    semantic.codes.every((code, index) => code === boundCodes[index]);
  const boundIncomparable =
    report.status === 'incomparable' &&
    report.metrics.regressions === 0 &&
    exactApprovalMatch &&
    report.metrics.approvedDifferences === boundCodes.length;
  const unapproved =
    report.metrics.regressions > 0 ||
    report.status === 'failed' ||
    report.status === 'different' ||
    (report.status === 'equivalent' && report.metrics.approvedDifferences > 0) ||
    (report.status === 'incomparable' && !boundIncomparable);
  return {
    id: input.entry.id,
    kind: input.entry.kind,
    projectId: input.entry.projectId,
    status: unapproved ? 'failed' : 'compared',
    ...(unapproved ? { reason: 'unapproved-semantic-difference' } : {}),
    packageExecution: {
      status: result.packageExecution.status,
      inputFiles: result.packageExecution.inputFiles,
      providerFacts: result.packageExecution.providerFacts,
    },
    comparison: {
      status: report.status,
      mappingVersion: report.mappingVersion,
      reportDigest: report.receipt.comparison.reportDigest,
      semanticOutputDigest: semantic.digest,
      sourceTreeDigest: input.sourceTreeDigest,
      regressions: report.metrics.regressions,
      approvedDifferences: report.metrics.approvedDifferences,
      differenceCodes: semantic.codes,
      sourceFixtureDigest: report.binding?.sourceFixtureDigest ?? input.inventoryDigest,
      scopeDigest:
        report.binding?.scopeDigest ?? createGraphShadowProjectScopeDigest(input.entry.projectId),
      providerProfileDigest: report.binding?.providerProfileDigest ?? input.inventoryDigest,
      graphPolicyDigest: report.binding?.graphPolicyDigest ?? input.inventoryDigest,
      redactionAuthorizationDigest:
        report.binding?.redactionAuthorizationDigest ??
        createGraphShadowReadOnlyAuthorizationDigest(),
      resourceBudgetDigest:
        report.binding?.resourceBudgetDigest ??
        createGraphShadowResourceBudgetDigest(comparisonLimits),
    },
    report,
  };
}

function readVersion(file: string, fallbackCommit: string): { version: string; commit: string } {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string };
  return {
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0-development',
    commit: fallbackCommit,
  };
}

function timeoutSignal(
  timeoutMs: number,
  parent?: AbortSignal
): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = (): void => controller.abort();
  parent?.addEventListener('abort', onAbort, { once: true });
  if (parent?.aborted) controller.abort();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

async function directoryHasVisibleEntries(root: string): Promise<boolean> {
  try {
    const entries = await readdir(root);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function terminateChild(child: ReturnType<typeof fork>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGKILL');
  if (process.platform === 'win32' && child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  await once(child, 'exit').catch(() => undefined);
}

async function withCwdObservation<T>(
  projectRoot: string,
  work: () => Promise<T>
): Promise<{ readonly value: T; readonly usedProcessCwdAsAuthority: boolean }> {
  const cwdAtStart = process.cwd();
  let cwdConsulted = false;
  const originalCwd = process.cwd.bind(process);
  process.cwd = (): string => {
    cwdConsulted = true;
    return originalCwd();
  };
  try {
    const value = await work();
    const cwdAtEnd = originalCwd();
    return {
      value,
      usedProcessCwdAsAuthority:
        cwdConsulted || cwdAtEnd !== cwdAtStart || (await sameRealPath(cwdAtEnd, projectRoot)),
    };
  } finally {
    process.cwd = originalCwd;
  }
}

async function runIsolatedObservation(input: {
  readonly payload: Parameters<typeof qualifyGraphRealWorkspaceObservation>[0];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly hang?: boolean;
  readonly sentinelRoot: string;
}): Promise<{
  readonly observation: GraphRealWorkspaceObservation;
  readonly usedProcessCwdAsAuthority: boolean;
}> {
  const fallback: GraphRealWorkspaceObservation = {
    id: input.payload.entry.id,
    kind: input.payload.entry.kind,
    projectId: input.payload.entry.projectId,
    status: 'failed',
    reason: input.signal?.aborted ? 'cancelled' : 'timeout',
  };
  if (input.signal?.aborted) {
    return { observation: fallback, usedProcessCwdAsAuthority: false };
  }
  // Source-tree CI harness only. The published CLI does not ship `src` or this
  // worker, and must not require `tsx` at runtime.
  const worker = fileURLToPath(new URL('./graph-real-workspace-shadow-worker.ts', import.meta.url));
  const child = fork(worker, [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'json',
  });
  let usedProcessCwdAsAuthority = false;
  let observation: GraphRealWorkspaceObservation | undefined;
  const timer = setTimeout(() => {
    void terminateChild(child);
  }, input.timeoutMs);
  const onAbort = (): void => {
    void terminateChild(child);
  };
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => {
        child.send(
          {
            type: 'qualify',
            hang: input.hang === true,
            sentinelRoot: input.sentinelRoot,
            payload: input.payload,
          },
          (error) => {
            if (error) reject(error);
            else resolve();
          }
        );
      });
    });
    const [message] = (await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => [{ type: 'exit' }]),
    ])) as [{ type?: string; observation?: GraphRealWorkspaceObservation; cwd?: string }];
    if (message?.type === 'ok' && message.observation) {
      observation = message.observation;
      if (
        typeof message.cwd === 'string' &&
        (await sameRealPath(message.cwd, input.payload.projectRoot))
      ) {
        usedProcessCwdAsAuthority = true;
      }
    }
  } catch {
    observation = fallback;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
    await terminateChild(child);
  }
  if (await directoryHasVisibleEntries(input.sentinelRoot)) usedProcessCwdAsAuthority = true;
  return { observation: observation ?? fallback, usedProcessCwdAsAuthority };
}

async function raceWithSignal<T>(work: Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => undefined);
    return fallback;
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: T): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(error);
    };
    const onAbort = (): void => finish(fallback);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(finish, fail);
  });
}

export async function runGraphRealWorkspaceQualification(
  request: GraphRealWorkspaceQualificationRequest
): Promise<{
  readonly result: GraphRealWorkspaceQualificationResult;
  readonly exitCode: number;
}> {
  const limits = resolveGraphRealWorkspaceLimits(request.limits);
  const cwdAtStart = process.cwd();
  let usedProcessCwdAsAuthority = false;
  let mutatedCanonicalArtifacts = false;
  const repositoryRoot = await assertRealDirectory(request.repositoryRoot, 'repository root');
  const referenceRoot = request.referenceRoot
    ? await assertRealDirectory(request.referenceRoot, 'reference root')
    : undefined;
  const { inventory, digest: inventoryDigest } = await loadGraphRealWorkspaceInventory(
    repositoryRoot,
    limits.maxControlBytes
  );
  const loadedPolicy = request.policy ?? (await loadPolicy(repositoryRoot, limits.maxControlBytes));
  const unboundApprovals = loadedPolicy.approvedDifferences ?? {};
  if (Object.keys(unboundApprovals).length > 0) {
    throw new Error('Real-workspace policy cannot carry unbound approved differences.');
  }
  const approvals =
    request.approvals ?? (await loadApprovals(repositoryRoot, limits.maxControlBytes));
  rejectBlanketApprovals(approvals);
  const testedCommit = COMMIT.test(process.env.GITHUB_SHA ?? '')
    ? (process.env.GITHUB_SHA as string)
    : '0'.repeat(40);
  const versions = {
    cli: readVersion(path.join(repositoryRoot, 'packages/cli/package.json'), testedCommit),
    graphPackage: readVersion(
      path.join(repositoryRoot, 'packages/graph/package.json'),
      testedCommit
    ),
  };
  const timed = timeoutSignal(limits.timeoutMs, request.signal);
  const observations: GraphRealWorkspaceObservation[] = [];
  const temporaryRoots: string[] = [];
  const failedObservation = (entry: GraphRealWorkspaceInventoryEntry, reason: string) => ({
    id: entry.id,
    kind: entry.kind,
    projectId: entry.projectId,
    status: 'failed' as const,
    reason,
  });
  const executeCopied = async (
    entry: GraphRealWorkspaceInventoryEntry,
    projectRoot: string
  ): Promise<void> => {
    if (await sameRealPath(projectRoot, process.cwd())) usedProcessCwdAsAuthority = true;
    const before = await digestRealWorkspaceSourceTree(projectRoot, limits);
    const beforeCanonicalWrites = await workspaceContainsCanonicalGraphWrites(projectRoot);
    const sentinelRoot = await mkdtemp(path.join(os.tmpdir(), `workspai-g8-cwd-${entry.id}-`));
    temporaryRoots.push(sentinelRoot);
    let observation: GraphRealWorkspaceObservation;
    if (request.legacyBuilder || request.packageBuilder) {
      const guarded = await withCwdObservation(projectRoot, () =>
        raceWithSignal(
          qualifyOne({
            entry,
            projectRoot,
            inventoryDigest,
            sourceTreeDigest: before.digest,
            mappingVersion: inventory.mappingVersion,
            approvals,
            limits,
            signal: timed.signal,
            ...(request.legacyBuilder ? { legacyBuilder: request.legacyBuilder } : {}),
            ...(request.packageBuilder ? { packageBuilder: request.packageBuilder } : {}),
            versions,
          }),
          timed.signal,
          failedObservation(entry, request.signal?.aborted ? 'cancelled' : 'timeout')
        )
      );
      observation = guarded.value;
      if (guarded.usedProcessCwdAsAuthority) usedProcessCwdAsAuthority = true;
    } else {
      const isolated = await runIsolatedObservation({
        payload: {
          entry,
          projectRoot,
          inventoryDigest,
          sourceTreeDigest: before.digest,
          mappingVersion: inventory.mappingVersion,
          approvals,
          limits,
          versions,
        },
        timeoutMs: limits.timeoutMs,
        signal: timed.signal,
        hang: request.testUninterruptibleHang === true,
        sentinelRoot,
      });
      observation = isolated.observation;
      if (isolated.usedProcessCwdAsAuthority) usedProcessCwdAsAuthority = true;
    }
    const after = await digestRealWorkspaceSourceTree(projectRoot, limits);
    const afterCanonicalWrites = await workspaceContainsCanonicalGraphWrites(projectRoot);
    if (treeChanged(before.files, after.files) || beforeCanonicalWrites !== afterCanonicalWrites) {
      mutatedCanonicalArtifacts = true;
    }
    if (process.cwd() !== cwdAtStart || (await sameRealPath(projectRoot, process.cwd()))) {
      usedProcessCwdAsAuthority = true;
    }
    observations.push(observation);
  };
  try {
    const required = inventory.required.filter((entry) =>
      request.mode === 'platform-report'
        ? entry.requiredFor.includes('cross-platform')
        : entry.requiredFor.includes('regression')
    );
    if (request.mode === 'platform-report' && required.length !== 1) {
      throw new Error('Cross-platform qualification requires exactly one committed corpus.');
    }
    for (const entry of required) {
      const sourceRoot = await resolveCommittedFixture(repositoryRoot, entry);
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), `workspai-g8-${entry.id}-`));
      temporaryRoots.push(projectRoot);
      await copyRealTree(sourceRoot, projectRoot, limits, { files: 0 });
      await executeCopied(entry, projectRoot);
    }
    if (request.mode === 'local-observation') {
      for (const entry of inventory.optionalLocalReferences) {
        const resolved = await resolveLocalReference(referenceRoot, entry);
        if (resolved.status !== 'resolved') {
          observations.push({
            id: entry.id,
            kind: entry.kind,
            projectId: entry.projectId,
            status: 'unavailable-local-observation',
            reason: resolved.reason,
          });
          continue;
        }
        const projectRoot = await mkdtemp(path.join(os.tmpdir(), `workspai-g8-${entry.id}-`));
        temporaryRoots.push(projectRoot);
        try {
          await copyRealTree(resolved.root, projectRoot, limits, { files: 0 });
        } catch {
          observations.push({
            id: entry.id,
            kind: entry.kind,
            projectId: entry.projectId,
            status: 'unavailable-local-observation',
            reason: 'reference-exceeded-copy-budget',
          });
          continue;
        }
        await executeCopied(entry, projectRoot);
      }
    }
  } finally {
    timed.dispose();
    if (process.cwd() !== cwdAtStart) {
      usedProcessCwdAsAuthority = true;
      try {
        process.chdir(cwdAtStart);
      } catch {
        usedProcessCwdAsAuthority = true;
      }
    }
    await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
  if (
    timed.signal.aborted &&
    !observations.some((item) => item.reason === 'timeout' || item.reason === 'cancelled')
  ) {
    observations.push({
      id: 'timeout',
      kind: 'committed-fixture',
      projectId: 'timeout',
      status: 'failed',
      reason: request.signal?.aborted ? 'cancelled' : 'timeout',
    });
  }
  const compared = observations.filter((item) => item.status === 'compared');
  const failed =
    mutatedCanonicalArtifacts ||
    usedProcessCwdAsAuthority ||
    observations.some(
      (item) => item.status === 'failed' || (item.comparison?.regressions ?? 0) > 0
    );
  const status =
    compared.length > 0 && !failed
      ? compared.every((item) => item.comparison?.status === 'equivalent')
        ? 'equivalent'
        : 'incomparable'
      : 'failed';
  const observationsWithoutReports = observations.map(({ report: _report, ...rest }) => rest);
  const reportDigest = createGraphRealWorkspaceQualificationDigest({
    schemaVersion: GRAPH_REAL_WORKSPACE_QUALIFICATION_SCHEMA_VERSION,
    profile: GRAPH_REAL_WORKSPACE_PROFILE,
    inventoryDigest,
    mappingVersion: inventory.mappingVersion,
    observations: observationsWithoutReports,
    mutatedCanonicalArtifacts,
    usedProcessCwdAsAuthority,
  });
  const result: GraphRealWorkspaceQualificationResult = {
    schemaVersion: GRAPH_REAL_WORKSPACE_QUALIFICATION_SCHEMA_VERSION,
    profile: GRAPH_REAL_WORKSPACE_PROFILE,
    inventoryDigest,
    mappingVersion: inventory.mappingVersion,
    observations: observationsWithoutReports,
    mutatedCanonicalArtifacts,
    usedProcessCwdAsAuthority,
    receipt: failedReceipt(GRAPH_REAL_WORKSPACE_PROFILE, reportDigest, status),
  };
  assertNoPathLeak(result, [
    repositoryRoot,
    referenceRoot ?? '',
    os.tmpdir(),
    cwdAtStart,
    DEFAULT_REPOSITORY_ROOT,
  ]);
  if (request.output) await writeAtomicJson(request.output, result);
  const exitCode = failed || compared.length === 0 ? 4 : status === 'equivalent' ? 0 : 2;
  return { result, exitCode };
}

function runnerOs(platform: NodeJS.Platform): 'Linux' | 'macOS' | 'Windows' | undefined {
  if (platform === 'linux') return 'Linux';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  return undefined;
}

export async function createGraphG8RealWorkspacePlatformReport(
  request: GraphRealWorkspaceQualificationRequest
): Promise<GraphG8RealWorkspacePlatformReport> {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Cross-platform evidence requires GitHub Actions.');
  }
  const sourceCommit = process.env.WORKSPAI_ADMISSION_SOURCE_COMMIT ?? '';
  const testedCommit = process.env.GITHUB_SHA ?? '';
  const runId = process.env.GITHUB_RUN_ID ?? '';
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  const osName = runnerOs(process.platform);
  if (!COMMIT.test(sourceCommit) || !COMMIT.test(testedCommit)) {
    throw new Error('Platform evidence requires exact source and tested commits.');
  }
  if (!/^[1-9][0-9]*$/u.test(runId) || (event !== 'pull_request' && event !== 'push') || !osName) {
    throw new Error('Platform evidence requires a valid GitHub run identity.');
  }
  const { result } = await runGraphRealWorkspaceQualification({
    ...request,
    mode: 'platform-report',
  });
  const compared = result.observations.find(
    (item) => item.id === 'committed-node-service' && item.kind === 'committed-fixture'
  );
  const failures: string[] = [];
  if (!compared?.comparison) failures.push('committed corpus comparison is missing');
  if (compared?.status !== 'compared') failures.push('committed corpus was not compared');
  if (compared?.packageExecution?.status !== 'complete') {
    failures.push('package execution was not complete');
  }
  if (compared?.comparison?.status !== 'equivalent') {
    failures.push('cross-platform corpus is not semantically equivalent');
  }
  if ((compared?.comparison?.regressions ?? 1) > 0) failures.push('unapproved semantic regression');
  if ((compared?.comparison?.approvedDifferences ?? 1) > 0) {
    failures.push('approved differences cannot pass cross-platform parity');
  }
  if ((compared?.comparison?.differenceCodes.length ?? 1) > 0) {
    failures.push('semantic difference codes remain on the corpus');
  }
  if (result.mutatedCanonicalArtifacts) failures.push('canonical artifact mutation was observed');
  if (result.usedProcessCwdAsAuthority) failures.push('process.cwd was used as project authority');
  if (result.receipt.authority !== 'released-cli') failures.push('forged authority');
  if (result.receipt.packageWrites !== 'prohibited') failures.push('write claim');
  if (result.receipt.fallback !== 'prohibited') failures.push('fallback claim');
  if (
    createGraphRealWorkspaceQualificationDigest({
      schemaVersion: result.schemaVersion,
      profile: result.profile,
      inventoryDigest: result.inventoryDigest,
      mappingVersion: result.mappingVersion,
      observations: result.observations,
      mutatedCanonicalArtifacts: result.mutatedCanonicalArtifacts,
      usedProcessCwdAsAuthority: result.usedProcessCwdAsAuthority,
    }) !== result.receipt.comparison.reportDigest
  ) {
    failures.push('qualification digest was not recomputable');
  }
  const versions = {
    cli: readVersion(path.join(request.repositoryRoot, 'packages/cli/package.json'), testedCommit),
    graphPackage: readVersion(
      path.join(request.repositoryRoot, 'packages/graph/package.json'),
      testedCommit
    ),
  };
  const report: GraphG8RealWorkspacePlatformReport = {
    schemaVersion: GRAPH_G8_REAL_WORKSPACE_PLATFORM_REPORT_SCHEMA_VERSION,
    package: '@workspai/graph',
    stage: 'G8',
    checkpoint: 'real-workspace-cross-platform-parity',
    status: failures.length === 0 ? 'passed-platform' : 'failed',
    admitted: false,
    nextStage: 'G9',
    nextStageAuthorized: false,
    crossPlatformAdmission: 'pending',
    currentGraphAuthority: 'official-internal-graph-capability',
    authorizedRuntimeMode: 'g8-shadow-comparison-only',
    mappingVersion: result.mappingVersion,
    inventoryDigest: result.inventoryDigest,
    sourceFixtureDigest: compared?.comparison?.sourceFixtureDigest ?? result.inventoryDigest,
    sourceTreeDigest: compared?.comparison?.sourceTreeDigest ?? result.inventoryDigest,
    scopeDigest:
      compared?.comparison?.scopeDigest ??
      createGraphShadowProjectScopeDigest('node-catalog-service'),
    providerProfileDigest: compared?.comparison?.providerProfileDigest ?? result.inventoryDigest,
    graphPolicyDigest: compared?.comparison?.graphPolicyDigest ?? result.inventoryDigest,
    redactionAuthorizationDigest:
      compared?.comparison?.redactionAuthorizationDigest ??
      createGraphShadowReadOnlyAuthorizationDigest(),
    resourceBudgetDigest:
      compared?.comparison?.resourceBudgetDigest ??
      createGraphRealWorkspaceResourceBudgetDigest(resolveGraphRealWorkspaceLimits()),
    reportDigest: result.receipt.comparison.reportDigest,
    semanticOutputDigest:
      compared?.comparison?.semanticOutputDigest ?? result.receipt.comparison.reportDigest,
    comparisonStatus: compared?.comparison?.status ?? 'failed',
    differenceCodes: compared?.comparison?.differenceCodes ?? [],
    packageExecutionStatus: compared?.packageExecution?.status ?? 'not-executed',
    environment: {
      platform: process.platform as 'linux' | 'darwin' | 'win32',
      architecture: process.arch,
      node: process.version,
    },
    platformEvidence: {
      status: failures.length === 0 ? 'passed' : 'failed',
      runnerOs: osName,
      runnerArch: process.env.RUNNER_ARCH ?? process.arch,
    },
    ci: {
      provider: 'github-actions',
      runId,
      event,
      sourceCommit,
      testedCommit,
    },
    versions,
    qualification: result,
    receipt: result.receipt,
    failures,
  };
  if (!SHA256.test(report.sourceFixtureDigest) || !SHA256.test(report.providerProfileDigest)) {
    failures.push('semantic generation digest is missing');
  }
  if (!SHA256.test(report.sourceTreeDigest) || !SHA256.test(report.semanticOutputDigest)) {
    failures.push('source tree or semantic output digest is missing');
  }
  assertNoPathLeak(report, [request.repositoryRoot, request.referenceRoot ?? '', os.tmpdir()]);
  const passed = failures.length === 0;
  return {
    ...report,
    status: passed ? 'passed-platform' : 'failed',
    platformEvidence: { ...report.platformEvidence, status: passed ? 'passed' : 'failed' },
    failures,
  };
}

export async function workspaceContainsCanonicalGraphWrites(projectRoot: string): Promise<boolean> {
  const entries = await readdir(projectRoot, { withFileTypes: true });
  return entries.some(
    (entry) => entry.name === '.workspai' || entry.name === 'graph-generation.json'
  );
}

export {
  DEFAULT_REPOSITORY_ROOT,
  INVENTORY_RELATIVE,
  POLICY_RELATIVE,
  APPROVALS_RELATIVE,
  SHA256,
  GRAPH_SHADOW_PARITY_SCHEMA_VERSION,
};
