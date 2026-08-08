<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Exact-Target Repair and Complete Consumer Evidence",
  "summary": "Workspai now binds approval to the complete repair, resolves capabilities for the exact selected project, and publishes a final artifact index that agents can trust immediately.",
  "highlights": [
    {
      "icon": "🔐",
      "text": "Approval is invalidated before mutation when the selected repair semantics drift"
    },
    {
      "icon": "🎯",
      "text": "Project capability inspection resolves managed and externally linked targets exactly"
    },
    {
      "icon": "🐍",
      "text": "Python projects select Poetry, uv, or a local virtual environment with actionable launcher diagnostics"
    },
    {
      "icon": "🧾",
      "text": "The final report index includes Explain and the canonical run receipt from the completed run"
    }
  ]
}
-->

# Workspai CLI v0.55.0

Released August 7, 2026.

## Exact-Target Repair and Complete Consumer Evidence

Workspai 0.55.0 hardens the boundary between model-selected work and the
CLI-owned Repair Engine. Approval is tied to the full causal operation, runtime
capabilities are resolved for the exact selected project, and the final
Workspace Intelligence index reflects the complete run that consumers receive.

The governed lifecycle remains:

```text
plan → preconditions → approval → exact-target preflight → checkpoint → execute
     → reconcile → audit → test → build → exact producer → canonical verify
     → closed | rolled-back | decision-required
```

## Approval is semantic, not identifier-only

An action identifier is not enough to authorize mutation. Plans now bind
approval to the complete causal surface, including blocker, scope, risk,
command or typed operation, files, rollback posture and dependency transaction.

Before checkpoint and mutation, Workspai refreshes the exact producer registered
for the selected card and compares the current action semantics with the
approved plan. Approval expires without changing source when:

- the finding already disappeared;
- the selected action changed meaning;
- source or executable preconditions drifted;
- the current producer can no longer prove the requested repair.

The same target producer runs again after the bounded repair before aggregate
Workspace Intelligence verification. This prevents a stale card, a reused
action identifier or unrelated workspace evidence from silently authorizing a
different mutation.

## Capability inspection follows the requested project

`workspace repair capabilities --project <name>` now resolves the selected
registered project before detecting runtime adapters. The resolution supports:

- projects managed inside the workspace root;
- externally linked projects in the workspace registry;
- boundary-safe direct project paths;
- explicit unavailable or ambiguous project diagnostics.

The command no longer reports capabilities from the workspace root or an
unrelated first project. Studio, CI and other JSON consumers therefore receive
the adapter, executable preconditions and supported transaction kinds for the
project they actually selected.

## Python materialization follows the declared environment

Python dependency materialization uses the environment surface present in the
project:

- Poetry projects run through Poetry;
- `uv.lock` projects run through uv;
- requirements and standard `pyproject.toml` projects materialize a local
  `.venv` and use its interpreter for reconciliation and tests.

When no usable Python launcher exists, the bridge returns the canonical
`PYTHON_NOT_FOUND` diagnostic. It no longer leaks a raw
`--version exited with code undefined` process failure.

## Agent consumers receive the completed run

The Workspace Intelligence runner now republishes the governed report index
after Explain and the final run receipt are written. `INDEX.json` opened
immediately after completion therefore represents the final artifact state of
that run instead of the earlier Agent Sync projection.

The index remains contract-backed and fail-closed: required missing or invalid
artifacts are visible, while optional reports remain explicitly distinguished
from required evidence.

## Leaner release tooling and dependency posture

The unused big-library size preset was replaced with the file-only size plugin.
The CLI retains the same bundle gate without pulling the browser-time dependency
chain that was not used by Workspai's size policy.

Root overrides and the lockfile retain the audited dependency baseline. npm
audit reports zero known vulnerabilities for the release dependency graph.

## End-user and contract verification

The release source was exercised against a nine-project enterprise workspace
covering .NET, Node.js, Rust, Java, Go and Python across backend, frontend,
desktop and extension project kinds.

Verification included:

- project-targeted repair capability inspection for every registered project;
- Doctor workspace and per-project evidence;
- model, graph, contract, context, agent grounding, Explain and final index;
- deterministic graph rebuild and bounded natural-language retrieval;
- remediation planning and non-mutating repair plan lifecycle checks;
- DOT, Mermaid, JSON-LD, GraphML and GEXF graph exports;
- CLI command-surface, package, contract, documentation and generator gates.

All 2,328 CLI tests passed across 215 test files with 8 explicit environment
skips. Coverage reached 81.86%, the CLI stayed within its bundle budget, npm
audit reported zero known vulnerabilities, and type checking, linting,
formatting, runtime conformance, adversarial scenarios, package smoke and
documentation validation passed.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.55.0`.
- Existing v1 repair plans, proposals, transactions and Workspace Intelligence
  artifacts remain readable.
- New optional v1 fields preserve compatibility for durable transactions while
  current producers write the stronger target-aware evidence.
- Consumers should use published contracts and artifact paths rather than infer
  behavior from terminal prose or UI state.

## Upgrade

```bash
npm install -g workspai@0.55.0
workspai --version
workspai workspace repair capabilities --json
workspai workspace repair list --json
```

Optional short alias:

```bash
npm install -g wspai@0.55.0
wspai --version
```
