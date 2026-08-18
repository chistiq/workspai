<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Governed Goals for real multi-project workspaces",
  "summary": "Workspai 0.60.0 gives agents and developers deterministic Goal scope, canonical runtime binding, and self-consistent evidence refresh across projects and polyglot workspaces.",
  "highlights": [
    {
      "icon": "🎯",
      "text": "Goals now bind automatically to an invoked project or request an explicit project, project set, or workspace scope"
    },
    {
      "icon": "🧩",
      "text": "Coverage runtime choices come from the canonical Workspace Model and must cover every selected project"
    },
    {
      "icon": "🛡️",
      "text": "Mixed-runtime scopes fail closed instead of silently omitting projects from verification"
    },
    {
      "icon": "🔄",
      "text": "Managed Workspai outputs no longer invalidate their own freshly generated Graph evidence"
    }
  ]
}
-->

# Workspai CLI v0.60.0

Released August 18, 2026.

## Governed Goals for Real Multi-Project Workspaces

Workspai 0.60.0 makes a plain-language Goal dependable in the places where
software work actually happens: inside an adopted project, at the root of a
multi-project workspace, and across polyglot project sets.

The CLI now resolves scope before an agent acts, reuses runtime identity from
the canonical Workspace Model, and carries those bindings through Goal packs,
agent handoffs, deterministic verification, repair transactions, and renewal.

## Scope follows where the Goal is defined

When a Goal is created inside an adopted project, Workspai binds it to that
project automatically. At a single-project workspace root, the only registered
project is selected without adding a prompt. At a multi-project root, an
interactive user can choose one project, multiple projects, or the whole
workspace.

Automation remains deterministic:

```bash
workspai goal "Improve API reliability" --scope project:api --json
workspai goal "Map service dependencies" --scope projects:api,web --json
workspai goal "Review release readiness" --scope workspace --json
```

JSON, CI, and agent consumers never receive an interactive prompt. When scope
is unresolved they receive a machine-readable `needs-confirmation` result with
canonical project choices.

## Coverage Goals use canonical runtime identity

Workspai does not introduce a second runtime detector for Goals. Runtime
choices are taken from the selected projects in the canonical Workspace Model.

For one polyglot project, users or automation can bind the intended coverage
surface explicitly:

```bash
workspai goal "Raise test coverage to 85%" --scope project:grpc --runtime cpp --json
```

For a project set, Workspai exposes only runtimes present in every selected
project. If the projects do not share a canonical coverage runtime, the Goal
requires runtime-compatible scopes. This prevents a single runtime choice from
silently dropping other selected projects from measurement or verification.

The selected runtime is retained in the immutable Goal identity, measurement
preflight, generated verified-goal command, baseline, renewal command, and
every subsequent verification attempt.

## Goal lifecycle and Repair boundaries stay aligned

The new `project-set` scope is supported across:

- Goal Pack, index, lifecycle-result, and agent-handoff contracts
- verified-goal planning and deterministic verification
- Repair Engine project-boundary enforcement
- project agent-entry recovery and Goal renewal
- VS Code native scope and runtime Quick Picks

Repair proposals must identify a project inside the selected Goal set. Scope
expansion remains a decision boundary, and a source mutation cannot claim Goal
success without fresh CLI-owned verification.

## Evidence refresh no longer invalidates itself

Real-workspace qualification found that Git-backed fingerprints included the
complete repository diff even though graph providers intentionally excluded
managed `.workspai` output directories. Agent grounding could therefore update
a managed report after graph generation and immediately make the new graph
appear stale.

The Git fingerprint now follows the same bounded inventory as graph providers.
Source, manifest, contract, and relevant documentation changes still
invalidate evidence. Managed report and grounding refreshes do not invalidate
their own Model/Graph pair.

## Consumer contracts

The canonical Goal schemas and runtime command inventory are synchronized with
the VS Code extension consumer. The additive measurement `runtimeChoices`
field gives interfaces a structured source for valid runtime selection instead
of parsing human-readable guidance.

Existing Goal artifacts remain readable because the new field is optional for
older persisted packs and emitted by new producers.

## Validation

The release was qualified against:

- a four-project Python, .NET, Go, and Node workspace
- a central workspace containing FastAPI, Next.js, and the polyglot gRPC repo
- project, project-set, and workspace-wide Goals
- interactive, JSON, CI, and agent planning behavior
- single-runtime, shared-runtime, mixed-runtime, and invalid-runtime coverage
- stale Graph detection and explicit `--refresh` recovery
- CLI and VS Code contract parity, privacy checks, and full test suites

## Upgrade

```bash
npm install -g workspai@0.60.0
workspai --version
```

Expected output:

```text
0.60.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias is published at the matching `0.60.0` version.
- Existing single-project Goal commands remain valid.
- New schema values and `runtimeChoices` are additive.
- No public command or artifact contract is removed.

## Breaking changes

None.
