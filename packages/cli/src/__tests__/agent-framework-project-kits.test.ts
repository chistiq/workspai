import os from 'node:os';
import path from 'node:path';
import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  describeAgentFrameworkProjectKits,
  isAdmittedAgentFrameworkProjectKit,
  isAgentFrameworkProjectKit,
  listAgentFrameworkProjectKits,
  initializeAgentFrameworkProjectRoot,
  resolveAgentFrameworkProjectKit,
} from '../agent-frameworks/project-kits.js';
import { readProjectMetadata } from '../utils/project-metadata.js';
import { listBundledAgentFrameworkReleaseAdmissions } from '../agent-frameworks/release-admission.js';

const roots: string[] = [];
const releaseAdmitted = listBundledAgentFrameworkReleaseAdmissions().length === 4;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('agent framework project kits', () => {
  it('publishes every Microsoft and OpenAI kit without treating visibility as admission', () => {
    expect(describeAgentFrameworkProjectKits().map((kit) => kit.id)).toEqual([
      'agent.microsoft.python',
      'agent.microsoft.dotnet',
      'agent.openai.python',
      'agent.openai.typescript',
    ]);
    const kits = listAgentFrameworkProjectKits();
    expect(kits.map((kit) => kit.id)).toEqual([
      'agent.microsoft.python',
      'agent.microsoft.dotnet',
      'agent.openai.python',
      'agent.openai.typescript',
    ]);
    expect(isAgentFrameworkProjectKit('agent.openai.python')).toBe(true);
    expect(isAgentFrameworkProjectKit('agent.openai.typescript')).toBe(true);
    expect(resolveAgentFrameworkProjectKit('agent.openai.python')?.adapterId).toBe(
      'openai-agents-python'
    );
    expect(resolveAgentFrameworkProjectKit('agent.openai.typescript')?.adapterId).toBe(
      'openai-agents-typescript'
    );
    expect(isAdmittedAgentFrameworkProjectKit('agent.openai.python')).toBe(releaseAdmitted);
    expect(isAdmittedAgentFrameworkProjectKit('agent.openai.typescript')).toBe(releaseAdmitted);
    expect(kits.every((kit) => isAdmittedAgentFrameworkProjectKit(kit) === releaseAdmitted)).toBe(
      true
    );
  });

  it('resolves stable aliases without exposing mutable registry state', () => {
    const first = resolveAgentFrameworkProjectKit('agent-framework-python');
    expect(first?.id).toBe('agent.microsoft.python');
    if (!first) throw new Error('Expected Python agent kit.');
    first.aliases.length = 0;
    expect(
      resolveAgentFrameworkProjectKit('agent-framework-python')?.aliases.length
    ).toBeGreaterThan(0);
    expect(resolveAgentFrameworkProjectKit('unknown')).toBeNull();
  });

  it('emits one canonical runtime boundary and preserves framework identity', async () => {
    for (const kit of listAgentFrameworkProjectKits()) {
      const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-agent-kit-'));
      roots.push(root);
      await initializeAgentFrameworkProjectRoot({
        projectPath: root,
        projectName: 'agent-app',
        kit,
      });
      expect(await fsExtra.pathExists(path.join(root, 'pyproject.toml'))).toBe(false);
      expect((await fsExtra.readdir(root)).some((entry) => entry.endsWith('.csproj'))).toBe(false);
      expect(readProjectMetadata(root)?.detection).toMatchObject({
        key: kit.frameworkId,
        runtime: kit.runtime,
        displayName: kit.frameworkName,
        source: 'kit',
      });
      expect(await fsExtra.readJson(path.join(root, '.workspai', 'project.json'))).toMatchObject({
        kind: 'agent',
        category: 'agent',
        project_type: 'agent',
      });
    }
  });
});
