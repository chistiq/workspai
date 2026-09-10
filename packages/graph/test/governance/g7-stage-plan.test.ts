import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G7 stage authorization', () => {
  it('opens G7 product-surface checkpoints while registry remains on G5', () => {
    const plan = readJson(path.join(packageRoot, 'governance/g7-stage-plan.v1.json'));
    expect(plan).toMatchObject({
      stage: 'G7',
      status: 'local-source-continuation',
      nextStage: 'G8',
      nextStageAuthorized: false,
      publicInternalDocuments: 0,
      nativeAcceleration: { status: 'prohibited', earliestDecisionStage: 'G6' },
    });
    expect(JSON.stringify(plan)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);

    const checkpoints = plan.checkpoints as { id: string; status: string }[];
    expect(checkpoints.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'honest-package-status-and-capability-ledger',
        'stable-export-map-lock',
        'cli-json-and-exit-contract',
        'published-support-limitations-matrix',
        'g7-standalone-stable-admission',
      ])
    );
    for (const checkpoint of checkpoints) {
      if (
        checkpoint.id === 'g7-standalone-stable-admission' ||
        checkpoint.id === 'sbom-provenance-security-verification' ||
        checkpoint.id === 'retrieval-benchmark-command'
      ) {
        expect(checkpoint.status).toBe('planned');
        continue;
      }
      expect(checkpoint.status).toBe('implemented-local-candidate');
    }
  });

  it('audits G7 as an unauthorized local product-surface continuation', () => {
    const result = spawnSync(process.execPath, ['scripts/check-g7-stage.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G7',
      status: 'local-source-continuation',
      admitted: false,
      standaloneStable: false,
      nextStage: 'G8',
      nextStageAuthorized: false,
      registryStage: 'G5',
      failures: [],
    });
  });
});
