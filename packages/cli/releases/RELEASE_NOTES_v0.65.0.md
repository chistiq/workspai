<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Evidence-bound project intelligence and repair qualification",
  "summary": "Workspai 0.65.0 gives models, agents, and IDEs more accurate project identity, lifecycle, governance, topology, Goal context, and governed repair guarantees.",
  "highlights": [
    {
      "icon": "🧭",
      "text": "Project taxonomy and lifecycle discovery now cover application, library, platform, native, and polyglot boundaries"
    },
    {
      "icon": "🕸️",
      "text": "Graph evidence separates runtime API registration from proven endpoint implementation"
    },
    {
      "icon": "🎯",
      "text": "Goal Packs preserve diverse source, package, test, lifecycle, and API evidence"
    },
    {
      "icon": "🛡️",
      "text": "Repair qualification enforces bounded recovery across adapters, scopes, and failure families"
    }
  ]
}
-->

# Workspai CLI v0.65.0

Released August 24, 2026.

## Evidence-Bound Project Intelligence and Repair Qualification

Workspai 0.65.0 strengthens the full Workspace Intelligence lifecycle: adopt a
repository, identify what it really is, model its executable and governance
surfaces, retrieve bounded evidence for an agent or Goal, diagnose applicable
problems, and repair them through a deterministic governed loop.

The release is built from qualification against large real repositories rather
than repository-specific exceptions. Shared evidence producers now improve
application, library, platform, extension, native, generated, aggregate, and
mixed-runtime projects together.

## More accurate project identity and lifecycle

Project classification now combines canonical manifests, detected runtime and
framework, executable topology, package structure, and repository role. It
recognizes platform and library boundaries, extensions and desktop
applications, multi-command Go repositories, JVM module aggregators, and native
libraries that expose several language-binding ecosystems.

Lifecycle discovery is correspondingly more precise:

- Node.js scripts are interpreted as declared project capabilities rather than
  generic package-manager assumptions;
- Go projects expose proof-backed init, dev, start, build, test, lint, and
  format capabilities when their repository surface supports them;
- portable test evidence covers common runtime-native layouts and commands;
- fixtures, examples, vendored content, and incidental nested tooling do not
  become the primary runtime or project identity.

Doctor, Analyze, Readiness, the Workspace Model, operational Skills, and Goal
planning all consume these shared detections. A repository without a recognized
runtime remains a valid runtime-neutral project with an explicit advisory; it
is no longer treated as a broken executable project.

## Proof-backed topology and governance

The Knowledge Graph can now prove that an authored API enters a runtime through
framework registration or configuration even when no literal route handler is
present. Runtime registration and endpoint implementation remain separate
coverage guarantees: Workspai never converts registration evidence into a
claim that every operation has a reachable implementation.

Dynamic binding is runtime-specific, limited to production routing surfaces,
bounded per API, and backed by source proofs. Shared contract APIs without
project ownership are excluded from project-local registration denominators.
Agents can further constrain bounded retrieval with:

```bash
workspai workspace graph search "authentication endpoint" \
  --kind endpoint \
  --limit 12 \
  --json
```

CI, release, and ownership controls now have one canonical representation.
Each control is classified as repository-owned, externally declared,
externally observed, or unknown. A workspace contract can name an external
provider and reference, preventing Analyze from misreporting an intentional
external control plane as a missing repository file. The resolved governance
profile is shared by the Model, Graph, facts, Analyze, project lens, and agent
context.

## Stronger Doctor, Analyze, Readiness, and Goal behavior

Deployment, health, environment, migration, dependency, test, and governance
checks are now conditioned on the detected project kind and proven runtime
surface. Libraries, platforms, plugins, SDKs, and monorepos are not assigned
service-only requirements. Doctor also distinguishes unproven runtime coverage
from a causally repairable blocking failure.

Goal retrieval removes redundant project-name noise, applies stronger matching
to long natural-language objectives, preserves compatibility constraints, and
diversifies the bounded candidate set by entity kind. Large API surfaces can no
longer consume the entire Goal evidence budget at the expense of source,
package, test, lifecycle, or ownership context.

## Contract-enforced repair qualification

`workspace repair capabilities --json` now publishes a qualification matrix
covering:

- 13 runtime adapters;
- project, workspace, linked-project, and polyglot-project scopes;
- ten failure families, including missing tools or artifacts, stale evidence,
  no-op proposals, source drift, validation and provider failures, interrupted
  rollback, and unsupported runtimes;
- automatic refresh, bounded replan, decision-required, checkpoint rollback,
  durable resume, and manual-repair terminal paths.

Contract generation fails if an adapter omits reconciliation, audit, test,
build, or closure stages, or if a failure family has no bounded recovery policy.
This is an authority and recovery guarantee; runtime execution still requires
Doctor to prove the relevant executable and project surface on the current
machine.

## Safer adoption, caching, and consumer artifacts

Adoption snapshots now include generated agent entry files and repository-local
symlink targets. Rollback validates the exact canonical file set before it
restores state.

Workspace Model caches carry a semantic producer revision, preventing a local
candidate or backport from reusing structurally valid but semantically obsolete
models when the package version has not changed. Model, Graph, project lens,
agent context, and generated operational Skills expose the new evidence through
their existing versioned consumer surfaces.

The root and CLI documentation now distinguish canonical workspace artifacts
from project-local portable entry artifacts and include an actual Workspace
Graph preview without adding the GIF to the npm package payload.

## Qualification

The release was exercised in isolated Workspai workspaces against large real
repositories spanning C and C++, Rust, Go, Java, JavaScript and TypeScript,
Python, .NET, PHP, Ruby, native bindings, generated APIs, monorepos, and
polyglot platforms. Qualification asserts deterministic Model and Graph output,
Doctor applicability, Analyze and Readiness semantics, Goal evidence quality,
consumer artifact validity, repair capability closure, and publication safety.

## Upgrade

```bash
npm install -g workspai@0.65.0
workspai --version
```

Expected output:

```text
0.65.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias will be published at the matching `0.65.0` version.
- Existing Workspace, Model, Graph, Goal, repair, and agent-entry version-one
  contracts remain supported.
- Governance, test-surface, binding-coverage, cache-producer, and repair-
  qualification fields are additive.
- `workspace graph search --kind` is additive and optional.
- No public command is removed.

## Breaking changes

None.
