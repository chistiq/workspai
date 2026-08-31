# Proof-Carrying Change contracts

Status: released v1 CLI and read-only MCP contracts; extension mutation adapter pending

## Published contracts

| Schema                                                 | Owner           | Purpose                                             |
| ------------------------------------------------------ | --------------- | --------------------------------------------------- |
| `workspai.decision-event.v1`                           | Decisions       | Digest-linked causal event.                         |
| `workspai.decision-transaction.v1`                     | Decisions       | Replay-derived transaction projection.              |
| `workspai.decision-checkpoint.v1`                      | Decisions       | Event-head and projection integrity checkpoint.     |
| `workspai.architecture-change-lease.v1`                | PCC composition | Goal and architecture generation guard.             |
| `workspai.predicted-architecture-change.v1`            | PCC composition | Explicit noncanonical expected delta.               |
| `workspace-knowledge-graph-change-overlay.v1`          | Graph           | Actual base-to-head architecture delta.             |
| `workspai.architecture-surprise-report.v1`             | PCC composition | Predicted-versus-observed comparison.               |
| `workspai.proof-carrying-change-capsule.v1`            | PCC composition | Portable closure, assurance, and uncertainty index. |
| `workspai.change-operation-result.v1`                  | PCC composition | Stable machine result shared by lifecycle commands. |
| `workspai.proof-carrying-change-list.v1`               | PCC composition | Read-only discovery for IDE, CI, and automation.    |
| `workspai.proof-carrying-change-capsule-validation.v1` | PCC composition | Explicit integrity validation verdict.              |
| `workspai.proof-carrying-change-capsule-export.v1`     | PCC composition | Validated portable export receipt.                  |

The schemas live in `contracts/workspace-intelligence/` and are advertised by
the published contract catalog and runtime command surface.

## Reuse map

- `workspai.goal-pack.v1`: immutable intent, scope, and success criteria.
- `workspai.goal-index.v1`: active Goal and bounded PCC transaction links.
- `workspace-model.v1`: structural baseline and post-effect system identity.
- `workspace-knowledge-graph.v1`: architecture facts and proofs.
- `workspace-knowledge-graph-change-overlay.v1`: actual change semantics.
- `workspace-verify.v1`: canonical workspace verification evidence.

## Semantic validation beyond JSON Schema

JSON shape is necessary but insufficient. The runtime additionally verifies:

1. contiguous event sequence and one transaction ID;
2. previous-event and event-content digests;
3. legal state transitions;
4. explicit effect-class authorization;
5. unique effect receipt IDs and idempotency keys;
6. exact effect-head binding for verification receipts;
7. current Model/Graph target identity;
8. successful receipt or validated deletion-tombstone coverage for changed
   Graph proof artifacts;
9. deletion paths remain absent and contained by the workspace or an explicit
   linked-project contract;
10. latest passing receipt for every immutable Goal criterion;
11. capsule, lease, decision-head, baseline-cache, and referenced-artifact integrity.

## Compatibility rules

- v1 fields do not grant authority beyond their named owner.
- Prediction remains ineligible as proof in every consumer.
- A capsule is an index, not a duplicate Goal, Graph, ledger, or verifier.
- Missing, stale, uncertain, failed, and unsupported are distinct outcomes.
- Unknown event kinds or fields fail closed under v1 schemas.
- Consumers must use command discovery and the published catalog rather than
  guessing artifact paths.
- Consumers must use `change list --json` rather than inferring recency or
  lifecycle state from directory order.

## Deferred contract

`workspai.semantic-change-conflict.v1` remains deferred until proof-backed
two-change overlap can distinguish `overlap`, `disjoint`, and `unknown` without
inferring absence from incomplete Graph coverage.
