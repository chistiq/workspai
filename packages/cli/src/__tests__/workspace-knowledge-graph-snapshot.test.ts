import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
} from '../contracts/workspace-intelligence-runtime-registry.js';
import type { WorkspaceKnowledgeGraph } from '../contracts/workspace-knowledge-graph-contract.js';
import type { WorkspaceModel } from '../workspace-model.js';
import { hashWorkspaceModel } from '../workspace-model-hash.js';
import { readWorkspaceKnowledgeGraphSnapshot } from '../workspace-knowledge-graph-snapshot.js';
import { computeWorkspaceKnowledgeGraphInputFingerprint } from '../workspace-knowledge-graph.js';

describe('workspace knowledge graph snapshot', () => {
  const roots: string[] = [];
  const execFileAsync = promisify(execFile);

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
  });

  async function fixture(options: { git?: boolean } = {}): Promise<{
    root: string;
    model: WorkspaceModel;
    graph: WorkspaceKnowledgeGraph;
  }> {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-snapshot-'));
    roots.push(root);
    const topology = {
      schemaVersion: 'workspace-dependency-graph.v1',
      generatedAt: '2026-08-10T00:00:00.000Z',
      nodes: [],
      edges: [],
      stats: { nodeCount: 0, edgeCount: 0, inferredEdges: 0, contractEdges: 0, manualEdges: 0 },
    };
    const model = {
      schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.model,
      generatedAt: '2026-08-10T00:00:00.000Z',
      workspace: { name: 'snapshot', profile: 'polyglot' },
      projects: [],
      projectTopology: topology,
      graph: topology,
      evidence: {},
      summary: {
        projectCount: 0,
        runtimes: [],
        frameworks: [],
        firstClassProjects: 0,
        observedProjects: 0,
      },
    } as unknown as WorkspaceModel;
    const graph = {
      schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph,
      generatedAt: '2026-08-10T00:00:00.000Z',
      source: {
        kind: 'workspace-model',
        artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
        hashAlgorithm: 'sha256',
        hash: hashWorkspaceModel(model),
      },
      workspace: { name: 'snapshot', profile: 'polyglot' },
      projectTopology: topology,
      entities: [],
      relations: [],
      proofs: [],
      providers: [],
      quality: {
        entityCount: 0,
        relationCount: 0,
        proofCount: 0,
        entityProofCoverageRatio: 1,
        relationProofCoverageRatio: 1,
        providerSuccessRatio: 1,
        conflictCount: 0,
        unknownCount: 0,
        portable: true,
        secretValuesEmitted: false,
      },
      diagnostics: [],
    } as unknown as WorkspaceKnowledgeGraph;
    await fsExtra.outputFile(path.join(root, 'src', 'main.rs'), 'fn main() {}\n');
    if (options.git) {
      await execFileAsync('git', ['init', '--quiet'], { cwd: root });
      await execFileAsync('git', ['config', 'user.email', 'test@workspai.local'], { cwd: root });
      await execFileAsync('git', ['config', 'user.name', 'Workspai Test'], { cwd: root });
      await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });
      await execFileAsync('git', ['add', 'src/main.rs'], { cwd: root });
      await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
    }
    graph.source.inputs = await computeWorkspaceKnowledgeGraphInputFingerprint({
      workspacePath: root,
      projects: [],
      projectFileLimit: 100,
      workspaceFileLimit: 100,
    });
    await fsExtra.outputJson(path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.model), model);
    await fsExtra.outputJson(
      path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph),
      graph
    );
    return { root, model, graph };
  }

  it('reuses a schema-valid graph bound to the persisted model hash', async () => {
    const { root } = await fixture();
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toMatchObject({
      status: 'hit',
      model: { workspace: { name: 'snapshot' } },
      graph: { workspace: { name: 'snapshot' } },
    });
  });

  it('uses Git tree and worktree state and detects repeated edits to an already-modified file', async () => {
    const { root, graph } = await fixture({ git: true });
    expect(graph.source.inputs?.scopes[0]?.strategy).toBe('git-worktree-v2');
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toMatchObject({
      status: 'hit',
    });
    await fsExtra.outputFile(path.join(root, 'src', 'main.rs'), 'fn main() { println!("one"); }\n');
    const first = await computeWorkspaceKnowledgeGraphInputFingerprint({
      workspacePath: root,
      projects: [],
      projectFileLimit: 100,
      workspaceFileLimit: 100,
    });
    await fsExtra.outputFile(path.join(root, 'src', 'main.rs'), 'fn main() { println!("two"); }\n');
    const second = await computeWorkspaceKnowledgeGraphInputFingerprint({
      workspacePath: root,
      projects: [],
      projectFileLimit: 100,
      workspaceFileLimit: 100,
    });
    expect(first.hash).not.toBe(second.hash);
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toEqual({
      status: 'miss',
      reason: 'live-input-mismatch',
    });
  });

  it('does not invalidate Git-backed graph evidence when managed outputs change', async () => {
    const { root } = await fixture({ git: true });
    const managedReport = path.join(root, '.workspai', 'reports', 'generated.json');
    await fsExtra.outputJson(managedReport, { generatedAt: '2026-01-01T00:00:00.000Z' });
    await execFileAsync('git', ['add', '.workspai/reports/generated.json'], { cwd: root });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'track managed output'], { cwd: root });
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toMatchObject({
      status: 'hit',
    });

    await fsExtra.outputJson(managedReport, { generatedAt: '2026-01-02T00:00:00.000Z' });
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toMatchObject({
      status: 'hit',
    });
  });

  it.runIf(process.platform !== 'win32')(
    'keeps the Git strategy when the workspace path is a logical alias of the physical worktree',
    async () => {
      const { root } = await fixture({ git: true });
      const aliasedRoot = `${root}-alias`;
      roots.push(aliasedRoot);
      await fsExtra.symlink(root, aliasedRoot, 'dir');

      const fingerprint = await computeWorkspaceKnowledgeGraphInputFingerprint({
        workspacePath: aliasedRoot,
        projects: [],
        projectFileLimit: 100,
        workspaceFileLimit: 100,
      });

      expect(fingerprint.scopes[0]).toMatchObject({
        kind: 'workspace',
        strategy: 'git-worktree-v2',
      });
    }
  );

  it('rejects a graph whose source hash does not match the model', async () => {
    const { root, graph } = await fixture();
    graph.source.hash = '0'.repeat(64);
    await fsExtra.outputJson(
      path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph),
      graph
    );
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toEqual({
      status: 'miss',
      reason: 'source-mismatch',
    });
  });

  it.each([
    [
      'modified',
      async (root: string) =>
        fsExtra.outputFile(
          path.join(root, 'src', 'main.rs'),
          'fn main() { println!("changed"); }\n'
        ),
    ],
    [
      'added',
      async (root: string) =>
        fsExtra.outputFile(path.join(root, 'src', 'added.ts'), 'export const added = true;\n'),
    ],
    ['deleted', async (root: string) => fsExtra.remove(path.join(root, 'src', 'main.rs'))],
  ])('rejects a snapshot when a live input is %s', async (_scenario, mutate) => {
    const { root } = await fixture();
    await mutate(root);
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toEqual({
      status: 'miss',
      reason: 'live-input-mismatch',
    });
  });

  it('rejects legacy graph snapshots without a live-input fingerprint', async () => {
    const { root, graph } = await fixture();
    delete graph.source.inputs;
    await fsExtra.outputJson(
      path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph),
      graph
    );
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toEqual({
      status: 'miss',
      reason: 'missing-input-fingerprint',
    });
  });

  it('rejects snapshots containing explicitly stale proof evidence', async () => {
    const { root, graph } = await fixture();
    graph.proofs.push({ freshness: 'stale' } as WorkspaceKnowledgeGraph['proofs'][number]);
    await fsExtra.outputJson(
      path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph),
      graph
    );
    await expect(readWorkspaceKnowledgeGraphSnapshot(root)).resolves.toEqual({
      status: 'miss',
      reason: 'stale-proof',
    });
  });
});
