<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Proof-backed polyglot workspace execution",
  "summary": "Workspai 0.74.0 makes the complete Model-to-Graph-to-Goal-to-PCC lifecycle safer and more truthful across adopted and generated polyglot workspaces.",
  "highlights": [
    {
      "icon": "⚙️",
      "text": "Bounded native lifecycle execution preserves real exit codes, timeouts, and actionable setup blockers"
    },
    {
      "icon": "🧭",
      "text": "Canonical workspace identity now survives external adoption, nested projects, snapshots, repair, and recovery"
    },
    {
      "icon": "🕸️",
      "text": "Graph search uses authored subject evidence and stable polyglot ranking instead of generic keyword collisions"
    },
    {
      "icon": "✅",
      "text": "Goal and proof-carrying change qualification covers authorization, execution evidence, re-observation, and verification"
    },
    {
      "icon": "🩺",
      "text": "Analyze and Doctor share cross-language health evidence and avoid unsupported efficiency or price claims"
    }
  ]
}
-->

# Workspai CLI v0.74.0

Prepared September 5, 2026.

**Publication status: pending.** Prepared for release; not yet published.

## Proof-backed Polyglot Workspace Execution

Workspai 0.74.0 hardens the complete workspace-intelligence lifecycle rather
than one framework-specific path. Model, Graph, Analyze, Doctor, Goal,
proof-carrying change, Run, Repair, Snapshot, and agent evidence now resolve the
same canonical project identity and report what the current machine actually
verified.

The release was exercised against an adopted real-world polyglot repository and
a generated workspace containing Go, Python, Rust, and .NET services. Missing
toolchains and incompatible project dependencies remain visible blockers; they
are not converted into false CLI success.

## Native execution with truthful outcomes

- Polyglot lifecycle stages run through bounded native child processes.
- A timed-out process returns exit 124 and its process tree is terminated.
- Missing runtimes, toolchains, and build dependencies remain actionable setup
  evidence instead of opaque command failure.
- Empty Go tooling modules are skipped when they contain no runnable package.
- Nested CMake targets are not executed twice when an ancestor owns them via
  `add_subdirectory`.
- Registered project names resolve even when their directory basenames differ.

## Canonical identity, recovery, and isolation

- Adopted external projects resolve their Workspace binding from the project
  directory for `infra`, snapshots, repair capability inspection, and other
  lifecycle commands.
- Ambiguous registry aliases are rejected instead of selecting an arbitrary
  project.
- Project paths that escape a Workspace through symlinks are rejected.
- Marker-defined identity remains consistent across adoption, contracts,
  Doctor, Goals, repair, snapshots, and agent evidence.
- Recovery snapshots retain canonical contracts, registries, policy and
  toolchain inputs, and registered external-project identities.
- Observed nested manifests stay inside their managed aggregate boundary while
  explicitly registered children remain independent.

## Polyglot Model, Graph, and health evidence

- Analyze and Doctor share cross-language health-surface discovery for
  supported Go, Python, Rust, .NET, and JavaScript service patterns.
- Graph retrieval rejects generic distractors when a named subject has no
  supporting evidence.
- Matching authored source supplies service-language affinity without turning a
  runtime word into standalone relevance evidence.
- Build questions prioritize lifecycle manifests and executable evidence.
- Short search terms avoid ambiguous prefix collisions.
- Multi-language Goal constraints retain their explicit language anchors.
- Generated Goal evidence and snapshots no longer invalidate their own Graph
  fingerprints during verification.

## Goal and proof-carrying change continuity

- The documented `--runtime` selector works for verified test-coverage Goals.
- Goal constraints, authorization, effect receipts, re-observation, and
  verification use the same project identity and evidence boundary.
- Enterprise qualification derives coverage from completed checks instead of
  declaring scenarios verified before execution.
- Qualification artifacts are checked so local reference paths and internal
  workspace data cannot enter the published npm package.

## Consumer truthfulness

- Token efficiency stays unknown when no usable model measurement exists.
- `workspai ai info` no longer presents stale fixed provider-price estimates.
- Runtime contract validation remains offline-safe and does not cold-start the
  optional Python Core catalog in contract-only mode.
- Missing CMake packages are classified as dependency failures.
- CLI and extension command contracts include the verified Goal runtime
  selector consistently.

## Compatibility

- Existing version-one Model, Graph, Goal, Decisions, PCC, Live, MCP, Repair,
  Doctor, Snapshot, and agent contracts remain supported.
- No public command, schema version, or canonical artifact path is removed.
- Stricter identity and path validation can reject ambiguous or escaping
  project registrations that older versions accepted implicitly.

## Qualification evidence

- The complete CLI suite passed with 240 test files passing and 4 skipped;
  2,822 tests passed and 8 were skipped.
- TypeScript typecheck, lint, formatting, English-text, package security, and
  contract gates passed.
- The runtime contract matrix completed offline with 97 checks passed, 11
  explicitly skipped live-Core catalog checks, and no failures.
- A generated four-runtime workspace produced a 100/100 Analyze result, stable
  Model and Graph output, successful Goal verification, and bounded failure
  evidence for unavailable host toolchains.
- Go lifecycle execution completed test, build, start, and coverage with
  80.92% measured coverage. Python build and start completed; its generated
  test dependency incompatibility remained an explicit project blocker.

## Install after publication

```bash
npm install -g workspai@0.74.0
workspai --version
```

The optional `wspai` alias is prepared at the matching `0.74.0` version.
