import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G3 stage authorization', () => {
  it('enters G3 only through the approved signed G2 matrix', () => {
    const registry = readJson(path.join(repositoryRoot, 'independent-packages.json')) as {
      packages: {
        name: string;
        currentStage: string;
        stageStatus: string;
        latestClosure: string;
      }[];
    };
    const graph = registry.packages.find((entry) => entry.name === '@workspai/graph');
    expect(graph).toMatchObject({
      currentStage: 'G3',
      stageStatus: 'in-progress',
      latestClosure: 'packages/graph/governance/g2-stage-approval.v1.json',
    });
    expect(readJson(path.join(repositoryRoot, graph?.latestClosure ?? ''))).toMatchObject({
      stage: 'G2',
      status: 'approved',
      nextStage: 'G3',
      nextStageAuthorized: true,
      approval: { status: 'approved' },
    });
  });

  it('keeps native and later-stage claims blocked', () => {
    const plan = readJson(path.join(packageRoot, 'governance/g3-stage-plan.v1.json'));
    expect(plan).toMatchObject({
      stage: 'G3',
      status: 'in-progress',
      nativeAcceleration: { status: 'prohibited', earliestDecisionStage: 'G6' },
      publicInternalDocuments: 0,
      nextStageAuthorized: false,
    });
    expect(JSON.stringify(plan)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
  });
});
