<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Evidence-driven agent operations and portable project graphs",
  "summary": "Workspai 0.66.0 gives every adopted project a verified Graph projection, evidence-qualified operational Skills, adaptive agent context, and interoperable MCP retrieval while preserving the canonical workspace aggregate.",
  "highlights": [
    {
      "icon": "🧠",
      "text": "Operational Skills are generated or suppressed from current project evidence instead of a generic template list"
    },
    {
      "icon": "🕸️",
      "text": "Every project receives a portable, integrity-bound Graph projection linked to the complete workspace aggregate"
    },
    {
      "icon": "🎯",
      "text": "Adaptive project lenses preserve diverse architecture evidence within a bounded agent context"
    },
    {
      "icon": "🔌",
      "text": "MCP consumers receive structured results, stable schemas, explicit errors, and dual-era protocol compatibility"
    },
    {
      "icon": "🛡️",
      "text": "Concurrent adoption, Windows execution, runtime diagnostics, and isolated qualification are substantially hardened"
    }
  ]
}
-->

# Workspai CLI v0.66.0

Released August 28, 2026.

**Publication status:** Published.

## Evidence-Driven Agent Operations and Portable Project Graphs

Workspai 0.66.0 strengthens the architecture between repository adoption and
useful agent work. The canonical workspace still owns the complete Model and
aggregate Knowledge Graph, but every registered project now receives a
portable, project-owned Graph projection and a bounded agent entry surface that
can be validated independently.

Generated operational Skills are no longer treated as a fixed catalog. Their
presence, instructions, commands, evidence, and project boundary are derived
from the current workspace contract, Model, and Graph. The result is a smaller
and more useful consumer surface: a user sees why a Skill applies to this
project, and irrelevant API, schema, or contract workflows are explicitly
suppressed from generation.

## Project-owned Graphs with one canonical aggregate

Workspace Intelligence now publishes the Model, the complete workspace Graph,
and each project Graph projection as one atomic generation transaction. Project
artifacts include only project-owned entities plus directly connected boundary
evidence; they do not silently copy unrelated projects from a multi-project
workspace.

Project context, agent entry, and bootstrap receipts distinguish these two
views:

- the project Graph is the portable first read for project-local work;
- the workspace aggregate is the authoritative cross-project view;
- a versioned Graph reference records identity, revision, integrity, scope, and
  the canonical aggregate location;
- agent bootstrap refuses architecture claims when the local projection is
  missing, stale, invalid, tampered with, or not the exact canonical shard.

`workspace graph emit` publishes all of these artifacts together. A requested
Graph refresh bypasses semantic reuse and updates the canonical artifacts
instead of returning a transient result. Snapshot and rollback behavior covers
nested and externally linked projects, so partial publication cannot leave the
workspace and its consumers on different revisions.

## Evidence-qualified operational Skills

Agent synchronization evaluates each candidate Skill against proven project
capabilities and topology. Generated `SKILL.md` files now include:

- the evidence signals that made the workflow applicable;
- the exact project boundary and registered commands;
- bounded Graph queries suited to the Skill's purpose;
- task-specific validation and completion expectations;
- clear handling for missing evidence and unsupported operations.

The Skills index records both generated and suppressed decisions. API failure,
contract rename, and schema migration Skills, for example, are not emitted when
the project has no evidence of the relevant surface. Runtime, dependency, and
release workflows remain available only when their own evidence is present.
Safe synchronization removes obsolete Workspai-owned wrappers while preserving
repository-authored Skills and provider content.

## Adaptive project context without quality collapse

The project intelligence lens now uses a stratified, adaptive selection policy
instead of a single small global slice. It preserves representation across
languages, runtimes, lifecycle stages, services, APIs, endpoints, schemas,
protocols, modules, files, and symbols, while increasing capacity when project
complexity and evidence diversity require it.

This keeps the first agent read bounded without allowing a large endpoint or
symbol population to crowd out lifecycle, dependency, test, governance, or
cross-project evidence. The complete canonical Model and Graph remain
available for exact follow-up retrieval; the lens is a routing surface, not a
replacement source of truth.

## MCP interoperability and explicit retrieval contracts

The Workspace Intelligence MCP server now supports modern and legacy consumer
shapes without weakening its proof boundary. Tool responses can expose both
human-readable content and structured content, input and output schemas remain
stable, initialization advertises the implemented capabilities, and protocol
or validation failures are returned as explicit MCP errors.

Graph search, evidence lookup, paths, project context, and related tools remain
bounded and revision-aware. A consumer can therefore move from the project
entry artifact to a precise Graph query without scanning the repository or
assuming that generated prose is canonical evidence.

## Broader polyglot and framework fidelity

Lifecycle planning now recognizes evidence-backed Bun, Deno, Kotlin, Scala,
Clojure, PHP, Ruby, and Elixir surfaces in addition to the established Node.js,
Python, Go, JVM, .NET, Rust, and native paths. Nested runtime units in polyglot
repositories retain their real boundaries instead of forcing the repository
into one dominant ecosystem.

Framework and topology detection is more defensive around nested packages,
homogeneous monorepos, GraphQL executable documents, legacy and modern Compose
formats, Rails route mounts, generated content, test fixtures, and incidental
tooling. Unresolved topology evidence is discarded rather than published as an
orphan proof.

## Cross-platform and transactional hardening

This release also closes several failure modes exposed by the enterprise
qualification matrix and Windows CI:

- imported-project registry changes use interprocess coordination and preserve
  concurrent updates;
- Model cache identity uses Git content when available while safely handling a
  missing or relocated Git executable;
- Python and shell diagnostics explain broken pipx shims, unavailable pip, and
  platform-specific activation commands;
- repository-authored setup commands remain actionable on Windows;
- integration teardown waits for bounded child-process and filesystem cleanup;
- adoption links, snapshots, and repairs retain canonical path identity;
- qualification is isolated from the user's central registry and validates
  publication safety before and after each run.

## Upgrade

```bash
npm install -g workspai@0.66.0
workspai --version
```

Expected output:

```text
0.66.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias is released at the matching `0.66.0` version.
- Existing version-one Workspace Intelligence, Model, Graph, Goal, MCP,
  repair, Skill, and agent-entry contracts remain supported.
- Project Graph references, Skill decisions, MCP structured responses, and
  evidence summaries are additive.
- Existing project-local agent host files remain supported and authored files
  are preserved during synchronization.
- No public command is removed.

## Breaking changes

None.
