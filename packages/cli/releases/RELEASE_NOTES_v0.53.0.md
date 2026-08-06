<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Governed Workspace Repair Engine",
  "summary": "Workspai now owns blocker repair as a durable, approval-bound transaction from evidence and checkpoint through multi-runtime execution, rollback, and strict Workspace Intelligence verification.",
  "highlights": [
    {
      "icon": "🛠️",
      "text": "One CLI-owned repair transaction carries a blocker from plan to canonical verification"
    },
    {
      "icon": "🔐",
      "text": "Plan hashes, source preconditions, explicit approval, and bounded checkpoints guard every mutation"
    },
    {
      "icon": "↩️",
      "text": "Failed required stages roll back only after target and backup integrity are verified"
    },
    {
      "icon": "🌐",
      "text": "Package-manager-aware adapters cover Node, Python, Go, Rust, PHP, Ruby, Elixir, Deno, .NET, Maven, and Gradle surfaces"
    }
  ]
}
-->

# Workspai CLI v0.53.0

Released August 6, 2026.

## Governed Workspace Repair Engine

Workspai 0.53.0 moves blocker repair behind a durable CLI-owned execution
boundary. IDEs and AI agents can propose bounded work, show progress and diffs,
and request a user decision, but they no longer need to reproduce the rules
that decide whether a repair is safe, complete, or verified.

The canonical flow is now:

```text
plan → preconditions → approval → checkpoint → execute
     → reconcile → audit → test → build → canonical verify
     → closed | rolled-back | decision-required
```

## One source of truth for repair

The new `workspace repair` command surface owns the complete transaction:

- `capabilities` publishes the current adapter and safety inventory;
- `plan` compiles governed evidence into an immutable transaction;
- `propose` accepts hash-pinned, bounded model output and validates it before it
  can become executable work;
- `approve` binds user approval to the exact plan hash;
- `execute` and `resume` run only valid, current, approved stages;
- `status`, `list`, and `decide` expose durable progress and explicit choices;
- `rollback` and `cancel` provide controlled terminal paths.

The latest portable state is written to
`.workspai/reports/workspace-repair-last-run.json`. Durable transaction data
lives under `.workspai/repair/transactions/`, so an IDE restart does not turn a
verified stage into an untracked model assumption.

## Model proposals are evidence, not authority

An IDE model may propose complete-file writes or deletes plus structured
verification commands. The CLI rejects stale source hashes, duplicate targets,
workspace evidence edits, Git internals, installed dependency trees,
secret-bearing files, path or symbolic-link escapes, and commands outside the
governed invocation policy.

Dependency-manifest proposals still receive CLI-inferred reconcile, audit,
test, build, and strict verification stages. A manifest edit by itself cannot
close a blocker.

## Approval and rollback are integrity-bound

Every plan records its policy, preconditions, structured invocations, target
baseline, and checkpoint hashes. Execution expires approval when the plan,
source, required executable, or selected policy has changed.

Required-stage failure triggers bounded rollback by default. Before restoring
files, the engine validates the current target and backup hashes, restores file
modes atomically, and reconciles dependency state when manifests or lockfiles
were involved. A conflict becomes `decision-required`; Workspai does not hide
an uncertain restore behind a success state.

## Multi-runtime repair is explicit

The published repair-capabilities contract describes support for Node, Python,
Go, Rust, Composer, Bundler, Elixir, Deno, .NET, Maven, and Gradle surfaces. A
polyglot project can receive independent, collision-free stages for every
applicable adapter.

Support remains truthful: adapters that need an isolated environment, declared
project command, or separately installed audit tool are marked conditional.
Missing tools and unsupported ecosystems produce `decision-required`; they do
not silently fall back to arbitrary model execution.

## Stronger Doctor and artifact behavior

- Doctor treats RapidKit Core as an optional engine when the workspace does not
  require Python-backed kits or modules.
- Doctor resolves workspace-local Core installations from nested projects.
- Canonical artifact locking tolerates transient Windows filesystem contention,
  preserves live-owner locks, and cleans stale or malformed lock state safely.
- Runtime commands and documentation now agree on supported scopes, aliases,
  output artifacts, and strict failure behavior.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.53.0`.
- Existing Workspace Intelligence artifacts remain readable.
- Repair consumers should discover commands and schemas from the published
  runtime and repair-capabilities contracts instead of hard-coding them.

## Verification

- Full CLI tests, coverage, type checking, formatting, linting, and production
  build passed for the release source.
- Contract generation, shared-contract parity, runtime acceptance, and the
  Workspace Intelligence chain guards passed.
- The CLI-to-extension repair boundary passed real local integration scenarios.
- Package metrics reported 81% coverage, zero ESLint errors, and zero known
  dependency vulnerabilities.

## Upgrade

```bash
npm install -g workspai@0.53.0
workspai --version
workspai workspace repair capabilities --json
workspai workspace repair list --json
```

Optional short alias:

```bash
npm install -g wspai@0.53.0
wspai --version
```
