# Goal Packs — Plain Language to Governed Work

`workspai goal` is the simple front door for an engineering outcome. It turns
one plain-language intent into a portable, versioned Goal Pack bound to the
current Workspace Model and proof-backed Knowledge Graph.

```bash
# Run inside an adopted project; scope defaults to that project.
npx workspai goal "Raise test coverage to at least 85%"

# Plan for the whole canonical workspace.
npx workspai goal "Prepare this workspace for release" --scope workspace

# Inspect the complete machine contract without writing artifacts.
npx workspai goal "Map the authentication architecture" --dry-run --json
```

The command plans work. It does **not** edit source, call a model, install an
agent plugin, approve a repair, or claim that the outcome is complete.

## What it produces

A successful plan atomically publishes four portable artifacts:

| Artifact | Purpose |
| --- | --- |
| `.workspai/goals/<goal-id>/goal-pack.json` | Canonical intent, scope, evidence bindings, policy, criteria, and orchestration state |
| `.workspai/goals/<goal-id>/agent-handoff.json` | Bounded consumer projection for `generic`, `claude`, or `codex` |
| `.workspai/goals/index.json` | Active-goal and lifecycle discovery authority for agents and IDEs |
| `.workspai/reports/goal-pack-last-run.json` | Latest Goal Pack for IDE, CI, and automation discovery |

Agents start from the index. They do not infer the active objective by walking
directories or treating the newest timestamp as authority.

```bash
workspai goal --status --json
workspai goal --list --json
workspai goal --activate <goal-id> --json
workspai goal --cancel <goal-id> --json
```

The files contain logical workspace/project identity and relative artifact
paths. They do not copy the machine-local workspace root, linked-project path,
credentials, raw model responses, or unrestricted command output.

## Scope resolution

- From an adopted or linked project, the default scope is that exact project.
- From a workspace root, the default scope is all registered projects.
- `--scope project:<name>` selects one project explicitly.
- `--scope workspace` selects the complete canonical workspace explicitly.
- `--workspace <path>` is available for automation that cannot rely on the
  current directory.

An unadopted directory is rejected. `goal` never silently creates or selects a
different workspace.

## Evidence and freshness

Goal planning requires a persisted canonical Model and a Graph whose
`source.hash` still matches that Model. Missing or mismatched evidence fails
closed with a renewal command. Use `--refresh` to run the complete Workspace
Intelligence chain before planning:

```bash
npx workspai goal "Fix the authentication regression" --refresh --json
```

The Goal Pack records both bindings and their exact hash semantics. The Model
uses its stable structural projection; Graph and Goal artifacts use canonical
JSON. A Goal fingerprint is an identity key and is never presented as a file
digest. Regenerating after either source binding
changes creates a different goal identity, preventing an agent from silently
executing a proposal against stale architecture.

## Honest preflight states

`ready-to-plan` means intent, scope, retrieval anchors, and required
measurement capability are available. It does not mean source changed or the
goal passed. `needs-evidence` means a measurable target is valid but its
machine-readable producer or baseline still needs setup. A native C/C++
project without instrumented LCOV, Cobertura, or LLVM output is therefore
reported as `needs-evidence`, never as ready.

Preflight also carries the current Workspace Intelligence status, blocked
stages, deterministic category queries, and bounded graph anchors.

## Relationship to verified goals

The two goal surfaces have different jobs:

| Surface | Job |
| --- | --- |
| `workspai goal "<intent>"` | Compile plain language, resolve scope, pin Model/Graph evidence, and prepare an agent handoff |
| `workspai workspace goal plan ...` | Create or resume one of the shipped deterministic success contracts: release readiness, dependency security, or test coverage |

When a plain-language intent maps exactly to one of those three measurable
contracts, the Goal Pack includes the correct `workspace goal plan` command.
For example, a coverage intent without a percentage becomes
`needs-confirmation`; Workspai does not invent a target.

For a supported deterministic contract, the lifecycle bridge is explicit:

```bash
workspai goal --prepare <goal-id> --json
workspai goal --verify <goal-id> --json
```

Preparation is refused while clarification or measurement evidence is
missing. Verification is refused until a CLI verified-goal contract is linked,
and only CLI evidence may transition the lifecycle to `verified`.

## Ownership and safety boundary

```text
User intent
  -> CLI: resolve Model, Graph, scope, policy, and success contract
  -> Agent: inspect bounded evidence and propose one focused source change
  -> Human: approve the immutable repair plan
  -> CLI Repair Engine: checkpoint, execute, reconcile, verify, keep or roll back
```

The agent handoff is a projection, not a second source of truth. Agent plugins,
IDE chat, MCP, and future independent packages may render or transport it, but
they cannot widen scope, grant network access, authorize mutation, mark a goal
verified, or replace CLI evidence.

Current Goal Packs use `proposal-only` mutation mode. Model-driven source
proposal execution is intentionally a later bridge through the existing
Repair Engine and, ultimately, the independent Decisions architecture.

## Options

```text
--workspace <path>      Explicit canonical workspace
--scope <scope>         workspace or project:<name>
--for-agent <consumer>  generic, claude, or codex (default: generic)
--max-attempts <count>  Bounded proposal budget, 1–25 (default: 5)
--refresh               Refresh Workspace Intelligence before planning
--dry-run               Validate and preview without writes
--status [goal-id]       Validate active or named Goal bindings
--list                   List registered Goal Packs
--activate <goal-id>     Select the active agent objective
--cancel <goal-id>       Cancel without deleting evidence
--prepare <goal-id>      Link a deterministic verification contract
--verify <goal-id>       Run CLI-owned verification
--no-run                 Read verification evidence without executing producers
--json                  Machine-readable result
```

Schemas:

- [`goal-pack.v1.json`](../contracts/workspace-intelligence/goal-pack.v1.json)
- [`goal-agent-handoff.v1.json`](../contracts/workspace-intelligence/goal-agent-handoff.v1.json)
- [`goal-plan-result.v1.json`](../contracts/workspace-intelligence/goal-plan-result.v1.json)
- [`goal-index.v1.json`](../contracts/workspace-intelligence/goal-index.v1.json)
- [`goal-lifecycle-result.v1.json`](../contracts/workspace-intelligence/goal-lifecycle-result.v1.json)

Every lifecycle operation uses the same `workspai.goal-lifecycle-result.v1`
success envelope. Failures use the shared CLI operation result with an
operation-specific code such as `goal.prepare.failed`; consumers never parse
terminal prose or infer a lifecycle state from directories.
