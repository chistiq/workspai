import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createNodeGraphProductHostPorts } from '../../src/adapters/node/index.js';
import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildRepoGraph,
  executeGraphReferenceCompositionTask,
} from '../../src/application/index.js';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/index.js';
import type { GraphWorkerTaskRequest, GraphWorkerTaskResult } from '../../src/ports/index.js';
import { createStandardRepositoryProviders } from '../../src/providers/index.js';

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/g4/repositories'
);

const supported = [
  ['node', 'imports', 'exposes'],
  ['python', 'imports', 'exposes'],
  ['go', 'imports', 'exposes'],
  ['java', 'imports', 'exposes'],
  ['dotnet', 'imports', 'exposes'],
  ['rust', 'imports', undefined],
  ['c-cpp', 'imports', undefined],
  ['objective-c-matlab', 'imports', undefined],
  ['php', 'imports', undefined],
  ['ruby', 'imports', undefined],
  ['swift', 'imports', undefined],
] as const;

function buildFixture(language: string) {
  const nodePorts = createNodeGraphProductHostPorts();
  return buildRepoGraph({
    root: path.join(fixtureRoot, language),
    scope: { kind: 'project', projectIds: [`project:fixture-${language}`] },
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    providers: createStandardRepositoryProviders(),
    policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
    ports: {
      ...nodePorts,
      workers: {
        async execute<TInput, TOutput>(
          request: GraphWorkerTaskRequest<TInput>
        ): Promise<GraphWorkerTaskResult<TOutput>> {
          return {
            status: 'complete',
            output: executeGraphReferenceCompositionTask(request.input as never) as TOutput,
            diagnostics: [],
            metrics: { durationMs: 0, inputBytes: 0, outputBytes: 0 },
          };
        },
      },
    },
  });
}

describe('G4 repository fixture matrix', () => {
  for (const [language, importRelation, routeRelation] of supported) {
    it(`builds meaningful evidence-backed ${language} repository facts`, async () => {
      const result = await buildFixture(language);
      if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

      expect(['complete', 'partial']).toContain(result.status);
      expect(result.graph.edges.some((edge) => edge.relation === importRelation)).toBe(true);
      if (routeRelation) {
        expect(result.graph.edges.some((edge) => edge.relation === routeRelation)).toBe(true);
      }
      expect(result.graph.edges.every((edge) => edge.proof.evidence.length > 0)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(fixtureRoot);
    });
  }

  it('returns honest partial quality for a recognized unsupported source language', async () => {
    const result = await buildFixture('unsupported');

    expect(result.status).toBe('partial');
    expect(result.quality.unsupportedZones).toContainEqual(
      expect.objectContaining({ code: 'graph.source-language-unsupported' })
    );
  });
});
