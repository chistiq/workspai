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
  it('discovers registry candidates without committing, opening a PR, or regenerating contracts', () => {
    const source = read('.github/workflows/agent-framework-version-discovery.yml');
    const workflow = YAML.parse(source);

    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.on).not.toHaveProperty('pull_request_target');
    expect(workflow.permissions).toEqual({
      contents: 'read',
    });
    expect(source).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(source).toContain('persist-credentials: false');
    expect(source).toContain('propose-agent-framework-version-update.ts');
    expect(source).toContain('report.json');
    expect(source).toContain('proposed.json');
    expect(source).toContain('diff -u "$BASELINE" "$DIR/proposed.json"');
    expect(source).not.toContain('--write');
    expect(source).not.toContain('gh auth setup-git');
    expect(source).not.toContain('git commit');
    expect(source).not.toContain('git push');
    expect(source).not.toContain('gh pr create');
    expect(source).not.toContain('sync:shared-contracts');
    expect(source).not.toContain('gh workflow run');
    expect(source).not.toContain('quality:push');
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
    expect(conformance).toContain('qualification_mode:');
    expect(conformance).toContain(
      'outputs.full == \'true\' && \'["ubuntu-24.04","macos-latest","windows-latest"]\' || \'["ubuntu-24.04"]\''
    );
    expect(YAML.parse(conformance).permissions).toEqual({ contents: 'read' });
    expect(conformance).toContain('runtime: [python, dotnet]');
    expect(conformance).toContain('runtime: [python, typescript]');
    expect(conformance).toContain('smoke-openai-agents-adapter.ts');
    expect(conformance).toContain('smoke-google-adk-adapter.ts');
    expect(conformance).toContain('Google ADK ·');
    expect(conformance).toContain('node-version: "22.20.0"');
    expect(conformance).not.toMatch(/FOUNDRY_PROJECT_ENDPOINT:\s*\$\{\{/);
    expect(conformance).not.toMatch(/OPENAI_API_KEY:\s*\$\{\{/);
    expect(conformance).toContain('promote-agent-framework-release-admission.ts');
    expect(conformance).not.toContain('pull_request_target:');

    const smoke = read('packages/cli/scripts/smoke-microsoft-agent-framework-adapter.ts');
    expect(smoke).toContain('WORKSPAI_AGENT_LIFECYCLE_OK');
    expect(smoke).toContain('credentiallessAgentLifecycle');
    expect(smoke).toContain('contextObserved: true');
    expect(smoke).toContain('providerInvocationPerformed: false');

    const openaiSmoke = read('packages/cli/scripts/smoke-openai-agents-adapter.ts');
    expect(openaiSmoke).toContain('WORKSPAI_AGENT_LIFECYCLE_OK');
    expect(openaiSmoke).toContain('ScriptedModel');
    expect(openaiSmoke).toContain('OPENAI_AGENTS_DISABLE_TRACING');
    expect(openaiSmoke).toContain('livePaidApiCall: false');
    expect(openaiSmoke).toContain('resolvePackageRunnerInvocation');
    expect(openaiSmoke).toContain("['install', '--no-fund', '--no-audit']");
    expect(openaiSmoke).toContain("await run('npm', ['test'], agentRoot)");
    expect(openaiSmoke).toContain('runAdmittedAgent');
    expect(openaiSmoke).toContain('run_admitted_agent');
    expect(openaiSmoke).toContain('loadWorkspaiContext');
    expect(openaiSmoke).not.toContain("'--prefix', path.dirname(context.dependencyManifest)");
    expect(openaiSmoke).not.toContain("process.platform === 'win32' ? 'npm.cmd' : 'npm'");
    expect(openaiSmoke).not.toContain('OPENAI_API_KEY=sk-');

    const googleSmoke = read('packages/cli/scripts/smoke-google-adk-adapter.ts');
    expect(googleSmoke).toContain('WORKSPAI_AGENT_LIFECYCLE_OK');
    expect(googleSmoke).toContain('ScriptedLlm');
    expect(googleSmoke).toContain('livePaidApiCall: false');
    expect(googleSmoke).toContain('from google.adk.models.base_llm import BaseLlm');
    expect(googleSmoke).toContain("from '@google/adk'");
    expect(googleSmoke).not.toContain('OPENAI_API_KEY=sk-');
    expect(googleSmoke).toContain('isolatedCaches');

    const promotion = read('packages/cli/scripts/promote-agent-framework-release-admission.ts');
    expect(promotion).toContain('AGENT_FRAMEWORK_ADMISSION_CANDIDATE_CONTRACT_PATH');
    expect(promotion).toContain('digestBuiltinAgentFrameworkManifest');
    expect(promotion).toContain('digestBuiltinAgentFrameworkImplementation');
    expect(promotion).toContain('candidate.sourceCommit !== sourceCommit');
    expect(conformance).toContain('release-admissions.v2.json');
    expect(promotion).toContain("repository !== 'chistiq/workspai'");
    const verify = read('packages/cli/scripts/verify-agent-framework-conformance.ts');
    expect(verify).toContain('implementationSha256ByPlatformFromReports');
    expect(verify).toContain('liveImplementationDigestBlockers');
    expect(verify).not.toContain(
      'implementationSha256: digestBuiltinAgentFrameworkImplementation(adapter)'
    );
  });

  it('qualifies the main proposal manually or weekly and exports its admission without pushing', () => {
    const source = read('.github/workflows/agent-framework-conformance.yml');
    const workflow = YAML.parse(source);
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.on.schedule).toEqual([{ cron: '43 8 * * 1' }]);
    expect(workflow.on.workflow_dispatch.inputs.qualification_mode).toMatchObject({
      default: 'full',
      options: ['fast', 'full'],
    });
    expect(workflow.jobs.qualification.outputs.full).toContain(
      "github.event_name == 'schedule' || inputs.qualification_mode == 'full'"
    );
    expect(source).toContain('github.event.repository.default_branch');
    const prepare = 'npm exec tsx -- scripts/prepare-agent-framework-candidate.ts';
    for (const id of ['microsoft-agent-framework', 'openai-agents', 'google-adk', 'admit-matrix']) {
      const steps = workflow.jobs[id].steps;
      expect(steps[0].with.ref).toBe('${{ github.sha }}');
      expect(steps.map((step: { run?: string }) => step.run)).toContain(prepare);
    }
    expect(source).toContain('SOURCE_COMMIT: ${{ github.sha }}');
    expect(workflow.jobs['admit-matrix'].if).toContain("github.repository == 'chistiq/workspai'");
    expect(source).toContain('release-admission.patch');
    expect(source.indexOf('Verify bundled admission and kit selection')).toBeLessThan(
      source.indexOf('Upload reviewable admission candidate')
    );
    expect(source).not.toMatch(
      /automation\/agent-framework-version-baselines|contents: write|git (?:commit|push)/
    );
  });

  it('keeps generator coverage and OpenAI adapter coverage in the same Vitest gate', () => {
    const config = read('packages/cli/vitest.config.ts');
    expect(config).toContain("'src/generators/**/*.ts'");
    expect(config).toContain("'src/agent-frameworks/adapters/openai-agents/**/*.ts'");
    expect(config).toContain("'src/agent-frameworks/adapters/google-adk/**/*.ts'");
  });
});
