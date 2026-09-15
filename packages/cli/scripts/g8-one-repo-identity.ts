/**
 * One-repo directional identity probe. Not a published CLI command.
 * Runs package/legacy shadow comparison only, then exits.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { runPreparedProjectGraphShadow } from '../src/graph-package-shadow-bridge.js';
import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  createGraphShadowProjectScopeDigest,
  createGraphShadowReadOnlyAuthorizationDigest,
  createGraphShadowResourceBudgetDigest,
  summarizeGraphShadowSemanticFamilies,
  summarizeGraphShadowStructuralDeltas,
  summarizeGraphShadowUnknownCauses,
} from '../src/graph-shadow-parity.js';
import { buildWorkspaceKnowledgeGraph } from '../src/workspace-knowledge-graph.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../src/contracts/workspace-intelligence-runtime-registry.js';
import { hashCanonicalJson } from '../src/workspace-model-hash.js';

function withoutGroupingSeparators(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('\0', '|');
  if (Array.isArray(value)) return value.map(withoutGroupingSeparators);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, withoutGroupingSeparators(nested)])
    );
  }
  return value;
}

const PATH_LEAK = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\\\\)/u;
const FIXED_GENERATED_AT = '2026-09-12T00:00:00.000Z';

const project = process.argv[2];
const repo = process.argv[3];
if (!project || !repo || !path.isAbsolute(repo)) {
  throw new Error('Usage: g8-one-repo-identity.ts <project> <absolute-repo>');
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  return (result.stdout ?? '').trim();
}

const commit = git(repo, ['rev-parse', 'HEAD']);
const porcelain = git(repo, ['status', '--porcelain']);
const dirty = porcelain.length > 0;
let root = repo;
let cleanup: (() => void) | undefined;
if (dirty) {
  const worktree = path.join(os.tmpdir(), `g8-ref-${randomUUID()}`);
  const added = spawnSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (added.status !== 0) {
    throw new Error('Pinned commit checkout for a dirty reference worktree failed.');
  }
  root = worktree;
  cleanup = () => {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
    });
    rmSync(worktree, { recursive: true, force: true });
  };
}

async function main(): Promise<void> {
  const started = performance.now();
  try {
    const inventoryDigest = hashCanonicalJson({ id: project, projectId: project });
    const placeholder = {
      sourceFixtureDigest: inventoryDigest.startsWith('sha256:')
        ? inventoryDigest
        : `sha256:${'d'.repeat(64)}`,
      scopeDigest: createGraphShadowProjectScopeDigest(project),
      providerProfileDigest: `sha256:${'d'.repeat(64)}`,
      graphPolicyDigest: `sha256:${'d'.repeat(64)}`,
      redactionAuthorizationDigest: createGraphShadowReadOnlyAuthorizationDigest(),
      resourceBudgetDigest: createGraphShadowResourceBudgetDigest(GRAPH_SHADOW_DEFAULT_LIMITS),
      legacyCli: { version: '0.75.1', commit: 'a'.repeat(40) },
      graphPackage: { version: '0.0.0-development', commit: 'b'.repeat(40) },
    };
    const legacy = async () =>
      buildWorkspaceKnowledgeGraph({
        workspacePath: root,
        workspace: { name: project },
        projects: [{ id: project, path: '.', absolutePath: root }],
        projectTopology: {
          schemaVersion: 'workspace-dependency-graph.v1',
          generatedAt: FIXED_GENERATED_AT,
          nodes: [{ id: project, path: '.' }],
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
        },
        now: new Date(FIXED_GENERATED_AT),
        inventoryFileLimitPerProject: 500_000,
        maxFilesPerProject: 100_000,
        semanticFilesPerProject: 100_000,
        sourceFilesPerProject: 100_000,
        source: {
          kind: 'workspace-model',
          artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
          hashAlgorithm: 'sha256',
          hash: inventoryDigest,
        },
      });
    const request = {
      context: { projectId: project, projectRoot: root, workspaceId: project },
      profile: 'g8-reference-identity.v1',
      binding: placeholder,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy,
    };
    const discovery = await runPreparedProjectGraphShadow(request);
    const semantic = discovery.packageExecution.semanticBinding;
    if (!semantic) {
      const payload = {
        id: project,
        commit,
        status: 'failed',
        reason: 'partial-package-execution',
        packageExecution: discovery.packageExecution.status,
        ms: Math.round(performance.now() - started),
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = 3;
      return;
    }
    const compared = await runPreparedProjectGraphShadow({
      ...request,
      binding: {
        ...placeholder,
        sourceFixtureDigest: semantic.sourceFixtureDigest,
        providerProfileDigest: semantic.providerProfileDigest,
        graphPolicyDigest: semantic.graphPolicyDigest,
      },
    });
    const differenceCodes = [
      ...new Set(compared.report.differences.map((item) => item.code)),
    ].sort();
    const unsafeIdentity = compared.report.differences.filter(
      (item) => item.code === 'GRAPH_SHADOW_UNSAFE_IDENTITY'
    );
    const payload = {
      id: project,
      commit,
      clean: !dirty,
      evaluatedFrom: dirty ? 'pinned-commit-worktree' : 'clean-worktree',
      status: compared.report.status,
      packageExecution: compared.packageExecution.status,
      differenceCodes,
      semanticFamilies: summarizeGraphShadowSemanticFamilies(compared.report.differences),
      unknownCauses: summarizeGraphShadowUnknownCauses(compared.report.differences),
      structuralDeltas: summarizeGraphShadowStructuralDeltas(compared.report.differences),
      hasUnsafeIdentity: unsafeIdentity.length > 0,
      regressions: compared.report.metrics.regressions,
      unsafeIdentity: unsafeIdentity.map((item) => ({
        key: item.key,
        reason: item.reason,
        legacy: item.legacy,
        package: item.package,
      })),
      ms: Math.round(performance.now() - started),
    };
    const serialized = `${JSON.stringify(withoutGroupingSeparators(payload), null, 2)}\n`;
    if (PATH_LEAK.test(serialized)) {
      throw new Error('One-repo identity report leaked a machine path.');
    }
    process.stdout.write(serialized);
    process.exitCode = payload.status === 'failed' || payload.hasUnsafeIdentity ? 3 : 0;
  } finally {
    cleanup?.();
  }
}

void main();
