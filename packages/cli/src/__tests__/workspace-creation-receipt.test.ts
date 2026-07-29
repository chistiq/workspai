import { describe, expect, it } from 'vitest';

import { workspaceCreationReceiptLines } from '../cli-ui/workspace-creation-receipt.js';

describe('workspace creation receipt', () => {
  it('presents one concise Workspace Intelligence handoff', () => {
    const receipt = workspaceCreationReceiptLines({
      workspaceName: 'my-workspace',
      workspacePath: '/workspaces/my-workspace',
      profile: 'polyglot',
      projectCount: 0,
      pythonEngine: 'installed',
      pythonVersion: '3.12',
      installMethod: 'venv',
    }).join('\n');

    expect(receipt).toContain('✓ Workspace ready');
    expect(receipt).toContain('my-workspace · polyglot · 0 registered projects');
    expect(receipt).toContain('Canonical model and proof-backed graph');
    expect(receipt).toContain(
      'npx workspai workspace intelligence run --for-agent generic --strict --json'
    );
    expect(receipt).toContain('Evidence  .workspai/reports/INDEX.json');
    expect(receipt).not.toContain('artifact(s)');
    expect(receipt).not.toContain('workspai init');
  });
});
