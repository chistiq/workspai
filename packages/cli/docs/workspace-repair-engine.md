# Workspace Repair Engine

The Workspace Repair Engine is the CLI-owned execution boundary for blocker repair. IDEs,
agents, and CI may request work and render progress, but they do not invent commands or decide
that a repair is complete.

```text
canonical evidence
      ↓
plan → preconditions → approval → exact-target preflight → checkpoint → execute
     → reconcile → audit → test → build → exact producer → canonical verify
     → closed | rolled-back | decision-required
```

## Command flow

```bash
# Inspect the exact adapter and fail-closed policy contract first.
npx workspai workspace repair capabilities --json

# 1. Build an immutable plan from current governed evidence.
npx workspai workspace repair plan --card doctor --project api --json

# Or compile hash-pinned model output into the same CLI-owned transaction.
npx workspai workspace repair propose \
  --proposal .workspai/repair/inbox/proposal.json \
  --json

# 2. Bind approval to the exact plan hash returned above.
npx workspai workspace repair approve \
  --transaction <transaction-id> \
  --approved-by local-user \
  --json

# 3. Execute or resume the durable transaction.
npx workspai workspace repair execute --transaction <transaction-id> --json
npx workspai workspace repair resume --transaction <transaction-id> --json

# Inspect or resolve a terminal decision.
npx workspai workspace repair status --transaction <transaction-id> --json
npx workspai workspace repair decide --transaction <transaction-id> --decision <available-option> --json
npx workspai workspace repair rollback --transaction <transaction-id> --json
npx workspai workspace repair cancel --transaction <transaction-id> --json
npx workspai workspace repair list --json
```

`capabilities` is global discovery and works outside a Workspai workspace. When it is run from
an attached project or workspace, the same response also includes local adapter inspection. All
other repair actions require an unambiguous canonical workspace root.

Before the first mutation, every IDE consumer must probe the executable it will actually run with
`--version --json` and `workspace repair capabilities --json`. Package metadata alone is not an
execution contract: version-manager links can expose multiple manifests or a stale built entrypoint.
The consumer must reject a binary whose version, repair protocol, proposal schema, transaction
schema, or operation envelope does not match the published handshake. Running from the canonical
workspace root is sufficient; `--workspace` is an equivalent explicit selector, not a required IDE
transport flag.

`plan` never mutates source files. `approve` never executes work. `execute` refuses an expired,
tampered, unapproved, or precondition-stale plan.

Immediately before checkpoint and mutation, the engine reruns the exact producer registered for
the selected Studio card and proves that every approved causal remediation action still exists
with the same semantics. The approval-bound fingerprint covers the blocker, scope, risk, command,
typed operation, files, rollback posture, and dependency transaction—not only the action id. If
the card generation changed, the blocker disappeared, or any selected action changed meaning, the
approval expires and no source byte is changed. After mutation and runtime-native validation, the
same exact producer runs again before aggregate Workspace Intelligence verification.

`propose` is the dynamic repair boundary for IDE models. A model may provide bounded complete-file
writes/deletes and optional structured audit/test/build commands. The CLI rejects stale source
hashes, duplicate targets, workspace evidence edits, Git internals, installed dependency trees,
secret-bearing files, path/link escapes, and ungoverned commands. For a linked project, proposal
paths may leave the central workspace only when the target resolves to exactly one canonical
project in `workspace.contract.json`; the authorized boundary is that project's exact root, never
its parent or a sibling repository. Dependency manifest proposals still receive CLI-inferred
reconcile, audit, test, and build stages before strict verification.

Doctor also publishes a distinct `dependency-materialization` transaction when manifests exist
but the installed runtime tree is missing. Its install or restore invocation is the repair stage
itself; it does not require a manifest or lockfile diff and is never run twice. Declared tests and
builds, followed by canonical verification, prove closure. Dependency-security transactions still
require manifest/lock reconciliation and a clean focused audit.

Python materialization follows the project's declared environment surface instead of assuming
Poetry: `[tool.poetry]` selects `poetry install --no-root`, `uv.lock` selects `uv sync`, and a
requirements-only or standard `pyproject.toml` project creates a project-local `.venv` before using
that exact interpreter for dependency reconciliation and tests. The future `.venv` executable is a
deferred precondition owned by the approved transaction; it is never mistaken for a missing global
tool before the environment-creation stage runs.

## Safety and ownership

- The immutable plan hash covers target, policy, preconditions, structured invocations, risk,
  and the existence/hash baseline of every checkpointed path.
- Only typed Doctor operations and allowlisted structured process invocations are executable.
  Shell evaluation is disabled, secret-like environment variables are removed, and autonomous
  package fetching through `npx` is rejected.
- Force and breaking changes require explicit policy approval. A different policy means a new
  plan and a new approval.
- Files are bounded to the workspace or the exact root of one canonically registered linked
  project, regular files only, at most 5 MiB each and 25 MiB per transaction. Absolute proposal
  paths, unregistered external roots, parent/sibling escapes, and symbolic-link boundaries fail
  closed. A source change between planning and execution expires approval.
