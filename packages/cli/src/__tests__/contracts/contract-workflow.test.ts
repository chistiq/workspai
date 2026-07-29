import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const monorepoRoot = path.resolve(repoRoot, '..', '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readMonorepo(relativePath: string): string {
  return fs.readFileSync(path.join(monorepoRoot, relativePath), 'utf8');
}

describe('shared contracts workflow (Wave A + B)', () => {
  it('uses one npm-owned script to generate, sync, and validate shared extension contracts', () => {
    const npmPackage = JSON.parse(read('package.json'));
    const syncScript = read('scripts/sync-shared-contracts.mjs');
    const preCommit = readMonorepo('.husky/pre-commit');

    expect(npmPackage.scripts['sync:shared-contracts']).toContain('sync-shared-contracts');
    expect(npmPackage.scripts['check:shared-contracts']).toContain('sync-shared-contracts');
    expect(npmPackage.scripts['validate:contracts']).toContain('check:shared-contracts');
    expect(npmPackage.scripts['sync:parity-snapshot']).toBe(
      npmPackage.scripts['sync:shared-contracts']
    );
    expect(npmPackage.scripts['check:parity-snapshot']).toBe(
      npmPackage.scripts['check:shared-contracts']
    );
    expect(npmPackage.scripts['generate:contracts']).toContain('generate-shared-contracts');
    expect(syncScript).toContain('Canonical contracts live in packages/cli/contracts/');
    expect(syncScript).toContain('runGenerator()');
    expect(syncScript).toContain('rapidkit-vscode/contracts');
    expect(syncScript).toContain('rapidkit-vscode/src/contracts');
    expect(syncScript).toContain('listJsonContracts');
    expect(syncScript).toContain('module-layout.v1.json');
    expect(syncScript).toContain('infra-stack.v1.json');
    expect(syncScript).toContain('--stage-git');
    expect(syncScript).toContain('stageSyncedContracts');
    expect(preCommit).toContain('sync:shared-contracts -- --stage-git');
    expect(preCommit).toContain('run validate:contracts');
  });

  it('keeps official generator drift coverage release-safe and cost bounded', () => {
    const smokeWorkflow = readMonorepo('.github/workflows/frontend-generator-smoke.yml');
    const releaseWorkflow = readMonorepo('.github/workflows/release-npm-manual.yml');

    expect(smokeWorkflow).toContain('name: Official Generator Smoke');
    expect(releaseWorkflow).toContain("'Official Generator Smoke'");
    expect(smokeWorkflow).toContain('cancel-in-progress: true');
    expect(smokeWorkflow).toContain('MATRIX_MODE="primary"');
    expect(smokeWorkflow).toContain('MATRIX_MODE="full"');
    expect(smokeWorkflow).toContain("github.event.inputs.generators == ''");
    expect(smokeWorkflow).toContain('RAPIDKIT_OFFICIAL_GENERATOR_WORKSPACE_ROOT');
    expect(smokeWorkflow).toContain('Restore Composer download cache');
    expect(releaseWorkflow).toContain("run.display_title?.endsWith('· primary')");
    expect(releaseWorkflow).not.toContain("run.display_title?.endsWith('· full')");
  });
});
