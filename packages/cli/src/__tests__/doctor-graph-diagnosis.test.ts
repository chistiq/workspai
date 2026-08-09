import os from 'node:os';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { buildDoctorGraphDiagnosis } from '../utils/doctor-graph-diagnosis.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';

const NOW = new Date('2026-07-26T12:00:00.000Z');

describe('Doctor graph diagnosis', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop();
      if (directory) await fsExtra.remove(directory);
    }
  });

  async function fixture(): Promise<{ root: string; project: string }> {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-graph-'));
    tempDirs.push(root);
    const project = path.join(root, 'api');
    await fsExtra.outputJson(path.join(root, '.workspai', 'workspace.json'), {
      name: 'platform',
      profile: 'enterprise',
    });
    await fsExtra.outputJson(path.join(project, '.workspai', 'project.json'), {
      name: 'api',
      runtime: 'node',
      framework: 'nestjs',
    });
    await fsExtra.outputJson(path.join(project, 'package.json'), {
      name: '@platform/api',
      version: '1.0.0',
      scripts: { test: 'vitest run' },
      dependencies: { express: '^5.0.0' },
    });
    await fsExtra.outputFile(path.join(project, 'src', 'app.ts'), "import './service';\n");
    await fsExtra.outputFile(path.join(project, 'src', 'service.ts'), 'export function run() {}\n');
    await fsExtra.outputFile(path.join(project, 'test', 'app.test.ts'), 'test("ok", () => {});\n');
    await fsExtra.outputJson(path.join(root, 'other', '.workspai', 'project.json'), {
      name: 'other',
      runtime: 'node',
      framework: 'nestjs',
    });
    await fsExtra.outputJson(path.join(root, 'other', 'package.json'), {
      name: '@platform/other',
      version: '1.0.0',
      scripts: { test: 'vitest run' },
      dependencies: { express: '^5.0.0' },
    });
    await fsExtra.outputFile(
      path.join(root, 'other', 'test', 'other.test.ts'),
      'test("ok", () => {});\n'
    );
    const model = await buildWorkspaceModel({ workspacePath: root, now: NOW });
    await writeWorkspaceModel(model, root);
    return { root, project };
  }

  it('returns proof-carrying impact and verification candidates for a Doctor finding', async () => {
    const { root, project } = await fixture();
    const diagnosis = await buildDoctorGraphDiagnosis({
      workspacePath: root,
      projectPath: project,
      projectName: 'api',
      probes: [
        {
          id: 'surface-security-hygiene',
          status: 'fail',
          issueClass: 'security',
          reason: 'Dependency vulnerabilities were reported.',
          subjects: ['express'],
        },
      ],
      now: NOW,
    });

    expect(diagnosis).toMatchObject({
      schemaVersion: 'doctor-graph-diagnosis.v1',
      status: 'available',
      project: { name: 'api', path: 'api' },
      summary: {
        findingCount: 1,
        rootEntityCount: 1,
      },
    });
    const finding = diagnosis.findings[0];
    expect(finding?.subjects).toEqual(['express']);
    expect(finding?.unresolvedSubjects).toEqual([]);
    expect(finding?.rootEntities[0]).toMatchObject({
      kind: 'module',
      label: 'express',
    });
    expect(finding?.verificationTargets).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'test-suite', projectId: 'api' })])
    );
    expect(finding?.proofPaths.length).toBeGreaterThan(0);
    expect(finding?.sourceArtifacts).toContain('api/package.json');
    expect(finding?.sourceArtifacts.some((artifact) => artifact.startsWith('other/'))).toBe(false);
    expect(finding?.affectedEntities.some((entity) => entity.projectId === 'other')).toBe(false);
    expect(finding?.proofPaths.length).toBeLessThanOrEqual(6);
    expect(finding?.sourceArtifacts.length).toBeLessThanOrEqual(8);
    expect(diagnosis.claimBoundary).toMatch(/do not prove runtime causality/i);

    const schema = await fsExtra.readJson(
      path.resolve('contracts/workspace-intelligence/doctor-graph-diagnosis.v1.json')
    );
    expect(schema.$id).toBe(
      'https://workspai.dev/schemas/workspace-intelligence/doctor-graph-diagnosis.v1.json'
    );
    const projectEvidenceSchema = await fsExtra.readJson(
      path.resolve('contracts/doctor-project-evidence.v1.json')
    );
    expect(projectEvidenceSchema.properties.project.properties.graphDiagnosis.$ref).toBe(
      schema.$id
    );
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(diagnosis), JSON.stringify(validate.errors)).toBe(true);
  });

  it('preserves unresolved audit subjects instead of binding them to unrelated packages', async () => {
    const { root, project } = await fixture();
    const diagnosis = await buildDoctorGraphDiagnosis({
      workspacePath: root,
      projectPath: project,
      projectName: 'api',
      probes: [
        {
          id: 'surface-security-hygiene',
          status: 'fail',
          issueClass: 'security',
          reason: 'Dependency vulnerabilities were reported.',
          subjects: ['not-present-in-the-graph'],
        },
      ],
      now: NOW,
    });

    const finding = diagnosis.findings[0];
    expect(finding?.rootEntities).toEqual([
      expect.objectContaining({ kind: 'project', label: 'api' }),
    ]);
    expect(finding?.unresolvedSubjects).toEqual(['not-present-in-the-graph']);
    expect(finding?.unknowns).toEqual([
      expect.stringMatching(/no canonical graph entity resolved/i),
    ]);
    expect(diagnosis.summary).toMatchObject({
      subjectCount: 1,
      unresolvedSubjectCount: 1,
      unknownCount: 1,
    });
  });

  it('refuses stale graph evidence instead of presenting speculative impact', async () => {
    const { root, project } = await fixture();
    const graphPath = path.join(root, '.workspai', 'reports', 'workspace-knowledge-graph.json');
    const graph = await fsExtra.readJson(graphPath);
    graph.source.hash = '0'.repeat(64);
    await fsExtra.writeJson(graphPath, graph, { spaces: 2 });

    const diagnosis = await buildDoctorGraphDiagnosis({
      workspacePath: root,
      projectPath: project,
      projectName: 'api',
      probes: [],
      now: NOW,
    });

    expect(diagnosis.status).toBe('stale');
    expect(diagnosis.findings).toEqual([]);
    expect(diagnosis.diagnostics[0]).toMatch(/stale/i);
  });

  it('reports the explicit missing-graph boundary for standalone projects', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-standalone-'));
    tempDirs.push(root);
    const diagnosis = await buildDoctorGraphDiagnosis({
      projectPath: root,
      projectName: 'standalone',
      probes: [],
      now: NOW,
    });

    expect(diagnosis.status).toBe('graph-missing');
    expect(diagnosis.project.path).toBe('.');
    expect(diagnosis.summary.unknownCount).toBe(1);
  });
});
