# Unified Workspace Intelligence Runner

Use one command when you want the latest answer to these questions:

- What projects and relationships exist now?
- What changed, and what may be affected?
- Is the workspace healthy and ready?
- What should developers, CI, IDEs, and AI tools read?

Run it from a Workspai workspace root:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

`generic` is the vendor-neutral context surface. Replace it with `codex`,
`claude`, `cursor`, or `orca` for agent-specific context. The `agent-sync`
stage also publishes shared grounding for GitHub Copilot, VS Code, and
`AGENTS.md` consumers.

Workspai runs the required steps in a fixed order and saves one final report.
The technical contract writes that report atomically to
`.workspai/reports/workspace-intelligence-run-last-run.json` with schema
`workspace-intelligence-run.v1`. JSON stdout returns the same report payload.
Consumers should read the persisted report when they need durable evidence and
use the process exit code for the immediate automation verdict.

## Execution envelope and canonical chain

The runner separates prerequisite operations from the versioned intelligence
chain. `sync` and baseline handling are reported in `preflight`; they are not
additional chain stages.

```text
Execution order

sync
  -> model
  -> baseline resolution
  -> diff
  -> impact
  -> doctor-evidence
  -> contract-evidence
  -> analyze-evidence
  -> readiness-evidence
  -> verify
  -> context
  -> agent-sync
  -> explain
```

The report always contains exactly two ordered `preflight` entries:

| ID         | Execution point              | Successful result     | Purpose                                            |
| ---------- | ---------------------------- | --------------------- | -------------------------------------------------- |
| `sync`     | Before `model`               | `synchronized`        | Reconcile workspace inventory and contract inputs. |
| `baseline` | After `model`, before `diff` | `created` or `reused` | Ensure Diff has an explicit structural baseline.   |

The report always contains exactly these 11 ordered `stages`:

| Order | Stage                | Contract role                                           |
| ----: | -------------------- | ------------------------------------------------------- |
|     1 | `model`              | Build and persist the current workspace model.          |
|     2 | `diff`               | Compare the current model with the selected baseline.   |
|     3 | `impact`             | Calculate affected projects and transitive consequence. |
|     4 | `doctor-evidence`    | Refresh workspace and project health evidence.          |
|     5 | `contract-evidence`  | Verify the workspace contract.                          |
|     6 | `analyze-evidence`   | Refresh structural and operational analysis.            |
|     7 | `readiness-evidence` | Refresh pre-verify release-readiness evidence.          |
|     8 | `verify`             | Produce the definitive evidence-backed gate.            |
|     9 | `context`            | Build agent context from the same current evidence.     |
|    10 | `agent-sync`         | Project canonical context into agent and IDE surfaces.  |
|    11 | `explain`            | Explain the resulting release posture and blockers.     |

The machine-readable authority is
[`workspace-intelligence-chain.v1.json`](../contracts/workspace-intelligence-chain.v1.json).
Commands, websites, IDEs, CI jobs, and agent instructions must not define a
different order or insert `sync` or `snapshot-baseline` into `stages`.

## Baseline semantics

On the first run, the runner creates
`.workspai/reports/workspace-model-snapshot.json` and reports:

```json
{
  "id": "baseline",
  "status": "passed",
  "result": "created"
}
```

On later runs, it reuses the existing snapshot and reports `result: "reused"`.
`baselineCreated` is `true` only when that run created the baseline.

The runner does not silently replace an existing baseline immediately before
Diff. Doing so would erase the change boundary and incorrectly report no
changes. Refresh or replace a baseline only through the explicit
`workspace snapshot` workflow after the intended structural state has been
accepted.

## Status and exit semantics

| Report status | Exit code | Meaning                                                                                        |
| ------------- | --------: | ---------------------------------------------------------------------------------------------- |
| `passed`      |       `0` | Every operation executed and no gate blocked the run.                                          |
| `failed`      |       `1` | A required operation threw or could not complete. Downstream stages are recorded as `skipped`. |
| `blocked`     |       `2` | Execution completed, but one or more evidence or verification gates rejected readiness.        |

The canonical mapping is `passed` → `0`, `failed` → `1`, and `blocked` → `2`.

A `blocked` evidence stage does not stop the chain. Context, grounding, and
Explain must still be refreshed so humans and agents receive the current
blocker evidence. A hard `failed` stage stops execution work and every
downstream canonical stage is recorded with `status: "skipped"`, `exitCode: 0`,
and `durationMs: 0`.

Stage invariants:

- `passed` requires `exitCode: 0`;
- `blocked` requires a non-zero stage exit code;
- `failed` requires `exitCode: 1`;
- `skipped` requires `exitCode: 0` and `durationMs: 0`;
- report status and exit code are derived from all preflight and stage results;
- every stage artifact list must exactly match the runtime registry.

