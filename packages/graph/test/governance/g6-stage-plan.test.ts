import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G6 stage authorization', () => {
  it('opens G6 with incremental contract checkpoints while registry remains on G5', () => {
    const plan = readJson(path.join(packageRoot, 'governance/g6-stage-plan.v1.json'));
    expect(plan).toMatchObject({
      stage: 'G6',
      status: 'in-progress',
      nextStage: 'G7',
      nextStageAuthorized: false,
      publicInternalDocuments: 0,
      nativeAcceleration: { status: 'prohibited', earliestDecisionStage: 'G6' },
    });
    expect(JSON.stringify(plan)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);

    const checkpoints = plan.checkpoints as { id: string; status: string }[];
    expect(checkpoints.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'versioned-changeset-and-graph-delta-contract',
        'content-state-manifest-contract',
        'merkle-comparison-engine',
      ])
    );
    for (const checkpoint of checkpoints) {
      if (checkpoint.id === 'g6-cross-platform-admission') {
        expect(checkpoint.status).toBe('planned');
        continue;
      }
      if (
        checkpoint.id === 'versioned-changeset-and-graph-delta-contract' ||
        checkpoint.id === 'content-state-manifest-contract' ||
        checkpoint.id === 'merkle-comparison-engine' ||
        checkpoint.id === 'shard-reuse-and-invalidation' ||
        checkpoint.id === 'incremental-build-orchestration'
      ) {
        expect(checkpoint.status).toBe('implemented-local-candidate');
        continue;
      }
      expect(checkpoint.status).toBe('planned');
    }
  });
});
