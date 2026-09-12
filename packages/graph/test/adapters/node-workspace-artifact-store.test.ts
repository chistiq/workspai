import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createNodeProjectArtifactStore,
  createNodeWorkspaceArtifactStore,
} from '../../src/adapters/node/index.js';
import type { GraphProjectArtifact, GraphProjectArtifactName } from '../../src/ports/index.js';

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function workspaceFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-workspace-publication-'));
  temporary.push(root);
  return root;
}

function jsonArtifact(name: GraphProjectArtifactName, value: unknown): GraphProjectArtifact {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  return {
    name,
    mediaType: 'application/json',
    bytes,
    digest: {
      algorithm: 'sha256',
      value: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function workspaceArtifacts(generationKey: string): readonly GraphProjectArtifact[] {
  const generation = {
    reference: {
      id: `generation:${generationKey}`,
      generatedAt: '2026-09-09T00:00:00.000Z',
      contentDigest: { algorithm: 'sha256', value: generationKey },
    },
  };
  const graph = jsonArtifact('canonical-graph', { generation, nodes: [], edges: [] });
  const quality = jsonArtifact('quality', { status: 'complete' });
  const providers = jsonArtifact('provider-runs', { projectReferences: [] });
  const base = '.workspai/reports/graph-generations';
  const publication = jsonArtifact('publication', {
    schemaVersion: 'workspai.graph.workspace-publication-index.v1',
    generation: {
      generation,
      artifactDigest: graph.digest,
      qualityDigest: quality.digest,
      publication: 'committed',
    },
    buildStatus: 'complete',
    projectReferences: [],
    artifacts: {
      'canonical-graph': {
        digest: graph.digest.value,
        path: `${base}/${generationKey}/workspace-graph.json`,
      },
      quality: {
        digest: quality.digest.value,
        path: `${base}/${generationKey}/workspace-graph-quality.json`,
      },
      'provider-runs': {
        digest: providers.digest.value,
        path: `${base}/${generationKey}/workspace-provider-runs.json`,
      },
    },
  });
  return [graph, quality, providers, publication];
}

describe('Node workspace graph artifact store', () => {
  it('publishes immutable workspace generations with workspace artifact filenames', async () => {
    const root = await workspaceFixture();
    const generationKey = 'a'.repeat(64);
    const store = createNodeWorkspaceArtifactStore(root);

    const first = await store.publish({
      generationKey,
      artifacts: workspaceArtifacts(generationKey),
    });
    const second = await store.publish({
      generationKey,
      artifacts: workspaceArtifacts(generationKey),
    });

    expect(first.status).toBe('committed');
    expect(second.status).toBe('already-current');
    expect(first.artifacts['canonical-graph']).toMatch(
      /\.workspai\/reports\/graph-generations\/[a-f0-9]{64}\/workspace-graph\.json/u
    );
    await expect(
      fs.readFile(
        path.join(
          root,
          '.workspai',
          'reports',
          'graph-generations',
          generationKey,
          'workspace-graph.json'
        ),
        'utf8'
      )
    ).resolves.toContain('"nodes":[]');
  });

  it('coexists with the project store under one host root using distinct locks', async () => {
    const root = await workspaceFixture();
    const projectKey = 'b'.repeat(64);
    const workspaceKey = 'd'.repeat(64);
    const projectStore = createNodeProjectArtifactStore(root);
    const workspaceStore = createNodeWorkspaceArtifactStore(root);
    const generation = (generationKey: string) => ({
      reference: {
        id: `generation:${generationKey}`,
        generatedAt: '2026-09-09T00:00:00.000Z',
        contentDigest: { algorithm: 'sha256', value: generationKey },
      },
    });
    const buildProjectArtifacts = (generationKey: string) => {
      const currentGeneration = generation(generationKey);
      const graph = jsonArtifact('canonical-graph', {
        generation: currentGeneration,
        nodes: [],
        edges: [],
      });
      const quality = jsonArtifact('quality', { status: 'complete' });
      const providers = jsonArtifact('provider-runs', []);
      const base = '.workspai/reports/graph-generations';
      const publication = jsonArtifact('publication', {
        schemaVersion: 'workspai.graph.project-publication-index.v1',
        generation: {
          generation: currentGeneration,
          artifactDigest: graph.digest,
          qualityDigest: quality.digest,
          publication: 'committed',
        },
        buildStatus: 'complete',
        artifacts: {
          'canonical-graph': {
            digest: graph.digest.value,
            path: `${base}/${generationKey}/source-evidence-graph.json`,
          },
          quality: {
            digest: quality.digest.value,
            path: `${base}/${generationKey}/source-evidence-graph-quality.json`,
          },
          'provider-runs': {
            digest: providers.digest.value,
            path: `${base}/${generationKey}/graph-provider-runs.json`,
          },
        },
      });
      return [graph, quality, providers, publication] as const;
    };

    await projectStore.publish({
      generationKey: projectKey,
      artifacts: buildProjectArtifacts(projectKey),
    });
    await workspaceStore.publish({
      generationKey: workspaceKey,
      artifacts: workspaceArtifacts(workspaceKey),
    });

    await expect(
      fs.readFile(
        path.join(
          root,
          '.workspai',
          'reports',
          'graph-generations',
          projectKey,
          'source-evidence-graph.json'
        ),
        'utf8'
      )
    ).resolves.toContain('"nodes":[]');
    await expect(
      fs.readFile(
        path.join(
          root,
          '.workspai',
          'reports',
          'graph-generations',
          workspaceKey,
          'workspace-graph.json'
        ),
        'utf8'
      )
    ).resolves.toContain('"nodes":[]');
    await expect(
      fs.stat(path.join(root, '.workspai', 'reports', '.graph-publication.lock'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.stat(path.join(root, '.workspai', 'reports', '.workspace-graph-publication.lock'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects forged workspace publication bindings before touching metadata', async () => {
    const root = await workspaceFixture();
    const generationKey = 'c'.repeat(64);
    const candidate = [...workspaceArtifacts(generationKey)];
    const publicationIndex = candidate.find((artifact) => artifact.name === 'publication');
    expect(publicationIndex).toBeDefined();
    const decoded = JSON.parse(new TextDecoder().decode(publicationIndex?.bytes)) as {
      artifacts: { 'canonical-graph': { digest: string; path: string } };
    };
    decoded.artifacts['canonical-graph'].path =
      '.workspai/reports/graph-generations/forged/workspace-graph.json';
    const forgedPublication = jsonArtifact('publication', decoded);
    const forgedSet = candidate.map((artifact) =>
      artifact.name === 'publication' ? forgedPublication : artifact
    );

    await expect(
      createNodeWorkspaceArtifactStore(root).publish({ generationKey, artifacts: forgedSet })
    ).rejects.toThrow('artifact binding');
    await expect(fs.stat(path.join(root, '.workspai'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
