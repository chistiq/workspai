import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const script = path.join(packageRoot, 'scripts/check-composition-admission.mjs');

function run(args: readonly string[], environment?: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...(environment ? { env: environment } : {}),
  });
  if (result.error) throw result.error;
  return result;
}

describe('Graph composition admission audit', () => {
  it('reports an honest local G2 remote-pending candidate', () => {
    const result = run(['--allow-pending', '--json']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 'workspai-graph-composition-admission-audit.v2',
      stage: 'G2',
      status: 'pending-remote',
      admitted: false,
      failures: [],
    });
  });

  it('rejects forged CI evidence without the GitHub and prerequisite environment', () => {
    const environment = { ...process.env };
    delete environment.GITHUB_ACTIONS;
    delete environment.WORKSPAI_PACKAGE_INFRASTRUCTURE_PASSED;
    delete environment.WORKSPAI_ADMISSION_SOURCE_COMMIT;
    delete environment.GITHUB_SHA;
    const result = run(['--ci-evidence', '--json'], environment);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'invalid',
      platformEvidence: { status: 'failed' },
      failures: expect.arrayContaining([
        'CI evidence requires GitHub Actions',
        'CI evidence requires the preceding package-infrastructure pass',
        'CI evidence requires the full source commit SHA',
        'CI evidence requires the full tested commit SHA',
      ]),
    });
  });

  it('binds platform evidence to distinct source and tested commits', () => {
    const environment = {
      ...process.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REF: 'refs/pull/58/merge',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: '34292221450',
      GITHUB_SHA: 'b'.repeat(40),
      RUNNER_ARCH: 'X64',
      RUNNER_OS: 'Linux',
      WORKSPAI_ADMISSION_SOURCE_COMMIT: 'a'.repeat(40),
      WORKSPAI_PACKAGE_INFRASTRUCTURE_PASSED: '1',
    };
    const result = run(['--ci-evidence', '--json'], environment);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'passed-platform',
      ci: {
        sourceCommit: 'a'.repeat(40),
        testedCommit: 'b'.repeat(40),
        event: 'pull_request',
      },
      failures: [],
    });
  });

  it('rejects output paths that escape the repository', () => {
    const result = run(['--allow-pending', '--output', '../escaped.json']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--output must be a safe repository-relative path');
  });
});
