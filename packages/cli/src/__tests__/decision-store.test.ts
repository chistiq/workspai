import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import fsExtra from 'fs-extra';
import { describe, expect, it } from 'vitest';

import type { DecisionArtifactReference } from '../decisions/decision-contract.js';
import {
  appendDecisionEvent,
  readDecisionTransaction,
  repairDecisionProjection,
} from '../decisions/decision-store.js';

const at = '2026-08-29T00:00:00.000Z';
const intent: DecisionArtifactReference = {
  role: 'intent',
  artifact: '.workspai/goals/goal-1/goal-pack.json',
  schemaVersion: 'workspai.goal-pack.v1',
  digest: { algorithm: 'sha256', semantics: 'canonical-json-v1', value: 'a'.repeat(64) },
};

describe('decision transaction store', () => {
  it('serializes optimistic appends and repairs projections from the authoritative log', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'workspai-decision-store-'));
    const transactionId = 'change-store-fixture';
    const created = await appendDecisionEvent({
      workspacePath,
      transactionId,
      expectedHeadDigest: null,
      event: {
        kind: 'created',
        occurredAt: at,
        actor: { kind: 'cli', id: 'test' },
        payload: { summary: 'Create', references: [intent] },
      },
    });

    const attempts = await Promise.allSettled(
      ['api', 'web'].map((project) =>
        appendDecisionEvent({
          workspacePath,
          transactionId,
          expectedHeadDigest: created.transaction.eventHeadDigest,
          event: {
            kind: 'scope-bound',
            occurredAt: at,
            actor: { kind: 'cli', id: 'test' },
            payload: {
              summary: `Bind ${project}`,
              scope: { kind: 'project', projects: [project] },
            },
          },
        })
      )
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);

    const record = await readDecisionTransaction(workspacePath, transactionId);
    await fsExtra.remove(record.paths.transaction);
    await fsExtra.remove(record.paths.checkpoint);
    const repaired = await repairDecisionProjection(workspacePath, transactionId, at);

    expect(repaired.transaction.state).toBe('scoped');
    expect(repaired.transaction.eventCount).toBe(2);
    expect(await fsExtra.pathExists(repaired.paths.transaction)).toBe(true);
    expect(await fsExtra.pathExists(repaired.paths.checkpoint)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects an authoritative event log symlink that escapes the workspace',
    async () => {
      const workspacePath = await mkdtemp(path.join(tmpdir(), 'workspai-decision-symlink-'));
      const outsidePath = await mkdtemp(path.join(tmpdir(), 'workspai-decision-outside-'));
      const transactionId = 'change-symlink-fixture';
      const transactionDirectory = path.join(
        workspacePath,
        '.workspai',
        'decisions',
        transactionId
      );
      await fsExtra.ensureDir(transactionDirectory);
      const outsideEvents = path.join(outsidePath, 'events.jsonl');
      await fsExtra.outputFile(outsideEvents, '{}\n');
      await fsExtra.ensureSymlink(outsideEvents, path.join(transactionDirectory, 'events.jsonl'));

      await expect(readDecisionTransaction(workspacePath, transactionId)).rejects.toThrow(
        /resolves outside workspace root/i
      );
      await fsExtra.remove(outsidePath);
    }
  );
});
