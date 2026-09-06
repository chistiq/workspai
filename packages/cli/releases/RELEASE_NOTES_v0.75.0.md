<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Governed agent frameworks inside the Workspai loop",
  "summary": "Workspai 0.75.0 adds release-admitted Microsoft Agent Framework projects for Python and .NET without bypassing workspace intelligence, authorization, or verification.",
  "highlights": [
    {
      "icon": "🤖",
      "text": "Create governed Microsoft Agent Framework projects for Python and .NET"
    },
    {
      "icon": "🔐",
      "text": "Framework changes pass through scoped Goals, authorization, ownership, effects, and PCC evidence"
    },
    {
      "icon": "🧪",
      "text": "Release admission binds exact versions to a six-lane Linux, macOS, and Windows conformance matrix"
    },
    {
      "icon": "🔄",
      "text": "Automated upstream discovery proposes version updates without silently promoting unverified releases"
    },
    {
      "icon": "🧾",
      "text": "Byte-accurate PCC baselines and actionable lifecycle diagnostics keep verification truthful"
    }
  ]
}
-->

# Workspai CLI v0.75.0

Released September 6, 2026.

**Publication status:** Published.

## Governed Agent Framework Workspaces

Workspai 0.75.0 makes agent-framework projects first-class Workspace citizens.
The initial admitted integration targets Microsoft Agent Framework for Python
and .NET, while the contract and adapter boundary remain framework-neutral for
future runtimes.

An agent project does not bypass Workspai merely because its framework can run
agents independently. Creation and attachment remain connected to canonical
Workspace identity, Model and Graph evidence, scoped Goals, authorization,
managed-file ownership, Proof-Carrying Change, Doctor, Analyze, lifecycle
execution, and verification.

## Agent projects through the normal Create experience

- `workspai create` groups the growing kit catalog by Backend, Frontend,
  Desktop, Extension, AI Agent, and future Gaming categories.
- Microsoft Agent Framework Python and .NET kits are selectable only when their
  shipped adapter version has a valid release-admission receipt.
- Generated projects contain a credentialless context boundary, deterministic
  tests, explicit environment-name examples, and one authoritative runtime
  manifest.
- Project creation does not install dependencies, request credentials, or call
  a model implicitly.
- Existing target directories are rejected before delegation or generation, so
  user files are preserved and internal engine tracebacks do not leak into the
  CLI experience.

## Governed framework lifecycle

- `agent framework list` exposes only supported, admitted integrations.
- `agent framework plan` resolves the adapter and produces a deterministic,
  non-mutating plan.
- `agent framework attach` binds the requested integration to a scoped Goal and
  hash-bound architecture prediction.
- `agent framework apply` writes only after explicit filesystem authorization
  and records managed ownership and typed effect receipts.
- Idempotent refreshes respect user-owned files and cannot silently overwrite a
  path whose ownership or digest no longer matches.
- Secret values remain outside generated artifacts; only environment variable
  names and credential boundaries are modeled.

## Release-admitted versions

- Adapter manifests declare exact framework and runtime capabilities instead
  of resolving an unverified `latest` release at project-creation time.
- Microsoft Agent Framework Python and .NET admission is bound to reproducible
  runtime baselines and conformance evidence on Linux, macOS, and Windows.
- Conformance verifies compile/import behavior plus a deterministic,
  credentialless context-to-agent-to-response lifecycle.
- A scheduled discovery workflow checks PyPI and NuGet for newer upstream
  versions and prepares a review-only update candidate.
- Discovery cannot update the admitted baseline by itself. Promotion requires
  the complete matrix and a digest-bound admission receipt.
- Python and .NET release lanes remain independent so one ecosystem cannot
  silently promote or block the other through shared version assumptions.

## Model, Doctor, Analyze, and lifecycle truth

- Agent projects retain their authored `agent` category, framework identity,
  application archetype, and nested runtime boundaries across Model, Analyze,
  Doctor, Graph, and consumer output.
- Python projects use the platform Python 3 launcher, deterministic compilation,
  and standard-library `unittest` unless authored pytest ownership is observed.
- .NET projects expose production and test projects as separate lifecycle units
  rather than collapsing them into a root placeholder.
- Test capability is not claimed without an observable test surface.
- Missing virtual environments, restores, toolchains, and dependencies remain
  explicit readiness blockers instead of false success.
- Independent manifests using the same runtime execute independently and are
  not collapsed into a single command.

## More reliable Proof-Carrying Change

- PCC stores a private, digest-bound byte inventory for physical baseline
  artifacts without rewriting the canonical Graph or changing provider
  semantics.
- A provider, entity, or relation appearing or disappearing no longer makes an
  unchanged source file look mutated.
- Real file additions, byte edits, and deletions still require matching typed
  effect receipts and remain fail-closed when unexplained.
- Concurrent changes outside a project-scoped transaction are excluded from
  that transaction's receipt coverage while shared or explicitly receipted
  artifacts remain governed.
- Verification receipts remain bound to the immutable per-change verification
  artifact rather than a mutable last-run pointer.

## Actionable execution failures

- Workspace Run keeps timeout and exit-code behavior intact across nested
  package-manager processes.
- External resource and network-fetch failures are classified as dependency
  failures when native output is available.
- Failure excerpts retain the strongest actionable line instead of only the
  trailing package-manager verbose footer.
- If an interactive tool emits no capturable output, the report provides the
  exact native package-manager command and project path required to reproduce
  the failure.
- Broad `failed` patterns can classify test output but no longer relabel build,
  init, or start failures as test failures.

## Compatibility

- Existing version-one Model, Graph, Goal, Decisions, PCC, Live, MCP, Repair,
  Doctor, Snapshot, and agent contracts remain supported.
- Agent Framework contracts and commands are additive.
- Existing projects and official third-party kits are not rewritten or patched.
- No public command, flag, schema version, or canonical artifact path is
  removed.
- PCC Changes created before byte inventories existed retain their original
  immutable baseline and conservative fail-closed semantics.

## Qualification evidence

- The complete CLI suite passed with 250 test files passing and 4 skipped;
  2,889 tests passed and 8 were skipped.
- Focused Agent Framework, PCC, lifecycle, runtime-adapter, and command-surface
  regression suites passed.
- TypeScript build, declaration generation, lint, English-text validation, and
  whitespace validation passed.
- A generated five-project polyglot Workspace correctly modeled Microsoft Agent
  Framework Python and .NET, FastAPI, ASP.NET Core, and Next.js projects.
- Python agent build and tests executed successfully; unavailable .NET and
  Python dependencies remained Doctor/readiness blockers rather than being
  executed unsafely.
- A separate empty central Workspace remained blocked in strict mode with a
  clear instruction to add its first project.
- Shared registry reconciliation removed two stale project entries and matched
  the five-project canonical Workspace contract.

## Install

```bash
npm install -g workspai@0.75.0
workspai --version
```

The optional `wspai` alias is released at the matching `0.75.0` version.
