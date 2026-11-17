<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Clearer project context and safer change verification",
  "summary": "Workspai CLI 0.81.1 gives agents explicit project context and makes scoped change verification reject stale evidence and out-of-project effects.",
  "highlights": [
    { "icon": "📍", "text": "Run lifecycle checks from the manifest-backed project directory" },
    { "icon": "🧭", "text": "Resolve workspace evidence from the canonical workspace root" },
    { "icon": "🛡️", "text": "Bind project verification to current effect receipts and canonical project paths" }
  ]
}
-->

# Workspai CLI v0.81.1

Released November 17, 2026. **Publication status: Published November 17, 2026.**
Package metadata is aligned to `0.81.1`. Cross-platform qualification has not
been claimed.

## Clearer execution context for agents

Re-adoption also recovers from deletion of the entire managed central workspace.
An intact link to the configured default is validated before the CLI creates a
fresh workspace, replaces its stale discovery registration and adopts the
requested project. Dry-run reports creation without writing, while failure
restores the source metadata and registry and removes the newly created
workspace. Modified links, occupied/unmarked paths, and custom destinations do
not trigger automatic recreation. Ordinary read commands keep rejecting stale
membership. Deleted goals, history and other project memberships require their
own recovery or re-adoption; this operation does not claim to restore them.

Canonical evidence reads now preserve `EACCES` and `EPERM` as permission
failures, including artifact lookup and membership checks. Task context emits
`graph.userAction.kind: request-filesystem-read` and asks for host read access
to the existing binding selected by the command or project link. After approval
the same command is retried, with all membership, integrity and freshness
checks intact. Recovery does not switch workspace, rewrite links or refresh
evidence to bypass denied access. Corrupt and missing artifacts remain separate
failures and do not invent a permission request.

A partial packet can contain usable Graph matches. Task context now explicitly
identifies completed retrieval and points agents to `graph.matches` and
`graph.proofs`; an IDE picker failure does not invalidate these results. Empty
results use `graph.retrieval.status: no-matches`. Saved-output examples show the
actual Graph fields. Advisory verification findings and unrelated Goal warnings
remain visible without directing local work into foreign Goal recovery or broad
workspace refresh.

Re-adoption now recovers an intact local link when its matching workspace is
valid but project registration is absent. It rejects identity collisions,
tampered links and invalid contracts; ordinary tools still require membership.
Current grounding is refreshed transactionally, preserving authored instructions.

Structural grounding freshness no longer inherits expired workspace Doctor,
Analyze or Readiness reports. Those facts retain their TTLs and produce a
separate bootstrap warning/degraded status, rather than blocking adoption.
Strict bootstrap remains nonzero for degraded evidence; stale structural facts,
Graph mismatches and changed live inputs remain blocking.

Project-scoped lifecycle runs validate canonical project Doctor evidence and
keep unrelated workspace release readiness separate. Unscoped fleet gates are
preserved. Empty/ambiguous selectors, conflicting external registrations,
contradictory Doctor scope flags and differently bound health evidence are
rejected before source execution.

Scoped Doctor warnings stay visible and make strict runs exit nonzero. A
standalone Node manifest proving no dependency requirements no longer needs an
empty `node_modules` tree; workspace roots, agent owners and malformed groups
retain conservative checks. Blocked health verdicts cannot pass a project gate.

Task packets provide one compact project Skill from their lifecycle manifests;
routine work no longer needs the workspace Skill catalog. Project host entries
exclude Skills proven to belong only to other projects. Python setup includes
declared validation extras when supported manifest declarations prove their
pytest dependency. Discovery does not assert an installed test environment.
Task continuation retains warnings about an unrelated active Goal without
directing the agent into that other project's Goal details or repair routes.

Graph retrieval preserves Unicode identifiers, reduces workflow-word dominance
in long task queries and supplies explicit no-match recovery. Proof ownership
normalizes path traversal, and bounded test-discovery diagnostics identify their
owning project. Results remain lexical candidates, not semantic or executed-test
proofs; incomplete indexes retain their coverage limits and native-search fallback.

