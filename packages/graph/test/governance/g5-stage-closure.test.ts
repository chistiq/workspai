import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G5 stage closure', () => {
  it('registers G5 as locally complete in the independent package registry', () => {
    const repositoryRoot = path.resolve(packageRoot, '../..');
    const registry = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'independent-packages.json'), 'utf8')
    ) as {
      packages: {
        name: string;
        currentStage: string;
        stageStatus: string;
        latestClosure: string;
      }[];
    };
    expect(registry.packages.find((entry) => entry.name === '@workspai/graph')).toMatchObject({
      currentStage: 'G5',
      stageStatus: 'local-source-complete',
      latestClosure: 'packages/graph/governance/g5-stage-closure.v1.json',
    });
  });

  it('records local pass with remote admission still pending', () => {
    const closure = readJson(path.join(packageRoot, 'governance/g5-stage-closure.v1.json'));
    expect(closure).toMatchObject({
      stage: 'G5',
      status: 'local-passed-remote-pending-awaiting-approval',
      advancesAdmissionGate: false,
      nextStage: 'G6',
      nextStageAuthorized: false,
    });
    expect(JSON.stringify(closure)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
    const checks = closure.checks as { id: string; status: string }[];
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'g5-local-source-checkpoints', status: 'passed' }),
        expect.objectContaining({ id: 'remote-platform-matrix', status: 'pending-remote' }),
      ])
    );
  });

  it('audits G5 local source completion through the package admission script', () => {
    const result = spawnSync(process.execPath, ['scripts/check-g5-stage.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G5',
      status: 'local-source-complete',
      admitted: false,
      nextStage: 'G6',
      nextStageAuthorized: false,
      failures: [],
    });
  });
});
