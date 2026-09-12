import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const temporary: string[] = [];
const portableRelativePath = (target: string): string =>
  path.relative(repositoryRoot, target).split(path.sep).join(path.posix.sep);

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Graph G4 repository preview admission', () => {
  it('reports an honest local remote-pending candidate', () => {
    const result = spawnSync(process.execPath, ['scripts/check-repository-preview-admission.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G4',
      status: 'pending-remote',
      admitted: false,
      failures: [],
    });
  });

  it('admits exactly one same-run report for every required platform', () => {
    const resultRoot = path.join(packageRoot, 'test-results');
    fs.mkdirSync(resultRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(resultRoot, 'repository-preview-matrix-'));
    temporary.push(directory);
    const sourceCommit = 'a'.repeat(40);
    const testedCommit = 'b'.repeat(40);
    for (const [runnerOs, platform] of [
      ['Linux', 'linux'],
      ['macOS', 'darwin'],
      ['Windows', 'win32'],
    ] as const) {
      fs.writeFileSync(
        path.join(directory, `${runnerOs}.json`),
        JSON.stringify({
          schemaVersion: 'workspai-graph-repository-preview-admission-audit.v1',
          stage: 'G4',
          status: 'passed-platform',
          planDigest: `sha256:${'c'.repeat(64)}`,
          closureDigest: `sha256:${'d'.repeat(64)}`,
          implementationDigest: `sha256:${'e'.repeat(64)}`,
          environment: { platform, node: 'v20.20.0' },
          platformEvidence: { runnerOs, runnerArch: 'test' },
          ci: { runId: '123', event: 'pull_request', sourceCommit, testedCommit },
        })
      );
    }
    const output = path.join(directory, 'candidate.json');
    const result = spawnSync(
      process.execPath,
      [
        'packages/graph/scripts/check-repository-preview-matrix-admission.mjs',
        '--evidence-directory',
        portableRelativePath(directory),
        '--source-commit',
        sourceCommit,
        '--tested-commit',
        testedCommit,
        '--output',
        portableRelativePath(output),
      ],
      { cwd: repositoryRoot, encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G4',
      admitted: true,
      nextStage: 'G5',
      nextStageAuthorized: true,
      requiredRunnerOperatingSystems: ['Linux', 'Windows', 'macOS'],
    });
  });
});
