import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const repositoryRoot = path.resolve(__dirname, '..', '..', '..', '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function actionReferences(workflow: string): string[] {
  return [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]!);
}

describe('agent framework version automation', () => {
  it('discovers on trusted code, proposes a PR, and dispatches admission without auto-merge', () => {
    const source = read('.github/workflows/agent-framework-version-discovery.yml');
    const workflow = YAML.parse(source);

    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.on).not.toHaveProperty('pull_request_target');
    expect(workflow.permissions).toEqual({
      actions: 'write',
      contents: 'write',
      'pull-requests': 'write',
    });
    expect(source).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(source).toContain('persist-credentials: false');
    expect(source).toContain('gh auth setup-git');
    expect(source).toContain('propose-agent-framework-version-update.ts');
    expect(source).toContain('git push --force-with-lease=');
    expect(source).toContain('candidate_tree="$(git write-tree)"');
    expect(source).toContain('changed=false');
    expect(source).toContain('gh pr create');
    expect(source).toContain('gh workflow run agent-framework-conformance.yml');
    expect(source).not.toMatch(/gh\s+pr\s+merge|--auto/);
  });

  it('pins third-party actions and keeps the admission matrix credentialless', () => {
    const workflows = [
      read('.github/workflows/agent-framework-version-discovery.yml'),
      read('.github/workflows/agent-framework-conformance.yml'),
    ];
    for (const workflow of workflows) {
      for (const reference of actionReferences(workflow)) {
        expect(reference).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/);
      }
    }
    const conformance = workflows[1]!;
    expect(conformance).toContain('os: [ubuntu-latest, macos-latest, windows-latest]');
    expect(conformance).toContain('runtime: [python, dotnet]');
    expect(conformance).not.toMatch(/FOUNDRY_PROJECT_ENDPOINT:\s*\$\{\{/);
    expect(conformance).toContain("github.event_name == 'workflow_dispatch'");
    expect(conformance).toContain(
      "github.ref == 'refs/heads/automation/agent-framework-version-baselines'"
    );
    expect(conformance).toContain('promote-agent-framework-release-admission.ts');
    expect(conformance).toContain('contents: write');
    expect(conformance).not.toContain('pull_request_target:');

    const smoke = read('packages/cli/scripts/smoke-microsoft-agent-framework-adapter.ts');
    expect(smoke).toContain('WORKSPAI_AGENT_LIFECYCLE_OK');
    expect(smoke).toContain('credentiallessAgentLifecycle');
    expect(smoke).toContain('contextObserved: true');
    expect(smoke).toContain('providerInvocationPerformed: false');

    const promotion = read('packages/cli/scripts/promote-agent-framework-release-admission.ts');
    expect(promotion).toContain('AGENT_FRAMEWORK_ADMISSION_CANDIDATE_CONTRACT_PATH');
    expect(promotion).toContain('digestBuiltinAgentFrameworkManifest');
    expect(promotion).toContain("repository !== 'chistiq/workspai'");
  });
});
