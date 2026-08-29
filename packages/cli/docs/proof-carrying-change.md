# Proof-Carrying Change

Status: architecture preparation on `feat/proof-carrying-change`; runtime not implemented

Working product line:

> Every change carries its intent, predicted architecture impact, observed
> effects, actual architecture delta, verification and remaining uncertainty.

## Decision: product composition, not a new package

Proof-Carrying Change is a CLI product capability composed from existing
authoritative domains. It does not introduce `@workspai/change` or
`@workspai/architecture-transaction`.

| Concern | Authoritative owner | Proof-Carrying Change responsibility |
| --- | --- | --- |
| Intent, scope and acceptance criteria | Goal Pack | Reference the immutable goal and its fingerprint. |
| Transaction identity, generation guards, effects, receipts, resume and ledger | Decisions | Present one change-oriented projection over the same transaction. |
| Facts, relations, proof, overlays and semantic overlap | Graph | Request predicted/actual overlays and conflict queries. |
| Stable system snapshot and capabilities | Model | Pin and reference the exact baseline generation. |
| Impact and required verification | Impact / owning domain | Preserve results and limitations; do not recompute them. |
| Verification verdict and evidence | Verify / domain verifier | Admit exact receipts against the post-change target. |
| Product orchestration and UX | Workspai CLI | Resolve context, invoke owners, write the capsule index and render status. |
| Agent/MCP/IDE rendering | Agents / MCP / extension | Consume the same artifacts without changing their meaning. |

Creating another transaction package would duplicate Decisions lifecycle and
ledger authority. Creating another graph package would duplicate overlay and
semantic relation authority. The CLI is the correct composition point.

## User outcome

An agent or developer can begin a scoped change against an exact architecture
generation, state the expected architecture delta, perform work through normal
tools, and finish with a portable capsule that another process can validate
without trusting chat history.

Candidate command surface (not yet registered):

```bash
workspai change begin --goal "rename order.created to order.placed" \
  --scope project:orders --json
workspai change predict --change <change-id> --from patch.diff --json
workspai change status --change <change-id> --json
workspai change verify --change <change-id> --strict --json
workspai change explain --change <change-id> --json
workspai change abort --change <change-id> --reason "superseded" --json
```

No command is added until its contract, failure states, help, JSON behavior and
process integration tests are ready. Documentation must not advertise this
candidate surface as released.

## Architecture flow

```text
Goal Pack + resolved Context
  -> begin Decision Transaction
  -> pin Graph/Model/content/contract/policy/evidence generations
  -> Architecture Lease projection
  -> predicted non-canonical Graph overlay
  -> admitted file/command/external effects and receipts
  -> rebuild/re-observe canonical owners
  -> actual Graph overlay from pinned base to observed head
  -> compare prediction, actual delta, scope and required verification
  -> admit verification receipts
  -> Proof-Carrying Change Capsule projection
```

### Architecture Lease

The lease is an optimistic generation guard and user-facing projection over one
Decision Transaction. It does not lock Git, files, Graph or other agents. It
pins labeled identities for:

- workspace/project scope and Goal Pack fingerprint;
- Git/content identity and dirty/untracked state classification;
- Model and Graph schema, generation and artifact digest;
- contract, policy and evidence generations;
- capability/claim envelope and known unsupported areas.

Before effect admission and final verification, owners are resolved again. A
changed relevant generation yields `rebase-required`; it never silently renews
the baseline. Unrelated changes may be admitted only when Graph/Context can
prove disjointness under the active comparison profile. Unknown is not disjoint.

### Prediction

Prediction is a proposed, non-canonical overlay. It may be authored explicitly
or derived from an isolated patch simulation when that provider exists. It must
declare provider/profile version, inputs, confidence, unsupported facts and
expected additions/removals/changes for entities, relations, contracts,
projects, artifacts and required verification.

A prediction never mutates canonical Graph/Model state and cannot corroborate
its own eventual result.

