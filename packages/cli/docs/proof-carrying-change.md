# Proof-Carrying Change

Status: released in Workspai CLI v0.69.0; deletion-tombstone and overlapping
artifact-identity hardening released in v0.70.0. Scoped verification and current
effect-projection hardening are included in v0.82.0.

> Every change carries its intent, pinned architecture baseline, predicted
> impact, authorized effects, actual architecture delta, independent
> verification, and remaining uncertainty.

Proof-Carrying Change (PCC) is a product composition, not a second Graph or
transaction system. Goal Pack owns intent and acceptance criteria. The
extraction-safe Decisions kernel owns lifecycle, causal ordering, authorization,
effect receipts, verification receipts, resume, and the tamper-evident ledger.
Model and Graph own architecture truth. Workspace Verify and domain verifiers
own verdicts. The CLI composes references to those owners into one capsule.

## Quickstart

Start from a current adopted project or workspace:

```bash
# 1. Create an immutable Goal Pack.
workspai goal "Improve retry behavior without breaking clients" --json

# 2. Pin that Goal and the exact Model/Graph/input generation.
workspai change begin --json

# Discover resumable and sealed changes without scanning directories.
workspai change list --json

# 3. For source, test, or configuration changes, attach an explicit artifact-level
#    prediction before the first write. Prediction is intent, never proof.
workspai change predict --change <change-id> --file prediction.json --json

# 4. A human grants only the effect classes required by the change.
workspai change authorize --change <change-id> \
  --effects filesystem,command --granted-by maintainer --json

# 5. An agent, extension, or CLI tool records every observed effect.
workspai change effect record --change <change-id> \
  --file effect-receipt.json --json

# 6. Rebuild/re-observe architecture and run independent verification.
workspai change verify --change <change-id> --json

# 7. Validate or export the sealed manifest.
workspai change capsule validate --change <change-id> --json
workspai change capsule export --change <change-id> \
  --output .workspai/exports/<change-id>.json --json
```

For Goals with additional release, security, or coverage criteria, `change
verify` first records canonical Workspace Verify and the actual Graph overlay.
The owning domain/CI adapter can then admit an exact-generation receipt:

```bash
workspai change verification record --change <change-id> \
  --file verification-receipt.json --json
```

If a transaction is blocked, it remains durable. A human may resume it into an
explicit state; history is never erased:

```bash
workspai change resume --change <change-id> --to authorized \
  --reason "Add receipts for observed generated files" --json
```

## Ownership and invariants

| Concern                          | Owner                              | PCC behavior                                                                |
| -------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| Intent, scope, success criteria  | Goal Pack                          | References the immutable Goal and criterion IDs.                            |
| State, ledger, effects, receipts | Decisions kernel                   | Uses one digest-linked event stream and derived projection.                 |
| Architecture baseline and delta  | Model / Graph                      | Pins exact hashes and reuses `workspace-knowledge-graph-change-overlay.v1`. |
| Verification                     | Workspace Verify / domain verifier | Admits only receipts bound to the current Model, Graph, and effect head.    |
| Product view                     | CLI / IDE / CI                     | Consumes the same capsule without redefining truth.                         |

The runtime enforces these rules:

- prediction is `nonCanonical: true` and `proofEligible: false`;
- authorization names allowed effect classes before receipts are admitted;
- receipt idempotency keys cannot be reused;
- verification binds the exact current Model, Graph, and effect-head digest;
- observed changed artifacts must be covered by successful effect receipts;
- the latest recorded state of every logical/canonical artifact must match the
  filesystem before either verification gate can proceed; a digest failure is
  a blocker and cannot be bypassed by workspace readiness;
- removed artifacts must be covered by validated deletion tombstones rather
  than references to files that no longer exist;
- a changed Graph with no effect receipt blocks verification;
- every required Goal criterion needs a latest passing receipt before commit;
- failed or uncertain effects block the transaction;
- terminal transactions cannot accept later events;
- optimistic compare-and-append prevents concurrent history forks;
- capsule validation replays the event chain and checks local reference digests.

The generated agent policy uses native project tools for routine project-local
work. Proof-Carrying Change applies when repository policy requires it, the
change crosses project or architecture boundaries, or a governed Workspai effect
needs authorization. Within that transaction, every expected source, test, or
configuration write must be predicted before mutation as an `artifact`
operation with a project-relative `targetId`. The prediction makes derived
Graph evidence attributable; it is intent, never proof.

`change verify` selects its gate from the immutable Goal criterion. A
single-project Goal can use a project-scoped gate that verifies the selected
project and its affected transitive dependents while retaining workspace graph
integrity and policy checks. Workspace-scoped Goals and changes with effects
outside the selected project use the full Workspace Verify gate. `--strict`
always requires full workspace readiness and freshness. The default workspace
gate blocks on a blocked verdict; strict mode also blocks `needs-attention` and
stale workspace freshness.

Both gates retain the latest successful effect's freshness boundary. Required
project checks must actually execute after that boundary; completion timestamps
alone cannot make a check started before a mutation current. Cached
`--reuse-passed` and `--plan` runs do not prove execution for a governed change.
Keyed project/stage history retains its own timing and execution mode. Legacy
history without enough timing information requires a new check. Pinned projects
and their transitive dependents remain in the plan even when the structural
Model diff is empty, and skipped or indeterminate checks cannot seal the change.

Repeated edits use the last receipt in ledger order for each artifact, matching
both normalized labels and canonical filesystem targets. Updates, deletion, and
recreation replace the current state while the complete receipt history remains
in the tamper-evident ledger. Capsules expose current effects and verification
references so superseded digests do not invalidate a later successful retry.
Validation independently derives that projection from the ledger, checks the
effect head, and accepts the original full-history representation of older v1
capsules. Removing current effect entries from a capsule does not bypass the
filesystem checks.

