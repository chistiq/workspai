import { createHash } from 'node:crypto';
import path from 'node:path';

import type { AgentFrameworkAdapterManifest } from '../contracts/agent-framework-contract.js';
import type { AgentFrameworkDetectionResult } from './detection.js';

export type AgentFrameworkProjectMode = 'scaffold' | 'attach';

export type AgentFrameworkManagedFile = {
  path: string;
  content: string;
  sha256: string;
  ownership: 'workspai-managed';
  overwrite: 'create-only' | 'replace-if-owned';
};

export type AgentFrameworkFileConflict = {
  path: string;
  reason:
    | 'user-authored-file-exists'
    | 'ownership-unproven'
    | 'owned-file-modified'
    | 'path-outside-managed-roots';
};

export type AgentFrameworkChangePlan = {
  schemaVersion: 'workspai.agent-framework-change-plan.v1';
  status: 'planned' | 'blocked' | 'no-op';
  adapterId: string;
  adapterVersion: string;
  frameworkVersion: string;
  mode: AgentFrameworkProjectMode;
  projectRoot: '.';
  target: { project: string; artifactPrefix: string };
  instanceName: string;
  files: Array<{
    path: string;
    sha256: string;
    overwrite: 'create-only' | 'replace-if-owned';
  }>;
  changes: Array<{
    kind: 'create-file' | 'replace-owned-file' | 'dependency-recommendation';
    path: string;
    summary: string;
  }>;
  requiredEnvironment: string[];
  permissions: Array<'network:model-provider' | 'network:dependency-registry'>;
  blockers: string[];
};

export type AgentFrameworkRenderResult = {
  files: AgentFrameworkManagedFile[];
  conflicts: AgentFrameworkFileConflict[];
};

export type AgentFrameworkProjectContext = {
  adapterId: string;
  frameworkId: string;
  runtime: string;
  entrypoint: string;
  dependencyManifest: string;
  requiredEnvironment: string[];
  verificationCommands: string[];
  boundaries: string[];
};

export type AgentFrameworkValidationResult = {
  status: 'passed' | 'blocked';
  checks: Array<{
    id: 'managed-files' | 'secret-references' | 'runtime-baseline' | 'verification-plan';
    status: 'passed' | 'failed';
    summary: string;
  }>;
  blockers: string[];
};

export type AgentFrameworkRuntimeResolution = {
  status: 'resolved' | 'unavailable' | 'ambiguous';
  runtime: string | null;
  acceptedRange: string;
  candidates: string[];
  blockers: string[];
};

export type AgentFrameworkAdapterInput = {
  projectRoot: string;
  instanceName: string;
  target?: { project: string; artifactPrefix: string };
  existingFiles?: ReadonlyMap<string, string>;
  ownershipLedger?: ReadonlyMap<string, string>;
};

export interface AgentFrameworkAdapter {
  readonly manifest: AgentFrameworkAdapterManifest;
  detect(projectRoot: string): Promise<AgentFrameworkDetectionResult>;
  plan(
    mode: AgentFrameworkProjectMode,
    input: AgentFrameworkAdapterInput
  ): AgentFrameworkChangePlan;
  render(input: AgentFrameworkAdapterInput): AgentFrameworkRenderResult;
  context(input: AgentFrameworkAdapterInput): AgentFrameworkProjectContext;
  validate(input: AgentFrameworkAdapterInput): AgentFrameworkValidationResult;
  resolveRuntime(availableRuntimes: string[]): AgentFrameworkRuntimeResolution;
}

const OWNERSHIP_MARKER = 'Generated and managed by Workspai';

export function normalizedAgentInstanceName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized || normalized.length > 48) {
    throw new Error('Agent instance name must normalize to 1-48 lowercase characters.');
  }
  return normalized;
}

export function managedFile(pathname: string, content: string): AgentFrameworkManagedFile {
  const normalizedPath = path.posix.normalize(pathname.replaceAll('\\', '/'));
  if (
    normalizedPath.startsWith('../') ||
    normalizedPath.startsWith('/') ||
    normalizedPath === '..'
  ) {
    throw new Error(`Managed file path escapes the project root: ${pathname}`);
  }
  if (!content.includes(OWNERSHIP_MARKER)) {
    throw new Error(`Managed file is missing its ownership marker: ${normalizedPath}`);
  }
  return {
    path: normalizedPath,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    ownership: 'workspai-managed',
    overwrite: 'replace-if-owned',
  };
}

export function resolveManagedFiles(
  manifest: AgentFrameworkAdapterManifest,
  files: AgentFrameworkManagedFile[],
  existingFiles: ReadonlyMap<string, string> = new Map(),
  ownershipLedger: ReadonlyMap<string, string> = new Map()
): AgentFrameworkRenderResult {
  const roots = manifest.ownership.managedRoots.map((root) => `${root.replace(/\/$/, '')}/`);
  const accepted: AgentFrameworkManagedFile[] = [];
  const conflicts: AgentFrameworkFileConflict[] = [];
  for (const file of files) {
    if (!roots.some((root) => file.path.startsWith(root))) {
      conflicts.push({ path: file.path, reason: 'path-outside-managed-roots' });
      continue;
    }
    const existing = existingFiles.get(file.path);
    if (existing !== undefined && !existing.includes(OWNERSHIP_MARKER)) {
      conflicts.push({ path: file.path, reason: 'user-authored-file-exists' });
      continue;
    }
    if (existing !== undefined) {
      const admittedDigest = ownershipLedger.get(file.path);
      if (!admittedDigest) {
        conflicts.push({ path: file.path, reason: 'ownership-unproven' });
        continue;
      }
      const actualDigest = createHash('sha256').update(existing).digest('hex');
      if (actualDigest !== admittedDigest) {
        conflicts.push({ path: file.path, reason: 'owned-file-modified' });
        continue;
      }
      if (actualDigest === file.sha256) continue;
    }
    accepted.push({
      ...file,
      overwrite: existing === undefined ? 'create-only' : 'replace-if-owned',
    });
  }
  return { files: accepted, conflicts };
}

