import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WORKSPACE_REPAIR_ADAPTER_CAPABILITIES,
  buildWorkspaceRepairCapabilitiesContract,
  type WorkspaceRepairAdapterId,
} from '../contracts/workspace-repair-capabilities-contract.js';
import { inspectWorkspaceRepairCapabilities } from '../workspace-repair-engine.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('Workspace Repair capability contract', () => {
  it('publishes one unique, fail-closed adapter inventory owned by the CLI', () => {
    const contract = buildWorkspaceRepairCapabilitiesContract();
    expect(contract).toMatchObject({
      schemaVersion: 'workspai.workspace-repair-capabilities.v1',
      owner: 'Workspai CLI',
      invariants: {
        multiAdapterProjects: true,
        missingTools: 'decision-required',
        unsupportedEcosystems: 'decision-required',
        silentFallbackToModelExecution: false,
        mutationAuthority: 'cli-only',
        targetClosure: 'selected-causal-action-set',
        changeReceipt: 'checkpoint-hash-delta',
        consumerTimeline: 'durable-transaction-events',
        consumerHandshakeRequired: true,
        ephemeralProposalsAreEvidence: false,
        canonicalVerificationRequired: true,
      },
      consumerProtocol: {
        protocolVersion: 'workspai.workspace-repair-consumer-protocol.v1',
        versionProbe: {
          args: ['--version', '--json'],
          schemaVersion: 'rapidkit-version-v1',
        },
        capabilityProbe: {
          args: ['workspace', 'repair', 'capabilities', '--json'],
          schemaVersion: 'workspai.workspace-repair-capabilities.v1',
        },
        invocation: {
          workspaceResolution: ['process-cwd', '--workspace'],
        },
      },
    });
    expect(contract.workflow).toContain('target-precondition');
    expect(contract.workflow.slice(-3)).toEqual([
      'target-producer-verify',
      'canonical-verify',
      'close-or-rollback-or-decision',
    ]);
    expect(new Set(contract.adapters.map((adapter) => adapter.id)).size).toBe(
      contract.adapters.length
    );
    expect(contract.adapters).toEqual(WORKSPACE_REPAIR_ADAPTER_CAPABILITIES);
    for (const adapter of contract.adapters) {
      expect(adapter.manifests.length).toBeGreaterThan(0);
      expect(adapter.requiredToolFamilies.length).toBeGreaterThan(0);
      expect(Object.keys(adapter.stages).sort()).toEqual(['audit', 'build', 'reconcile', 'test']);
    }
  });

  it('detects every declared runtime family through its canonical project surface', async () => {
    const workspacePath = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-repair-capabilities-')
    );
    roots.push(workspacePath);
    const fixtures: Array<{ id: WorkspaceRepairAdapterId; file: string; content?: string }> = [
      { id: 'node', file: 'package.json', content: '{}' },
      { id: 'python', file: 'pyproject.toml' },
      { id: 'go', file: 'go.mod' },
      { id: 'rust', file: 'Cargo.toml' },
      { id: 'php-composer', file: 'composer.json', content: '{}' },
      { id: 'ruby-bundler', file: 'Gemfile' },
      { id: 'elixir-mix', file: 'mix.exs' },
      { id: 'deno', file: 'deno.jsonc', content: '{}' },
      { id: 'dotnet', file: 'App.csproj' },
      { id: 'jvm-maven', file: 'pom.xml' },
      { id: 'jvm-gradle', file: 'build.gradle.kts' },
      { id: 'clojure', file: 'deps.edn' },
      { id: 'scala-sbt', file: 'build.sbt' },
    ];

    for (const fixture of fixtures) {
      const projectPath = path.join(workspacePath, fixture.id);
      await fsExtra.outputFile(path.join(projectPath, fixture.file), fixture.content ?? '');
      const report = await inspectWorkspaceRepairCapabilities({
        workspacePath,
        projectPath: fixture.id,
      });
      expect(report.inspection?.detectedAdapters, fixture.id).toEqual([fixture.id]);
    }
  });

  it('reports every adapter in a genuinely multi-runtime project instead of selecting the first', async () => {
    const workspacePath = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-repair-polyglot-')
    );
    roots.push(workspacePath);
    await fsExtra.outputJson(path.join(workspacePath, 'service', 'package.json'), {});
    await fsExtra.outputFile(path.join(workspacePath, 'service', 'pyproject.toml'), '[project]\n');
    await fsExtra.outputFile(
      path.join(workspacePath, 'service', 'go.mod'),
      'module example.test/service\n'
    );

    const report = await inspectWorkspaceRepairCapabilities({
      workspacePath,
      projectPath: 'service',
    });

    expect(report.inspection?.detectedAdapters).toEqual(['node', 'python', 'go']);
  });

  it('resolves a registered project reference, including an external project, before inspection', async () => {
    const workspacePath = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-repair-registered-project-')
    );
    const externalRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-repair-external-project-')
    );
    roots.push(workspacePath, externalRoot);
    await fsExtra.outputJson(path.join(workspacePath, 'web', 'package.json'), {});
    await fsExtra.outputFile(path.join(externalRoot, 'go.mod'), 'module example.test/external\n');
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      projects: [
        { slug: 'web', relativePath: 'web', relationship: 'managed' },
        {
          slug: 'external-api',
          relativePath: 'external/external-api',
          externalPath: externalRoot,
          relationship: 'linked',
        },
      ],
    });

    await expect(
      inspectWorkspaceRepairCapabilities({ workspacePath, project: 'web' })
    ).resolves.toMatchObject({
      inspection: { projectPath: 'web', detectedAdapters: ['node'] },
    });
    await expect(
      inspectWorkspaceRepairCapabilities({ workspacePath, project: 'external-api' })
    ).resolves.toMatchObject({
      inspection: { projectPath: 'external-api', detectedAdapters: ['go'] },
    });
    await expect(
      inspectWorkspaceRepairCapabilities({ workspacePath, project: 'missing' })
    ).rejects.toThrow('Registered project not found');
  });
});
