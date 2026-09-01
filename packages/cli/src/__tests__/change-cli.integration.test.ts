import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { ensureDistBuilt } from './helpers/dist.js';
import { strictVerificationExitCode } from '../commands/change.js';

describe('Proof-Carrying Change CLI process integration', () => {
  it('fails closed when strict verification reaches a blocked state', () => {
    expect(strictVerificationExitCode({ strict: true, state: 'blocked' })).toBe(2);
    expect(strictVerificationExitCode({ strict: false, state: 'blocked' })).toBeUndefined();
    expect(strictVerificationExitCode({ strict: true, state: 'committed' })).toBeUndefined();
  });

  it('publishes the complete command tree and a versioned empty discovery result', () => {
    const dist = ensureDistBuilt();
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-change-cli-'));
    try {
      fs.mkdirSync(path.join(workspacePath, '.workspai'), { recursive: true });
      fs.writeFileSync(
        path.join(workspacePath, '.workspai-workspace'),
        JSON.stringify({ signature: 'RAPIDKIT_WORKSPACE', name: 'change-fixture' })
      );
      fs.writeFileSync(
        path.join(workspacePath, '.workspai', 'workspace.contract.json'),
        JSON.stringify({
          schemaVersion: 1,
          kind: 'rapidkit.workspace.contract',
          generatedAt: '2026-08-29T00:00:00.000Z',
          workspace: { name: 'change-fixture', profile: 'minimal' },
          projects: [],
        })
      );

      const help = spawnSync(process.execPath, [dist, 'change', '--help'], {
        cwd: workspacePath,
        encoding: 'utf8',
      });
      expect(help.status).toBe(0);
      expect(help.stdout).toContain('list');
      expect(help.stdout).toContain('verification');
      expect(help.stdout).toContain('capsule');

      const list = spawnSync(
        process.execPath,
        [dist, 'change', 'list', '--workspace', workspacePath, '--json'],
        { cwd: workspacePath, encoding: 'utf8' }
      );
      expect(list.status).toBe(0);
      expect(JSON.parse(list.stdout)).toMatchObject({
        schemaVersion: 'workspai.proof-carrying-change-list.v1',
        workspace: { name: 'change-fixture' },
        changes: [],
        summary: { total: 0, invalid: 0 },
      });

      const invalid = spawnSync(
        process.execPath,
        [
          dist,
          'change',
          'capsule',
          'validate',
          '--change',
          'change-missing-fixture',
          '--workspace',
          workspacePath,
          '--json',
        ],
        { cwd: workspacePath, encoding: 'utf8' }
      );
      expect(invalid.status).toBe(1);
      expect(JSON.parse(invalid.stdout)).toMatchObject({ valid: false });
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60_000);
});
