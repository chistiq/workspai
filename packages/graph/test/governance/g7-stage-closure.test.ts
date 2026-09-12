import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G7 stage closure', () => {
  it('keeps the independent package registry on G5', () => {
    const repositoryRoot = path.resolve(packageRoot, '../..');
    const registry = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'independent-packages.json'), 'utf8')
    ) as {
      packages: {
        name: string;
        currentStage: string;
        latestClosure: string;
        standaloneStability?: string;
      }[];
    };
    expect(registry.packages.find((entry) => entry.name === '@workspai/graph')).toMatchObject({
      currentStage: 'G5',
      latestClosure: 'packages/graph/governance/g5-stage-closure.v1.json',
      standaloneStability: 'not-admitted',
    });
  });

  it('records local pass with remote admission still pending', () => {
    const closure = readJson(path.join(packageRoot, 'governance/g7-stage-closure.v1.json'));
    expect(closure).toMatchObject({
      stage: 'G7',
      status: 'local-passed-remote-pending-awaiting-approval',
      advancesAdmissionGate: false,
      nextStage: 'G8',
      nextStageAuthorized: false,
      measurements: {
        standaloneStable: false,
        signedAttestation: 'not-generated',
        rollbackProcedure: 'not-proven',
        cliRuntimeBridges: 0,
        nativeTruthImplementations: 0,
        publicInternalDocuments: 0,
      },
    });
    expect(JSON.stringify(closure)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
    const checks = closure.checks as { id: string; status: string }[];
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'g7-local-source-checkpoints', status: 'passed' }),
        expect.objectContaining({
          id: 'remote-platform-and-internal-promotion',
          status: 'pending-remote',
        }),
        expect.objectContaining({ id: 'standalone-stable-admission', status: 'blocked' }),
      ])
    );
    const dimensions = closure.dimensions as { id: string; status: string }[];
    expect(dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'portability-and-multiplatform',
          status: 'pending-remote',
        }),
      ])
    );
  });

  it('audits G7 local source completion without authorizing G8', () => {
    const result = spawnSync(process.execPath, ['scripts/check-g7-stage.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G7',
      status: 'local-source-complete',
      admitted: false,
      standaloneStable: false,
      nextStage: 'G8',
      nextStageAuthorized: false,
      registryStage: 'G5',
      failures: [],
    });
  });
});
