import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WORKSPACE_README_MANAGED_END,
  WORKSPACE_README_MANAGED_START,
  renderWorkspaceReadmeManagedBlock,
  syncWorkspaceReadme,
} from '../utils/workspace-readme.js';

const roots: string[] = [];

async function temporaryWorkspace(): Promise<string> {
  const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-readme-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('workspace README projection', () => {
  it('renders the canonical profile, project count, loop, and consumer entrypoints', () => {
    const readme = renderWorkspaceReadmeManagedBlock({
      workspaceName: 'commerce-platform',
      profile: 'polyglot',
      projectCount: 3,
      engineSummary: 'Optional Python engine: Python 3.12 via venv',
    });

    expect(readme).toContain('# commerce-platform');
    expect(readme).toContain('| Profile | `polyglot` |');
    expect(readme).toContain('| Registered projects | 3 projects |');
    expect(readme).toContain(
      'Understand → Change → Evidence → Gate → Ground → Distribute → Explain'
    );
    expect(readme).toContain(
      'npx workspai workspace intelligence run --for-agent generic --strict --json'
    );
    expect(readme).toContain('.workspai/reports/workspace-knowledge-graph.json');
    expect(readme).toContain('Optional Python engine: Python 3.12 via venv');
  });

  it('preserves user-authored content and updates one managed block idempotently', async () => {
    const workspacePath = await temporaryWorkspace();
    await fsExtra.outputFile(
      path.join(workspacePath, 'README.md'),
      '# Customer platform\n\nPrivate operating notes.\n',
      'utf-8'
    );

    await syncWorkspaceReadme({
      workspacePath,
      workspaceName: 'customer-platform',
      profile: 'minimal',
      projectCount: 0,
    });
    await syncWorkspaceReadme({
      workspacePath,
      workspaceName: 'customer-platform',
      profile: 'enterprise',
      projectCount: 4,
    });

    const readme = await fsExtra.readFile(path.join(workspacePath, 'README.md'), 'utf-8');
    expect(readme).toContain('# Customer platform');
    expect(readme).toContain('Private operating notes.');
    expect(readme).toContain('## Workspace Intelligence');
    expect(readme).toContain('| Profile | `enterprise` |');
    expect(readme).toContain('| Registered projects | 4 projects |');
    expect(readme.match(new RegExp(WORKSPACE_README_MANAGED_START, 'g'))).toHaveLength(1);
    expect(readme.match(new RegExp(WORKSPACE_README_MANAGED_END, 'g'))).toHaveLength(1);
  });

  it('migrates the legacy generated README instead of preserving stale commands', async () => {
    const workspacePath = await temporaryWorkspace();
    await fsExtra.outputFile(
      path.join(workspacePath, 'README.md'),
      '# Workspai Workspace\n\nThis directory contains a Workspai development environment.\n\n' +
        'workspai workspace context --for-agent --json --write\n',
      'utf-8'
    );
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.json'), {
      engine: {
        install_method: 'venv',
        python_version: '3.11',
        python_core: { status: 'installed' },
      },
    });

    await syncWorkspaceReadme({
      workspacePath,
      workspaceName: 'payments',
      profile: 'python-only',
      projectCount: 1,
    });

    const readme = await fsExtra.readFile(path.join(workspacePath, 'README.md'), 'utf-8');
    expect(readme).toContain('# payments');
    expect(readme).toContain('| Profile | `python-only` |');
    expect(readme).toContain('Optional Python engine: Python 3.11 via venv');
    expect(readme).not.toContain('workspai workspace context --for-agent --json --write');
  });
});
