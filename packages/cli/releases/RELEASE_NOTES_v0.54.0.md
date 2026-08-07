<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Target-Aware, Cross-Runtime Repair",
  "summary": "Workspai now completes the selected blocker through one portable repair transaction, while keeping unrelated workspace findings visible instead of misreporting a failed repair.",
  "highlights": [
    {
      "icon": "📦",
      "text": "Missing dependency trees are repaired without requiring an artificial manifest edit"
    },
    {
      "icon": "🎯",
      "text": "Target verification is separated from the wider workspace verdict"
    },
    {
      "icon": "🌐",
      "text": "Explicit adapters cover major package managers across Node, Python, JVM, native, and other runtimes"
    },
    {
      "icon": "🧾",
      "text": "Durable receipts preserve target status, workspace status, and remaining work"
    }
  ]
}
-->

# Workspai CLI v0.54.0

Released August 7, 2026.

## Target-Aware, Cross-Runtime Repair

Workspai 0.54.0 strengthens the CLI-owned Repair Engine introduced in 0.53.0.
The engine can now repair missing dependency installations as a complete
transaction, keep the selected blocker as its verification target, and report
unrelated workspace findings without undoing valid work.

The canonical lifecycle remains:

```text
plan → preconditions → approval → checkpoint → execute
     → reconcile → audit → test → build → canonical verify
     → closed | rolled-back | decision-required
```

## Missing dependencies no longer require a fake source change

A project with a valid manifest and lockfile but a missing installed dependency
tree needs materialization, not a manifest rewrite. Doctor now publishes a
typed `dependency-materialization` capability, and the Repair Engine carries it
through:

1. package-manager reconciliation;
2. focused security audit when the runtime supports it;
3. declared tests;
4. declared build;
5. strict Workspace Intelligence verification.

The transaction does not claim that source changed when no source mutation was
needed. Its checkpoint and rollback behavior remain bounded to the actual
mutation surface.

## Verification follows the selected target

Workspace verification is intentionally broad, but one repair transaction has
a specific blocker and project target. New receipts distinguish:

- `verification.targetStatus`: whether the selected blocker is closed;
- `verification.workspaceStatus`: the wider workspace verdict;
- `verification.remainingActionIds`: work still required for this target.

The full canonical Workspace Intelligence chain still runs. If the target is
clean but another project remains blocked, the transaction closes and retains
the workspace blocker as evidence for a separate repair. Workspai no longer
rolls back a valid target repair because of unrelated work.

## Blockers take precedence over advisory work

Doctor remediation plans now preserve finding severity and target scope.
Blocking actions are selected before advisory coverage, formatting, deployment,
or optional quality improvements. A card repair therefore receives the minimum
causal plan needed to close its blocker instead of an accidental workspace
backlog.

This also gives IDE and agent consumers a clearer contract: the model may help
choose or propose bounded work, but the CLI decides which actions belong to the
transaction and whether they completed.

## Portable runtime adapters

The published repair capability inventory now represents package-manager and
tool preconditions for:

- Node: npm, pnpm, Yarn, and Bun;
- Python: Poetry, uv, and pip;
- native and service runtimes: Go, Cargo, Deno, and dotnet;
- application ecosystems: Composer, Bundler, and Mix;
- JVM and related build surfaces: Maven, Gradle, Leiningen, and sbt.

Adapters remain fail-closed. A command is executable only when its declared
tool and project surface are available. Conditional or unsupported paths become
an explicit decision instead of being guessed by a shell or model.

## Durable contract compatibility

New transactions always write target-aware verification evidence. The added v1
receipt fields remain optional when reading older durable transactions, so an
upgrade does not strand an approved or paused repair created by 0.53.x.

Root contracts, package contracts, Doctor evidence, remediation plans, and the
CLI/extension compatibility inventory remain synchronized.

## End-user verification

The release source was exercised against a real workspace whose NestJS project
had a valid lockfile but no installed dependency tree. The governed transaction:

- installed 849 packages;
- completed with zero reported dependency vulnerabilities;
- passed 6 Jest suites and 10 tests;
- passed the production build;
- ran the full Workspace Intelligence chain;
- closed the selected project target while preserving an unrelated workspace
  blocker.

Full CLI tests, type checking, focused Repair Engine suites, contract
synchronization, shared-contract parity, and CLI/extension parity also passed.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.54.0`.
- Existing v1 repair transactions and Workspace Intelligence artifacts remain
  readable.
- Consumers should use the published repair-capabilities and transaction
  contracts rather than infer execution rules from UI state.

## Upgrade

```bash
npm install -g workspai@0.54.0
workspai --version
workspai workspace repair capabilities --json
workspai workspace repair list --json
```

Optional short alias:

```bash
npm install -g wspai@0.54.0
wspai --version
```
