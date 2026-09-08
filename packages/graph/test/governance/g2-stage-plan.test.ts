import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

describe('Graph G2 stage authorization', () => {
  it('enters G2 only through the approved G1 closure', () => {
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
      currentStage: 'G2',
      stageStatus: 'in-progress',
      latestClosure: 'packages/graph/governance/g1-stage-approval.v1.json',
    });
    const approval = readJson(path.join(repositoryRoot, graph?.latestClosure ?? ''));
    expect(approval).toMatchObject({
      stage: 'G1',
      status: 'approved',
      nextStage: 'G2',
      nextStageAuthorized: true,
      approval: { status: 'approved' },
    });
  });

  it('keeps native acceleration and later-stage claims blocked', () => {
    const plan = readJson(path.join(packageRoot, 'governance/g2-stage-plan.v1.json'));
    expect(plan).toMatchObject({
      stage: 'G2',
      status: 'in-progress',
      nativeAcceleration: { status: 'prohibited', earliestDecisionStage: 'G6' },
      publicInternalDocuments: 0,
      nextStageAuthorized: false,
    });
    expect(JSON.stringify(plan)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
  });
});
