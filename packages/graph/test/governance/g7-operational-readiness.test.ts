import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function portable(target: string): string {
  return path.relative(repositoryRoot, target).split(path.sep).join(path.posix.sep);
}

function fixture(name: string, source: string): string {
  const root = path.join(packageRoot, 'test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'g7-operational-'));
  temporary.push(directory);
  const target = path.join(directory, name);
  fs.copyFileSync(path.join(packageRoot, source), target);
  return target;
}

function run(args: string[] = []) {
  return spawnSync(process.execPath, ['scripts/check-g7-operational-readiness.mjs', ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
}

describe('Graph G7 operational readiness', () => {
  it('locks the internal bridge contract and proves a non-destructive rollback boundary', () => {
    const result = run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 'workspai-graph-g7-operational-readiness-audit.v1',
      package: '@workspai/graph',
      status: 'ready-for-current-commit-matrix',
      contractEpoch: 'graph-internal-v1',
      rollbackTarget: 'official-internal-graph-capability',
      centralCliRuntimeImports: 0,
      baselineRunId: '34703877434',
      baselineAdmitted: false,
      currentCommitEvidenceRequired: true,
      failures: [],
    });
  });

  it('rejects a contract lock whose catalog binding is stale', () => {
    const target = fixture('contract-lock.json', 'governance/g7-internal-contract-lock.v1.json');
    const lock = JSON.parse(fs.readFileSync(target, 'utf8')) as {
      catalog: { digest: string };
    };
    lock.catalog.digest = `sha256:${'0'.repeat(64)}`;
    fs.writeFileSync(target, JSON.stringify(lock));

    const result = run(['--contract-lock', portable(target)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      'internal Graph contract catalog digest drifted'
    );
  });

  it('rejects silent fallback or a user-managed Rust toolchain', () => {
    const target = fixture(
      'operations-policy.json',
      'governance/g7-migration-rollback-policy.v1.json'
    );
    const policy = JSON.parse(fs.readFileSync(target, 'utf8')) as {
      runtime: { silentFallback: string; userRustToolchain: string };
    };
    policy.runtime.silentFallback = 'allowed';
    policy.runtime.userRustToolchain = 'required';
    fs.writeFileSync(target, JSON.stringify(policy));

    const result = run(['--operations-policy', portable(target)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      'Graph runtime fallback or zero-toolchain boundary drifted'
    );
  });

  it('rejects promotion without exact signed artifact and workflow identity binding', () => {
    const target = fixture(
      'promotion-policy.json',
      'governance/g7-migration-rollback-policy.v1.json'
    );
    const policy = JSON.parse(fs.readFileSync(target, 'utf8')) as {
      promotion: {
        requiresRepositoryAndSignerWorkflowVerification: boolean;
        requiresExactArtifactAndSbomBinding: boolean;
      };
    };
    policy.promotion.requiresRepositoryAndSignerWorkflowVerification = false;
    policy.promotion.requiresExactArtifactAndSbomBinding = false;
    fs.writeFileSync(target, JSON.stringify(policy));

    const result = run(['--operations-policy', portable(target)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      'Graph internal promotion policy is incomplete'
    );
  });

  it('rejects retained evidence that claims admission or omits a platform', () => {
    const target = fixture('baseline.json', 'governance/g7-verified-baseline.v1.json');
    const baseline = JSON.parse(fs.readFileSync(target, 'utf8')) as {
      candidate: { admitted: boolean };
      platformEvidence: unknown[];
    };
    baseline.candidate.admitted = true;
    baseline.platformEvidence.pop();
    fs.writeFileSync(target, JSON.stringify(baseline));

    const result = run(['--verified-baseline', portable(target)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      'retained G7 baseline metadata is incomplete or overclaims admission'
    );
  });
});
