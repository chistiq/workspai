import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertProjectWorkspaceResolutionContract,
  type ProjectWorkspaceResolutionContract,
} from '../contracts/project-workspace-resolution-contract.js';
import {
  ProjectWorkspaceResolutionError,
  resolveProjectWorkspaceSync,
  writeProjectWorkspaceLink,
} from '../project-workspace-link.js';
import {
  buildProjectContextAgent,
  syncProjectIntelligenceLens,
} from '../project-intelligence-lens.js';
import { hashWorkspaceModel } from '../workspace-model-hash.js';
import type { WorkspaceModel } from '../workspace-model.js';

const cleanup: string[] = [];

async function fixture(input: { workspaceName?: string; projectName?: string } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'workspai-project-link-'));
  cleanup.push(root);
  const home = path.join(root, 'home');
  const workspacePath = path.join(root, input.workspaceName ?? 'workspace');
  const projectPath = path.join(root, 'external', input.projectName ?? 'web');
  await fsp.mkdir(path.join(workspacePath, '.workspai', 'reports'), { recursive: true });
  await fsp.mkdir(path.join(projectPath, '.workspai'), { recursive: true });
  await fsp.mkdir(path.join(home, '.workspai'), { recursive: true });
  await fsp.writeFile(path.join(workspacePath, '.workspai-workspace'), 'workspace\n');
  await fsp.writeFile(
    path.join(projectPath, '.workspai', 'project.json'),
    `${JSON.stringify({
      schema_version: '1.0',
      name: input.projectName ?? 'web',
      runtime: 'node',
      framework: 'nextjs',
    })}\n`
  );
  const contract = {
    schemaVersion: 1,
    kind: 'rapidkit.workspace.contract',
    generatedAt: '2026-07-27T00:00:00.000Z',
    workspace: { name: input.workspaceName ?? 'workspace', profile: 'polyglot' },
    projects: [
      {
        slug: input.projectName ?? 'web',
        relativePath: `external/${input.projectName ?? 'web'}`,
        externalPath: projectPath,
        relationship: 'adopted',
        modules: [],
        ports: [],
        contracts: {
          owns: [],
          apis: [],
          publishes: [],
          consumes: [],
          dependsOn: [],
          env: [],
        },
      },
    ],
  };
  await fsp.writeFile(
    path.join(workspacePath, '.workspai', 'workspace.contract.json'),
    `${JSON.stringify(contract)}\n`
  );
  return { root, home, workspacePath, projectPath, contract };
}

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((item) => fsp.rm(item, { recursive: true, force: true }))
  );
});

