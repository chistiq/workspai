# Workspace Repair Engine

The Workspace Repair Engine is the CLI-owned execution boundary for blocker repair. IDEs,
agents, and CI may request work and render progress, but they do not invent commands or decide
that a repair is complete.

```text
canonical evidence
      ↓
plan → preconditions → approval → checkpoint → execute
     → reconcile → audit → test → build → canonical verify
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

`plan` never mutates source files. `approve` never executes work. `execute` refuses an expired,
tampered, unapproved, or precondition-stale plan.

`propose` is the dynamic repair boundary for IDE models. A model may provide bounded complete-file
writes/deletes and optional structured audit/test/build commands. The CLI rejects stale source
hashes, duplicate targets, workspace evidence edits, Git internals, installed dependency trees,
secret-bearing files, path/link escapes, and ungoverned commands. Dependency manifest proposals
still receive CLI-inferred reconcile, audit, test, and build stages before strict verification.

Doctor also publishes a distinct `dependency-materialization` transaction when manifests exist
but the installed runtime tree is missing. Its install or restore invocation is the repair stage
itself; it does not require a manifest or lockfile diff and is never run twice. Declared tests and
builds, followed by canonical verification, prove closure. Dependency-security transactions still
require manifest/lock reconciliation and a clean focused audit.

## Safety and ownership

- The immutable plan hash covers target, policy, preconditions, structured invocations, risk,
  and the existence/hash baseline of every checkpointed path.
- Only typed Doctor operations and allowlisted structured process invocations are executable.
  Shell evaluation is disabled, secret-like environment variables are removed, and autonomous
  package fetching through `npx` is rejected.
- Force and breaking changes require explicit policy approval. A different policy means a new
  plan and a new approval.
- Files are bounded to the workspace, regular files only, at most 5 MiB each and 25 MiB per
  transaction. A source change between planning and execution expires approval.
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

IDE-generated input follows
`contracts/workspace-intelligence/workspace-repair-proposal.v1.json`. The proposal is evidence,
not authority: only the approved transaction created by the CLI may mutate the workspace.