Task entry refuses an unverified umbrella working directory before scanning
descendant projects. Missing source selectors and nested Git/Workspai boundaries
return `project-selection-required` with recovery instead of parent evidence.
Explicit native projects and ordinary monorepo packages remain supported.
Generated gates always bind `--project` and require a scope comparison before
using evidence. Boundary validation does not claim that a host supplied the
gate or that a model followed it.

Task context now reports how the selected project resolved its canonical
workspace: marked parent, validated project link, reverse registry, unmanaged
or blocked. A blocked parent/link resolution does not silently fall through to
another workspace. It identifies the central managed default with
a boolean while keeping the absolute path machine-local. Stale links and
ambiguous membership are no longer mislabeled as unmanaged projects, so an
agent is not prompted to adopt a project whose workspace binding needs repair.
The existing binding field also reports `resolution-blocked`, preventing older
context consumers from treating stale ownership as an unmanaged project.

When a project-scoped Graph is unavailable because its canonical workspace
cannot be resolved from the current host context, task context now returns a
structured `graph.userAction`. If Graph evidence matters, the agent can ask the
user once, then retry against the managed central workspace with
`--workspace-default` or an exact user-provided canonical root with
`--workspace`. The CLI validates exact project membership before reading the
Graph, does not modify project links or refresh workspace evidence, and keeps
local workspace paths out of portable output. Declining or failing to resolve
access leaves native project work available. The CLI does not grant host-level
filesystem permissions; those remain controlled by the active host.

Task instructions now distinguish project operations from workspace-wide
operations. A completed bounded Graph query in task context is reused; a
separate query is only for additional evidence. Host Graph picker
failures, unavailable snapshots and filesystem permission failures are reported
as different evidence limitations. Missing Graph data is not treated as proof
that source is absent, and workspace-wide intelligence refresh is conditional
on the task needing it and the broader refresh being authorized. Entry readiness
continues to report host loading and model compliance as unobserved.

Budget refusals provide structured executable/argv recovery with the original
task, host and project preserved. Canonical and nested selection retries rebase
their paths; missing inputs are requested explicitly. `--limit` counts Graph
matches, while `--max-bytes` controls bytes. No shell command is assembled from
user task text. Consumers must handle both selection and budget refusals before
reading task components; `--strict` exits two for either refusal.

Task context now describes where commands must run and how to resolve project
and workspace evidence. This addresses a common source of failed retries when
an IDE reads files from a project but leaves its terminal in another directory.

- Add a project-relative `cwd` to each manifest-derived lifecycle stage.
- State that reading a source file does not change terminal working directory;
  generated entry tells the agent to run from the selected project root or pass
  the verified path with `--project`.
- Add optional execution metadata to task context. It identifies the canonical
  workspace root and the supported `workspai project workspace status --json`
  lookup, whose `workspacePath` value anchors `workspace:` locators.
- Explain that workspace evidence paths do not live under the source project's
  `.workspai` directory and that one resolver result can be reused while the
  selected project and workspace remain the same.
- Clarify package-script arguments, command-scoped Git settings for temporary
  test repositories, and when checked-in generated artifacts need regeneration.

## Compact, verifiable host entry

Project entry now uses a compact shared policy and a native Copilot gate in
`.github/copilot-instructions.md`; detailed execution rules remain in task
context. The native gate runs independently and reuses a current packet if
another entry file already requested it. Managed refresh and removal preserve
authored content, including whitespace and line endings; tracked deletions,
unsafe symlinks and ambiguous marker state remain protected.

Entry manifests bind owned instruction blocks and imported dependencies.
Bootstrap detects changed or removed gates even when their files still exist,
while unrelated authored text remains editable. Legacy unbound entries remain
readable with degraded host coverage until refreshed. Artifact readiness does
not claim host activation: bootstrap reports host loading and model compliance
as unobserved, and task packets identify prepared delivery without claiming
that a particular session consumed it.

## Predictable bounded context for agent hosts