describe('project workspace binding', () => {
  it('validates the public project workspace resolution result contract', () => {
    const payload: ProjectWorkspaceResolutionContract = {
      schemaVersion: 'project-workspace-resolution.v1',
      status: 'resolved',
      workspacePath: '/machine/workspace',
      projectPath: '/machine/project',
      source: 'local-link',
      recovered: false,
      linkPath: '/machine/project/.workspai/workspace-link.local.json',
      nextCommand: 'npx workspai workspace intelligence run --for-agent generic --strict --json',
    };

    expect(() => assertProjectWorkspaceResolutionContract(payload)).not.toThrow();
    expect(() =>
      assertProjectWorkspaceResolutionContract({
        ...payload,
        source: 'guessed',
      } as unknown as ProjectWorkspaceResolutionContract)
    ).toThrow(/Project workspace resolution/);
  });

  it('resolves an external project through a validated machine-local link', async () => {
    const { workspacePath, projectPath } = await fixture();
    const { linkPath } = await writeProjectWorkspaceLink({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      now: new Date('2026-07-27T00:00:00.000Z'),
    });

    const resolution = resolveProjectWorkspaceSync({
      startPath: projectPath,
      strict: true,
    });
    expect(resolution).toMatchObject({
      workspacePath,
      projectPath,
      source: 'local-link',
      recovered: false,
    });
    expect(JSON.parse(await fsp.readFile(linkPath, 'utf8'))).toMatchObject({
      schemaVersion: 'project-workspace-link.v1',
      state: 'active',
      workspace: { root: workspacePath },
    });
    expect(await fsp.readFile(path.join(projectPath, '.gitignore'), 'utf8')).toContain(
      '.workspai/workspace-link.local.json'
    );
  });

  it('recovers a missing or stale link from the reverse registry without guessing', async () => {
    const { home, workspacePath, projectPath } = await fixture();
    await fsp.writeFile(
      path.join(home, '.workspai', 'workspaces.json'),
      `${JSON.stringify({
        workspaces: [
          {
            name: 'workspace',
            path: workspacePath,
            projects: [{ name: 'web', path: projectPath }],
          },
        ],
      })}\n`
    );

    const resolution = resolveProjectWorkspaceSync({
      startPath: projectPath,
      env: { HOME: home },
      platform: 'linux',
      strict: true,
    });
    expect(resolution).toMatchObject({
      workspacePath,
      projectPath,
      source: 'registry',
    });
  });

  it('rejects ambiguous reverse registry ownership in strict mode', async () => {
    const first = await fixture({ workspaceName: 'one' });
    const secondWorkspace = path.join(first.root, 'two');
    await fsp.mkdir(path.join(secondWorkspace, '.workspai'), { recursive: true });
    await fsp.writeFile(path.join(secondWorkspace, '.workspai-workspace'), 'workspace\n');
    await fsp.writeFile(
      path.join(secondWorkspace, '.workspai', 'workspace.contract.json'),
      `${JSON.stringify({
        ...first.contract,
        workspace: { name: 'two' },
      })}\n`
    );
    await fsp.writeFile(
      path.join(first.home, '.workspai', 'workspaces.json'),
      `${JSON.stringify({
        workspaces: [first.workspacePath, secondWorkspace].map((workspacePath) => ({
          name: path.basename(workspacePath),
          path: workspacePath,
          projects: [{ name: 'web', path: first.projectPath }],
        })),
      })}\n`
    );

    expect(() =>
      resolveProjectWorkspaceSync({
        startPath: first.projectPath,
        env: { HOME: first.home },
        platform: 'linux',
        strict: true,
      })
    ).toThrowError(ProjectWorkspaceResolutionError);
    try {
      resolveProjectWorkspaceSync({
        startPath: first.projectPath,
        env: { HOME: first.home },
        platform: 'linux',
        strict: true,
      });
    } catch (error) {
      expect((error as ProjectWorkspaceResolutionError).code).toBe('project.workspace.ambiguous');
    }
  });

  it('rejects a tampered local link instead of trusting its absolute workspace path', async () => {
    const { workspacePath, projectPath } = await fixture();
    const { linkPath } = await writeProjectWorkspaceLink({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
    });
    const link = JSON.parse(await fsp.readFile(linkPath, 'utf8')) as {
      project: { relativePath: string };
    };
    link.project.relativePath = 'external/another-project';
    await fsp.writeFile(linkPath, `${JSON.stringify(link)}\n`);

    try {
      resolveProjectWorkspaceSync({ startPath: projectPath, strict: true });
      throw new Error('Expected the tampered link to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectWorkspaceResolutionError);
      expect((error as ProjectWorkspaceResolutionError).code).toBe('project.workspace.link-stale');
    }
  });

  it('refuses to bind a project that is absent from the canonical contract', async () => {
    const { workspacePath, projectPath } = await fixture();
    const contractPath = path.join(workspacePath, '.workspai', 'workspace.contract.json');
    const contract = JSON.parse(await fsp.readFile(contractPath, 'utf8')) as {
      projects: unknown[];
    };
    contract.projects = [];
    await fsp.writeFile(contractPath, `${JSON.stringify(contract)}\n`);

    await expect(
      writeProjectWorkspaceLink({
        workspacePath,
        projectPath,
        projectName: 'web',
        relationship: 'adopted',
      })
    ).rejects.toMatchObject({ code: 'project.workspace.membership-missing' });
  });

  it('rejects an explicit but unrelated workspace when project membership is required', async () => {
    const target = await fixture({ workspaceName: 'target-workspace' });
    const unrelated = await fixture({ workspaceName: 'unrelated-workspace' });

    try {
      resolveProjectWorkspaceSync({
        startPath: target.projectPath,
        explicitWorkspacePath: unrelated.workspacePath,
        requireProjectMembership: true,
        strict: true,
      });
      throw new Error('Expected unrelated explicit workspace to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectWorkspaceResolutionError);
      expect((error as ProjectWorkspaceResolutionError).code).toBe(
        'project.workspace.membership-missing'
      );
    }
  });

  it('writes a portable project lens and preserves user-authored AGENTS content', async () => {
    const { workspacePath, projectPath } = await fixture();
    await fsp.writeFile(path.join(projectPath, 'AGENTS.md'), '# Team rules\n\nKeep this text.\n');
    const model = {
      schemaVersion: 'workspace-model.v1',
      generatedAt: '2026-07-27T00:00:00.000Z',
      workspace: { name: 'workspace', root: '.', profile: 'polyglot' },
      projects: [
        {
          name: 'web',
          path: 'external/web',
          kind: 'frontend',
          runtime: 'node',
          framework: 'nextjs',
          supportTier: 'first-class',
          commands: {
            supported: ['build', 'test'],
            unsupported: [],
            fleetStages: ['build', 'test'],
          },
          importantFiles: ['package.json'],
        },
      ],
    } as WorkspaceModel;
    await fsp.writeFile(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-model.json'),
      `${JSON.stringify(model)}\n`
    );
    await fsp.writeFile(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-knowledge-graph.json'),
      `${JSON.stringify({
        schemaVersion: 'workspace-knowledge-graph.v1',
        generatedAt: '2026-07-27T00:00:00.000Z',
        source: {
          kind: 'workspace-model',
          artifact: '.workspai/reports/workspace-model.json',
          hashAlgorithm: 'sha256',
          hash: hashWorkspaceModel(model),
        },
        workspace: { name: 'workspace' },
        projectTopology: {
          schemaVersion: 'workspace-dependency-graph.v1',
          generatedAt: '2026-07-27T00:00:00.000Z',
          nodes: [],
          edges: [],
          diagnostics: [],
          summary: {},
        },
        entities: [
          {
            id: 'project:web',
            kind: 'project',
            label: 'web',
            projectId: 'web',
            identity: { key: 'web', scope: 'project', aliases: [], fingerprint: 'b'.repeat(64) },
            attributes: {},
            proofIds: ['proof:web'],
          },
          {
            id: 'endpoint:web:users',
            kind: 'endpoint',
            label: 'GET /users',
            projectId: 'web',
            identity: {
              key: 'GET /users',
              scope: 'project',
              aliases: [],
              fingerprint: 'c'.repeat(64),
            },
            attributes: { method: 'GET', path: '/users' },
            proofIds: ['proof:web'],
          },
          {
            id: 'deployment:web',
            kind: 'deployment',
            label: 'web deployment',
            projectId: 'web',
            identity: {
              key: 'web deployment',
              scope: 'project',
              aliases: [],
              fingerprint: 'd'.repeat(64),
            },
            attributes: { environment: 'production' },
            proofIds: ['proof:web'],
          },
          {
            id: 'test:web',
            kind: 'test-suite',
            label: 'web contract tests',
            projectId: 'web',
            identity: {
              key: 'web contract tests',
              scope: 'project',
              aliases: [],
              fingerprint: 'e'.repeat(64),
            },
            attributes: { command: 'npm test' },
            proofIds: ['proof:web'],
          },
        ],
        relations: [
          {
            id: 'relation:web:users',
            from: 'project:web',
            to: 'endpoint:web:users',
            kind: 'exposes',
            derivation: 'extracted',
            trust: 'observed',
            confidence: 'high',
            proofIds: ['proof:web'],
          },
        ],
        proofs: [
          {
            id: 'proof:web',
            provider: 'metadata',
            artifact: '.workspai/project.json',
            observedAt: '2026-07-27T00:00:00.000Z',
            derivation: 'authored',
            trust: 'authoritative',
            confidence: 'high',
            freshness: 'fresh',
          },
        ],
        providers: [],
        quality: {
          entityCount: 4,
          relationCount: 1,
          proofCount: 1,
          entityProofCoverageRatio: 1,
          relationProofCoverageRatio: 1,
          providerSuccessRatio: 1,
          conflictCount: 0,
          unknownCount: 0,
          portable: true,
          secretValuesEmitted: false,
        },
        diagnostics: [],
      })}\n`
    );

    const result = await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
      now: new Date('2026-07-27T00:00:00.000Z'),
    });
    const context = await buildProjectContextAgent({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      now: new Date('2026-07-27T00:00:00.000Z'),
    });
    expect(result.writtenFiles).toContain('.workspai/reports/project-context-agent.json');
    expect(context.integrity).toMatchObject({
      portable: true,
      absolutePathsEmitted: false,
    });
    expect(JSON.stringify(context)).not.toContain(workspacePath);
    expect(JSON.stringify(context)).not.toContain(projectPath);
    expect(context.intelligence).toMatchObject({
      entityCount: 4,
      relationCount: 1,
      proofCount: 1,
      freshness: {
        model: 'unknown',
        graph: 'fresh',
        graphMatchesModel: true,
      },
      topology: { status: 'unavailable' },
    });
    expect(context.workspace.access).toMatchObject({
      localBinding: '.workspai/workspace-link.local.json',
      canonicalEvidenceAvailableAtGeneration: true,
    });
    expect(context.intelligence.surfaces.endpoints).toEqual([
      expect.objectContaining({ id: 'endpoint:web:users', label: 'GET /users' }),
    ]);
    expect(context.intelligence.surfaces.deployments).toEqual([
      expect.objectContaining({ id: 'deployment:web' }),
    ]);
    expect(context.intelligence.surfaces.tests).toEqual([
      expect.objectContaining({ id: 'test:web' }),
    ]);
    expect(context.evidence.relations).toEqual([
      expect.objectContaining({ id: 'relation:web:users', proofIds: ['proof:web'] }),
    ]);
    expect(context.evidence.proofs).toEqual([
      expect.objectContaining({
        id: 'proof:web',
        artifact: '.workspai/project.json',
      }),
    ]);
    const agents = await fsp.readFile(path.join(projectPath, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Keep this text.');
    expect(agents).toContain('Workspai project boundary');
    expect(agents).toContain('<!-- WORKSPAI:PROJECT-GROUNDING:START -->');
    expect(agents).not.toContain('<!-- RAPIDKIT:AGENT-GROUNDING:START -->');
    expect(fs.existsSync(path.join(projectPath, '.workspai', 'PROJECT-GROUNDING.md'))).toBe(true);

    const graphPath = path.join(
      workspacePath,
      '.workspai',
      'reports',
      'workspace-knowledge-graph.json'
    );
    const staleGraph = JSON.parse(await fsp.readFile(graphPath, 'utf8')) as {
      source: { hash: string };
    };
    staleGraph.source.hash = 'f'.repeat(64);
    await fsp.writeFile(graphPath, `${JSON.stringify(staleGraph)}\n`);
    const staleContext = await buildProjectContextAgent({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
    });
    expect(staleContext.intelligence.entityCount).toBe(0);
    expect(staleContext.intelligence.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'project.context.graph-model-mismatch' }),
      ])
    );
  });

  it('supports local and off grounding policies without taking ownership of AGENTS.md', async () => {
    const localFixture = await fixture({ workspaceName: 'local-workspace' });
    await fsp.writeFile(
      path.join(localFixture.projectPath, 'AGENTS.md'),
      '# User-owned instructions\n'
    );
    const local = await syncProjectIntelligenceLens({
      workspacePath: localFixture.workspacePath,
      projectPath: localFixture.projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'local',
    });
    expect(local.agentsPath).toBeUndefined();
    expect(await fsp.readFile(path.join(localFixture.projectPath, 'AGENTS.md'), 'utf8')).toBe(
      '# User-owned instructions\n'
    );
    const gitignore = await fsp.readFile(path.join(localFixture.projectPath, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.workspai/workspace-link.local.json');
    expect(gitignore).toContain('.workspai/PROJECT-GROUNDING.md');
    expect(gitignore).toContain('.workspai/reports/project-context-agent.json');

    const offFixture = await fixture({ workspaceName: 'off-workspace' });
    const off = await syncProjectIntelligenceLens({
      workspacePath: offFixture.workspacePath,
      projectPath: offFixture.projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'off',
    });
    expect(off.writtenFiles).toEqual(['.workspai/workspace-link.local.json']);
    expect(
      fs.existsSync(path.join(offFixture.projectPath, '.workspai', 'workspace-link.local.json'))
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(offFixture.projectPath, '.workspai', 'reports', 'project-context-agent.json')
      )
    ).toBe(false);
  });

  it('converges managed, local, managed, and off transitions without stale ownership', async () => {
    const { workspacePath, projectPath } = await fixture({
      workspaceName: 'transition-workspace',
    });
    await fsp.writeFile(path.join(projectPath, 'AGENTS.md'), '# User rules\n\nKeep me.\n');

    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });
    expect(await fsp.readFile(path.join(projectPath, 'AGENTS.md'), 'utf8')).toContain(
      '<!-- WORKSPAI:PROJECT-GROUNDING:START -->'
    );

    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'local',
    });
    const localAgents = await fsp.readFile(path.join(projectPath, 'AGENTS.md'), 'utf8');
    expect(localAgents).toBe('# User rules\n\nKeep me.\n');
    expect(await fsp.readFile(path.join(projectPath, '.gitignore'), 'utf8')).toContain(
      '.workspai/reports/project-context-agent.json'
    );

    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });
    const managedIgnore = await fsp.readFile(path.join(projectPath, '.gitignore'), 'utf8');
    expect(managedIgnore).not.toContain('.workspai/reports/project-context-agent.json');
    expect(await fsp.readFile(path.join(projectPath, 'AGENTS.md'), 'utf8')).toContain(
      '<!-- WORKSPAI:PROJECT-GROUNDING:START -->'
    );

    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'off',
    });
    expect(await fsp.readFile(path.join(projectPath, 'AGENTS.md'), 'utf8')).toBe(
      '# User rules\n\nKeep me.\n'
    );
    expect(fs.existsSync(path.join(projectPath, '.workspai', 'PROJECT-GROUNDING.md'))).toBe(false);
    expect(
      fs.existsSync(path.join(projectPath, '.workspai', 'reports', 'project-context-agent.json'))
    ).toBe(false);
    const offIgnore = await fsp.readFile(path.join(projectPath, '.gitignore'), 'utf8');
    expect(offIgnore).not.toContain('.workspai/reports/project-context-agent.json');
    expect(offIgnore).toContain('.workspai/workspace-link.local.json');
  });
});