### Observed effects

There is no new `observed-effect` truth store. File, command and external effects
are Decision Events and Effect Receipts. The change directory stores references
and content digests or a bounded projection, not a second causal ledger.

### Actual overlay and surprise analysis

After normal Graph/Model renewal, the existing
`workspace-knowledge-graph-change-overlay.v1` compares the pinned base and
observed head. A derived surprise report compares predicted versus actual sets:

- unexpected actual changes;
- predicted changes not observed;
- missed impacted consumers;
- scope escapes;
- verification omissions;
- stale or incomparable owner generations;
- unsupported/unknown comparison zones.

`architectureFidelity` is a profile-versioned analytical score. Its report must
expose drivers, denominators, weights, missing inputs and comparability limits.
It cannot authorize commit/release or rank agents across different profiles,
repositories or evidence coverage.

### Semantic concurrency

Active changes may be compared through Graph impact cones. Shared entities,
contracts or proof-backed relations can produce `semantic-overlap` even when Git
reports no textual conflict. MVP output is advisory unless the workspace policy
explicitly promotes a supported conflict class to a transaction precondition.
Unknown graph coverage cannot produce `no-conflict`.

## Artifact layout

```text
.workspai/changes/<change-id>/
  lease.json
  predicted-overlay.json
  actual-overlay.json
  verification.json
  architecture-surprises.json
  capsule.json
```

`capsule.json` is the portable hash-index and summary. Goal Pack, Decision
ledger/events/effect receipts, Graph/Model artifacts and verification evidence
remain owned at their canonical locations and are referenced by logical path,
schema version, generation and digest. The capsule never copies secrets, raw
prompts, unrestricted command output or absolute machine paths.

## Derived product phase

The UI may render `draft`, `prediction-required`, `ready-for-effects`,
`rebase-required`, `verifying`, `verified`, `blocked` or `aborted`. These are a
deterministic projection of Goal, Decision, generation and verification owner
states—not a second mutable state machine.

## Safety and failure rules

- stale baseline fails closed before effect admission and verification;
- unsupported prediction is explicit and may continue only under policy;
- interrupted or uncertain effects resume through the same Decision Transaction;
- capsule publication is atomic and cannot precede owner artifact validation;
- missing verification remains unverified, never inferred from exit code/text;
- rollback/compensation is a new authorized effect and does not erase history;
- prediction and capsule artifacts cannot re-enter Graph as independent proof;
- concurrent writers use Decisions compare-and-append plus artifact locks;
- source paths are relative and containment-checked across symlinks/platforms.

## MVP boundary

The first useful slice is intentionally narrow:

1. begin from an existing/new Goal Pack and pin current generations;
2. accept an explicit predicted overlay (no AI requirement);
3. detect stale base before verification;
4. build actual overlay with the existing Graph overlay engine;
5. emit explainable surprise analysis without a marketing score claim;
6. admit existing workspace verification evidence;
7. publish and independently validate a capsule.

Daemon coordination, immutable historical Graph query, automated patch
simulation, multi-agent enforcement, PR checks, MCP tools and leaderboards are
later stages. They are not prerequisites for the honest MVP.

## Entry gates for implementation

- accept the ownership and no-new-package decision;
- lock candidate contract names and reuse map;
- inventory current Goal/Graph/Impact/Verify/repair transaction fields;
- choose the Decisions integration epoch without creating a temporary second ledger;
- define fixtures for stale base, partial graph, scope escape, semantic overlap,
  uncertain effect, failed verification and successful capsule validation;
- approve security/privacy and performance budgets;
- implement each stage with schema/type/validator/tests/docs in the same change.

See [Proof-Carrying Change contract plan](./contracts/PROOF_CARRYING_CHANGE_CONTRACT_PLAN.md)
and the machine-readable
[implementation manifest](./proof-carrying-change.implementation.v1.json).