## Architecture lease

`change begin` requires a fresh Goal Pack and a current canonical Graph. It
creates `workspai.architecture-change-lease.v1`, binding Goal ID, workspace,
scope, structural Model hash, canonical Graph hash, live Graph input
fingerprint, and a derived generation ID.

Before prediction or authorization, the generation must still match. The lease
is an optimistic guard, not a filesystem or Git lock.

Because the canonical Graph path is renewed in place, begin also writes a
private, non-authoritative, hash-bound baseline materialization. It exists only
to derive the later base-to-head overlay. The capsule cites the canonical
baseline identity, not the cache as architecture truth.

## Typed receipts

An effect receipt includes an ID, effect class, result, summary, observation
time, idempotency key, optional command argv, present artifact references, and
optional deleted-artifact tombstones. Artifact references use labeled digest
semantics:

- `canonical-json-v1` for JSON evidence;
- `raw-bytes-v1` for source or command-output files;
- `workspace-model-structural-v1` for canonical Model identity.

A deletion is not represented by a fake file digest. CLI and IDE consumers may
submit the compact input below; the CLI normalizes it into a
`deletion-tombstone-v1` reference before the event enters the ledger:

```json
{
  "id": "remove-obsolete-retry",
  "effectClass": "filesystem",
  "status": "succeeded",
  "summary": "Removed the obsolete retry implementation.",
  "artifacts": [],
  "deletedArtifacts": [{ "artifact": "api/src/obsolete-retry.ts" }],
  "observedAt": "2026-08-31T12:00:00.000Z",
  "idempotencyKey": "remove-obsolete-retry-v1"
}
```

Admission proves that each deleted path is absent and remains inside the
workspace or an explicitly contracted linked-project root. Verification then
requires the fresh Graph overlay to report the same removal. Recreating the
path invalidates capsule validation. A tombstone intentionally carries no
unverifiable claim about the deleted bytes; the pinned baseline Graph owns the
pre-change architecture identity.

When adopted scopes overlap, one physical source file can have both an
aggregate-project Graph label and a nested-project Graph label. Effect coverage
resolves those portable labels through the workspace contract and treats them
as one mutation only when they map to the same contained filesystem target. It
never requires duplicate receipts for one physical effect, and it never uses
label similarity as proof of equivalence.

Verification receipts add a Goal criterion ID and an exact target. Domain
receipts are admitted only after `change verify` has re-observed the Graph and
recorded passing Workspace Verify evidence.

## Artifact layout

```text
.workspai/decisions/<change-id>/
  events.jsonl              # authoritative causal ledger
  transaction.json          # replay-derived projection
  checkpoint.json           # generation and head integrity checkpoint

.workspai/changes/<change-id>/
  lease.json
  predicted-overlay.json    # optional, noncanonical
  actual-overlay.json
  architecture-surprises.json
  capsule.json
  private/baseline-graph.json
```

`capsule.json` is a portable hash-index and assurance summary. It does not copy
the Goal, event ledger, Model, Graph, or verification reports. Absolute paths,
secrets, prompts, and unbounded command output are not capsule content.
Use the schema-validated `change list --json` projection for IDE and automation
discovery; filesystem directory order is never lifecycle truth.

Every CLI operation also emits a Live activity observation correlated by the
change ID, and every PCC artifact write flows through the shared artifact
publisher. Live remains execution telemetry rather than verification proof;
the capsule references Decision, Graph, effect, and verifier evidence instead
of upgrading an observed activity event into an assurance claim.

Read-only MCP consumers receive the same ledger-derived projections through
`listProofCarryingChanges`, `getProofCarryingChange`, and
`validateProofCarryingChange`. No PCC mutation tool is exposed over MCP; effect
authorization and execution remain behind explicit CLI or IDE approval
boundaries.

CI can fail closed on capsule integrity and assurance without parsing terminal
text:

```bash
workspai change capsule validate --change "$CHANGE_ID" --json
workspai change status --change "$CHANGE_ID" --json
```

An invalid capsule exits non-zero. Policy automation should additionally
require `capsule.status == "sealed"` when a sealed change is a merge or release
condition.

## Decision states

The Decisions owner derives these states from events:

```text
draft -> scoped -> evidence-ready -> authorized -> executing -> verifying
                                  \-> blocked/awaiting-human -> resumed
                                                    verifying -> committed
any nonterminal state -> aborted/rejected/superseded
```

The product-facing capsule reports `open`, `blocked`, `verified`, `sealed`, or
`aborted`. A sealed capsule means all immutable Goal criteria have passing
post-effect receipts. It does not mean unsupported external claims became true.

## Prediction versus observation

The prediction lists expected add/remove/change operations for entities,
relations, proofs, or artifacts. `change verify` derives the actual overlay from
the pinned Graph and fresh canonical head, then emits matched operations,
unpredicted actual operations, predicted operations not observed, and an honest
`exact`, `within-expectation`, `surprising`, or `no-prediction` verdict.

Surprise analysis is explanatory evidence. It is not self-corroborating proof
and cannot replace verification.

## Deferred work

Rich hosted PR annotations remain separate from the machine-readable CI gate
above. Semantic multi-change overlap, immutable historical Graph queries,
isolated patch simulation, and remote attestation remain separate follow-up
capabilities. No current command claims those behaviors.

See the [contract reference](./contracts/PROOF_CARRYING_CHANGE_CONTRACT_PLAN.md)
and [implementation manifest](./proof-carrying-change.implementation.v1.json).