Agent context now keeps a valid `insufficient-budget` refusal in structured JSON
with a successful command exit by default, allowing IDE and agent hosts to read
the status and offer a larger-budget retry. Automation that needs a nonzero
refusal can opt into `--strict`. Generated guidance and the saved-output example
check the status before accessing grounding or Graph fields, and the published
CLI command inventory includes the new option. Proof-Carrying Change guidance
also clarifies that prediction belongs to a governed change and that strict
verification retains the workspace-wide readiness and freshness gate.

## Safer project-scoped change verification

Single-project Proof-Carrying Changes can use the focused project gate when all
effects are explicitly bounded to the registered project. Both verification
gates first validate the latest recorded state of each logical/canonical file.
Invalid digests or deletion tombstones block the change directly. Repeated
edits, deletion, and recreation preserve the full ledger while verifying the
latest state, including overlapping artifact aliases.

Project containment uses canonical filesystem roots for local and adopted
projects, including workspace path aliases. Traversal and escaping symlinks use
the full workspace gate. Both gates keep the latest successful effect's
freshness boundary: runtime checks must actually start after the effect, and
reused or plan-only results cannot seal a change. Project/stage history retains
timing and execution mode. Required project and transitive-dependent checks stay
in the plan even when there is no structural Model diff.

Capsules expose current effect and verification references; validation derives
them independently from the ledger and checks its effect head. This supports
successful verification retries and legacy v1 histories without treating omitted
effect entries as proof. Goal Pack verification semantics use a new kernel
revision, preventing old and new immutable Goal contracts from sharing an ID.

Workspace-scoped changes and strict verification continue to use the full
workspace gate.

## Consistent project identity across filesystem aliases

Workspace discovery now deduplicates project roots by physical filesystem
identity while retaining the registered project metadata. Graph freshness
fingerprints canonicalize workspace and project roots before excluding project
files from workspace scope, so equivalent path spellings do not create false
stale evidence. Git-root project selection uses the same canonical identity
comparison on Windows. These changes preserve content and membership checks;
they only make equivalent paths resolve consistently. Cross-platform CI must
still pass before claiming matrix qualification.

## Compatibility and scope

The task context and lifecycle additions are optional in their v1 schemas, and
the full Graph and bootstrap views keep their existing defaults. These changes
guide external agents; they do not grant host permissions or guarantee that a
model follows the guidance. The independent Graph package and framework
qualification statuses are unchanged.

## Install or upgrade

```bash
npm install -g workspai@0.81.1
workspai --version
```

The optional `wspai` alias uses the matching `0.81.1` version.

## Release qualification

Latest local qualification on Linux with Node 24.20.0 completed November 17,
2026:

- Full CLI suite: **3,306 passed**, **12 skipped**, **0 failed** across 280 files
  (276 passed, 4 skipped).
- Permanent regression cases cover compiler identity, host entry, scoped
  lifecycle gates, Graph retrieval, Skill applicability and
  governed verification, including instruction preservation, discovery bindings,
  explicit project selection, structured argv recovery, receipt integrity, sequential edits,
  deletion/recreation, stale and reused runtime evidence, canonical project
  boundaries, adopted sources, capsule replay, recovery, and domain admission.
  Access regressions cover denied artifact lookup/reads, live input validation,
  safe retries through the original binding, tampered-link rejection before
  remote reads, and usable Graph results in advisory task packets. Adoption
  regressions cover deleted central workspace recovery, read-only preview,
  path aliases, rejected modified bindings and occupied/custom destinations,
  registry cleanup and transactional failure rollback.
- Build, TypeScript typecheck, lint and formatting passed.
- Generated/shared contract parity, contract synchronization, agent
  customization drift, documentation drift, Markdown links, and release-note
  and announcement contracts passed.

Current guides now use task context after adoption, describe scoped runtime
gates separately from fleet readiness, and document inline Skills, Graph
recovery and explicit project selection. The READMEs keep the product slogans
while presenting create/adopt paths and a compact static overview. No universal
token reduction, runtime speed or model-compliance guarantee is claimed.

Cross-platform qualification has not been claimed.
