import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const script = path.join(packageRoot, 'scripts/check-foundation-matrix-admission.mjs');
const temporaryDirectories: string[] = [];
const sourceCommit = 'a'.repeat(40);

function repositoryRelative(file: string): string {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

function digest(file: string): string {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function createEvidenceDirectory(): string {
  const testResultsRoot = path.join(repositoryRoot, 'test-results');
  fs.mkdirSync(testResultsRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testResultsRoot, 'graph-matrix-'));
  temporaryDirectories.push(directory);
  const packageManifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
  ) as { name: string; version: string };
  const catalogPath = path.join(packageRoot, 'conformance/contract-catalog.v1.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as { contracts: unknown[] };
  const closurePath = path.join(packageRoot, 'governance/g1-stage-closure.v1.json');

  for (const [runnerOs, platform, runnerArch] of [
    ['Linux', 'linux', 'X64'],
    ['macOS', 'darwin', 'ARM64'],
    ['Windows', 'win32', 'X64'],
  ]) {
    const report = {
      schemaVersion: 'workspai-graph-foundation-admission-audit.v1',
      generatedAt: '2026-09-08T20:00:00.000Z',
      package: packageManifest.name,
      version: packageManifest.version,
      stage: 'G1',
      status: 'passed-platform',
      admitted: false,
      contractCatalog: { count: catalog.contracts.length, digest: digest(catalogPath) },
      closureDigest: digest(closurePath),
      environment: { platform, architecture: runnerArch.toLowerCase(), node: 'v20.19.0' },
      ci: {
        provider: 'github-actions',
        runId: '1234',
        runAttempt: '1',
        commit: sourceCommit,
        ref: 'refs/pull/1/merge',
      },
      platformEvidence: {
        status: 'passed',
        runnerOs,
        runnerArch,
        prerequisite: 'npm run check:package-infrastructure',
      },
      failures: [],
    };
    fs.writeFileSync(
      path.join(directory, `graph-foundation-admission-${runnerOs}.json`),
      `${JSON.stringify(report)}\n`
    );
  }
  return directory;
}

function runAdmission(directory: string): {
  status: number | null;
  stdout: string;
  stderr: string;
  output: Record<string, unknown> | undefined;
} {
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
    stdout: result.stdout,
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

describe('Graph foundation matrix admission', () => {
  it('admits exactly one same-commit report from every required operating system', () => {
    const result = runAdmission(createEvidenceDirectory());

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.output).toMatchObject({
      status: 'admitted-candidate',
      admitted: true,
      nextStageAuthorized: true,
      sourceCommit,
      failures: [],
    });
  });

  it('rejects an incomplete platform matrix', () => {
    const directory = createEvidenceDirectory();
    fs.rmSync(path.join(directory, 'graph-foundation-admission-Windows.json'));
    const result = runAdmission(directory);

    expect(result.status).toBe(1);
    expect(result.output).toMatchObject({
      status: 'blocked',
      admitted: false,
      failures: expect.arrayContaining(['Windows: evidence is missing']),
    });
  });

  it('rejects evidence produced for a different commit', () => {
    const directory = createEvidenceDirectory();
    const evidencePath = path.join(directory, 'graph-foundation-admission-Linux.json');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as {
      ci: { commit: string };
    };
    evidence.ci.commit = 'b'.repeat(40);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
    const result = runAdmission(directory);

    expect(result.status).toBe(1);
    expect(result.output).toMatchObject({
      failures: expect.arrayContaining([
        'Linux: evidence is not bound to the requested GitHub commit',
      ]),
    });
  });
});
