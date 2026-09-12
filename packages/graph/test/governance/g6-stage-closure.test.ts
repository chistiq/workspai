import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G6 stage closure', () => {
  it('records local pass with remote admission still pending', () => {
    const closure = readJson(path.join(packageRoot, 'governance/g6-stage-closure.v1.json'));
    expect(closure).toMatchObject({
      stage: 'G6',
      status: 'local-passed-remote-pending-awaiting-approval',
      advancesAdmissionGate: false,
      nextStage: 'G7',
      nextStageAuthorized: false,
    });
    expect(JSON.stringify(closure)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
    const checks = closure.checks as { id: string; status: string }[];
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'g6-local-source-checkpoints', status: 'passed' }),
        expect.objectContaining({ id: 'remote-platform-matrix', status: 'pending-remote' }),
      ])
    );
  });

  it('audits G6 local source completion through the package admission script', () => {
    const result = spawnSync(process.execPath, ['scripts/check-g6-stage.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G6',
      status: 'local-source-complete',
      admitted: false,
      nextStage: 'G7',
      nextStageAuthorized: false,
      failures: [],
    });
  });
});
