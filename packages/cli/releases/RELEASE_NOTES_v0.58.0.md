<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Governed Goals and Agent-Ready Objective Handoffs",
  "summary": "Workspai 0.58.0 turns plain-language outcomes into bounded, evidence-backed Goal Packs that developers, AI agents, IDEs, and CI can follow without giving up CLI-owned scope and verification controls.",
  "highlights": [
    {
      "icon": "🎯",
      "text": "One goal command compiles intent into an immutable, scope-bound plan and portable consumer handoff"
    },
    {
      "icon": "🧭",
      "text": "Agents discover one active objective through a versioned lifecycle index and bounded proof anchors"
    },
    {
      "icon": "🛡️",
      "text": "Ambiguous state, empty retrieval, unsafe commands, path disclosure, and scope widening fail closed"
    },
    {
      "icon": "✅",
      "text": "Preparation, verification, recovery, and completion remain explicit CLI-owned lifecycle operations"
    }
  ]
}
-->

# Workspai CLI v0.58.0

Released August 16, 2026.

## Governed Goals and Agent-Ready Objective Handoffs

Workspai 0.58.0 introduces one plain-language front door for outcome-driven
work while preserving the system boundaries that make Workspace Intelligence
trustworthy. A developer can state an objective once; Workspai binds it to the
current Workspace Model, its revision-bound Knowledge Graph, an explicit
project scope, measurable capabilities, proof anchors, and immutable policy.

The result is not a free-running prompt. It is a portable, inspectable Goal
Pack that developers, AI agents, IDEs, and CI can consume without silently
widening scope or claiming success before canonical verification passes.

## One intent becomes one governed Goal Pack

```bash
workspai goal "Raise test coverage to 85%" --for-agent generic
```

The Goal compiler resolves the canonical workspace even when the command is
run from an adopted project. It validates project selection, checks whether the
requested result has a measurable workspace capability, retrieves bounded
proof-backed Graph context, and writes an immutable Goal Pack plus a portable
consumer handoff.

Each Goal separates three integrity concepts instead of overloading one hash:

- the Workspace Model's structural revision;
- canonical JSON hashes for Graph and Goal artifacts;
- the stable Goal identity fingerprint used by lifecycle operations.

This distinction lets consumers prove what changed, what evidence the Goal was
bound to, and whether they are still acting on the same objective.

## Agents and IDEs discover the same active objective

A versioned Goal index exposes the active objective and its bounded handoff to
authorized consumers. Agent grounding points to that portable index rather
than copying machine-specific workspace roots into repository instructions.

Only one Goal can be selected at a time. Duplicate or malformed index entries
fail closed. Stale Goals remain listable and cancellable for recovery, but they
cannot be reactivated or verified as though their evidence were current.

## Lifecycle control remains explicit and machine-readable

Goal status, list, activation, cancellation, verification preparation, and
verification use the published `workspai.goal-lifecycle-result.v1` envelope.
Successful responses therefore share stable operation, state, selection,
artifact, and next-action fields across terminal, CI, IDE, and agent consumers.

Failures use operation-specific machine-readable codes. Conflicting selectors,
invalid identifiers, empty project scope, stale bindings, ambiguous indexes,
and unsupported measurement requests cannot fall through to generic prose or
an accidentally successful exit.

The supported lifecycle is explicit:

```text
draft → ready | needs-evidence | blocked
ready → active
active → verifying → verified
draft | ready | needs-evidence | active → cancelled
```

Preparation and verification retain exactly one selected objective. A verified
Goal clears selection; cancelled or failed operations do not silently select a
different Goal.

## Missing evidence is not readiness

A measurable request must resolve to a supported capability and current
evidence. When the capability exists but its producer has not run, Workspai
returns `needs-evidence` with the bounded next command. It does not label the
Goal ready based on intent alone.

Likewise, an empty bounded Graph retrieval is `blocked`. An agent is never
encouraged to replace missing evidence with an unbounded repository scan.
Generated commands are tokenized and shell-safe, and Goal artifacts reject
local absolute paths, traversal, control characters, credentials, tokens, and
other secret-like material before persistence.

## Repair cannot widen the objective

Repair Engine proposals may reference the active Goal, but that reference does
not transfer ownership of scope or verification. A project-scoped Goal cannot
be silently widened to another project or to the complete workspace. Existing
checkpoint, transaction, reconciliation, verification, and rollback controls
remain authoritative.

This keeps the product flow simple without weakening its contract:

```text
Understand → bound the objective → act through governed tools → verify evidence
```

## Workspace Intelligence cannot stale its own output

Managed agent grounding can update repository-side instruction artifacts near
the end of an Intelligence run. Workspai now reconciles the canonical Model and
Graph bindings after those writes, ensuring a successful chain does not make
its own Goal, Graph, IDE, or agent evidence stale before a consumer reads it.

## Real-repository qualification is permanent and publication-safe

The qualification harness now supports snapshot-first isolated and cumulative
workspace scenarios, including project-scoped Goal creation and lifecycle
assertions. Qualification retains bounded metrics and safe artifact identities,
not raw command output, invocation directories, machine roots, or local paths.

This release candidate has been exercised across large polyglot repositories
and multi-project workspaces. These checks validate orchestration and contract
behavior; they do not claim that Workspai can autonomously complete every
possible source change in every language.

## Compatibility

There are no breaking changes. The Goal command family, Goal Pack artifacts,
lifecycle index, consumer handoff, lifecycle-result envelope, and repair Goal
binding are additive. Existing Model, Graph, Doctor, Repair, Workspace
Intelligence, and agent-grounding commands remain available.

## Verification status

The release matrix, package smoke, security, documentation, contract,
cross-platform, and npm dry-run gates passed for the published release.

## Install

```bash
npm install -g workspai@0.58.0
workspai --version
workspai goal "Raise test coverage to 85%" --for-agent generic
workspai goal status --json
```

Expected version:

```text
0.58.0
```