- A workspace-level owner lock prevents concurrent repair writers and is not stolen from a live
  process merely because a long transaction exceeded a wall-clock threshold. Resume skips
  durable passed stages.
- Required stage failure triggers bounded rollback by default. Before restoring the first byte,
  rollback verifies every target and backup hash, rejects path/link conflicts, restores files
  atomically with their recorded modes, and reconciles installed dependencies with the restored
  manifests and lockfiles. It reports `decision-required` if any part cannot be proven complete.
- Strict canonical Workspace Intelligence always runs before closure. The receipt separates
  `verification.targetStatus` from `verification.workspaceStatus`: a proven selected action may
  close while unrelated governed findings keep the workspace blocked. Those findings remain the
  next repair target and never trigger rollback of a valid bounded repair.
- Required executables are resolved before approval and again immediately before execution. A
  missing or changed toolchain expires approval instead of starting a partial transaction.
- The exact card producer is run twice: first as a no-mutation causal precondition, then after
  repair as card-local evidence. An aggregate workspace gate cannot substitute for either run.
- A Goal-bound proposal is linked to the active Goal before execution. Closure seals the fresh
  structural Model hash, exact canonical Graph hash, and stable Graph input fingerprint into the
  verification receipt. The receipt receives its own closure hash and remains acceptable as a
  source transition only while the approved plan, proposal, checkpoint outputs, verification,
  Goal identity, and current source fingerprints still agree.

## Runtime adapters

Dependency transactions are package-manager aware. The canonical inventory is published at
`contracts/workspace-repair-capabilities.v1.json` and exposed through `workspace repair
capabilities`. It distinguishes full support from conditional support instead of treating “the
command exists” as proof that the whole repair is executable.

Node, Python, Go, Rust, Composer, Bundler, Elixir, Deno, .NET, Maven, Gradle, Clojure, and sbt
surfaces are detected independently. A genuinely multi-runtime project receives collision-free
stages for every applicable adapter. Doctor dependency actions remain bound to the ecosystem
declared by their evidence so an npm finding cannot accidentally trigger an unrelated Python
transaction. If a manifest, required executable, isolated environment, project-declared
validation, or audit surface is unavailable, the engine returns `decision-required`; it never
hides the gap behind a model fallback.

## Consumer contract

The latest transaction is written to:

```text
.workspai/reports/workspace-repair-last-run.json
```

The schema is
`contracts/workspace-intelligence/workspace-repair-transaction.v1.json`. Full transaction state
is durable under `.workspai/repair/transactions/<transaction-id>/`. Consumers should discover
the `workspace repair` action from `runtime-command-surface.v1.json`, render its stages and
events, and send explicit user decisions back to the CLI. They must not reproduce the executor.

The consumer protocol is fail-closed on these invariants:

- `mutationAuthority=cli-only`: an IDE or model may inspect and propose, but it cannot run a
  parallel package-manager, file-write, or remediation executor.
- `targetClosure=selected-causal-action-set`: closure proves the requested card and its selected
  prerequisite action set; unrelated workspace findings remain visible without falsifying the
  selected repair result.
- `changeReceipt=checkpoint-hash-delta`: consumers must call a file changed only when the
  transaction recorded a different post-execution hash. Planned checkpoint files are not edits.
- `consumerTimeline=durable-transaction-events`: progress, decisions, rollback, and closure are
  projections of ordered transaction/session events, not optimistic UI copy.
- `registeredLinkedProjectMutationBoundary=true`: an external source root is writable only when
  it is exactly one project in the canonical workspace contract; parent and sibling roots never
  inherit that authority.
- `sourceProposalIntegrity=project-bound-hash-pinned`: every proposed change is bound to the
  selected project and the SHA-256 value observed before planning.
- `completionAuthority=cli-verification-receipt`: model prose, an IDE diff, or a successful build
  cannot close a repair without the CLI transaction's exact-target verification receipt.
- `goalSourceTransition=closed-integrity-bound-transaction`: an immutable Goal may move from its
  original Model/Graph binding only through a linked, approved, closed Repair transaction whose
  current output and post-repair source binding still validate. Evidence-only regeneration with
  identical live inputs remains valid; unlinked or unrelated source drift fails closed.

The runtime advertises this boundary as the capability invariants
`goalSourceTransition=closed-integrity-bound-v1` and
`goalAttemptBudget=durable-serialized-v1`. Consumers must probe them before a
Goal mutation; the package version alone is not sufficient proof.

Consumers must render changed files relative to the selected project (or workspace when no
project is selected). Portable `../` paths retained by the CLI transaction are execution identity,
not presentation text; absolute host paths and checkpoint internals must never cross into an IDE
card, model transcript, export, screenshot, or diagnostic bundle.

IDE-generated input follows
`contracts/workspace-intelligence/workspace-repair-proposal.v1.json`. The proposal is evidence,
not authority: only the approved transaction created by the CLI may mutate the workspace.
Files under `.workspai/repair/inbox/` and the engine lock are transient transport state. They must
never advance an evidence generation, reset a retry budget, or appear as governed evidence in an
IDE. Durable transaction receipts and canonical reports are the only repair-state evidence.
