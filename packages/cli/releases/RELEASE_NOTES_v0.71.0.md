<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Governed startup and enterprise native kit baselines",
  "summary": "Workspai 0.71.0 keeps Goal and PCC startup stable across operational observation, makes cold polyglot initialization truthful, and promotes every npm-owned native generator onto one reviewed enterprise baseline.",
  "highlights": [
    {
      "icon": "🔒",
      "text": "Goal and PCC architecture leases remain stable across runtime-owned telemetry updates"
    },
    {
      "icon": "🧭",
      "text": "Generated GitHub agent definitions remain Graph consumers instead of circular architecture inputs"
    },
    {
      "icon": "🧪",
      "text": "A lifecycle regression proves Goal creation, operational observation, and PCC begin compose safely"
    },
    {
      "icon": "⚙️",
      "text": "Cold workspace initialization streams real progress and reports the command that actually executed"
    },
    {
      "icon": "🏗️",
      "text": "Go, Spring Boot, .NET, and Rust generators share reviewed runtime, container, CI, and dependency baselines"
    }
  ]
}
-->

# Workspai CLI v0.71.0

Released August 31, 2026.

**Publication status:** Published.

## Governed Startup and Enterprise Native Kit Baselines

Workspai 0.71.0 fixes an ownership error at the boundary between canonical
architecture and runtime observation. The reserved `.workspai-workspace`
marker may receive local CLI or IDE usage telemetry after an immutable Goal is
created. That activity does not change the user's system and must not make the
Graph, Goal source binding, or Proof-Carrying Change architecture lease stale.

The same rule now explicitly covers Workspai-generated GitHub agent
definitions. Agent projections consume canonical evidence; they are never
allowed to become circular inputs to the Graph that generated them.

The release also closes two adjacent orchestration gaps exposed by Studio and
polyglot workspace qualification. Activated Goal projections may legitimately
carry Repair and PCC transaction links, and the lifecycle result contract now
accepts those canonical fields. Workspace initialization also distinguishes a
cold dependency bootstrap from an ordinary stage, streams its real progress,
and records the executor that actually ran.

The release also establishes an executable baseline policy for the native kits
owned directly by the npm CLI. Go Fiber, Go Gin, Spring Boot, .NET Web API, and
Rust Axum generators now draw runtime, framework, build, container, CI, and
dependency-update versions from one reviewed source of truth. Generator tests
bind the emitted projects to those baselines so the templates cannot silently
drift apart.

## What changed

- Graph inventory and Git fingerprints exclude the runtime-owned
  `.workspai-workspace` marker while continuing to observe real workspace and
  project source changes.
- Generated `.github/agents/workspai-*.agent.md` files join the existing set of
  downstream agent projections excluded from architecture identity.
- Git-backed and filesystem-backed snapshot regressions prove that operational
  metadata can be created or updated without producing a false
  `live-input-mismatch`.
- A full Goal-to-PCC regression proves that telemetry written after Goal
  planning cannot block `change begin` before the first authorized effect.
- Goal lifecycle results and their mirrored schemas admit validated Repair and
  PCC transaction linkage from the canonical Goal index.
- Cold Python, JVM, .NET, Rust, Go, and Node initialization receives bounded
  runtime-aware budgets while explicit timeout policy continues to take
  precedence.
- Workspace run reports update planned runtime entries with actual command,
  status, exit code, duration, and diagnostics; process output is visible while
  a long dependency bootstrap remains active.
- Python initialization prefers the project-local Poetry executable and probes
  optional system Poetry without turning an expected missing executable into
  misleading blocker evidence.

## Native kit baseline

- Go Fiber and Go Gin generate against Go 1.26 with pinned framework, lint,
  documentation, container, and GitHub Actions tool versions.
- Spring Boot generates a Java 21 project on the maintained 3.5 line, verifies
  Java 21 and 25 compatibility, emits an OWASP dependency scan and CycloneDX
  SBOM, and runs as a non-root container user.
- .NET Web API generates consistently on .NET 10 LTS across source, tests,
  containers, and CI, including transitive vulnerability audit coverage.
- Rust Axum generates with a pinned Rust 1.98 toolchain, edition 2024, Axum
  0.8, locked builds, non-root containers, and deterministic CI.
- Every owned native kit includes Dependabot coverage for its package ecosystem
  and GitHub Actions.

FastAPI and NestJS remain owned by the RapidKit Python engine. Frameworks with
official upstream project creators remain delegated to those official CLIs;
this release does not fork or shadow their scaffolding contracts.

## Trust boundary

This fix does not weaken source freshness. Tracked source, manifests,
configuration, infrastructure, documentation, and non-ignored untracked files
remain part of the live Git/Merkle fingerprint. Only Workspai-owned operational
state and generated agent-consumer projections are removed from architecture
identity.

## Compatibility

- Existing version-one Model, Graph, Goal, Decisions, PCC, Live, MCP, Repair,
  and agent contracts remain backward compatible. Goal lifecycle transaction
  fields are additive and already owned by the canonical Goal index.
- No public command, flag, schema, or artifact path is removed.
- Existing generated projects are not rewritten. The new baselines apply when
  creating a new native project.
- Workspaces with a Graph generated by 0.70.0 need one normal Intelligence
  refresh before receiving the corrected input fingerprint.

## Validation

- CLI typecheck, build, documentation links, and contract validation pass.
- Graph snapshot and PCC lifecycle regressions pass for Git and non-Git
  workspaces.
- Generator contracts pass for all five native kits without requiring host
  runtimes.
- The generated Spring Boot baseline passes real Maven compilation, tests, and
  CycloneDX SBOM generation on Java 21.

## Install after publication

```bash
npm install -g workspai@0.71.0
workspai --version
```

The optional `wspai` alias is released at the matching `0.71.0` version.