`--strict` promotes warning-grade readiness states such as Analyze
`needs-attention` and Readiness `warn` into blocked stage verdicts. It does not
turn evidence blockers into execution failures: the aggregate exit remains `2`,
not `1`.

## Report contract

The durable report contains:

```json
{
  "schemaVersion": "workspace-intelligence-run.v1",
  "chainSchemaVersion": "workspai-workspace-intelligence-chain-v1",
  "generatedAt": "2026-07-18T00:00:00.000Z",
  "workspacePath": "/absolute/machine-local/path",
  "baselineCreated": false,
  "preflight": [],
  "status": "blocked",
  "exitCode": 2,
  "stages": [],
  "artifactPath": ".workspai/reports/workspace-intelligence-run-last-run.json"
}
```

The abbreviated arrays above illustrate the envelope only; conforming reports
must contain exactly two preflight entries and 11 stages. The complete JSON
Schema is
[`workspace-intelligence-run.v1.json`](../contracts/workspace-intelligence/workspace-intelligence-run.v1.json).
Structural schema validation is necessary but not sufficient. Workspai also
enforces stage order, registered artifacts, baseline coherence, failure
propagation, and aggregate verdict semantics before writing the report.

`workspacePath` and some underlying evidence can contain machine-local absolute
paths. Do not treat the run report as a portable workspace identity contract or
publish it without applying the relevant redaction policy.

## CI consumption

The simplest hard gate is:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

Both exit `1` and exit `2` fail a normal CI step. If artifacts must be uploaded
after a blocked run, allow the runner step to continue, upload with `if: always()`,
then fail the job from the recorded step outcome. See
[`examples/ci-agent-grounding.yml`](./examples/ci-agent-grounding.yml).

Automation must distinguish:

- exit `1`: repair execution, environment, permissions, corruption, or another
  hard runtime failure;
- exit `2`: inspect Analyze, Readiness, Verify, and Explain evidence and resolve
  the reported blockers;
- exit `0`: consume the newly refreshed artifacts.

Do not parse terminal prose. Read `status`, `exitCode`, `preflight`, `stages`,
and their registered artifacts from the JSON report.

## Verified engineering goals

The intelligence runner answers what is true now. A verified goal adds the
durable definition of what must become true, so a person or agent can resume
work without changing the success criteria between attempts.

```bash
# Prepare the whole workspace for release.
npx workspai workspace goal plan release-readiness --json

# Remove blocking dependency vulnerabilities from one registered project.
npx workspai workspace goal plan dependency-security --scope project:api --json

# Raise one project's measured coverage to at least 75%.
npx workspai workspace goal plan test-coverage --scope project:web --target 75 --json

# Re-measure the goal against current source and evidence.
npx workspai workspace goal verify <goal-id> --json
```

Planning writes an immutable goal definition and its current status under
`.workspai/goals/<goal-id>/`. Verification also refreshes the canonical latest
verdict at `.workspai/reports/verified-goal-last-run.json`. Consumers must read
the JSON verdict; they must not infer success from an agent message or a source
edit alone.

The three shipped goal kinds have explicit completion rules:

| Goal kind             | Completion boundary                                                            |
| --------------------- | ------------------------------------------------------------------------------ |
| `release-readiness`   | Readiness passes and Workspace Verify reports ready.                            |
| `dependency-security` | A fresh audit reports zero blocking vulnerabilities and required checks pass.  |
| `test-coverage`       | Runtime-owned coverage reaches the selected percentage and required checks pass. |

Goals are workspace-scoped by default. Use `--scope project:<registered-name>`
when the requested outcome belongs to one project. Dependency goals preserve a
hash baseline for recognized manifests and lockfiles across supported
ecosystems. Breaking or force-based changes remain forbidden unless the goal
explicitly records `--allow-breaking` or `--allow-force`; changing a manifest
alone never satisfies the goal.

`--no-run` only reads current goal evidence. `--reuse-intelligence` may reuse a
just-completed canonical run, but it does not waive goal-specific measurement.
The goal schemas are
[`verified-goal.v1.json`](../contracts/workspace-intelligence/verified-goal.v1.json)
and
[`verified-goal-status.v1.json`](../contracts/workspace-intelligence/verified-goal-status.v1.json).

## Relationship to other commands

`workspace intelligence run` is the canonical Workspace Intelligence chain.
`pipeline` is a broader governance/release orchestrator and `autopilot release`
is a separate release surface. Neither command may replace, reorder, extend, or
silently partially execute the canonical intelligence chain.

Individual commands such as `workspace model`, `workspace diff`, and
`workspace verify` remain useful for inspection and targeted renewal. A partial
manual sequence must not be documented or treated as an equivalent replacement
for the unified runner.
