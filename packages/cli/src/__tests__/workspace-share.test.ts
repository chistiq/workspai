import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsExtra from 'fs-extra';
import path from 'path';
import os from 'os';
import { createWorkspaceShareBundle } from '../workspace.js';

describe('createWorkspaceShareBundle', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `workspace-share-test-${Date.now()}-${Math.random()}`);
    await fsExtra.ensureDir(testDir);
  });

  afterEach(async () => {
    if (testDir && (await fsExtra.pathExists(testDir))) {
      await fsExtra.remove(testDir);
    }
  });

  it('creates a collaboration bundle with project metadata and reports', async () => {
    const projectPath = path.join(testDir, 'orders-service');

    await fsExtra.outputJson(path.join(testDir, '.rapidkit', 'workspace.json'), {
      workspace_name: 'team-ws',
      profile: 'polyglot',
      rapidkit_version: '0.26.0',
    });
    await fsExtra.outputJson(path.join(testDir, '.rapidkit', 'reports', 'doctor-last-run.json'), {
      status: 'pass',
    });
    await fsExtra.outputJson(path.join(testDir, '.rapidkit', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'team-ws' },
      projects: [
        {
          slug: 'orders-service',
          relativePath: 'orders-service',
          ports: [{ name: 'http', port: 8080, protocol: 'http' }],
          contracts: {
            owns: ['Order'],
            apis: [],
            publishes: ['OrderCreated'],
            consumes: [],
            dependsOn: [],
            env: [],
          },
        },
      ],
    });

    await fsExtra.outputJson(path.join(projectPath, '.rapidkit', 'project.json'), {
      runtime: 'java',
      kit_name: 'springboot.standard',
      modules: ['settings', 'logging'],
    });
    await fsExtra.outputJson(
      path.join(projectPath, '.rapidkit', 'reports', 'doctor-last-run.json'),
      {
        status: 'pass',
        project: { name: 'orders-service' },
      }
    );

    const outputPath = await createWorkspaceShareBundle(testDir);
    const bundle = await fsExtra.readJson(outputPath);

    expect(outputPath).toContain(path.join('.workspai', 'reports', 'share-bundle.json'));
    expect(bundle.workspace.name).toBe('team-ws');
    expect(bundle.schema_version).toBe('1.1');
    expect(bundle.workspace.profile).toBe('polyglot');
    expect(bundle.summary.project_count).toBe(1);
    expect(bundle.summary.contract_included).toBe(true);
    expect(bundle.contract.projects[0].ports[0].port).toBe(8080);
    expect(bundle.projects[0].name).toBe('orders-service');
    expect(bundle.projects[0].relative_path).toBe('orders-service');
    expect(bundle.projects[0].runtime).toBe('java');
    expect(bundle.projects[0].kit_name).toBe('springboot.standard');
    expect(bundle.projects[0].modules).toEqual(['settings', 'logging']);
    expect(bundle.projects[0].doctor_report).toBeTruthy();
    expect(bundle.workspace.absolute_root).toBeUndefined();
    expect(bundle.projects[0].absolute_path).toBeUndefined();
    expect(bundle.blueprint).toMatchObject({
      schema_version: 'rapidkit.workspace-blueprint.v1',
      purpose: 'portable-reproducibility',
      workspace: {
        name: 'team-ws',
        profile: 'polyglot',
      },
    });
    expect(bundle.blueprint.projects[0].recreate_commands).toContain(
      'npx workspai create project springboot.standard orders-service --yes --skip-install'
    );
    expect(bundle.blueprint.recommended_commands).toContain(
      'npx workspai workspace contract verify --strict'
    );
    expect(bundle.blueprint.recommended_commands).toContain(
      'npx workspai readiness --strict --json'
    );
  });

  it('supports includePaths and no-doctor modes', async () => {
    const projectPath = path.join(testDir, 'billing-service');

    await fsExtra.outputJson(path.join(projectPath, '.rapidkit', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
    });

    const outputPath = await createWorkspaceShareBundle(testDir, {
      includePaths: true,
      includeDoctorEvidence: false,
      outputPath: path.join(testDir, 'custom-share.json'),
    });

    const bundle = await fsExtra.readJson(outputPath);

    expect(outputPath).toBe(path.join(testDir, 'custom-share.json'));
    expect(bundle.workspace.absolute_root).toBe(path.resolve(testDir));
    expect(bundle.projects[0].absolute_path).toBe(path.resolve(projectPath));
    expect(bundle.summary.doctor_evidence_included).toBe(false);
    expect(bundle.projects[0].doctor_report).toBeUndefined();
  });

  it('supports excluding the reproducibility blueprint', async () => {
    const projectPath = path.join(testDir, 'worker-service');

    await fsExtra.outputJson(path.join(projectPath, '.rapidkit', 'project.json'), {
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const outputPath = await createWorkspaceShareBundle(testDir, {
      includeBlueprint: false,
    });

    const bundle = await fsExtra.readJson(outputPath);

    expect(bundle.blueprint).toBeUndefined();
  });

  it('skips invalid doctor report schemas when building share bundle', async () => {
    const projectPath = path.join(testDir, 'payments-service');

    await fsExtra.outputJson(path.join(projectPath, '.rapidkit', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
    });

    await fsExtra.outputJson(
      path.join(projectPath, '.rapidkit', 'reports', 'doctor-last-run.json'),
      {
        schemaVersion: 'doctor-project-evidence-v999',
        evidenceType: 'project',
        status: 'pass',
      }
    );

    const outputPath = await createWorkspaceShareBundle(testDir);
    const bundle = await fsExtra.readJson(outputPath);

    expect(bundle.summary.doctor_evidence_included).toBe(true);
    expect(bundle.projects[0].doctor_report).toBeUndefined();
  });
});
