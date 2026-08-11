<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Universal Doctor Intelligence and Proof-Backed Polyglot Graphs",
  "summary": "Workspai now combines causal Doctor evidence with live-source-aware Graph retrieval, native lifecycle modeling, and bounded agent payloads across linked polyglot projects.",
  "highlights": [
    {
      "icon": "🩺",
      "text": "Doctor publishes truthful diagnosis, applicability, freshness, summary, and receipt evidence"
    },
    {
      "icon": "🌐",
      "text": "Native and polyglot graphs carry runtime, lifecycle, protocol, and cross-language evidence"
    },
    {
      "icon": "🎯",
      "text": "Git/Merkle fingerprints and bounded agent projections keep retrieval current and controlled"
    },
    {
      "icon": "🔗",
      "text": "Linked external projects retain portable proof paths across search, benchmark, and consumers"
    }
  ]
}
-->

# Workspai CLI v0.56.0

Publication status: pending. This release candidate is documented on `main` but
has not been published to npm.

## Universal Doctor Intelligence and Proof-Backed Polyglot Graphs

Workspai 0.56.0 gives every CLI, IDE, CI, and agent consumer the same
machine-readable answer to three questions: what was observed, what it means,
and which governed action can prove the issue is closed.

It also makes the Knowledge Graph safe to reuse for interactive agents: a
persisted graph is accepted only when its canonical model binding and bounded
live-source fingerprint still match the workspace on disk.

## One diagnosis model across polyglot workspaces

Doctor now normalizes runtime-specific observations through one causal
diagnosis boundary. Findings carry stable identities, confidence, proof
bindings, repair disposition, causal groups, unknowns, contradictions, and
domain completeness.

The capability registry covers 17 runtime adapters, 44 framework identities,
and Linux, macOS, and Windows declarations. Unsupported or unobserved evidence
remains unknown; it is never reported as healthy merely because a provider did
not run.

## Smaller, truthful handoffs for consumers

`doctor workspace --fresh --json=summary` provides a bounded operational view
without weakening the complete Doctor artifact. Every Doctor run also writes a
receipt that separates blocking causes, advisories, unknowns, dependency
advisories, vulnerabilities, and not-applicable checks.

Freshness and applicability are explicit. Cache age is bounded, live security
state can be forced with `--fresh`, and checks that do not apply no longer
inflate warnings or passing counts.

## Repair stays attached to the causal finding

Remediation plans retain diagnosis finding identifiers and causal keys across
multi-project transactions. Repair can close the selected causal action set
without confusing unrelated workspace findings with a failed repair.

Workspace Verify now binds a missing evidence step to its exact
`sourceCommand` and `sourceArtifact`. A missing `workspace run test` report, for
example, routes back to that project-scoped test producer rather than a generic
Analyze refresh.

## Persisted Graph reads prove live compatibility

`workspace graph search`, `entities`, `evidence`, `path`, and `benchmark` first
attempt a read-only persisted-graph fast path. Reuse fails closed if the model
or graph is missing or malformed, a proof is stale, the model hash differs, the
project scopes differ, or live inputs no longer match.

Git worktrees use a bounded `git-worktree-v2` signature covering tracked,
modified, untracked, ignored, renamed, and deleted inventory state. Sources that
cannot use that safe path fall back to content hashing with
`content-merkle-v1`. The aggregate `hybrid-git-content-v2` fingerprint includes
one workspace scope and every canonical project scope. `--refresh-graph`
remains the explicit bypass when a caller requires a live rebuild.

Before scope containment is evaluated, Workspai canonicalizes both the logical
workspace path and Git's reported physical worktree root. This keeps macOS
`/var` → `/private/var` aliases and Windows workspace junctions on the
`git-worktree-v2` path instead of causing a false content-hash fallback.

## Native and polyglot structure is first-class

Root CMake and Meson projects retain C/C++ as their primary runtime even when
they ship Node or Python bindings. The graph now carries proof-backed language,
package, runtime-unit, lifecycle-stage, Protocol Buffers service/message, and
cross-language bridge entities and relations. C++-primary `.h` files remain C++
evidence, and distinct Protobuf definitions that share an FQN retain separate
identity variants rather than becoming a false conflict.

`workspace run <stage> --plan` exposes the discovered polyglot lifecycle without
executing it. `--runtime <runtime>` selects one runtime family, while CMake and
Meson units publish bounded init, test, and build commands with explicit
confidence.

## Agent retrieval is scoped and bounded

`workspace graph search ... --scope project:<name>` includes project-owned facts
plus workspace-level shared entities connected to that project. Broad
architecture queries rank languages, protocols, APIs, dependencies, owners,
pipelines, deployments, and documents by intent while exact identity matches
remain dominant.

The agent projection caps relations, related entities, proofs, proof references,
aliases, arrays, and long strings and reports every omitted count. Benchmarking
uses the same projection and resolves portable `external/<project>/...` proof
paths through the workspace contract instead of treating linked-project
evidence as unreadable.

## Re-adoption and external consumers stay coherent

Re-adopting a linked project refreshes Workspai-managed runtime, framework, kit,
registry, and workspace-contract state. Analyze, Doctor, Workspace Run, Graph,
benchmarking, and terminal summaries now resolve the same external project
identity and no longer fall back to stale Python/Node metadata or `unknown`
display labels when native evidence is authoritative.

## Compatibility

There are no breaking command changes. Doctor evidence and remediation fields
are additive within their versioned contracts. The extension compatibility
floor remains 0.55.1; publishing a newer backward-compatible CLI no longer
raises that floor automatically.

## Release-candidate verification

- The complete restricted-environment suite produced 2,413 passes and 8
  explicit skips. Seven loopback-listener cases were environment-blocked; all
  three owning suites passed 60/60 when rerun with loopback access.
- 234 focused adoption, lifecycle, model, graph, query, consumer, and contract
  tests passed across 10 files.
- The 170-case versioned Doctor validation corpus passed across all 17 adapters;
  this is deterministic contract validation, not a claim of production-world
  diagnostic accuracy.
- A nine-project polyglot workspace exercised Sync, Model, Graph, Doctor,
  Contract, Analyze, Readiness, Verify, Explain, Agent Sync, and governed Repair
  planning.
- A real linked gRPC repository produced 4,692 entities, 5,287 relations, and
  7,332 proofs with 100% proof coverage, zero conflicts, zero unknowns, and a
  non-truncated 10,439-file live-input fingerprint.
- Its benchmark read all 1,062 proof artifacts and reduced one bounded query
  from 2,644,948 estimated corpus tokens to 4,665 estimated retrieval tokens
  (99.82%). Results vary by workspace and query; this is not an answer-quality
  or billing claim.
- Type checking, linting, formatting, contract validation, contract parity, and
  documentation gates passed.

## After publication

```bash
npm install -g workspai@0.56.0
workspai --version
workspai doctor capabilities --validate --json
workspai workspace intelligence run --for-agent generic --strict --json
```

Expected version:

```text
0.56.0
```
