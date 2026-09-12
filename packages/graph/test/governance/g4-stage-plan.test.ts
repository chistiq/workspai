import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G4 stage authorization', () => {
  it('retains the signed G3 matrix that authorized G4 work', () => {
    expect(readJson(path.join(packageRoot, 'governance/g3-stage-approval.v1.json'))).toMatchObject({
      stage: 'G3',
      status: 'approved',
      nextStage: 'G4',
      nextStageAuthorized: true,
      approval: { status: 'approved' },
    });
    expect(
      readJson(path.join(packageRoot, 'governance/g3-remote-admission.v1.json'))
    ).toMatchObject({
      stage: 'G3',
      status: 'passed',
      sourceCommit: 'ed18cd5cb435711e742a4dfd99d3778635bf695d',
      workflow: { runId: '34356880325', conclusion: 'success' },
      repositoryGate: { conclusion: 'success' },
    });
  });

  it('keeps later stages, native acceleration and publication blocked', () => {
    const plan = readJson(path.join(packageRoot, 'governance/g4-stage-plan.v1.json'));
    expect(plan).toMatchObject({
      stage: 'G4',
      status: 'in-progress',
      nativeAcceleration: { status: 'prohibited', earliestDecisionStage: 'G6' },
      publicInternalDocuments: 0,
      nextStage: 'G5',
      nextStageAuthorized: false,
    });
    expect(JSON.stringify(plan)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
  });

  it('audits the current repository preview as an honest in-progress candidate', () => {
    const result = spawnSync(process.execPath, ['scripts/check-repository-preview-stage.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G4',
      status: 'in-progress',
      admitted: false,
      nextStage: 'G5',
      nextStageAuthorized: false,
      failures: [],
    });
  });
});
