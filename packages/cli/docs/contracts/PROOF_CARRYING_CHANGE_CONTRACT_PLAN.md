# Proof-Carrying Change Contract Plan

Status: pre-contract design; none of the candidate contracts below are released

## Reuse before invention

| Need | Existing owner/contract | Decision |
| --- | --- | --- |
| Intent and success criteria | `workspai.goal-pack.v1` | Reference; do not copy or redefine. |
| Active goal discovery | `workspai.goal-index.v1` | Reference lifecycle links only. |
| Base/head graph delta | `workspace-knowledge-graph-change-overlay.v1` | Reuse unchanged for actual overlay. |
| Graph/Model identity | existing Graph/Model artifact schemas | Reference labeled schema, generation, fingerprint and digest. |
| Workspace verification | `workspace-verify.v1` | Reference exact result and target generation. |
| Effect/event/ledger lifecycle | WIS Decision candidate and `@workspai/decisions` plan | Reuse owner semantics; no CLI-local observed-effect contract. |
| Impact/explain | existing workspace impact/explain contracts | Reference outputs with limitations. |
| Historical summary | workspace history | Add a capsule reference only after the capsule contract stabilizes; history is not the ledger. |

## Candidate new contracts

Names are reserved for design discussion only. They must not enter published
contract registries before schema/type/validator/fixture lock.

### `workspai.architecture-change-lease.v1`

Portable projection of the Decision Transaction base guard:

- change/transaction/goal identity;
- workspace and project scope;
- labeled Git/content/Graph/Model/contract/policy/evidence generations;
- captured freshness, coverage and claim limitations;
- renewal command and `current | stale | rebase-required | unsupported` result.

It contains no exclusive lock claim and no mutable effect history.

### `workspai.predicted-architecture-change.v1`

Non-canonical proposed overlay:

- lease and base generation reference;
- provider/profile/input identity;
- expected entity/relation/contract/project/artifact sets;
- expected impact and required verification;
- confidence, unsupported zones and assumptions;
- deterministic prediction digest.

Graph must review/admit the portable overlay shape because Graph owns relation
and overlay semantics.

### `workspai.architecture-surprise-report.v1`

Derived comparison result:

- prediction and actual-overlay references;
- matched, unexpected and missing sets;
- missed consumers, scope escapes and verification omissions;
- comparison coverage, unknowns and limitations;
- algorithm/profile version, drivers, weights and optional fidelity score;
- allowed and prohibited claims.

This is analytical evidence, not transaction authorization or Graph truth.

### `workspai.proof-carrying-change-capsule.v1`

Portable closure/index:

- intent/lease/transaction/prediction/actual/verification references and digests;
- exact owner generations and compatibility envelope;
- final owner verdicts plus remaining unknown/unverified claims;
- derived change phase and capsule integrity digest;
- redaction, retention and renewal metadata.

The capsule validates references and closure; it does not embed a second Goal,
Decision ledger, Graph, Model or verification result.

### Later candidate: `workspai.semantic-change-conflict.v1`

Graph-derived overlap between two change leases, including shared entities,
contracts, impact paths, proof coverage and `overlap | disjoint | unknown`.
Defer until two-change fixtures prove stable semantics. Never infer disjointness
from missing graph data.

## Contract invariants

1. One authoritative owner per field and generation.
2. Every reference includes schema/profile, logical artifact identity and digest.
3. Hash kinds are labeled; structural Graph identity, artifact digest, Git
   identity and Goal fingerprint are never substituted.
4. Unknown, unsupported, stale, partial and conflicting remain distinct.
5. Prediction cannot be cited as proof of actual change.
6. Capsule and surprise report cannot corroborate their own source artifacts.
7. Timestamps are excluded from deterministic content identity where declared.
8. Absolute paths, secrets, raw prompts and unbounded output are prohibited.
9. Additive compatibility cannot silently broaden authority or allowed claims.

## Required fixtures before command registration

- minimal valid capsule with explicit prediction;
- maximal polyglot/multi-project capsule;
- stale lease and changed policy generation;
- dirty/untracked baseline and post-begin human edit;
- partial/unsupported Graph provider coverage;
- predicted/actual name collision and relation-kind mismatch;
- missed consumer and scope escape;
- no textual conflict with proof-backed semantic overlap;
- uncertain effect and interrupted resume;
- failed/expired/wrong-target verification;
- tampered ledger/reference/digest and path traversal;
- previous-version and unknown-field round trip;
- Linux/macOS/Windows path/case/symlink corpus.

## Registration sequence

```text
ownership approval
  -> JSON schemas
  -> generated TypeScript bindings and structural validators
  -> semantic validators and fixtures
  -> artifact registry and compatibility registry
  -> pure direct API tests
  -> CLI command registration and help/JSON/process tests
  -> MCP/IDE consumers after CLI stability
```
