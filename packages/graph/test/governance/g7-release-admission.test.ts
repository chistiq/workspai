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
    schemaVersion: 'workspai-graph-g7-release-candidate-audit.v1',
    stage: 'G7',
    status: 'passed-platform-candidate',
    admitted: false,
    standaloneStable: false,
    publicPreview: false,
    provenance: 'unattested',
    rollbackProcedure: 'defined-unactivated',
    nextStage: 'G8',
    nextStageAuthorized: false,
    registryStage: 'G5',
    planDigest: `sha256:${'a'.repeat(64)}`,
    closureDigest: `sha256:${'b'.repeat(64)}`,
    inventoryDigest: `sha256:${'c'.repeat(64)}`,
    sbomDigest: `sha256:${'d'.repeat(64)}`,
    releaseInputsDigest: `sha256:${'e'.repeat(64)}`,
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

function g6Candidate(sourceCommit: string, testedCommit: string, extra = {}) {
  return {
    schemaVersion: 'workspai-graph-g6-matrix-admission.v1',
    stage: 'G6',
    status: 'admitted-platform-candidate',
    admitted: true,
    nextStageAuthorized: false,
    sourceCommit,
    testedCommit,
    requiredRunnerOperatingSystems: ['Linux', 'Windows', 'macOS'],
    evidence: ['Linux', 'macOS', 'Windows'].map((runnerOs) => ({
      runnerOs,
      runId: '123',
      digest: `sha256:${runnerOs === 'Linux' ? '1' : runnerOs === 'macOS' ? '2' : '3'}`.padEnd(
        71,
        runnerOs === 'Linux' ? '1' : runnerOs === 'macOS' ? '2' : '3'
      ),
    })),
    failures: [],
    ...extra,
  };
}

function combine(directory: string, g6Path: string, sourceCommit: string, testedCommit: string) {
  const output = path.join(directory, 'candidate.json');
  const result = spawnSync(
    process.execPath,
    [
      'packages/graph/scripts/check-g7-release-matrix.mjs',
      '--evidence-directory',
      portableRelativePath(directory),
      '--g6-candidate',
      portableRelativePath(g6Path),
      '--source-commit',
      sourceCommit,
      '--tested-commit',
      testedCommit,
      '--output',
      portableRelativePath(output),
    ],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  return { result, output };
}

function matrixFixture(options: { g6?: Record<string, unknown> } = {}) {
  const resultRoot = path.join(packageRoot, 'test-results');
  fs.mkdirSync(resultRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(resultRoot, 'g7-release-matrix-'));
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
  const g6Path = path.join(directory, 'g6-candidate.fixture');
  fs.writeFileSync(g6Path, JSON.stringify(g6Candidate(sourceCommit, testedCommit, options.g6)));
  return { directory, g6Path, sourceCommit, testedCommit };
}

describe('Graph G7 release-candidate admission', () => {
  it('reports an honest local candidate without claiming publication or stability', () => {
    const resultRoot = path.join(packageRoot, 'test-results');
    fs.mkdirSync(resultRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(resultRoot, 'g7-release-local-'));
    temporary.push(directory);
    const output = path.join(directory, 'report.json');
    const result = spawnSync(
      process.execPath,
      ['scripts/check-g7-release-candidate.mjs', '--output', portableRelativePath(output)],
      { cwd: packageRoot, encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      stage: 'G7',
      status: 'pending-remote',
      admitted: false,
      standaloneStable: false,
      publicPreview: false,
      provenance: 'unattested',
      rollbackProcedure: 'defined-unactivated',
      nextStageAuthorized: false,
      failures: [],
    });
  });

  it('verifies one same-run G7 report per platform only when bound to G6', () => {
    const fixture = matrixFixture();
    const { result, output } = combine(
      fixture.directory,
      fixture.g6Path,
      fixture.sourceCommit,
      fixture.testedCommit
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      stage: 'G7',
      status: 'verified-release-candidate',
      candidatePassed: true,
      admitted: false,
      standaloneStable: false,
      publicPreview: false,
      nextStageAuthorized: false,
      requiredRunnerOperatingSystems: ['Linux', 'Windows', 'macOS'],
      failures: [],
    });
  });

  it('blocks a valid-looking G7 matrix when its G6 prerequisite is not admitted', () => {
    const fixture = matrixFixture({ g6: { admitted: false, status: 'blocked' } });
    const { result, output } = combine(
      fixture.directory,
      fixture.g6Path,
      fixture.sourceCommit,
      fixture.testedCommit
    );
    expect(result.status).not.toBe(0);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      candidatePassed: false,
      admitted: false,
      standaloneStable: false,
      nextStageAuthorized: false,
    });
  });

  it('blocks cross-run evidence and forged stability claims', () => {
    const fixture = matrixFixture();
    const linuxPath = path.join(fixture.directory, 'Linux.json');
    const linux = JSON.parse(fs.readFileSync(linuxPath, 'utf8'));
    linux.ci.runId = '456';
    linux.standaloneStable = true;
    fs.writeFileSync(linuxPath, JSON.stringify(linux));
    const { result, output } = combine(
      fixture.directory,
      fixture.g6Path,
      fixture.sourceCommit,
      fixture.testedCommit
    );
    expect(result.status).not.toBe(0);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      candidatePassed: false,
      admitted: false,
      standaloneStable: false,
      nextStageAuthorized: false,
    });
  });
});
