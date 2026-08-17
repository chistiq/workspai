# Goal Packs — Plain Language to Governed Work

`workspai goal` is the simple front door for an engineering outcome. It turns
one plain-language intent into a portable, versioned Goal Pack bound to the
current Workspace Model and proof-backed Knowledge Graph.

```bash
# Run inside an adopted project; scope defaults to that project.
npx workspai goal "Raise test coverage to at least 85%"

# Goals are not limited to coverage or another built-in metric.
npx workspai goal "Add retry with exponential backoff for transient requests"
npx workspai goal "Refactor the authentication boundary"
npx workspai goal "Improve startup latency" --scope project:web
npx workspai goal "Document the release workflow"

# Plan for the whole canonical workspace.
npx workspai goal "Prepare this workspace for release" --scope workspace

# Inspect the complete machine contract without writing artifacts.
npx workspai goal "Map the authentication architecture" --dry-run --json
```

The command plans work. It does **not** edit source, call a model, install an
agent plugin, approve a repair, or claim that the outcome is complete.

Goal intent is open-ended within the engineering workspace. The category is a
retrieval and verification hint, not an allowlist. An objective that does not
match the local deterministic classifier is retained as a low-confidence
general Goal instead of being discarded; the original text remains the
authority. Genuine compound ambiguity, missing numeric coverage targets,
missing evidence, unsafe scope, or stale bindings still stop before mutation.

## What it produces

A successful plan atomically publishes four portable artifacts:

| Artifact                                       | Purpose                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `.workspai/goals/<goal-id>/goal-pack.json`     | Canonical intent, scope, evidence bindings, policy, criteria, and orchestration state |
| `.workspai/goals/<goal-id>/agent-handoff.json` | Bounded consumer projection for `generic`, `claude`, or `codex`                       |
| `.workspai/goals/index.json`                   | Active-goal and lifecycle discovery authority for agents and IDEs                     |
| `.workspai/reports/goal-pack-last-run.json`    | Latest Goal Pack for IDE, CI, and automation discovery                                |

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
JSON. The Graph binding also records its stable live-input fingerprint, so an
evidence-only rerun does not make an unchanged Goal stale merely because the
artifact timestamp changed. A Goal fingerprint is an identity key and is never
presented as a file digest.

The original source binding remains immutable. A later source state is accepted
only when it is sealed by a Goal-bound, approved, closed CLI Repair transaction
whose plan, proposal, checkpoint output, exact-target verification, canonical
Model, Graph, and closure receipt all still validate. Any unlinked edit,
post-closure edit, or unrelated workspace drift makes the Goal stale and
requires a new Goal Pack.

## Honest preflight states

`ready-to-plan` means intent, scope, at least one bounded retrieval anchor, and required
measurement capability are available. It does not mean source changed or the
goal passed. `needs-evidence` means a measurable target is valid but its
machine-readable producer or baseline still needs setup. A native C/C++
project without instrumented LCOV, Cobertura, or LLVM output is therefore
reported as `needs-evidence`, never as ready.

`blocked` means the CLI cannot provide bounded proof-backed retrieval for the
selected intent and scope. Workspai refuses to hand broad source inspection to
an agent until Workspace Intelligence is refreshed or the intent is clarified.

Only a `ready-to-plan` Goal may become the active objective automatically.
Planning a Goal that needs confirmation or evidence records it for review but
does not replace the current active Goal.

Preflight also carries the current Workspace Intelligence status, blocked
stages, objective-first retrieval queries, deterministic category recall, and
bounded graph anchors. The complete user objective receives the primary anchor
budget; generic category matches cannot crowd it out. When only structured
category evidence is available, retrieval is reported as `partial`, not falsely
as objective-grounded.

## Relationship to verified goals

The two goal surfaces have different jobs:

| Surface                            | Job                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `workspai goal "<intent>"`         | Compile plain language, resolve scope, pin Model/Graph evidence, and prepare an agent handoff                                 |
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
Only the selected `activeGoalId` may enter preparation or verification. A
completed verified goal clears the active selection. `--list` and `--cancel`
remain available when an old Goal is stale, so operators can recover safely;
`--status`, `--activate`, `--prepare`, and `--verify` require current bindings.

The immutable Goal Pack also owns the execution-cycle budget. Every repair
proposal is linked in the Goal index and every verification attempt is recorded
in the verified-goal status artifact. Proposal planning and verification are
serialized independently, refuse to exceed `executionPolicy.maxAttempts`, and
remain bounded even when concurrent IDE or agent requests race. Consumers must
restore both durable counters and use the greater value as the current cycle;
they cannot reset a local retry counter. If the baseline already satisfies the
criteria, the consumer should call the verifier immediately and avoid an
unnecessary source change.

Every other Goal is still executable through a compatible consumer, but its
semantic outcome is not falsely presented as machine-verifiable. The consumer
must assess the final diff or answer against the complete immutable objective,
while the CLI independently owns scope, repair transactions, build/test/audit
checks, canonical workspace verification, rollback, and the attempt budget.
Such a result is evidence-reviewed; only the three exact producer contracts may
use the lifecycle claim `verified`. Its `workspace-verify` success criterion and
final orchestration step explicitly describe safety and evidence freshness; they
never describe that signal as proof of an arbitrary semantic outcome.

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

Current Goal Packs use `proposal-only` mutation mode: the CLI command itself
does not invoke a model or mutate source. A compatible IDE or agent consumer
may execute an inspected proposal only by submitting it to the existing CLI
Repair Engine, binding the transaction to the active Goal fingerprint, and
calling the exact Goal verifier after the transaction closes. A closed repair,
generic test pass, or consumer message cannot mark the Goal verified. This
boundary is designed to remain compatible with the independent Decisions
architecture.

Goal consumers must also preserve metric integrity. The Workspai extension does
not expose file deletion to deterministic verified Goals. Its test-coverage
Goal may write only test-owned source, fixtures, or snapshots; a general Goal
may create, replace, or delete only inspected source through an approved,
rollback-protected CLI Repair transaction. This prevents a model from reaching
a numeric coverage target by shrinking or redefining the measured surface
without crippling legitimate goals such as removing a deprecated module.

## Options

```text
--workspace <path>      Explicit canonical workspace
--scope <scope>         workspace or project:<name>
--for-agent <consumer>  generic, claude, or codex (default: generic)
--max-attempts <count>  Bounded execution-cycle budget, 1–25 (default: 5)
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

Choose exactly one lifecycle option. Lifecycle options cannot be combined with
an intent, `--scope`, `--refresh`, or `--dry-run`; `--no-run` applies only to
`--verify`. Invalid combinations fail before workspace resolution or writes.

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
