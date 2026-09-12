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

function platformReport(
  runnerOs: 'Linux' | 'macOS' | 'Windows',
  platform: 'linux' | 'darwin' | 'win32',
  sourceCommit: string,
  testedCommit: string,
  extra: Record<string, unknown> = {}
) {
  return {
    schemaVersion: 'workspai-graph-g6-admission-audit.v1',
    stage: 'G6',
    status: 'passed-platform',
    admitted: false,
    nextStage: 'G7',
    nextStageAuthorized: false,
    registryStage: 'G5',
    nativeAcceleration: 'prohibited',
    planDigest: `sha256:${'c'.repeat(64)}`,
    closureDigest: `sha256:${'d'.repeat(64)}`,
    implementationDigest: `sha256:${'e'.repeat(64)}`,
    environment: { platform, node: 'v20.20.0' },
    platformEvidence: {
      status: 'passed',
      runnerOs,
      runnerArch: 'test',
      prerequisite: 'npm run check:package-infrastructure',
    },
    ci: {
      provider: 'github-actions',
      runId: '123',
      event: 'pull_request',
      sourceCommit,
      testedCommit,
    },
    failures: [],
    ...extra,
  };
}

function combine(directory: string, sourceCommit: string, testedCommit: string) {
  const output = path.join(directory, 'candidate.json');
  return spawnSync(
    process.execPath,
    [
      'packages/graph/scripts/check-g6-matrix-admission.mjs',
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
}

describe('Graph G6 platform admission', () => {
  it('reports an honest local remote-pending candidate without authorizing G7', () => {
    const result = spawnSync(process.execPath, ['scripts/check-g6-admission.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G6',
      status: 'pending-remote',
      admitted: false,
      nextStage: 'G7',
      nextStageAuthorized: false,
      registryStage: 'G5',
      nativeAcceleration: 'prohibited',
      failures: [],
    });
  });

  it('admits exactly one same-run report for every required platform without authorizing G7', () => {
    const resultRoot = path.join(packageRoot, 'test-results');
    fs.mkdirSync(resultRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(resultRoot, 'g6-matrix-'));
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
        JSON.stringify(platformReport(runnerOs, platform, sourceCommit, testedCommit))
      );
    }
    const result = combine(directory, sourceCommit, testedCommit);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G6',
      status: 'admitted-platform-candidate',
      admitted: true,
      nextStage: 'G7',
      nextStageAuthorized: false,
      requiredRunnerOperatingSystems: ['Linux', 'Windows', 'macOS'],
    });
  });

  it('blocks an incomplete matrix without authorizing G7', () => {
    const resultRoot = path.join(packageRoot, 'test-results');
    fs.mkdirSync(resultRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(resultRoot, 'g6-matrix-incomplete-'));
    temporary.push(directory);
    const sourceCommit = 'a'.repeat(40);
    const testedCommit = 'b'.repeat(40);
    fs.writeFileSync(
      path.join(directory, 'Linux.json'),
      JSON.stringify(platformReport('Linux', 'linux', sourceCommit, testedCommit))
    );
    const result = combine(directory, sourceCommit, testedCommit);
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G6',
      admitted: false,
      nextStageAuthorized: false,
    });
  });

  it('rejects a platform report that authorizes G7 or native acceleration', () => {
    const resultRoot = path.join(packageRoot, 'test-results');
    fs.mkdirSync(resultRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(resultRoot, 'g6-matrix-forbidden-'));
    temporary.push(directory);
    const sourceCommit = 'a'.repeat(40);
    const testedCommit = 'b'.repeat(40);
    fs.writeFileSync(
      path.join(directory, 'Linux.json'),
      JSON.stringify(
        platformReport('Linux', 'linux', sourceCommit, testedCommit, {
          nextStageAuthorized: true,
          nativeAcceleration: 'allowed',
        })
      )
    );
    fs.writeFileSync(
      path.join(directory, 'macOS.json'),
      JSON.stringify(platformReport('macOS', 'darwin', sourceCommit, testedCommit))
    );
    fs.writeFileSync(
      path.join(directory, 'Windows.json'),
      JSON.stringify(platformReport('Windows', 'win32', sourceCommit, testedCommit))
    );
    const result = combine(directory, sourceCommit, testedCommit);
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      admitted: false,
      nextStageAuthorized: false,
    });
  });
});