export function validateAdapterRender(
  adapter: AgentFrameworkAdapter,
  input: AgentFrameworkAdapterInput
): AgentFrameworkValidationResult {
  const rendered = adapter.render(input);
  const context = adapter.context(input);
  const checks: AgentFrameworkValidationResult['checks'] = [
    {
      id: 'managed-files',
      status: rendered.conflicts.length === 0 ? 'passed' : 'failed',
      summary:
        rendered.conflicts.length === 0
          ? `${rendered.files.length} owned files are safe to render.`
          : `${rendered.conflicts.length} ownership, user-content, or path conflict(s) block rendering.`,
    },
    {
      id: 'secret-references',
      status: rendered.files.every(
        (file) => !/(?:api[_-]?key|token|secret)\s*[:=]\s*["'][^"'$][^"']+/i.test(file.content)
      )
        ? 'passed'
        : 'failed',
      summary: 'Managed output contains environment references only; no literal credential values.',
    },
    {
      id: 'runtime-baseline',
      status: context.runtime.length > 0 ? 'passed' : 'failed',
      summary: `Runtime baseline is ${context.runtime}.`,
    },
    {
      id: 'verification-plan',
      status: context.verificationCommands.length > 0 ? 'passed' : 'failed',
      summary: `${context.verificationCommands.length} explicit verification command(s) are declared.`,
    },
  ];
  const blockers = [
    ...rendered.conflicts.map((conflict) => `${conflict.path}: ${conflict.reason}`),
    ...checks.filter((check) => check.status === 'failed').map((check) => check.summary),
  ];
  return { status: blockers.length === 0 ? 'passed' : 'blocked', checks, blockers };
}

export function buildAgentFrameworkChangePlan(input: {
  adapter: AgentFrameworkAdapter;
  mode: AgentFrameworkProjectMode;
  adapterInput: AgentFrameworkAdapterInput;
  rendered: AgentFrameworkRenderResult;
  dependencyRecommendation?: { path: string; summary: string };
}): AgentFrameworkChangePlan {
  const instanceName = normalizedAgentInstanceName(input.adapterInput.instanceName);
  const files = input.rendered.files.map((file) => ({
    path: file.path,
    sha256: file.sha256,
    overwrite: file.overwrite,
  }));
  return {
    schemaVersion: 'workspai.agent-framework-change-plan.v1',
    status:
      input.rendered.conflicts.length > 0 ? 'blocked' : files.length === 0 ? 'no-op' : 'planned',
    adapterId: input.adapter.manifest.adapter.id,
    adapterVersion: input.adapter.manifest.adapter.version,
    frameworkVersion: input.adapter.manifest.framework.testedVersions[0],
    mode: input.mode,
    projectRoot: '.',
    target: input.adapterInput.target ?? { project: '.', artifactPrefix: '.' },
    instanceName,
    files,
    changes:
      files.length === 0 && input.rendered.conflicts.length === 0
        ? []
        : [
            ...input.rendered.files.map((file) => ({
              kind: (file.overwrite === 'create-only' ? 'create-file' : 'replace-owned-file') as
                'create-file' | 'replace-owned-file',
              path: file.path,
              summary: `${file.overwrite === 'create-only' ? 'Create' : 'Refresh'} Workspai-owned agent framework file.`,
            })),
            ...(input.mode === 'attach' && input.dependencyRecommendation
              ? [
                  {
                    kind: 'dependency-recommendation' as const,
                    ...input.dependencyRecommendation,
                  },
                ]
              : []),
          ],
    requiredEnvironment: [...input.adapter.context(input.adapterInput).requiredEnvironment],
    permissions: ['network:dependency-registry', 'network:model-provider'],
    blockers: input.rendered.conflicts.map(
      (conflict) => `${conflict.path}: ${conflict.reason.replaceAll('-', ' ')}`
    ),
  };
}

export function resolveDeclaredRuntime(
  runtime: string,
  acceptedRange: string,
  availableRuntimes: string[]
): AgentFrameworkRuntimeResolution {
  const candidates = availableRuntimes
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate === runtime || candidate.startsWith(`${runtime}@`));
  if (candidates.length === 0) {
    return {
      status: 'unavailable',
      runtime: null,
      acceptedRange,
      candidates: [],
      blockers: [`Required runtime ${runtime} (${acceptedRange}) is unavailable.`],
    };
  }
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      runtime: null,
      acceptedRange,
      candidates,
      blockers: [
        `Multiple ${runtime} runtimes are available; the host must select one explicitly.`,
      ],
    };
  }
  return { status: 'resolved', runtime: candidates[0], acceptedRange, candidates, blockers: [] };
}

export { OWNERSHIP_MARKER as AGENT_FRAMEWORK_OWNERSHIP_MARKER };
