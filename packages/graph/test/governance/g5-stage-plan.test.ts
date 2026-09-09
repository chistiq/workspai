import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G5 stage authorization', () => {
  it('opens G5 with projection, slice and workspace composition checkpoints', () => {
    const plan = readJson(path.join(packageRoot, 'governance/g5-stage-plan.v1.json'));
    expect(plan).toMatchObject({
      stage: 'G5',
      status: 'local-source-complete',
      nextStage: 'G6',
      nextStageAuthorized: false,
      publicInternalDocuments: 0,
    });
    expect(JSON.stringify(plan)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
    const checkpoints = plan.checkpoints as { id: string; status: string }[];
    expect(checkpoints.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'versioned-projection-profile-and-result',
        'generic-graph-slice-contract',
        'workspace-graph-composition',
        'derived-projection-profiles',
        'standalone-dual-scope-orchestration',
        'workspace-artifact-store-adapter',
      ])
    );
    for (const checkpoint of checkpoints) {
      if (checkpoint.id === 'g5-cross-platform-admission') {
        expect(checkpoint.status).toBe('planned');
        continue;
      }
      expect(checkpoint.status).toBe('implemented-local-candidate');
    }
  });
});
