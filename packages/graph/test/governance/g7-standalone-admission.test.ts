import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const temporary: string[] = [];
const canonicalAdmission = path.join(packageRoot, 'governance/g7-standalone-admission.v1.json');
const portableRelativePath = (target: string): string =>
  path.relative(repositoryRoot, target).split(path.sep).join(path.posix.sep);

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureDirectory(): string {
  const resultRoot = path.join(packageRoot, 'test-results');
  fs.mkdirSync(resultRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(resultRoot, 'g7-standalone-admission-'));
  temporary.push(directory);
  return directory;
}

function runAudit(arguments_: string[] = []) {
  return spawnSync(
    process.execPath,
    ['scripts/check-standalone-admission.mjs', '--json', ...arguments_],
    { cwd: packageRoot, encoding: 'utf8' }
  );
}

describe('Graph G7 standalone admission', () => {
  it('reports the canonical candidate as valid but blocked', () => {
    const result = runAudit(['--allow-blocked']);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      package: '@workspai/graph',
      version: '0.0.0-development',
      status: 'blocked',
      admitted: false,
      standaloneStable: false,
      nextStage: 'G8',
      nextStageAuthorized: false,
      runtimeDependencies: {
        shared: {
          requestedVersion: '0.0.0-development',
          packageVersion: '0.0.0-development',
          lockfileVersion: '0.0.0-development',
          internalReady: true,
        },
      },
      failures: [],
    });
  });

  it('uses a distinct exit code when an otherwise valid candidate is not admitted', () => {
    const result = runAudit();
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'blocked', failures: [] });
  });

  it('rejects forged stability while package metadata and registry remain unadmitted', () => {
    const directory = fixtureDirectory();
    const admission = JSON.parse(fs.readFileSync(canonicalAdmission, 'utf8'));
    admission.gates = admission.gates.map((gate: Record<string, unknown>) => ({
      ...gate,
      status: 'passed',
    }));
    admission.status = 'admitted';
    admission.admitted = true;
    admission.standaloneStable = true;
    admission.nextStageAuthorized = true;
    const manifest = path.join(directory, 'forged-admission.json');
    fs.writeFileSync(manifest, JSON.stringify(admission));

    const result = runAudit(['--allow-blocked', '--manifest', portableRelativePath(manifest)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'invalid',
      admitted: false,
      standaloneStable: false,
      nextStageAuthorized: false,
    });
    expect(JSON.parse(result.stdout).failures).toContain(
      'admitted Graph state is not reflected by package, registry and metadata'
    );
  });

  it('rejects a blocked dependency gate when the private Shared workspace is ready', () => {
    const directory = fixtureDirectory();
    const admission = JSON.parse(fs.readFileSync(canonicalAdmission, 'utf8'));
    admission.gates = admission.gates.map((gate: Record<string, unknown>) =>
      gate.id === 'shared-workspace-runtime-integrity' ? { ...gate, status: 'blocked' } : gate
    );
    const manifest = path.join(directory, 'forged-dependency.json');
    fs.writeFileSync(manifest, JSON.stringify(admission));

    const result = runAudit(['--allow-blocked', '--manifest', portableRelativePath(manifest)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      'Shared workspace runtime is ready but its Graph dependency gate is blocked'
    );
  });

  it('rejects evidence paths outside the repository', () => {
    const directory = fixtureDirectory();
    const admission = JSON.parse(fs.readFileSync(canonicalAdmission, 'utf8'));
    admission.gates[0].evidence = ['../outside.json'];
    const manifest = path.join(directory, 'unsafe-evidence.json');
    fs.writeFileSync(manifest, JSON.stringify(admission));

    const result = runAudit(['--allow-blocked', '--manifest', portableRelativePath(manifest)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      'unsafe evidence for version-1-standalone-jobs: ../outside.json'
    );
  });
});
