import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeProjectArtifactStore } from '../../src/adapters/node/index.js';
import type { GraphProjectArtifact, GraphProjectArtifactName } from '../../src/ports/index.js';

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function projectFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-publication-'));
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

function artifacts(generationKey: string): readonly GraphProjectArtifact[] {
  const generation = {
    reference: {
      id: `generation:${generationKey}`,
      generatedAt: '2026-09-09T00:00:00.000Z',
      contentDigest: { algorithm: 'sha256', value: generationKey },
    },
  };
  const graph = jsonArtifact('canonical-graph', { generation, nodes: [], edges: [] });
  const quality = jsonArtifact('quality', { status: 'complete' });
  const providers = jsonArtifact('provider-runs', []);
  const base = '.workspai/reports/graph-generations';
  const publication = jsonArtifact('publication', {
    schemaVersion: 'workspai.graph.project-publication-index.v1',
    generation: {
      generation,
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
  return [graph, quality, providers, publication];
}

describe('Node project graph artifact store', () => {
  it('publishes an immutable generation and advances a portable pointer last', async () => {
    const root = await projectFixture();
    const generationKey = 'a'.repeat(64);
    const store = createNodeProjectArtifactStore(root);

    const first = await store.publish({ generationKey, artifacts: artifacts(generationKey) });
    const second = await store.publish({ generationKey, artifacts: artifacts(generationKey) });

    expect(first.status).toBe('committed');
    expect(second.status).toBe('already-current');
    expect(first.pointer).toBe('.workspai/reports/graph-generation.json');
    expect(Object.values(first.artifacts).every((value) => !path.isAbsolute(value))).toBe(true);
    const pointer = await fs.readFile(path.join(root, first.pointer), 'utf8');
    expect(JSON.parse(pointer)).toMatchObject({
      schemaVersion: 'workspai.graph.project-publication-index.v1',
      buildStatus: 'complete',
      artifacts: {
        'canonical-graph': {
          path: expect.stringMatching(/^\.workspai\/reports\/graph-generations\//u),
        },
      },
    });
    expect(pointer).not.toContain(root);
    await expect(
      fs.readFile(
        path.join(
          root,
          '.workspai',
          'reports',
          'graph-generations',
          generationKey,
          'source-evidence-graph.json'
        ),
        'utf8'
      )
    ).resolves.toContain('"nodes":[]');
  });

  it('rejects content corruption without advancing the trusted pointer', async () => {
    const root = await projectFixture();
    const store = createNodeProjectArtifactStore(root);
    const firstKey = 'b'.repeat(64);
    const corruptKey = 'c'.repeat(64);
    await store.publish({ generationKey: firstKey, artifacts: artifacts(firstKey) });
    const pointerPath = path.join(root, '.workspai', 'reports', 'graph-generation.json');
    const trustedPointer = await fs.readFile(pointerPath, 'utf8');
    const corruptDirectory = path.join(
      root,
      '.workspai',
      'reports',
      'graph-generations',
      corruptKey
    );
    await fs.mkdir(corruptDirectory, { recursive: true });
    await fs.writeFile(path.join(corruptDirectory, 'source-evidence-graph.json'), 'forged\n');

    await expect(
      store.publish({ generationKey: corruptKey, artifacts: artifacts(corruptKey) })
    ).rejects.toThrow('content identity');
    await expect(fs.readFile(pointerPath, 'utf8')).resolves.toBe(trustedPointer);
  });

  it('rejects concurrent writers and cancellation before creating metadata', async () => {
    const root = await projectFixture();
    const store = createNodeProjectArtifactStore(root);
    const reports = path.join(root, '.workspai', 'reports');
    await fs.mkdir(reports, { recursive: true });
    await fs.writeFile(path.join(reports, '.graph-publication.lock'), 'active');

    await expect(
      store.publish({ generationKey: 'd'.repeat(64), artifacts: artifacts('d'.repeat(64)) })
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(fs.stat(path.join(reports, 'graph-generation.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const cancelledRoot = await projectFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createNodeProjectArtifactStore(cancelledRoot).publish({
        generationKey: 'e'.repeat(64),
        artifacts: artifacts('e'.repeat(64)),
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fs.stat(path.join(cancelledRoot, '.workspai'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the previous pointer when a generation directory exists without a commit and recovers on retry', async () => {
    const root = await projectFixture();
    const store = createNodeProjectArtifactStore(root);
    const firstKey = 'a'.repeat(64);
    const secondKey = 'b'.repeat(64);
    await store.publish({ generationKey: firstKey, artifacts: artifacts(firstKey) });
    const pointerPath = path.join(root, '.workspai', 'reports', 'graph-generation.json');
    const trustedPointer = await fs.readFile(pointerPath, 'utf8');
    const secondArtifacts = artifacts(secondKey);
    const generationDirectory = path.join(
      root,
      '.workspai',
      'reports',
      'graph-generations',
      secondKey
    );
    await fs.mkdir(generationDirectory, { recursive: true });
    const files: Record<GraphProjectArtifactName, string> = {
      'canonical-graph': 'source-evidence-graph.json',
      quality: 'source-evidence-graph-quality.json',
      'provider-runs': 'graph-provider-runs.json',
      publication: 'graph-generation.json',
    };
    for (const artifact of secondArtifacts) {
      await fs.writeFile(path.join(generationDirectory, files[artifact.name]), artifact.bytes);
    }

    expect(await fs.readFile(pointerPath, 'utf8')).toBe(trustedPointer);

    const recovered = await store.publish({
      generationKey: secondKey,
      artifacts: secondArtifacts,
    });

    expect(recovered.status).toBe('committed');
    expect(JSON.parse(await fs.readFile(pointerPath, 'utf8'))).toMatchObject({
      generation: {
        generation: { reference: { contentDigest: { value: secondKey } } },
      },
    });
    await expect(
      fs.readFile(
        path.join(
          root,
          '.workspai',
          'reports',
          'graph-generations',
          firstKey,
          'source-evidence-graph.json'
        ),
        'utf8'
      )
    ).resolves.toContain('"nodes":[]');
  });

  it('rejects malformed artifact sets before touching the project', async () => {
    const root = await projectFixture();
    const store = createNodeProjectArtifactStore(root);
    const generationKey = 'f'.repeat(64);
    const malformed = artifacts(generationKey).slice(1);

    await expect(store.publish({ generationKey, artifacts: malformed })).rejects.toThrow(
      'exactly one artifact'
    );
    await expect(fs.stat(path.join(root, '.workspai'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a self-hashed publication pointer that forges an artifact binding', async () => {
    const root = await projectFixture();
    const generationKey = '1'.repeat(64);
    const candidate = [...artifacts(generationKey)];
    const publicationIndex = candidate.find((artifact) => artifact.name === 'publication');
    expect(publicationIndex).toBeDefined();
    const decoded = JSON.parse(new TextDecoder().decode(publicationIndex?.bytes)) as {
      artifacts: { 'canonical-graph': { digest: string; path: string } };
    };
    decoded.artifacts['canonical-graph'].path =
      '.workspai/reports/graph-generations/forged/source-evidence-graph.json';
    const forgedPublication = jsonArtifact('publication', decoded);
    const forgedSet = candidate.map((artifact) =>
      artifact.name === 'publication' ? forgedPublication : artifact
    );

    await expect(
      createNodeProjectArtifactStore(root).publish({ generationKey, artifacts: forgedSet })
    ).rejects.toThrow('artifact binding');
    await expect(fs.stat(path.join(root, '.workspai'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
