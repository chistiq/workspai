import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
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
  selectBoundedProjectLensEntities,
  syncProjectIntelligenceLens,
} from '../project-intelligence-lens.js';
import type { WorkspaceKnowledgeEntity } from '../contracts/workspace-knowledge-graph-contract.js';
import {
  buildAgentBootstrapReceipt,
  PROJECT_AGENT_ENTRY_RELATIVE_PATH,
  WORKSPAI_AGENT_ENTRY_END,
  WORKSPAI_AGENT_ENTRY_START,
} from '../project-agent-entry.js';
import { hashWorkspaceModel } from '../workspace-model-hash.js';
import type { WorkspaceModel } from '../workspace-model.js';
import { normalizeRegistryPath } from '../utils/registry-path.js';
import { resolveRepositoryLocalSymlinkFile } from '../utils/repository-local-symlink.js';

const cleanup: string[] = [];

function lensEntity(
  kind: WorkspaceKnowledgeEntity['kind'],
  index: number
): WorkspaceKnowledgeEntity {
  return {
    id: `${kind}:${index}`,
    kind,
    label: `${kind}-${index.toString().padStart(2, '0')}`,
    projectId: 'web',
    identity: {
      key: `${kind}:${index}`,
      scope: 'project',
      aliases: [],
      fingerprint: index.toString(16).padStart(64, '0'),
    },
    attributes: {},
    proofIds: [],
  };
}

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
  it('stratifies the bounded project lens so late architectural kinds cannot starve', () => {
    const kinds: WorkspaceKnowledgeEntity['kind'][] = [
      'language',
      'service',
      'api',
      'endpoint',
      'schema',
      'protocol',
      'runtime-unit',
      'lifecycle-stage',
      'deployment',
      'test-suite',
      'decision',
    ];
    const entities = kinds.flatMap((kind) =>
      Array.from({ length: 8 }, (_, index) => lensEntity(kind, index))
    );

    const projection = selectBoundedProjectLensEntities(entities);
    const selectedKinds = new Set(projection.entities.map((entity) => entity.kind));

    expect(projection.entities.length).toBeLessThanOrEqual(48);
    expect(projection.selectedBytes).toBeLessThanOrEqual(12 * 1024);
    expect(selectedKinds).toEqual(new Set(kinds));
    expect(projection.omittedByKind).toMatchObject({
      service: expect.any(Number),
      deployment: expect.any(Number),
      'test-suite': expect.any(Number),
      decision: expect.any(Number),
    });
  });

  it('uses the newest canonical Doctor evidence in the portable project lens', async () => {
    const { workspacePath, projectPath } = await fixture();
    const reportsPath = path.join(workspacePath, '.workspai', 'reports');
    await fsp.writeFile(
      path.join(reportsPath, 'doctor-project-last-run.json'),
      `${JSON.stringify({
        generatedAt: '2026-07-27T00:00:00.000Z',
        projectName: 'web',
        project: {
          name: 'web',
          diagnosis: {
            findings: [
              {
                id: 'stale-runtime',
                status: 'advisory',
                symptom: 'Stale runtime composition.',
              },
            ],
          },
        },
      })}\n`
    );
    await fsp.writeFile(
      path.join(reportsPath, 'doctor-last-run.json'),
      `${JSON.stringify({
        generatedAt: '2026-07-27T00:05:00.000Z',
        projects: [
          {
            name: 'web',
            diagnosis: {
              findings: [
                {
                  id: 'current-security',
                  status: 'advisory',
                  symptom: 'Current security evidence is incomplete.',
                },
              ],
            },
          },
        ],
      })}\n`
    );

    const context = await buildProjectContextAgent({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      now: new Date('2026-07-27T00:06:00.000Z'),
    });

    expect(context.blockers).toEqual([
      expect.objectContaining({
        code: 'current-security',
        message: 'Current security evidence is incomplete.',
      }),
    ]);
    expect(JSON.stringify(context.blockers)).not.toContain('Stale runtime composition');
  });

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
      pathPolicy: {
        classification: 'machine-local',
        portable: false,
        persistence: 'forbidden',
        disclosure: 'forbidden',
        purpose: 'runtime-workspace-resolution',
      },
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
      workspacePath: normalizeRegistryPath(workspacePath),
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
          runtimeCandidates: ['node', 'python'],
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
            id: 'service:web:dashboard',
            kind: 'service',
            label: 'web dashboard',
            projectId: 'web',
            identity: {
              key: 'web dashboard',
              scope: 'project',
              aliases: [],
              fingerprint: 'a'.repeat(64),
            },
            attributes: { surface: 'webview' },
            proofIds: ['proof:web'],
          },
          {
            id: 'package:web:npm',
            kind: 'package',
            label: '@example/web',
            projectId: 'web',
            identity: {
              key: 'package:web:npm',
              scope: 'project',
              aliases: [],
              fingerprint: '1'.repeat(64),
            },
            attributes: { ecosystem: 'npm', manifest: 'external/web/package.json' },
            proofIds: ['proof:web'],
          },
          {
            id: 'file:web:generated',
            kind: 'file',
            label: 'external/web/src/generated/client.ts',
            projectId: 'web',
            identity: {
              key: 'file:web:generated',
              scope: 'project',
              aliases: [],
              fingerprint: '2'.repeat(64),
            },
            attributes: { language: 'typescript', generated: true },
            proofIds: ['proof:web'],
          },
          ...Array.from({ length: 100 }, (_, index) => ({
            id: `symbol:web:${index.toString().padStart(3, '0')}`,
            kind: 'symbol',
            label: `symbol-${index}`,
            projectId: 'web',
            identity: {
              key: `symbol-${index}`,
              scope: 'project',
              aliases: [],
              fingerprint: 'f'.repeat(64),
            },
            attributes: { symbolKind: 'function' },
            proofIds: ['proof:web'],
          })),
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
          entityCount: 105,
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
    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([
        PROJECT_AGENT_ENTRY_RELATIVE_PATH,
        '.agents/skills/workspai-grounding/SKILL.md',
        'CLAUDE.md',
        'GEMINI.md',
        'QWEN.md',
        '.amazonq/rules/workspai-agent-entry.md',
      ])
    );
    expect(context.integrity).toMatchObject({
      portable: true,
      absolutePathsEmitted: false,
    });
    expect(JSON.stringify(context)).not.toContain(workspacePath);
    expect(JSON.stringify(context)).not.toContain(projectPath);
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(32 * 1024);
    expect(context.agentRouting.requiredReadOrder).not.toContain(
      'workspace:.workspai/reports/workspace-context-agent.json'
    );
    expect(context.intelligence).toMatchObject({
      entityCount: 107,
      relationCount: 1,
      proofCount: 1,
      freshness: {
        model: 'unknown',
        graph: 'fresh',
        graphMatchesModel: true,
      },
      topology: { status: 'unavailable' },
    });
    expect(context.project.runtimeCandidates).toEqual(['node', 'python']);
    expect(context.intelligence.languages).toEqual({
      typescript: { fileCount: 1, symbolCount: 0, generatedFileCount: 1 },
    });
    expect(context.workspace.access).toMatchObject({
      localBinding: '.workspai/workspace-link.local.json',
      canonicalEvidenceAvailableAtGeneration: true,
      identityIsFilesystemPath: false,
      resolverCommand: 'workspai project workspace status --json',
      portableUriScheme: 'workspace:',
      resolvedPathPolicy: 'runtime-private-never-persist',
    });
    expect(context.workspace).toMatchObject({
      contract: 'workspace:.workspai/workspace.contract.json',
      index: 'workspace:.workspai/reports/INDEX.json',
      context: 'workspace:.workspai/reports/workspace-context-agent.json',
      skillsIndex: 'workspace:.workspai/reports/workspace-skills-index.json',
    });
    expect(context.agentRouting).toMatchObject({
      enforcement: 'required',
      mandatoryPreflight: {
        command: 'workspai agent bootstrap --for-agent generic --strict --json',
        successCondition: 'ready',
      },
      workspaceLocator: {
        command: 'workspai project workspace status --json',
        successCondition: 'resolved',
        outputClassification: 'machine-local',
        persistence: 'forbidden',
        disclosure: 'forbidden',
        portableUriScheme: 'workspace:',
      },
      degradedMode: {
        allowCompleteArchitectureClaims: false,
        requireDisclosure: true,
      },
    });
    expect(context.agentRouting.workspaceEvidenceRequiredFor).toContain('architecture-analysis');
    expect(context.commands.graphSearch).toContain('workspace graph search');
    expect(context.commands.graphSearch).toContain('--scope "project:web"');
    expect(context.intelligence.surfaces.endpoints).toEqual([
      expect.objectContaining({ id: 'endpoint:web:users', label: 'GET /users' }),
    ]);
    expect(context.intelligence.surfaces.services).toEqual([
      expect.objectContaining({ id: 'service:web:dashboard', label: 'web dashboard' }),
    ]);
    expect(context.intelligence.surfaces.packages).toEqual([
      expect.objectContaining({ id: 'package:web:npm', label: '@example/web' }),
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
    expect(agents).toContain('Workspai agent entry gate (mandatory)');
    expect(agents).toContain('Workspace identity: `workspace` (logical name');
    expect(agents).toContain('execute `nextActions`, and rerun bootstrap');
    expect(agents).toContain('`workspace:` paths belong to the canonical workspace');
    expect(agents.startsWith('<!-- WORKSPAI:PROJECT-GROUNDING:START -->')).toBe(true);
    expect(agents.indexOf('Workspai agent entry gate')).toBeLessThan(
      agents.indexOf('Keep this text.')
    );
    expect(agents).not.toContain('<!-- RAPIDKIT:AGENT-GROUNDING:START -->');
    expect(fs.existsSync(path.join(projectPath, '.workspai', 'PROJECT-GROUNDING.md'))).toBe(true);
    const portableSkill = await fsp.readFile(
      path.join(projectPath, '.agents/skills/workspai-grounding/SKILL.md'),
      'utf8'
    );
    expect(portableSkill).toContain('WORKSPAI:GENERATED-PROJECT-SKILL');
    expect(portableSkill).toContain('workspai agent bootstrap --for-agent generic');
    expect(portableSkill).not.toContain(workspacePath);
    const entry = JSON.parse(
      await fsp.readFile(path.join(projectPath, PROJECT_AGENT_ENTRY_RELATIVE_PATH), 'utf8')
    ) as {
      schemaVersion: string;
      workspace: {
        identityIsFilesystemPath: boolean;
        resolverCommand: string;
        portableUriScheme: string;
        resolvedPathPolicy: string;
      };
      canonical: {
        projectContext: string;
        goalIndex: string;
        workspaceIndex: string;
      };
      hosts: Array<{ id: string; status: string; entryFiles: string[] }>;
      integrity: { absolutePathsEmitted: boolean };
    };
    expect(entry).toMatchObject({
      schemaVersion: 'workspai.agent-entry.v1',
      workspace: {
        identityIsFilesystemPath: false,
        resolverCommand: 'workspai project workspace status --json',
        portableUriScheme: 'workspace:',
        resolvedPathPolicy: 'runtime-private-never-persist',
      },
      canonical: {
        projectContext: '.workspai/reports/project-context-agent.json',
        goalIndex: 'workspace:.workspai/goals/index.json',
        workspaceIndex: 'workspace:.workspai/reports/INDEX.json',
      },
      integrity: { absolutePathsEmitted: false },
    });
    expect(entry.hosts).toHaveLength(11);
    expect(entry.hosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex',
          status: 'ready',
          entryFiles: ['AGENTS.md', '.agents/skills/workspai-grounding/SKILL.md'],
        }),
        expect.objectContaining({ id: 'claude', status: 'ready', entryFiles: ['CLAUDE.md'] }),
        expect.objectContaining({ id: 'gemini', status: 'ready', entryFiles: ['GEMINI.md'] }),
        expect.objectContaining({ id: 'qwen', status: 'ready', entryFiles: ['QWEN.md'] }),
      ])
    );
    expect(JSON.stringify(entry)).not.toContain(workspacePath);
    expect(JSON.stringify(entry)).not.toContain(projectPath);
    for (const [fileName, host, imported] of [
      ['CLAUDE.md', 'claude', '@AGENTS.md'],
      ['GEMINI.md', 'gemini', '@./AGENTS.md'],
      ['QWEN.md', 'qwen', '@AGENTS.md'],
    ] as const) {
      const adapter = await fsp.readFile(path.join(projectPath, fileName), 'utf8');
      expect(adapter).toContain(imported);
      expect(adapter).toContain(`workspai agent bootstrap --for-agent ${host} --strict --json`);
      expect(adapter).toContain(`Workspai host binding · ${host}`);
      expect(adapter).toContain('workspace locator privacy policy');
      expect(adapter).toContain('the imported instructions or replace repository-authored');
    }
    const amazonQ = await fsp.readFile(
      path.join(projectPath, '.amazonq/rules/workspai-agent-entry.md'),
      'utf8'
    );
    expect(amazonQ).toContain('workspai agent bootstrap --for-agent amazon-q --strict --json');

    await Promise.all([
      fsp.writeFile(path.join(workspacePath, '.workspai', 'reports', 'INDEX.json'), '{}\n'),
      fsp.writeFile(
        path.join(workspacePath, '.workspai', 'reports', 'workspace-context-agent.json'),
        '{}\n'
      ),
    ]);
    const receipt = await buildAgentBootstrapReceipt({
      startPath: projectPath,
      forAgent: 'claude',
      validateLiveInputs: false,
      now: new Date('2026-07-27T01:00:00.000Z'),
    });
    expect(receipt).toMatchObject({
      schemaVersion: 'workspai.agent-bootstrap-receipt.v1',
      status: 'blocked',
      statusScope: 'agent-grounding',
      readiness: {
        agentGrounding: 'blocked',
        architectureEvidence: 'blocked',
        projectEnvironment: 'ready',
        release: 'not-verified',
      },
      resolvedHost: 'claude',
      entry: { hostStatus: 'ready', entryFiles: ['CLAUDE.md'] },
      claims: { architecture: 'prohibited' },
      integrity: { absolutePathsEmitted: false },
    });
    expect(receipt.checks).toContainEqual(
      expect.objectContaining({ id: 'canonical-contracts', status: 'failed' })
    );
    expect(JSON.stringify(receipt)).not.toContain(workspacePath);
    expect(JSON.stringify(receipt)).not.toContain(projectPath);
    await expect(
      buildAgentBootstrapReceipt({
        startPath: projectPath,
        forAgent: 'unknown-agent',
        validateLiveInputs: false,
      })
    ).rejects.toThrow(/Unsupported agent host/);

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
    expect(gitignore).toContain(PROJECT_AGENT_ENTRY_RELATIVE_PATH);

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

  it('preserves an authored tracked deletion of AGENTS.md during managed grounding', async () => {
    const { workspacePath, projectPath } = await fixture({
      workspaceName: 'tracked-deletion-workspace',
    });
    await execa('git', ['init', '--quiet'], { cwd: projectPath });
    await execa('git', ['config', 'user.email', 'test@workspai.local'], { cwd: projectPath });
    await execa('git', ['config', 'user.name', 'Workspai Test'], { cwd: projectPath });
    await execa('git', ['config', 'commit.gpgsign', 'false'], { cwd: projectPath });
    await fsp.writeFile(path.join(projectPath, 'AGENTS.md'), '# Repository agent guide\n');
    await execa('git', ['add', 'AGENTS.md'], { cwd: projectPath });
    await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectPath });
    await fsp.rm(path.join(projectPath, 'AGENTS.md'));

    const result = await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });

    expect(fs.existsSync(path.join(projectPath, 'AGENTS.md'))).toBe(false);
    expect(result.writtenFiles).not.toContain('AGENTS.md');
    expect(fs.existsSync(path.join(projectPath, '.workspai', 'PROJECT-GROUNDING.md'))).toBe(true);
    expect(result.hostCoverage).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'codex', status: 'blocked' })])
    );
    expect(await fsp.readFile(path.join(projectPath, 'CLAUDE.md'), 'utf8')).toContain(
      '@.workspai/PROJECT-GROUNDING.md'
    );
  });

  it('inherits shared repository-local AGENTS grounding without adding a self-import', async (context) => {
    const { workspacePath, projectPath } = await fixture({
      workspaceName: 'shared-agent-rules-workspace',
    });
    const rulesPath = path.join(projectPath, '.rules');
    await fsp.writeFile(rulesPath, '# Repository rules\n\nKeep this guidance.\n');
    try {
      await fsp.symlink('.rules', path.join(projectPath, 'AGENTS.md'));
      await fsp.symlink('.rules', path.join(projectPath, 'CLAUDE.md'));
    } catch {
      context.skip();
      return;
    }

    const first = await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });
    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });

    expect((await fsp.lstat(path.join(projectPath, 'AGENTS.md'))).isSymbolicLink()).toBe(true);
    expect((await fsp.lstat(path.join(projectPath, 'CLAUDE.md'))).isSymbolicLink()).toBe(true);
    const rules = await fsp.readFile(rulesPath, 'utf8');
    expect(rules).toContain('# Repository rules');
    expect(rules.match(/WORKSPAI:PROJECT-GROUNDING:START/g)).toHaveLength(1);
    expect(rules).not.toContain('WORKSPAI:AGENT-ENTRY:START');
    expect(rules).not.toContain('@AGENTS.md');
    expect(first.hostCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex',
          status: 'ready',
          entryFiles: ['AGENTS.md', '.agents/skills/workspai-grounding/SKILL.md'],
        }),
        expect.objectContaining({ id: 'claude', status: 'ready', entryFiles: ['CLAUDE.md'] }),
      ])
    );
  });

  it('removes a legacy Claude self-import when CLAUDE.md aliases AGENTS.md', async (context) => {
    const { workspacePath, projectPath } = await fixture({
      workspaceName: 'claude-agents-alias-workspace',
    });
    const agentsPath = path.join(projectPath, 'AGENTS.md');
    await fsp.writeFile(
      agentsPath,
      `# Repository rules\n\n${WORKSPAI_AGENT_ENTRY_START}\n@AGENTS.md\n\n# Workspai host binding · claude\n${WORKSPAI_AGENT_ENTRY_END}\n`
    );
    try {
      await fsp.symlink('AGENTS.md', path.join(projectPath, 'CLAUDE.md'));
    } catch {
      context.skip();
      return;
    }

    const result = await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });

    const agents = await fsp.readFile(agentsPath, 'utf8');
    expect(agents).toContain('# Repository rules');
    expect(agents.match(/WORKSPAI:PROJECT-GROUNDING:START/g)).toHaveLength(1);
    expect(agents).not.toContain('WORKSPAI:AGENT-ENTRY:START');
    expect(agents).not.toContain('@AGENTS.md');
    expect((await fsp.lstat(path.join(projectPath, 'CLAUDE.md'))).isSymbolicLink()).toBe(true);
    expect(result.hostCoverage).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'claude', status: 'ready' })])
    );
  });

  it('accepts a local symlink target when the project root uses an alias path', async (context) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'workspai-project-alias-'));
    cleanup.push(root);
    const canonicalProjectPath = path.join(root, 'canonical-project');
    const aliasProjectPath = path.join(root, 'project-alias');
    await fsp.mkdir(canonicalProjectPath, { recursive: true });
    await fsp.writeFile(path.join(canonicalProjectPath, '.rules'), '# Repository rules\n');
    try {
      await fsp.symlink('.rules', path.join(canonicalProjectPath, 'AGENTS.md'));
      await fsp.symlink(canonicalProjectPath, aliasProjectPath, 'dir');
    } catch {
      context.skip();
      return;
    }

    const resolvedTarget = await resolveRepositoryLocalSymlinkFile(
      aliasProjectPath,
      path.join(aliasProjectPath, 'AGENTS.md')
    );
    expect(resolvedTarget).not.toBeNull();
    await expect(fsp.readFile(resolvedTarget as string, 'utf8')).resolves.toBe(
      '# Repository rules\n'
    );
    expect((await fsp.stat(resolvedTarget as string)).isFile()).toBe(true);
  });

  it('never follows an AGENTS symlink outside the adopted project boundary', async (context) => {
    const { root, workspacePath, projectPath } = await fixture({
      workspaceName: 'external-agent-rules-workspace',
    });
    const outsideRules = path.join(root, 'outside-rules.md');
    await fsp.writeFile(outsideRules, '# Outside rules\n');
    try {
      await fsp.symlink(outsideRules, path.join(projectPath, 'AGENTS.md'));
    } catch {
      context.skip();
      return;
    }

    const result = await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });

    expect(await fsp.readFile(outsideRules, 'utf8')).toBe('# Outside rules\n');
    expect(result.hostCoverage).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'codex', status: 'blocked' })])
    );
  });

  it('blocks a nested provider adapter when its repository parent is a symbolic link', async (context) => {
    const { root, workspacePath, projectPath } = await fixture({
      workspaceName: 'adapter-safety-workspace',
    });
    const outsidePath = path.join(root, 'outside-amazonq');
    await fsp.mkdir(outsidePath, { recursive: true });
    try {
      await fsp.symlink(outsidePath, path.join(projectPath, '.amazonq'), 'dir');
    } catch {
      context.skip();
      return;
    }

    const result = await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });

    expect(fs.existsSync(path.join(outsidePath, 'rules', 'workspai-agent-entry.md'))).toBe(false);
    expect(result.hostCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'amazon-q',
          status: 'blocked',
          reason: expect.stringContaining('unsafe repository-authored parent'),
        }),
      ])
    );
  });

  it('preserves an authored project Skill even when it uses a Workspai name', async () => {
    const { workspacePath, projectPath } = await fixture({
      workspaceName: 'authored-project-skill-workspace',
    });
    const skillPath = path.join(projectPath, '.agents', 'skills', 'workspai-grounding', 'SKILL.md');
    const authored = '---\nname: workspai-grounding\n---\n\n# Team-owned workflow\n';
    await fsp.mkdir(path.dirname(skillPath), { recursive: true });
    await fsp.writeFile(skillPath, authored);

    const result = await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });

    expect(await fsp.readFile(skillPath, 'utf8')).toBe(authored);
    expect(result.hostCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex',
          status: 'degraded',
          reason: expect.stringContaining('authored Skill'),
        }),
      ])
    );
  });

  it('supports a repository-local .agents/skills mirror without escaping the project', async (context) => {
    const { workspacePath, projectPath } = await fixture({
      workspaceName: 'project-skill-mirror-workspace',
    });
    const sharedSkills = path.join(projectPath, '.claude', 'skills');
    await fsp.mkdir(path.join(projectPath, '.agents'), { recursive: true });
    await fsp.mkdir(sharedSkills, { recursive: true });
    try {
      await fsp.symlink(
        path.join('..', '.claude', 'skills'),
        path.join(projectPath, '.agents', 'skills'),
        'dir'
      );
    } catch {
      context.skip();
      return;
    }

    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });

    expect(fs.existsSync(path.join(sharedSkills, 'workspai-grounding', 'SKILL.md'))).toBe(true);
  });

  it('blocks a project .agents symlink that leaves the repository', async (context) => {
    const { root, workspacePath, projectPath } = await fixture({
      workspaceName: 'project-skill-escape-workspace',
    });
    const outsidePath = path.join(root, 'outside-agent-skills');
    await fsp.mkdir(outsidePath, { recursive: true });
    try {
      await fsp.symlink(outsidePath, path.join(projectPath, '.agents'), 'dir');
    } catch {
      context.skip();
      return;
    }

    const result = await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'web',
      relationship: 'adopted',
      mode: 'managed',
    });

    expect(await fsp.readdir(outsidePath)).toEqual([]);
    expect(result.hostCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex',
          status: 'blocked',
          reason: expect.stringContaining('blocked by authored state'),
        }),
      ])
    );
  });
});
