import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const readJson = (relative: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(packageRoot, relative), 'utf8')) as Record<string, unknown>;

describe('Graph G8 blocked closure', () => {
  it('records a shadow-candidate ledger that does not admit replacement or G9', () => {
    const closure = readJson('governance/g8-stage-closure.v1.json');
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(repositoryRoot, 'contracts/independent-package-stage-closure.v1.json'),
        'utf8'
      )
    ) as Record<string, unknown>;
    expect(new Ajv2020({ strict: false }).compile(schema)(closure)).toBe(true);
    expect(closure).toMatchObject({
      stage: 'G8',
      status: 'blocked',
      advancesAdmissionGate: false,
      nextStage: 'G9',
      nextStageAuthorized: false,
      measurements: {
        outcome: 'g8-shadow-candidate',
        packagePrimary: false,
        authorizedRuntimeMode: 'g8-shadow-comparison-only',
      },
      approval: { status: 'awaiting' },
    });
    expect(JSON.stringify(closure)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
  });

  it('audits the blocked G8 closure through the package admission script', () => {
    const result = spawnSync(process.execPath, ['scripts/check-g8-closure.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G8',
      outcome: 'g8-shadow-candidate',
      status: 'blocked',
      admitted: false,
      nextStageAuthorized: false,
      failures: [],
    });
  });
});
