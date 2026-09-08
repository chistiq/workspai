import { describe, expect, it } from 'vitest';

import type {
  DecisionArtifactReference,
  DecisionEvent,
  UnsignedDecisionEvent,
} from '../decisions/decision-contract.js';
import {
  createDecisionEvent,
  currentDecisionEffectHeadDigest,
  reduceDecisionEvents,
} from '../decisions/decision-kernel.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';

const ports = { digestCanonical: hashCanonicalJson };
const at = '2026-08-29T00:00:00.000Z';
const digest = (character: string) => character.repeat(64);

function reference(role: string, artifact: string): DecisionArtifactReference {
  return {
    role,
    artifact,
    schemaVersion: 'fixture.v1',
    digest: { algorithm: 'sha256', semantics: 'canonical-json-v1', value: digest('a') },
  };
}

function append(
  events: DecisionEvent[],
  kind: UnsignedDecisionEvent['kind'],
  payload: UnsignedDecisionEvent['payload']
): void {
  events.push(
    createDecisionEvent(
      'change-kernel-fixture',
      events.at(-1) ?? null,
      { kind, occurredAt: at, actor: { kind: 'cli', id: 'test' }, payload },
      ports
    )
  );
}

function authorizedEvents(): DecisionEvent[] {
  const events: DecisionEvent[] = [];
  append(events, 'created', {
    summary: 'Create transaction',
    references: [
      reference('intent', '.workspai/goals/g/goal-pack.json'),
      reference('success-criterion', 'workspace-verify'),
    ],
  });
  append(events, 'scope-bound', {
    summary: 'Bind scope',
    scope: { kind: 'project', projects: ['api'] },
  });
  append(events, 'evidence-attached', {
    summary: 'Attach architecture baseline',
    references: [reference('model', '.workspai/reports/workspace-model.json')],
  });
  append(events, 'authorized', {
    summary: 'Authorize bounded effects',
    authorization: {
      grantedBy: 'operator',
      grant: 'bounded-effects',
      effectClasses: ['filesystem', 'command'],
    },
  });
  return events;
}

describe('decision transaction kernel', () => {
  it('derives state exclusively from a causal, digest-validated event chain', () => {
    const events = authorizedEvents();
    const transaction = reduceDecisionEvents(events, ports);

    expect(transaction.state).toBe('authorized');
    expect(transaction.scope).toEqual({ kind: 'project', projects: ['api'] });
    expect(transaction.eventHeadDigest).toBe(events.at(-1)?.digest);
    expect(transaction.generation).toBe(4);

    const tampered = structuredClone(events);
    tampered[1].payload.summary = 'tampered';
    expect(() => reduceDecisionEvents(tampered, ports)).toThrow(/digest is invalid/);
  });

  it('rejects unapproved effect classes and duplicate idempotency keys', () => {
    const events = authorizedEvents();
    append(events, 'effect-recorded', {
      summary: 'Observed source write',
      effect: {
        id: 'effect-1',
        effectClass: 'filesystem',
        status: 'succeeded',
        summary: 'Updated source',
        artifacts: [],
        observedAt: at,
        idempotencyKey: 'source-write-1',
      },
    });
    append(events, 'effect-recorded', {
      summary: 'Duplicate source write',
      effect: {
        id: 'effect-2',
        effectClass: 'filesystem',
        status: 'succeeded',
        summary: 'Updated source again',
        artifacts: [],
        observedAt: at,
        idempotencyKey: 'source-write-1',
      },
    });
    expect(() => reduceDecisionEvents(events, ports)).toThrow(/idempotency key/);

    const external = authorizedEvents();
    append(external, 'effect-recorded', {
      summary: 'Unapproved external effect',
      effect: {
        id: 'effect-external',
        effectClass: 'external',
        status: 'succeeded',
        summary: 'Sent remote request',
        artifacts: [],
        observedAt: at,
        idempotencyKey: 'external-1',
      },
    });
    expect(() => reduceDecisionEvents(external, ports)).toThrow(/outside the authorization grant/);
  });

  it('commits only after exact post-effect verification satisfies every criterion', () => {
    const events = authorizedEvents();
    append(events, 'effect-recorded', {
      summary: 'Observed source write',
      effect: {
        id: 'effect-1',
        effectClass: 'filesystem',
        status: 'succeeded',
        summary: 'Updated source',
        artifacts: [],
        observedAt: at,
        idempotencyKey: 'source-write-1',
      },
    });
    const executing = reduceDecisionEvents(events, ports);
    append(events, 'verification-started', { summary: 'Verify current generation' });
    append(events, 'verification-recorded', {
      summary: 'Workspace verify passed',
      verification: {
        id: 'verify-1',
        criterionId: 'workspace-verify',
        status: 'passed',
        summary: 'Canonical verification passed',
        target: {
          modelHash: digest('m'),
          graphHash: digest('g'),
          effectHeadDigest: currentDecisionEffectHeadDigest(executing, ports),
        },
        artifacts: [],
        observedAt: at,
      },
    });
    append(events, 'committed', { summary: 'Seal the verified change' });

    expect(reduceDecisionEvents(events, ports).state).toBe('committed');

    const wrongTarget = structuredClone(events.slice(0, -2));
    append(wrongTarget, 'verification-recorded', {
      summary: 'Receipt from a different effect generation',
      verification: {
        id: 'verify-wrong',
        criterionId: 'workspace-verify',
        status: 'passed',
        summary: 'Wrong target',
        target: {
          modelHash: digest('m'),
          graphHash: digest('g'),
          effectHeadDigest: digest('x'),
        },
        artifacts: [],
        observedAt: at,
      },
    });
    expect(() => reduceDecisionEvents(wrongTarget, ports)).toThrow(/current effect head/);
  });
});
