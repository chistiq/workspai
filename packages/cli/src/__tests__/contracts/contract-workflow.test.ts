import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const monorepoRoot = path.resolve(repoRoot, '..', '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readMonorepo(relativePath: string): string {
  return fs.readFileSync(path.join(monorepoRoot, relativePath), 'utf8');
}

describe('shared contracts workflow (Wave A + B)', () => {
  it('synchronizes consumers while keeping CLI publication independently gated', () => {
    const npmPackage = JSON.parse(read('package.json'));
    const rootPackage = JSON.parse(readMonorepo('package.json'));
    const syncScript = read('scripts/sync-shared-contracts.mjs');
    const preCommit = readMonorepo('.husky/pre-commit');
    const releaseWorkflow = readMonorepo('.github/workflows/release-npm-manual.yml');

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
    expect(syncScript).toContain('--require-consumer');
    expect(syncScript).toContain('--require-clean');
    expect(syncScript).toContain('--require-consumer-clean');
    expect(syncScript).toContain('assertCanonicalContractsCommitted');
    expect(syncScript).toContain('assertConsumerContractsCommitted');
    expect(npmPackage.scripts['contracts:prepush']).toContain('sync:shared-contracts');
    expect(npmPackage.scripts['contracts:prepush']).toContain('--require-clean');
    expect(rootPackage.scripts['prepush:check']).toContain('contracts:prepush');
    expect(preCommit).toContain('sync:shared-contracts -- --stage-git');
    expect(preCommit).toContain('run contracts:check:local');
    expect(preCommit).not.toContain('run validate:contracts');
    expect(releaseWorkflow).not.toContain("'Consumer Contract Parity'");
  });

  it('keeps official generator drift coverage release-safe and cost bounded', () => {
    const smokeWorkflow = readMonorepo('.github/workflows/frontend-generator-smoke.yml');
    const releaseWorkflow = readMonorepo('.github/workflows/release-npm-manual.yml');
    const parsedSmokeWorkflow = YAML.parse(smokeWorkflow);
    const pushPaths = parsedSmokeWorkflow.on.push.paths as string[];
    const pullRequestPaths = parsedSmokeWorkflow.on.pull_request.paths as string[];

    expect(smokeWorkflow).toContain('name: Official Generator Smoke');
    expect(releaseWorkflow).toContain("'Official Generator Smoke · primary'");
    expect(smokeWorkflow).toContain('cancel-in-progress: true');
    expect(parsedSmokeWorkflow.on.push.branches).toEqual(['main', 'develop']);
    expect(parsedSmokeWorkflow.on.pull_request.branches).toEqual(['main', 'develop']);
    expect(parsedSmokeWorkflow.permissions).toMatchObject({
      contents: 'read',
      'pull-requests': 'read',
    });
    expect(parsedSmokeWorkflow.jobs.impact.outputs).toHaveProperty('run_official');
    expect(parsedSmokeWorkflow.jobs.impact.outputs).toHaveProperty('run_native');
    expect(parsedSmokeWorkflow.jobs.network.needs).toEqual(['impact', 'contract']);
    expect(parsedSmokeWorkflow.jobs.network.strategy.matrix).toBe(
      '${{ fromJSON(needs.impact.outputs.matrix) }}'
    );
    expect(pushPaths).toEqual(pullRequestPaths);
    expect(pushPaths).toContain('packages/cli/src/generators/**');
    expect(pushPaths).toContain('packages/cli/package.json');
    expect(pushPaths).toContain('package-lock.json');
    expect(pushPaths).toContain('.github/workflows/release-npm-manual.yml');
    expect(smokeWorkflow).toContain('uses: dorny/paths-filter@v4');
    expect(smokeWorkflow).toContain('MODE="primary"');
    expect(smokeWorkflow).toContain('MODE="full"');
    expect(smokeWorkflow).toContain('SELECT_ARGS=(--groups all)');
    expect(smokeWorkflow).toContain('GROUPS+=(frontend)');
    expect(smokeWorkflow).toContain('GROUPS+=(platform)');
    expect(smokeWorkflow).toContain("echo 'run_official=false'");
    expect(smokeWorkflow).toContain('needs.impact.outputs.run_official');
    expect(smokeWorkflow).toContain('needs.impact.outputs.run_native');
    expect(smokeWorkflow).toContain('RAPIDKIT_OFFICIAL_GENERATOR_WORKSPACE_ROOT');
    expect(smokeWorkflow).toContain('Restore Composer download cache');
    expect(smokeWorkflow).toContain('extensions: fileinfo');
    expect(releaseWorkflow).toContain("run.name === 'Official Generator Smoke · primary'");
    expect(releaseWorkflow).toContain("run.event !== 'push'");
    expect(releaseWorkflow).not.toContain('run.display_title?.endsWith');
    expect(releaseWorkflow).not.toContain("'Official Generator Smoke · full'");
  });

  it('selects official generator impact groups from the canonical contract', () => {
    const scriptPath = path.join(repoRoot, 'scripts/smoke-official-generators.mjs');
    const contract = JSON.parse(read('contracts/create-planner-capabilities.v1.json'));
    const available = (
      contract.officialCreate as Array<{
        id: string;
        status: string;
        canExecuteCreate: boolean;
      }>
    ).filter((entry) => entry.status === 'available' && entry.canExecuteCreate === true);

    const probe = (group: string): string[] => {
      const result = spawnSync(process.execPath, [scriptPath, '--list', '--groups', group], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as string[];
    };

    const frontend = probe('frontend');
    const platform = probe('platform');
    expect(frontend.length).toBeGreaterThan(0);
    expect(frontend.every((id) => id.startsWith('frontend.'))).toBe(true);
    expect(platform.length).toBeGreaterThan(0);
    expect(platform.every((id) => !id.startsWith('frontend.'))).toBe(true);
    expect([...frontend, ...platform].sort()).toEqual(available.map((entry) => entry.id).sort());
  });

  it('keeps pull-request path classifiers read-only and functional', () => {
    for (const workflowPath of [
      '.github/workflows/ci.yml',
      '.github/workflows/security.yml',
      '.github/workflows/frontend-generator-smoke.yml',
    ]) {
      const workflow = YAML.parse(readMonorepo(workflowPath));
      expect(workflow.permissions.contents).toBe('read');
      expect(workflow.permissions['pull-requests']).toBe('read');
    }

    for (const workflowPath of [
      '.github/workflows/e2e-smoke.yml',
      '.github/workflows/windows-bridge-e2e.yml',
      '.github/workflows/workspace-e2e-matrix.yml',
    ]) {
      const workflow = YAML.parse(readMonorepo(workflowPath));
      expect(workflow.permissions).toEqual({ contents: 'read' });
    }
  });

  it('keeps contributor onboarding bot-free and pinned to the reviewed action', () => {
    const welcomeWorkflow = readMonorepo('.github/workflows/welcome.yml');
    const parsedWelcomeWorkflow = YAML.parse(welcomeWorkflow);

    expect(welcomeWorkflow).toContain(
      'uses: actions/first-interaction@753c925c8d1ac6fede23781875376600628d9b5d # v3.0.0'
    );
    expect(parsedWelcomeWorkflow.jobs['first-interaction'].if).toBe(
      "github.event.sender.type != 'Bot'"
    );
    expect(welcomeWorkflow).toContain('repo_token:');
    expect(welcomeWorkflow).toContain('issue_message:');
    expect(welcomeWorkflow).toContain('pr_message:');
    expect(welcomeWorkflow).not.toContain('repo-token:');
    expect(welcomeWorkflow).not.toContain('issue-message:');
    expect(welcomeWorkflow).not.toContain('pr-message:');
  });
});
