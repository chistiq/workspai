import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const script = path.join(packageRoot, 'scripts/check-composition-matrix-admission.mjs');
const temporaryDirectories: string[] = [];
const sourceCommit = 'c'.repeat(40);

function repositoryRelative(file: string): string {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

function createEvidenceDirectory(): string {
  const testResultsRoot = path.join(repositoryRoot, 'test-results');
  fs.mkdirSync(testResultsRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testResultsRoot, 'graph-composition-matrix-'));
  temporaryDirectories.push(directory);
  for (const [runnerOs, platform, runnerArch] of [
    ['Linux', 'linux', 'X64'],
    ['macOS', 'darwin', 'ARM64'],
    ['Windows', 'win32', 'X64'],
  ]) {
    const report = {
      schemaVersion: 'workspai-graph-composition-admission-audit.v1',
      generatedAt: '2026-09-08T20:00:00.000Z',
      package: '@workspai/graph',
      version: '0.0.0-development',
      stage: 'G2',
      status: 'passed-platform',
      admitted: false,
      closureDigest: `sha256:${'a'.repeat(64)}`,
      implementationDigest: `sha256:${'b'.repeat(64)}`,
      implementationPaths: [],
      environment: { platform, architecture: runnerArch.toLowerCase(), node: 'v20.19.0' },
      platformEvidence: {
        status: 'passed',
        runnerOs,
        runnerArch,
        prerequisite: 'npm run check:package-infrastructure',
      },
      ci: {
        provider: 'github-actions',
        runId: '4321',
        runAttempt: '1',
        commit: sourceCommit,
        ref: 'refs/pull/1/merge',
      },
      failures: [],
    };
    fs.writeFileSync(
      path.join(directory, `graph-composition-admission-${runnerOs}.json`),
      `${JSON.stringify(report)}\n`
    );
  }
  return directory;
}

function runAdmission(directory: string) {
  const output = path.join(directory, 'candidate-output.json');
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--evidence-directory',
      repositoryRelative(directory),
      '--source-commit',
      sourceCommit,
      '--output',
      repositoryRelative(output),
    ],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  return {
    status: result.status,
    stderr: result.stderr,
    output: fs.existsSync(output)
      ? (JSON.parse(fs.readFileSync(output, 'utf8')) as Record<string, unknown>)
      : undefined,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Graph composition matrix admission', () => {
  it('admits one same-commit, same-implementation report per required platform', () => {
    const result = runAdmission(createEvidenceDirectory());
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.output).toMatchObject({
      stage: 'G2',
      status: 'admitted-candidate',
      admitted: true,
      nextStage: 'G3',
      nextStageAuthorized: true,
      sourceCommit,
      failures: [],
    });
  });

  it('rejects missing platforms and cross-platform implementation drift', () => {
    const missingDirectory = createEvidenceDirectory();
    fs.rmSync(path.join(missingDirectory, 'graph-composition-admission-Windows.json'));
    expect(runAdmission(missingDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: evidence is missing']),
    });

    const driftDirectory = createEvidenceDirectory();
    const evidencePath = path.join(driftDirectory, 'graph-composition-admission-macOS.json');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as {
      implementationDigest: string;
    };
    evidence.implementationDigest = `sha256:${'d'.repeat(64)}`;
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
    expect(runAdmission(driftDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'macOS: closure or implementation digest drifted across the matrix',
      ]),
    });
  });
});
