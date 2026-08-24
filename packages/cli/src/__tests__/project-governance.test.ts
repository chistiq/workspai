import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { detectProjectGovernance } from '../utils/project-governance.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('project governance discovery', () => {
  it('distinguishes repository, declared external, observed external, and unknown controls', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-governance-'));
    roots.push(root);
    await fsExtra.outputFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    await fsExtra.outputFile(
      path.join(root, 'CONTRIBUTING.md'),
      'Release engineering is owned by the external release infrastructure.\n'
    );

    const governance = await detectProjectGovernance({
      projectPath: root,
      declaration: {
        ownership: {
          mode: 'external',
          provider: 'central-platform',
          reference: 'https://example.test/owners/service',
        },
      },
    });

    expect(governance.ci).toMatchObject({
      status: 'repository',
      evidence: ['.github/workflows'],
    });
    expect(governance.release).toMatchObject({
      status: 'external-observed',
      evidence: ['CONTRIBUTING.md'],
    });
    expect(governance.ownership).toMatchObject({
      status: 'external-declared',
      provider: 'central-platform',
      reference: 'https://example.test/owners/service',
    });
  });

  it('keeps unavailable governance truth explicitly unknown', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-governance-unknown-'));
    roots.push(root);
    const governance = await detectProjectGovernance({ projectPath: root });
    expect(governance.ci.status).toBe('unknown');
    expect(governance.release.status).toBe('unknown');
    expect(governance.ownership.status).toBe('unknown');
  });

  it('discovers repository release automation from bounded workflow names and release roots', async () => {
    const workflowRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-governance-release-workflow-')
    );
    const toolRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-governance-release-tool-')
    );
    roots.push(workflowRoot, toolRoot);
    await fsExtra.outputFile(
      path.join(workflowRoot, '.github', 'workflows', 'publish-to-registry.yaml'),
      'name: Publish\n'
    );
    await fsExtra.outputFile(path.join(toolRoot, 'tools', 'release', 'notes.py'), '# release\n');

    const workflowGovernance = await detectProjectGovernance({ projectPath: workflowRoot });
    const toolGovernance = await detectProjectGovernance({ projectPath: toolRoot });

    expect(workflowGovernance.release).toMatchObject({
      status: 'repository',
      evidence: ['.github/workflows/publish-to-registry.yaml'],
    });
    expect(toolGovernance.release).toMatchObject({
      status: 'repository',
      evidence: ['tools/release'],
    });
  });
});
