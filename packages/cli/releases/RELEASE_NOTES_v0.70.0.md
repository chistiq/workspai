<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Deletion-aware change assurance and contributor-ready qualification",
  "summary": "Workspai 0.70.0 makes deleted artifacts first-class PCC evidence, reconciles overlapping Graph identities without duplicate receipts, strengthens nested polyglot readiness decisions, and gives contributors a bounded path from task selection to file-aware validation.",
  "highlights": [
    {
      "icon": "🪦",
      "text": "Deletion tombstones prove an artifact remains absent and invalidate the capsule if it reappears"
    },
    {
      "icon": "🧭",
      "text": "Overlapping project Graph labels reconcile through one contained physical artifact identity"
    },
    {
      "icon": "🧩",
      "text": "Nested polyglot projects keep unrelated Goal drift advisory while preserving architecture evidence"
    },
    {
      "icon": "🤝",
      "text": "A contribution hub and file-aware planner turn applicant interest into bounded, validated work"
    }
  ]
}
-->

# Workspai CLI v0.70.0

Released August 31, 2026.

**Publication status:** Published.

## Deletion-Aware Change Assurance and Contributor-Ready Qualification

Workspai 0.70.0 strengthens the trust boundary introduced by Proof-Carrying
Change. A successful change can now prove that an artifact was intentionally
deleted, retain that claim in the Decisions ledger and capsule, and fail
validation if the artifact later reappears. The same release reconciles
overlapping project Graph labels by their safe physical identity, improves
polyglot aggregate and Goal-scope decisions, extends isolated real-repository
qualification, and gives new contributors a bounded path to their first
validated change.

## Deleted artifacts become verifiable evidence

Effect receipts may now carry `deletedArtifacts` alongside ordinary present
artifacts. Each deletion reference includes a portable artifact identity,
observation time, and deterministic SHA-256 tombstone using
`deletion-tombstone-v1` semantics.

The runtime enforces that:

- only a succeeded effect can claim a deletion;
- one receipt cannot claim the same artifact as both present and deleted;
- duplicate deletion identities are rejected;
- the portable identity resolves through the governed workspace or a
  contract-declared linked project;
- the target is absent when the effect is admitted and whenever the capsule is
  validated;
- recreating the artifact invalidates the capsule instead of silently
  preserving an obsolete assurance.

Compact receipt input may provide the deleted artifact path and let Workspai
derive the tombstone. The persisted event and capsule always contain the fully
typed reference. Existing receipts without `deletedArtifacts` remain valid.

## One mutation, one physical identity

An aggregate project and an independently adopted nested project can project
the same source file under different portable Graph labels. Workspai now maps
those labels through the workspace contract and compares the contained physical
target before deciding that an effect receipt is missing.

This does not use suffix matching or caller-provided absolute paths. Missing
leaf paths are resolved only after the nearest existing ancestor is checked by
real path against the workspace or declared project root. Symlink escapes,
ambiguous external roots, and paths outside governed scope still fail closed.

The result is exact effect coverage without requiring an agent to submit
duplicate receipts for one filesystem mutation.

## Honest nested and polyglot readiness

Multi-runtime aggregate repositories no longer receive a false unknown-stack
failure merely because Workspai correctly refuses to promote one nested
framework as the identity of the whole repository. Analyze reports an explicit
aggregate-boundary information finding and recommends independent adoption only
when a nested unit needs its own lifecycle, ownership, or release evidence.

Agent bootstrap also separates current architecture evidence from the active
Goal decision. A stale or invalid Goal still blocks the project scope it owns,
but an unrelated nested project remains architecture-ready and receives a
degraded advisory rather than a false blocker or adoption rollback.

## Stronger real-repository qualification

The isolated real-world qualification harness now binds its Activity state to
the same disposable run root and validates a renderer-neutral Live Board with
observed command runs. The complete qualification contains 23 command checks
covering adoption, Model, Graph, queries, evidence, paths, exports, Doctor,
Analyze, consumer grounding, verification, and Live output.

The release was exercised on the Semantic Kernel repository as an aggregate
.NET, Python, and Node architecture with independently adopted .NET and Python
boundaries. Source mutations used for deletion testing remained confined to an
isolated snapshot; the reference repository stayed unchanged.

## A bounded path to the first contribution

The repository now provides a Contribution Hub for code, tests, Graph and AI
context, documentation, product experience, runtimes, and CI. It exposes only
a small candidate starter queue and distinguishes a complete good-first issue
from a maintainer-approved child slice of a larger architecture outcome.

Contributors can derive the required validation from staged, unstaged, and
untracked files:

```bash
corepack npm run contributor:plan
corepack npm run contributor:plan -- --json
corepack npm run contributor:plan -- --file packages/cli/docs/agent-entry.md
```

The planner is repository-only, read-only tooling. It composes documentation,
TypeScript, test, contract, automation, dependency, and lockfile checks without
adding a public Workspai command or entering the published npm package.

Welcome, pull-request, merged-contributor, outreach, and follow-up messages now
route people through the Contribution Hub and GitHub issue scope. Community
chat remains a support layer rather than the source of assignment or acceptance
criteria.

## Upgrade

```bash
npm install -g workspai@0.70.0
workspai --version
```

Expected output:

```text
0.70.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias is released at the matching `0.70.0` version.
- Existing version-one Workspace Intelligence, Model, Graph, Goal, MCP,
  Repair, Skill, project-entry, Live, Decisions, and PCC behaviors remain
  supported.
- `deletedArtifacts` is an additive optional field on v1 effect and capsule
  contracts; existing producers may continue omitting it.
- Physical-identity reconciliation changes only duplicate coverage decisions;
  portable labels and Graph contracts retain their existing shape.
- `contributor:plan` is repository development tooling, not a public CLI or npm
  package command.
- No public command is removed.

## Breaking changes

None.
