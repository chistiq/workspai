import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Graph G3 stage authorization', () => {
  it('retains the approved signed G3 transition in governance history', () => {
    expect(readJson(path.join(packageRoot, 'governance/g3-stage-approval.v1.json'))).toMatchObject({
      stage: 'G3',
      status: 'approved',
      nextStage: 'G4',
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
