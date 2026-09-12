import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (relative: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(packageRoot, relative), 'utf8')) as Record<string, unknown>;

describe('Graph G8 stage authorization', () => {
  it('binds shadow-only work to the retained protected-main admission', () => {
    const admission = readJson('governance/g7-retained-admission.v1.json');
    const transition = readJson('governance/g7-stage-admission.v1.json');
    const plan = readJson('governance/g8-stage-plan.v1.json');

    expect(admission).toMatchObject({
      repository: 'chistiq/workspai',
      ref: 'refs/heads/main',
      sourceCommit: '12d489ca916fd9898d2e12bc9c3e529b5bf2a160',
      testedCommit: '12d489ca916fd9898d2e12bc9c3e529b5bf2a160',
      runId: '34715037038',
      status: 'admitted',
      standaloneStable: true,
      nextStageAuthorized: true,
      authorizedRuntimeMode: 'g8-shadow-comparison-only',
      currentGraphAuthority: 'official-internal-graph-capability',
      npmPublication: 'prohibited',
      failures: [],
    });
    expect(plan).toMatchObject({
      stage: 'G8',
      status: 'in-progress',
      authorizedBy: 'packages/graph/governance/g7-stage-admission.v1.json',
      authorizedRuntimeMode: 'g8-shadow-comparison-only',
      currentGraphAuthority: 'official-internal-graph-capability',
      nextStage: 'G9',
      nextStageAuthorized: false,
    });
    expect(transition).toMatchObject({
      stage: 'G7',
      status: 'approved',
      advancesAdmissionGate: true,
      nextStage: 'G8',
      nextStageAuthorized: true,
      approval: { status: 'approved' },
    });
    expect(JSON.stringify({ admission, transition, plan })).not.toMatch(
      /(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u
    );
  });

  it('prohibits authority, fallback, writes, user engine choice and publication', () => {
    const plan = readJson('governance/g8-stage-plan.v1.json');
    const invariants = plan.invariants as string[];
    expect(invariants).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/released CLI remains the only Graph authority/i),
        expect.stringMatching(/read-only/i),
        expect.stringMatching(/No package failure may silently fall back/i),
        expect.stringMatching(/Users do not select an engine/i),
        expect.stringMatching(/npm publication stays prohibited/i),
      ])
    );
  });
});
