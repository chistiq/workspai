import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  WIS_COMPATIBILITY_STATUSES,
  WIS_DIAGNOSTIC_SEVERITIES,
  WIS_OPERATION_OUTCOMES,
  WIS_RESULT_STATUSES,
  WIS_SCOPE_KINDS,
  type WisResultEnvelope,
} from '../../src/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('@workspai/shared SH1 candidate vocabulary', () => {
  it('matches the machine-readable semantic-lock decisions', () => {
    const semanticLock = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'governance/semantic-lock-decisions.v1.json'), 'utf8')
    ) as { decisions: Array<{ subject: string; decision: unknown }> };
    const decision = (subject: string): unknown =>
      semanticLock.decisions.find((entry) => entry.subject === subject)?.decision;

    expect(WIS_RESULT_STATUSES).toEqual(decision('result-status'));
    expect(WIS_OPERATION_OUTCOMES).toEqual(decision('operation-outcome'));
    expect(WIS_SCOPE_KINDS).toEqual(decision('scope'));
    expect(WIS_DIAGNOSTIC_SEVERITIES).toEqual(decision('diagnostic-severity'));
    expect(WIS_COMPATIBILITY_STATUSES).toEqual(decision('compatibility'));
  });

  it('keeps a blocked domain verdict separate from successful production', () => {
    const result: WisResultEnvelope<{ readonly finding: string }> = {
      specVersion: 'wis-candidate',
      coreVersion: '0.2.0-draft',
      schemaId: 'wis.core.result.0.2.0-draft',
      profile: { id: 'wis.profile.fixture', version: '0.1.0-draft' },
      producer: { id: 'fixture-producer', version: '1.0.0' },
      operation: 'evaluate-fixture',
      operationOutcome: 'succeeded',
      scope: { kind: 'workspace', workspaceId: 'workspace:fixture' },
      generation: { id: 'generation:fixture', generatedAt: '2026-08-13T00:00:00.000Z' },
      status: 'blocked',
      payload: { finding: 'required evidence is missing' },
      evidence: [],
      freshness: { status: 'unknown' },
      unknowns: [],
      omissions: [],
      diagnostics: [
        {
          code: 'FIXTURE_EVIDENCE_MISSING',
          severity: 'error',
          message: 'Required fixture evidence is missing.',
          affectsStatus: true,
        },
      ],
      compatibility: { status: 'compatible' },
    };

    expect(result.operationOutcome).toBe('succeeded');
    expect(result.status).toBe('blocked');
  });
});
