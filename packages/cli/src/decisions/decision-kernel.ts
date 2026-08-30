import {
  DECISION_CHECKPOINT_SCHEMA_VERSION,
  DECISION_EVENT_SCHEMA_VERSION,
  DECISION_TRANSACTION_SCHEMA_VERSION,
  type DecisionCheckpoint,
  type DecisionEffectReceipt,
  type DecisionEvent,
  type DecisionKernelPorts,
  type DecisionTransaction,
  type DecisionTransactionState,
  type DecisionVerificationReceipt,
  type UnsignedDecisionEvent,
} from './decision-contract.js';

const TERMINAL_STATES = new Set<DecisionTransactionState>([
  'committed',
  'rejected',
  'aborted',
  'superseded',
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Decision protocol violation: ${message}`);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function effectHeadDigest(transaction: DecisionTransaction, ports: DecisionKernelPorts): string {
  return ports.digestCanonical(
    transaction.effects.map((receipt) => ({
      id: receipt.id,
      status: receipt.status,
      key: receipt.idempotencyKey,
    }))
  );
}

function validateReceiptIdentity(
  receipts: readonly { id: string }[],
  id: string,
  label: string
): void {
  assert(!receipts.some((receipt) => receipt.id === id), `${label} receipt '${id}' already exists`);
}

function appendEffect(
  transaction: DecisionTransaction,
  receipt: DecisionEffectReceipt
): DecisionEffectReceipt[] {
  validateReceiptIdentity(transaction.effects, receipt.id, 'effect');
  const duplicateKey = transaction.effects.find(
    (candidate) => candidate.idempotencyKey === receipt.idempotencyKey
  );
  assert(
    !duplicateKey,
    `effect idempotency key '${receipt.idempotencyKey}' was already recorded by '${duplicateKey?.id}'`
  );
  return [...transaction.effects, receipt];
}

function appendVerification(
  transaction: DecisionTransaction,
  receipt: DecisionVerificationReceipt,
  ports: DecisionKernelPorts
): DecisionVerificationReceipt[] {
  validateReceiptIdentity(transaction.verifications, receipt.id, 'verification');
  assert(
    receipt.target.effectHeadDigest === effectHeadDigest(transaction, ports),
    `verification '${receipt.id}' does not bind the current effect head`
  );
  return [...transaction.verifications, receipt];
}

function requiredVerificationSatisfied(transaction: DecisionTransaction): boolean {
  return transaction.requiredCriteria.every((criterionId) => {
    const matching = transaction.verifications.filter(
      (receipt) => receipt.criterionId === criterionId
    );
    return matching.length > 0 && matching.at(-1)?.status === 'passed';
  });
}

function applyEvent(
  current: DecisionTransaction | null,
  event: DecisionEvent,
  ports: DecisionKernelPorts
): DecisionTransaction {
  if (event.kind === 'created') {
    assert(current === null, 'created must be the first event');
    const intent = event.payload.references?.[0];
    assert(intent, 'created must bind an intent artifact');
    const criteria =
      event.payload.references
        ?.filter((reference) => reference.role === 'success-criterion')
        .map((reference) => reference.artifact) ?? [];
    return {
      schemaVersion: DECISION_TRANSACTION_SCHEMA_VERSION,
      id: event.transactionId,
      purpose: 'proof-carrying-change',
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
      state: 'draft',
      generation: 1,
      eventCount: event.sequence,
      eventHeadDigest: event.digest,
      intent,
      requiredCriteria: unique(criteria),
      scope: null,
      evidence: [],
      plans: [],
      authorization: null,
      effects: [],
      verifications: [],
      blockers: [],
    };
  }

  assert(current, `${event.kind} cannot occur before created`);
  assert(
    !TERMINAL_STATES.has(current.state),
    `${event.kind} cannot follow terminal state ${current.state}`
  );
  let state = current.state;
  let scope = current.scope;
  let evidence = current.evidence;
  let plans = current.plans;
  let authorization = current.authorization;
  let effects = current.effects;
  let verifications = current.verifications;
  let blockers = current.blockers;
  let terminalReason = current.terminalReason;

  switch (event.kind) {
    case 'scope-bound':
      assert(
        current.state === 'draft' || current.state === 'scoped',
        'scope-bound requires draft or scoped state'
      );
      assert(event.payload.scope, 'scope-bound requires scope');
      scope = event.payload.scope;
      state = 'scoped';
      break;
    case 'evidence-attached':
      assert(
        current.state === 'scoped' || current.state === 'evidence-ready',
        'evidence-attached requires scoped state'
      );
      assert((event.payload.references?.length ?? 0) > 0, 'evidence-attached requires references');
      evidence = [...evidence, ...(event.payload.references ?? [])];
      state = 'evidence-ready';
      break;
    case 'plan-attached':
      assert(current.state === 'evidence-ready', 'plan-attached requires evidence-ready state');
      assert((event.payload.references?.length ?? 0) > 0, 'plan-attached requires references');
      plans = [...plans, ...(event.payload.references ?? [])];
      break;
    case 'authorized':
      assert(current.state === 'evidence-ready', 'authorization requires evidence-ready state');
      assert(event.payload.authorization, 'authorized requires a bounded authorization grant');
      authorization = event.payload.authorization;
      state = 'authorized';
      break;
    case 'effect-requested':
      assert(
        current.state === 'authorized' || current.state === 'executing',
        'effect-requested requires authorization'
      );
      state = 'executing';
      break;
    case 'effect-recorded':
      assert(
        current.state === 'authorized' || current.state === 'executing',
        'effect-recorded requires authorization'
      );
      assert(event.payload.effect, 'effect-recorded requires a receipt');
      assert(
        authorization?.effectClasses.includes(event.payload.effect.effectClass),
        `effect class '${event.payload.effect.effectClass}' is outside the authorization grant`
      );
      effects = appendEffect(current, event.payload.effect);
      state = event.payload.effect.status === 'succeeded' ? 'executing' : 'blocked';
      if (event.payload.effect.status !== 'succeeded') {
        blockers = [
          ...blockers,
          {
            code:
              event.payload.effect.status === 'uncertain'
                ? 'decision.effect.uncertain'
                : 'decision.effect.failed',
            actionable: true,
            details: event.payload.effect.summary,
          },
        ];
      }
      break;
    case 'effect-uncertain':
      assert(
        current.state === 'authorized' || current.state === 'executing',
        'effect-uncertain requires an active execution'
      );
      state = 'blocked';
      blockers = [
        ...blockers,
        event.payload.blocker ?? { code: 'decision.effect.uncertain', actionable: true },
      ];
      break;
    case 'verification-started':
      assert(
        current.state === 'authorized' || current.state === 'executing',
        'verification-started requires authorized or executing state'
      );
      state = 'verifying';
      break;
    case 'verification-recorded': {
      assert(current.state === 'verifying', 'verification-recorded requires verifying state');
      assert(event.payload.verification, 'verification-recorded requires a receipt');
      verifications = appendVerification(current, event.payload.verification, ports);
      state =
        event.payload.verification.status === 'failed'
          ? 'blocked'
          : event.payload.verification.status === 'inconclusive'
            ? 'awaiting-human'
            : 'verifying';
      break;
    }
    case 'human-required':
      state = 'awaiting-human';
      break;
    case 'blocked':
      assert(event.payload.blocker, 'blocked requires a structured blocker');
      blockers = [...blockers, event.payload.blocker];
      state = 'blocked';
      break;
    case 'resumed':
      assert(
        current.state === 'blocked' || current.state === 'awaiting-human',
        'resumed requires a paused state'
      );
      assert(event.payload.resumeTo, 'resumed requires an explicit target state');
      state = event.payload.resumeTo;
      blockers = [];
      break;
    case 'committed':
      assert(current.state === 'verifying', 'commit requires verifying state');
      assert(
        requiredVerificationSatisfied(current),
        'every required criterion needs a latest passing receipt'
      );
      assert(
        !current.effects.some((effect) => effect.status !== 'succeeded'),
        'all effects must be certainly successful'
      );
      state = 'committed';
      terminalReason = event.payload.reason ?? event.payload.summary;
      break;
    case 'rejected':
    case 'aborted':
    case 'superseded':
      state = event.kind;
      terminalReason = event.payload.reason ?? event.payload.summary;
      break;
    default:
      throw new Error(
        `Decision protocol violation: unsupported event ${(event as DecisionEvent).kind}`
      );
  }

  return {
    ...current,
    updatedAt: event.occurredAt,
    state,
    generation: current.generation + 1,
    eventCount: event.sequence,
    eventHeadDigest: event.digest,
    scope,
    evidence,
    plans,
    authorization,
    effects,
    verifications,
    blockers,
    ...(terminalReason ? { terminalReason } : {}),
  };
}

export function createDecisionEvent(
  transactionId: string,
  previous: DecisionEvent | null,
  input: UnsignedDecisionEvent,
  ports: DecisionKernelPorts
): DecisionEvent {
  const sequence = (previous?.sequence ?? 0) + 1;
  const unsigned = {
    schemaVersion: DECISION_EVENT_SCHEMA_VERSION,
    transactionId,
    sequence,
    kind: input.kind,
    occurredAt: input.occurredAt,
    actor: input.actor,
    previousEventDigest: previous?.digest ?? null,
    payload: input.payload,
  };
  return { ...unsigned, digest: ports.digestCanonical(unsigned) };
}

export function reduceDecisionEvents(
  events: readonly DecisionEvent[],
  ports: DecisionKernelPorts
): DecisionTransaction {
  assert(events.length > 0, 'at least one event is required');
  let transaction: DecisionTransaction | null = null;
  let previous: DecisionEvent | null = null;
  for (const event of events) {
    assert(
      event.schemaVersion === DECISION_EVENT_SCHEMA_VERSION,
      `unsupported event schema ${event.schemaVersion}`
    );
    assert(
      event.sequence === (previous?.sequence ?? 0) + 1,
      `event sequence ${event.sequence} is not contiguous`
    );
    assert(
      event.previousEventDigest === (previous?.digest ?? null),
      `event ${event.sequence} has an invalid previous digest`
    );
    const { digest: _digest, ...unsigned } = event;
    assert(
      event.digest === ports.digestCanonical(unsigned),
      `event ${event.sequence} digest is invalid`
    );
    assert(
      !previous || event.transactionId === previous.transactionId,
      'events cross transaction boundaries'
    );
    transaction = applyEvent(transaction, event, ports);
    previous = event;
  }
  return transaction as DecisionTransaction;
}

export function buildDecisionCheckpoint(
  transaction: DecisionTransaction,
  generatedAt: string,
  ports: DecisionKernelPorts
): DecisionCheckpoint {
  return {
    schemaVersion: DECISION_CHECKPOINT_SCHEMA_VERSION,
    transactionId: transaction.id,
    generatedAt,
    generation: transaction.generation,
    eventCount: transaction.eventCount,
    eventHeadDigest: transaction.eventHeadDigest,
    state: transaction.state,
    transactionDigest: ports.digestCanonical(transaction),
  };
}

export function currentDecisionEffectHeadDigest(
  transaction: DecisionTransaction,
  ports: DecisionKernelPorts
): string {
  return effectHeadDigest(transaction, ports);
}
