<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Proof-carrying changes and tamper-evident agent assurance",
  "summary": "Workspai 0.69.0 gives source-changing agents a verifiable path from Goal-bound intent through pinned architecture, bounded authorization, observed effects, fresh Graph analysis, independent verification, and a validated portable capsule.",
  "highlights": [
    {
      "icon": "🧭",
      "text": "Every change pins its exact Goal, Model, Graph, and live-input generation before mutation"
    },
    {
      "icon": "🔐",
      "text": "Bounded authorization and typed receipts record what tools were allowed to do and what happened"
    },
    {
      "icon": "🧬",
      "text": "Fresh Graph overlays compare predicted and actual architecture without treating prediction as proof"
    },
    {
      "icon": "✅",
      "text": "CLI, CI, IDE, agent, Live, and read-only MCP consumers share one versioned capsule contract"
    }
  ]
}
-->

# Workspai CLI v0.69.0

Released August 30, 2026.

**Publication status:** Published.

## Proof-Carrying Changes and Tamper-Evident Agent Assurance

Workspai 0.69.0 turns an agent change into a portable engineering claim that can
be replayed, inspected, and independently validated without trusting chat
history. A Proof-Carrying Change (PCC) begins from an immutable Goal Pack, pins
the exact architecture generation, records bounded authorization and observed
effects, derives the actual Graph delta from fresh evidence, and closes only
when the required verification receipts match the post-effect state.

PCC is a composition over existing sources of truth. Goal owns intent and
acceptance criteria. Model and Graph own architecture truth. Workspace Verify
and domain verifiers own verdicts. The Decisions kernel owns the causal ledger.
The CLI composes their references into one capsule instead of creating a second
Graph, verification system, or hidden agent history.

## Complete `workspai change` lifecycle

The new command family supports the complete governed lifecycle:

```bash
workspai goal "Improve retry behavior without breaking clients" --json
workspai change begin --json
workspai change list --json
workspai change predict --change <change-id> --file prediction.json --json
workspai change authorize --change <change-id> \
  --effects filesystem,command --granted-by maintainer --json
workspai change effect record --change <change-id> \
  --file effect-receipt.json --json
workspai change verify --change <change-id> --strict --json
workspai change capsule validate --change <change-id> --json
workspai change capsule export --change <change-id> \
  --output .workspai/exports/<change-id>.json --json
```

Additional commands expose status, explanation, independent Goal-criterion
receipts, explicit resume, and evidence-preserving abort behavior. Every command
has a versioned machine-readable result. Invalid capsules and failed strict
verification preserve non-zero process exits for CI and automation.

## Architecture lease before mutation

`change begin` requires an active, current Goal Pack and canonical Graph. It
creates a versioned architecture lease that binds:

- Goal identity, scope, and immutable acceptance criteria;
- structural Workspace Model identity;
- canonical Graph hash and live input fingerprint;
- the exact baseline generation used to reason about the change.

The lease is an optimistic generation guard, not a filesystem lock. Before
prediction, authorization, effect admission, or verification, Workspai checks
that the relevant generation is still current. Drift is reported explicitly;
the baseline is never silently renewed.

## Prediction is useful, but never proof

A prediction can describe expected entity, relation, proof, or artifact
changes. It is always marked noncanonical and ineligible as evidence.

After effects, `change verify` refreshes canonical intelligence and derives the
actual base-to-head Graph overlay. Workspai then publishes an architecture
surprise report with matched operations, unpredicted actual changes, predicted
changes that were not observed, and an honest comparison verdict.

Graph overlays now report changed artifacts only from actual proof deltas.
Shared entities can accumulate proofs from many manifests, but an added proof no
longer makes every unchanged manifest appear mutated to PCC, Repair, or IDE
consumers.

## Bounded authorization and typed receipts

An agent or tool may record only an effect class granted by the authorization
event. Effect receipts carry a stable ID, result, summary, observation time,
idempotency key, optional command arguments, and digest-bound artifact
references.

Verification receipts bind the exact current Model, Graph, and effect-head
digest. The runtime blocks closure when:

- a changed Graph has no successful effect receipt;
- a changed artifact is not covered by an admitted effect;
- an effect failed or remains uncertain;
- a required Goal criterion lacks a current passing receipt;
- a referenced artifact is missing, stale, corrupt, or outside its authorized
  root.

Workspace-local evidence must resolve to a regular contained file. Evidence for
a linked project is accepted only through the canonical workspace contract,
then checked by real path against that declared external root. Absolute paths,
symlink escapes, and caller-invented external roots fail closed.

## Digest-linked Decisions ledger

The extraction-safe Decisions kernel stores one authoritative event stream for
each change. Events are sequence-checked, previous-digest-linked, and reduced
into deterministic transaction and checkpoint projections.

Optimistic compare-and-append prevents concurrent writers from forking history.
Blocked transactions remain durable and can be resumed only with explicit human
intent. Abort terminates the transaction without deleting evidence. Capsule
validation replays the ledger and validates local references rather than
trusting a cached summary.

## One contract for every consumer

The release publishes v1 schemas for the architecture lease, prediction,
surprise report, Decisions event/transaction/checkpoint, change operation,
change list, capsule, capsule validation, and capsule export.

The same contracts support:

- CLI and CI discovery through `change list`, `status`, and `capsule validate`;
- agent grounding that requires a Goal-bound change before source mutation;
- Live observations correlated by change ID without promoting telemetry into
  verification proof;
- IDE timelines and assurance views without filesystem-order inference;
- read-only MCP tools for list, inspect, and validate.

MCP deliberately exposes no PCC mutation or authorization tool. Effect approval
and execution remain behind explicit CLI or IDE approval boundaries.

## General intelligence hardening

This release also improves behavior outside PCC:

- Graph queries retain distinguishing product, subsystem, protocol, and domain
  subjects instead of allowing generic relationship words such as `connect`,
  `application`, or `integration` to consume the bounded result budget.
- Nested polyglot runtime units use stable IDs derived from runtime, project
  root, and manifest basename instead of duplicating relative paths.
- Workspace Run preserves each authored or adopted project name in Fleet and
  Live evidence, even when an isolated qualification or snapshot uses a
  transport-specific directory name.
- The npm-owned CLI execution path propagates the actual requested exit code so
  verification failures remain visible to scripts and CI.

## Artifact layout

```text
.workspai/decisions/<change-id>/
  events.jsonl
  transaction.json
  checkpoint.json

.workspai/changes/<change-id>/
  lease.json
  predicted-overlay.json
  actual-overlay.json
  architecture-surprises.json
  capsule.json
  private/baseline-graph.json
```

The capsule is a bounded hash index and assurance summary. It does not copy the
Goal, Graph, ledger, Model, prompts, secrets, or unbounded command output.

See [Proof-Carrying Change](../docs/proof-carrying-change.md), the
[command reference](../docs/commands-reference.md), and the
[published contract plan](../docs/contracts/PROOF_CARRYING_CHANGE_CONTRACT_PLAN.md).

## Upgrade

```bash
npm install -g workspai@0.69.0
workspai --version
```

Expected output:

```text
0.69.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias is released at the matching `0.69.0` version.
- Existing version-one Workspace Intelligence, Model, Graph, Goal, MCP,
  Repair, Skill, project-entry, and Live behavior remains supported.
- PCC and Decisions schemas are new additive v1 contracts.
- Goal Pack and Goal Index PCC bindings are additive.
- Existing Graph overlay consumers remain compatible; `changedArtifacts` is
  now more conservative and proof-accurate.
- No public command is removed.

## Breaking changes

None.
