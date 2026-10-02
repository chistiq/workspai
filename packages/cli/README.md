# Workspai CLI

[![npm version](https://img.shields.io/npm/v/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![Downloads](https://img.shields.io/npm/dm/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?style=flat-square&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode)

## Give your AI agent the system, not just the repository

**Your coding agent should not have to rediscover your architecture every session.**

> One workspace. One truth. Humans and AI aligned.

## Workspace Intelligence for software systems

Workspai is an open-source CLI that maps your software, links relationships to
source evidence, and prepares focused context for your coding agent. Developers,
agents, and CI can inspect the same system map and recorded blockers.

**Same agent. Better system context.** Start inside an existing project:

```bash
npx workspai adopt .
npx workspai workspace intelligence run --for-agent generic
```

Requires **Node.js 20.19+ and npm**. The system map and checks run locally without
an AI API key. Your source stays in place; Workspai adds project metadata and
agent entry files and saves reports in a linked workspace.

### Before vs After

| Before | With Workspai |
| --- | --- |
| Architecture questions begin with broad file discovery | Start from a system map and inspect its source references |
| Project checks and blockers live in separate reports | Read recorded checks and readiness evidence together |
| A new agent session needs project context | Validate and reuse saved project entry and focused context |

Here is what you get:

| What you get | Use it to |
| --- | --- |
| **System map** — Workspace Model and Knowledge Graph | Find registered projects, detected runtimes, and proven relationships |
| **Checks and evidence** — Doctor and readiness reports | Inspect blockers and what has actually been verified |
| **Agent entry and context** — instructions and Skills | Give supported coding agents a focused starting point |

`generic` is the safe default when you do not yet know which agent will use the
project: Workspai builds one portable context and prepares discovery adapters
for every supported host, without duplicating the Model or Graph.

[Get started](#start-in-two-minutes) ·
[See what you get](#what-happens-after-the-first-run) ·
[How it works](#how-workspace-intelligence-works) ·
[Documentation](docs/README.md)

![Workspai CLI adopting and analyzing the gRPC repository](https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/workspai-grpc-readme-cli.gif)

## Start in two minutes

### Use an existing project

Open the project and adopt it:

```bash
cd /absolute/path/to/project
npx workspai adopt .
```

The project stays where it is. Workspai creates or reuses a minimal workspace
in the default system location and records a validated local link.

Stay in the same project directory and run Workspace Intelligence:

```bash
npx workspai workspace intelligence run --for-agent generic
```

Workspai now knows which workspace owns the project. You only need
`--workspace <path>` when a moved or ambiguous binding cannot be resolved.
The shorter command is intended for a human-readable first run. CI, agents, and
other machine consumers should use the strict JSON form shown in
[How Workspace Intelligence works](#how-workspace-intelligence-works).

Look for the terminal summary of projects, generated context, and recorded
blockers. Runtime depends on the project and its checks; adoption alone does
not prove that the project is healthy.

Try a focused query to inspect the map. Replace `authentication` with a term
from your own code:

```bash
npx workspai workspace graph search "authentication" --limit 5 --json
```

Read the evidence references returned with a match. No match means the current
graph has not proven that relationship.

### Start new software

Use the guided flow:

```bash
npx workspai create
```

Choose whether to create a workspace, scaffold a project, or add existing
software. Project starters are grouped as Backend, Frontend, Desktop, AI
Agent, AI Gateway, Extension, and Gaming.

```bash
# Optional global installation
npm install -g workspai
workspai --version
```

## Give your agent a goal, not an open-ended prompt

Describe the outcome in plain language from the adopted project:

```bash
npx workspai goal "Raise test coverage to 85%" --for-agent generic
npx workspai goal "Raise test coverage to 85%" --runtime cpp --for-agent generic
npx workspai goal "Add retry with exponential backoff" --for-agent generic
```

Workspai turns it into a bounded, evidence-backed handoff:

```text
Intent → project scope → proof-backed context → governed plan → safe execution
```

The agent gets a focused objective, not permission to scan or change
everything. Workspai keeps approval, verification, and rollback under CLI
control. The command prepares governed work; it does not edit source or claim
that the outcome is complete. Exact coverage, dependency-security, and release
Goals have deterministic CLI verifiers; other outcomes retain CLI safety and
rollback while the consumer performs an evidence-backed outcome review.
Multi-project scope and polyglot runtime choices are explicit. Interactive
users get bounded choices from the canonical Workspace Model; automation gets
a machine-readable decision and can use `--scope` and `--runtime`.

[Learn how Goal Packs work](docs/goal-packs.md)

## Make every agent change carry proof

For source-changing work, begin a Goal-bound change before mutation:

```bash
npx workspai change begin --json
npx workspai change authorize --change <change-id> --effects filesystem,command --json
npx workspai change effect record --change <change-id> --file effect-receipt.json --json
npx workspai change verify --change <change-id> --strict --json
npx workspai change capsule validate --change <change-id> --json
```

The resulting capsule binds intent, baseline architecture, authorization,
observed effects, predicted-versus-actual Graph changes, verification receipts,
and remaining uncertainty. Prediction can guide work but can never prove its
own result. [Learn how Proof-Carrying Change works](docs/proof-carrying-change.md).

![Workspai creates a Goal-bound Proof-Carrying Change before source mutation](https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/workspai-pcc-readme-cli.gif)

## What happens after the first run

The linked workspace stores the shared map and reports in `.workspai/reports/`.
Your project keeps its portable `.workspai/agent-entry.v1.json`, scoped context,
and local workspace binding. You can keep working from the project directory.

The key outputs for each audience are:

| Audience            | What to read                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| **AI agent**        | `agent-entry.v1.json` (project) → `workspace-context-agent.json` (workspace) |
| **Developer**       | Terminal summary, or `workspace-explain-last-run.json` for diagnosis         |
| **CI / automation** | `workspace-verify-last-run.json` (exit code 0 = pass, 2 = blocked)           |
| **MCP client**      | `workspace mcp serve` (versioned read-oriented tools over JSON-RPC)          |
| **IDE extension**   | Same artifacts + watch events                                                |

An agent can prove that it entered through governed evidence before scanning
the repository:

```bash
npx workspai agent bootstrap --for-agent codex --strict --json
```

The receipt validates workspace membership, artifact integrity, Model/Graph
freshness, and the active Goal handoff. A blocked receipt prevents architecture
claims; it never falls back silently to a broad source scan. [Learn about
canonical-first agent entry](docs/agent-entry.md).

A blocked result is useful evidence, not a crashed command. Workspai names what
is missing or failing and keeps the generated reports available for inspection.

## How Workspace Intelligence works

```text
Workspace sources
       │
       ▼
Canonical Workspace Model
       │
       ▼
Evidence-backed Knowledge Graph
       │
       ▼
Impact · Doctor · Verify · Context · Explain
       │
       ▼
Humans · CI · IDEs · MCP · AI agents
```

The **Workspace Model is the canonical source of truth**. The Knowledge Graph is
a **derived, revision-bound representation** of that model. It can add
proof-backed detail without becoming a second source of truth or mutating the
model that authorized the run.

A missing relationship means **not proven by current evidence**, not "these
projects are independent."

The full contract-backed chain is:

```text
Model → Diff → Impact → Doctor + Contract Verify + Analyze → Readiness
      → Verify → Context → Agent Sync → Explain
```

Run it with:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

`pipeline --json --strict` is the broader release and governance workflow. It
complements this chain; it does not replace it.

The deterministic model, graph, and checks do not require an AI API key.

### See the evidence-backed graph

The graph connects projects, APIs, packages, tests, infrastructure, ownership,
and runtime topology only when current evidence supports the relationship.
Every visible relationship can retain proof, while missing relationships stay
explicitly unproven.

![Interactive 3D view of a real Workspai workspace graph](https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/workspace-graph.gif)

[Query, explain, and export the graph](docs/workspace-knowledge-graph.md)

## Everyday workflows

| Goal                                        | Command                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Use guided setup                            | `npx workspai create`                                                                            |
| Link a project without moving it            | `npx workspai adopt .`                                                                           |
| Initialize workspace and project dependencies | `npx workspai init`                                                                              |
| Refresh the complete system view            | `npx workspai workspace intelligence run --for-agent generic --strict --json`                    |
| Turn an outcome into governed work          | `npx workspai goal "Raise test coverage to 85%"`                                                 |
| Prove an agent change from intent to verify | `npx workspai change begin --json`                                                               |
| Ground an agent before source discovery     | `npx workspai agent bootstrap --for-agent generic --strict --json`                               |
| Copy or clone a project into a workspace    | `npx workspai import <path-or-git-url> --workspace <path>`                                       |
| Diagnose project or workspace health        | `npx workspai doctor project` / `npx workspai doctor workspace`                                 |
| Observe CLI and Studio activity             | `npx workspai live --once --json --projection board`                                             |
| Ask a focused architecture question         | `npx workspai workspace graph search "authentication service" --limit 12 --json`                 |
| Verify current evidence                     | `npx workspai workspace verify --strict --json`                                                  |
| Inspect a governed repair before execution  | `npx workspai workspace repair capabilities --json`                                              |
| Refresh agent and IDE context               | `npx workspai workspace agent-sync --write --preset enterprise --json`                           |
| Run the broader release gate                | `npx workspai pipeline --strict --json`                                                          |
| Start MCP server for workspace queries      | `npx workspai workspace mcp serve`                                                               |

For every command and flag, use the
[Command Reference](docs/commands-reference.md).

## Outputs and integrations

Workspai exposes the same governed data through several stable surfaces:

- human-readable terminal summaries;
- JSON output for scripts and CI;
- versioned artifacts under `.workspai/reports/`;
- focused context and instructions for AI agents;
- MCP server with versioned read-oriented workspace tools (`workspace mcp serve`);
- Live activity projections and reports for IDEs and dashboards;
- JSON, JSON-LD, Mermaid, DOT, GraphML, and GEXF graph exports.

The [Workspai VS Code extension](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode)
uses this CLI, so visual and terminal workflows share the same contracts and
artifacts.

## Requirements

- Node.js `>=20.19.0`
- npm

Python, Go, Java, .NET, Rust, or PHP are needed only for workflows that use
those runtimes. Python is not required for Python-free workspaces or npm-owned
project generators.

RapidKit Core is the optional Python engine for Python/Core-dependent kits and
modules; Workspai remains the workspace-level CLI.

## Documentation

| Goal                                          | Guide                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Learn the main terms                          | [Glossary](docs/GLOSSARY.md)                                                                   |
| Create, adopt, import, or connect software    | [Creating workspaces and projects](docs/creating-workspaces-and-projects.md)                   |
| Query Graph and inspect proof                 | [Workspace Knowledge Graph](docs/workspace-knowledge-graph.md)                                 |
| Understand the exact decision loop            | [Workspace Intelligence runner](docs/workspace-intelligence-runner.md)                         |
| Run dependency, test, and build stages         | [Workspace Run](docs/workspace-run.md)                                                         |
| Observe CLI and Studio activity                | [Workspai Live](docs/workspace-live-activity.md)                                               |
| Plan, approve, execute, or roll back a repair | [Workspace Repair Engine](docs/workspace-repair-engine.md)                                     |
| Set a release, security, or coverage outcome  | [Verified engineering goals](docs/workspace-intelligence-runner.md#verified-engineering-goals) |
| Compile plain language into a governed plan   | [Goal Packs](docs/goal-packs.md)                                                               |
| Prove what an agent changed and why           | [Proof-Carrying Change](docs/proof-carrying-change.md)                                         |
| Ground an agent in canonical project evidence | [Canonical-first agent entry](docs/agent-entry.md)                                             |
| Measure bounded retrieval and model usage      | [Evaluation](docs/workspace-intelligence-evaluation.md) and [benchmark](docs/workspace-intelligence-benchmark.md) |
| Integrate CI                                  | [CI workflows](docs/ci-workflows.md)                                                           |
| Find generated files and schemas              | [Artifact Catalog](docs/contracts/ARTIFACT_CATALOG.md)                                         |
| Browse all documentation                      | [Documentation index](docs/README.md)                                                          |

## Troubleshooting

| Problem                              | Next step                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| The workspace is not detected        | Run from the project/workspace or inspect `npx workspai project workspace status --json` |
| A check reports stale evidence       | Re-run the complete Workspace Intelligence command                                       |
| A runtime is missing                 | Install only the runtime required by that project                                        |
| An agent cannot find current context | Run `npx workspai workspace agent-sync --write --refresh-context --json`                 |
| You need a specific flag             | Open the [Command Reference](docs/commands-reference.md)                                 |

## Contributing

Workspai is developed in the open by
[Chistiq](https://chistiq.com/), the intelligence infrastructure company behind
RapidKit and Workspai.

Read [CONTRIBUTING.md](CONTRIBUTING.md), the
[Development Guide](docs/DEVELOPMENT.md), and the
[Security Policy](docs/SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
