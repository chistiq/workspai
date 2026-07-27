import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildExistingSoftwareSourcePrompt,
  buildInteractiveCreateTargetChoices,
  classifyExistingSoftwareSource,
} from '../utils/create-ingestion-choice.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => fsExtra.remove(item)));
});

describe('interactive create ingestion choices', () => {
  it('opens the existing-software source input empty and validates explicit input', () => {
    const sourcePrompt = buildExistingSoftwareSourcePrompt();

    expect(sourcePrompt).not.toHaveProperty('default');
    expect(sourcePrompt.validate('')).toBe('A source is required');
    expect(sourcePrompt.validate(' ./existing-project ')).toBe(true);
  });

  it('prioritizes projects and existing software inside a workspace', () => {
    expect(buildInteractiveCreateTargetChoices('platform')).toEqual([
      { name: 'Create a project', value: 'project' },
      {
        name: 'Add existing software (local project, Git repository, or workspace)',
        value: 'existing',
      },
      {
        name: 'Create another workspace (outside the current workspace)…',
        value: 'workspace',
      },
    ]);
  });

  it('classifies archives before generic URLs and distinguishes workspace folders', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-choice-'));
    cleanup.push(workspacePath);
    await fsExtra.writeJson(path.join(workspacePath, '.workspai-workspace'), {
      signature: 'WORKSPAI_WORKSPACE',
      name: 'existing',
    });

    expect(
      classifyExistingSoftwareSource('https://example.test/team.workspai-archive.zip')
    ).toEqual({
      kind: 'workspace-archive',
      source: 'https://example.test/team.workspai-archive.zip',
    });
    expect(classifyExistingSoftwareSource('https://example.test/team.git')).toEqual({
      kind: 'git-project',
      source: 'https://example.test/team.git',
    });
    expect(classifyExistingSoftwareSource(workspacePath)).toEqual({
      kind: 'local-workspace',
      source: workspacePath,
    });
    expect(classifyExistingSoftwareSource(path.join(workspacePath, 'project'))).toEqual({
      kind: 'local-project',
      source: path.join(workspacePath, 'project'),
    });
  });
});
