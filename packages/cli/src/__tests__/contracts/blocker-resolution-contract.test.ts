import { describe, expect, it } from 'vitest';

import {
  BLOCKER_RESOLUTION_SCHEMA_VERSION,
  computeBlockerSignature,
  isBlockerResolution,
  normalizeBlockerResolutionClass,
} from '../../contracts/blocker-resolution-contract.js';
import {
  buildResolutionHintForBlocker,
  buildResolutionHintsForBlockingReasons,
  inferResolutionClassFromBlockerReason,
} from '../../workspace-blocker-resolution-hints.js';

describe('blocker-resolution contract', () => {
  it('pins the schema version', () => {
    expect(BLOCKER_RESOLUTION_SCHEMA_VERSION).toBe('rapidkit-blocker-resolution-v1');
  });

  it('computes a stable blocker signature', () => {
    const a = computeBlockerSignature({
      blockers: ['doctor: missing evidence'],
      exitCode: 1,
      stderrTail: 'ENOENT',
    });
    const b = computeBlockerSignature({
      blockers: ['doctor: missing evidence'],
      exitCode: 1,
      stderrTail: 'ENOENT',
    });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it('normalizes resolution classes from a closed set', () => {
    expect(normalizeBlockerResolutionClass('artifact-missing')).toBe('artifact-missing');
    expect(normalizeBlockerResolutionClass('bogus')).toBeNull();
  });

  it('validates blocker resolution envelopes', () => {
    const hint = buildResolutionHintForBlocker({
      reason: 'workspaceVerify: missing evidence',
      blockerId: 'blocker-1',
    });
    expect(isBlockerResolution(hint)).toBe(true);
    expect(hint.resolutionClass).toBe('artifact-missing');
    expect(hint.fixHints[0]?.actionKind).toBe('run-once');
  });

  it('prefers an exact evidence producer command over the generic Analyze shortcut', () => {
    const hint = buildResolutionHintForBlocker({
      reason: 'project.web.test: Missing evidence report',
      blockerId: 'blocker-1',
      sourceCommand: 'npx workspai workspace run test --scope project:web --json',
      sourceArtifact: '.workspai/reports/workspace-run-last.json',
    });

    expect(hint.sourceCommand).toBe('npx workspai workspace run test --scope project:web --json');
    expect(hint.fixHints[0]).not.toHaveProperty('studioActionId');
    expect(hint.commandRetryHint).toContain('workspace run test --scope project:web');
  });

  it('infers semantic-attention for impact-style blockers', () => {
    expect(inferResolutionClassFromBlockerReason('impact: untracked grounding files')).toBe(
      'semantic-attention'
    );
  });

  it('builds deduplicated hints for blocking reasons', () => {
    const hints = buildResolutionHintsForBlockingReasons({
      blockingReasons: ['step-a: fail', 'step-a: fail', 'policy.contract: violation'],
    });
    expect(hints).toHaveLength(2);
    expect(hints[1]?.resolutionClass).toBe('config-fixable');
  });
});
