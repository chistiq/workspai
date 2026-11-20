<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Focused agent actions from discovery through verification",
  "summary": "Workspai CLI 0.82.0 gives coding agents a compact project route, manifest-backed test selection, and verification tied to current evidence.",
  "highlights": [
    { "icon": "🧭", "text": "Get up to three scoped actions with agent context --view route" },
    { "icon": "🔎", "text": "Follow fresh Graph evidence to shared code and select the right test owner" },
    { "icon": "🛡️", "text": "Verify project changes against current files and checks executed after the last effect" }
  ]
}
-->

# Workspai CLI v0.82.0

Target release date: November 19, 2026. Publication status: pending.

This release contains all CLI changes since v0.81.0. Package metadata for
`workspai` and the `wspai` alias is aligned to `0.82.0`.

## A smaller first call for coding agents

```bash
workspai agent context --task "Fix the storage size display and run its focused test" \
  --project . --view route
```

Run from the selected project root or pass its verified path. The versioned
route returns up to three scoped actions for source discovery, Graph access
when needed, and suggested verification. It carries exact UTF-8 byte accounting
and structured recovery for project-selection and budget refusals. Existing
automation can continue to use the full response, which remains the default.

New and refreshed project instructions prefer the route, including the native
Copilot entry in `.github/copilot-instructions.md`. If the relevant test file
is already known, include its project-relative path with `--path` and reuse
the applicable test action. Entry manifests bind the managed instruction blocks
and their imported dependencies. Refresh preserves authored content and
protected paths. Bootstrap reports host loading and model compliance as
unobserved.

## Keep discovery and verification in the selected project

- Scope reports the actual workspace resolution, including a marked parent,
  validated project link, or reverse registry. It identifies the centrally
  managed default without embedding machine-local paths. Stale or ambiguous
  bindings remain blocked. An unverified parent directory, missing path, or
  nested project boundary produces an actionable project-selection result.
- The route carries a project-root anchor and explicit working directories.
  `project lifecycle plan --strict` checks an existing path within that
  project and exits 2 for a refused plan. `agent context --strict` makes a
  selection or budget refusal nonzero for automation.
- Verification suggestions come from manifests. Focused Node or Bun
  scripts may be selected for a known test file. In a supported locked uv
  workspace, the route distinguishes the affected member manifest from the
  test owner, proposes a root-owned check with `--no-sync`, and exposes
  locked setup separately. Runner and setup requirements remain visible.
- Task context provides a compact project Skill and keeps unrelated Skills
  and Goal continuations out of the local task. Applicable warnings stay
  visible. Python lifecycle setup can include a manifest-declared validation
  extra when it provides pytest.

See the [agent entry guide](../docs/agent-entry.md) and
[command reference](../docs/commands-reference.md).

## Graph retrieval and access

- Scoped retrieval handles Unicode identifiers and prioritizes the subject
  of long task requests. Fresh, corroborated import, call, and test evidence
  can improve file recommendations. Local TypeScript and JavaScript compiler
  aliases help connect callers to shared code.
- A partial context packet can contain usable results. A completed
  `no-matches` result has a native-search fallback. Scope, freshness, and
  source containment are verified before recommending Graph file paths.
- For denied filesystem reads, the CLI identifies the existing binding and
  presents a host read-access request. When the canonical workspace itself
  needs selection, the agent can ask the user once and retry against the
  configured central workspace or an exact approved root. The retry validates
  project membership and is read-only.
- Graph evidence expansion is revision- and project-bound. Refreshing workspace
  intelligence is a separate workspace-scoped operation when the task needs it.
- Source extraction continues for readable projects when an unrelated
  registered checkout is missing. Offline scaffolding can finish portable
  grounding even when the workspace contains that missing registration.

See [Workspace Knowledge Graph](../docs/workspace-knowledge-graph.md).

## Adoption recovery and scoped runtime checks

- Explicit re-adoption can repair a missing registration from an intact local
  link. When the configured managed central workspace was deleted, it can be
  recreated and the selected project registered in place. Dry-run previews
  the operation. Failed sealing rolls back the workspace, project metadata,
  and registry changes. Custom paths, conflicting membership, and invalid
  links remain blocked. Recovery covers the requested membership and generated
  evidence. Previously deleted history, Goals, and other memberships require
  separate recovery.
- Structural Model and Graph freshness is evaluated separately from expired
  Doctor, Analyze, and Readiness reports. Stale advisory results remain visible
  to bootstrap consumers and strict checks.
- Project-scoped runs use canonical project Doctor evidence. Strict runs
  retain scoped warnings and reject blocked health results. Dependency-free
  standalone Node projects can pass the dependency check without a
  `node_modules` directory when the manifest proves that no dependencies
  are required.
- Canonical filesystem identity reduces duplicate project discovery and false
  staleness across path aliases. Git roots and verified Goal paths are compared
  consistently across supported path spellings.

See [workspace operations](../docs/workspace-operations.md) and
[Workspace Doctor](../docs/doctor-command.md).

## Proof-Carrying Change and Goal integrity

Eligible single-project changes use scoped verification that includes required
transitive dependents. Workspace-wide effects and strict verification continue
through the full workspace gate. Canonical containment checks cover traversal,
symlink escapes, and adopted sources.

Both gates check the latest observed file state, including digests and deletion
tombstones, before evaluating runtime evidence. Checks must start after the latest
effect. Reused and plan-only results stay ineligible for sealing. Capsules retain
effect history and validate their current projections against the ledger. A new
Goal Pack kernel revision separates Goal IDs whose verification contracts differ.

See [Proof-Carrying Change](../docs/proof-carrying-change.md) and
[Goal Packs](../docs/goal-packs.md).

## Install or upgrade

After publication, install the matching CLI and optional alias versions.

```bash
npm install -g workspai@0.82.0
workspai --version
```

Install `wspai@0.82.0` if you prefer the shorter command. Refresh adopted project
grounding to pick up the updated entry instructions. The compact route is an
opt-in CLI response. The full task context, Graph, and bootstrap views remain
available for existing consumers.

## Release qualification

Local verification on Linux with Node 24.20.0 passed:

- Full CLI suite with CLI-to-extension contract parity, 3,314 passed and
  12 skipped across 280 test files.
- Production build, typecheck, lint, formatting, shared contracts, and
  documentation and release-note checks.
- Enterprise package smoke, including FastAPI and NestJS offline scaffolding,
  and the `wspai` alias smoke. Both package dry-runs reported `0.82.0`.
- npm dependency audit with zero reported vulnerabilities.

Publication uses the gated release workflow for the exact target commit.
See [CI and release workflows](../docs/ci-workflows.md) for the required
cross-platform and security gates.
