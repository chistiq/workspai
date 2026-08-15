# Workspai CLI

[![npm version](https://img.shields.io/npm/v/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![Downloads](https://img.shields.io/npm/dm/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

## Give your AI agent the system—not just the repository

Your coding agent should not have to rediscover your architecture in every
session. Workspai builds a current, evidence-backed view of your projects,
APIs, dependencies, infrastructure, and change boundaries, then gives agents
the bounded context they need.

> One workspace. One truth. Humans and AI aligned.

```bash
npx workspai adopt .
npx workspai workspace intelligence run --for-agent generic
```

A single run gives developers and tools the same operational picture:

```text
System     projects · runtimes · APIs · dependencies · infrastructure
Evidence   relationships linked back to canonical proof
Change     affected projects and verification targets
Agents     bounded context instead of an unfiltered repository dump
```

**Understand the system before an agent changes it.**

![Workspai CLI adopting and analyzing the gRPC repository](https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/workspai-grpc-readme-cli.gif)

[Get started](#start-in-two-minutes) ·
[See what you get](#what-happens-after-the-first-run) ·
[How it works](#how-workspace-intelligence-works) ·
[Documentation](docs/README.md)

## Workspace Intelligence for software systems

Workspai is an open-source CLI that brings related software projects together,
so people and AI tools can understand and work with the same system.

- **See the system:** projects, runtimes, APIs, dependencies, infrastructure,
  documentation, tests, policies, and release state.
- **Ask with proof:** search relationships and trace them back to source files.
- **Act with confidence:** understand impact, verify changes, and prepare focused
  context for AI tools.

![From Code to Shared Understanding](https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/From%20Code%20to%20Shared%20Understanding.png)

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

### Start new software

Use the guided flow:

```bash
npx workspai create
```

Choose whether to create a workspace, scaffold a project, or add existing
software. Project starters are grouped as Backend, Frontend, Desktop, and
Extension.

Global installation is optional:

```bash
npm install -g workspai
workspai --help
```

`wspai` is an optional short alias for the same CLI.

## What happens after the first run

Workspai saves reusable results under `.workspai/`:

- `workspace-model.json` — the canonical description of the system.
- `workspace-knowledge-graph.json` — searchable relationships with proof.
- `workspace-verify-last-run.json` — the latest verification decision.
- `workspace-context-agent.json` — bounded context for agents and IDEs.
- `INDEX.json` — the current evidence inventory and recommended read order.

It also prepares `AGENTS.md` and supported agent/IDE surfaces. Developers, CI,
IDEs, MCP clients, and AI agents can therefore read the same current evidence.

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

## Everyday workflows

| Goal | Command |
| --- | --- |
| Use guided setup | `npx workspai create` |
| Link a project without moving it | `npx workspai adopt .` |
| Copy or clone a project into a workspace | `npx workspai import <path-or-git-url> --workspace <path>` |
| Check the current project | `npx workspai doctor project` |
| Check the whole workspace | `npx workspai doctor workspace` |
| Refresh Model and Graph | `npx workspai workspace model --write --json` |
| Ask a focused architecture question | `npx workspai workspace graph search "authentication service" --limit 12 --json` |
| Verify current evidence | `npx workspai workspace verify --strict --json` |
| Inspect a governed repair before execution | `npx workspai workspace repair capabilities --json` |
| Refresh agent and IDE context | `npx workspai workspace agent-sync --write --preset enterprise --json` |

For every command and flag, use the
[Command Reference](docs/commands-reference.md).

## Outputs and integrations

Workspai exposes the same governed data through several stable surfaces:

- human-readable terminal summaries;
- JSON output for scripts and CI;
- versioned artifacts under `.workspai/reports/`;
- focused context and instructions for AI agents;
- MCP tools for read-oriented workspace queries;
- watch events and reports for IDEs and dashboards;
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

| Goal | Guide |
| --- | --- |
| Learn the main terms | [Glossary](docs/GLOSSARY.md) |
| Create, adopt, import, or connect software | [Creating workspaces and projects](docs/creating-workspaces-and-projects.md) |
| Query Graph and inspect proof | [Workspace Knowledge Graph](docs/workspace-knowledge-graph.md) |
| Understand the exact decision loop | [Workspace Intelligence runner](docs/workspace-intelligence-runner.md) |
| Plan, approve, execute, or roll back a repair | [Workspace Repair Engine](docs/workspace-repair-engine.md) |
| Set a release, security, or coverage outcome | [Verified engineering goals](docs/workspace-intelligence-runner.md#verified-engineering-goals) |
| Integrate CI | [CI workflows](docs/ci-workflows.md) |
| Find generated files and schemas | [Artifact Catalog](docs/contracts/ARTIFACT_CATALOG.md) |
| Browse all documentation | [Documentation index](docs/README.md) |

## Troubleshooting

| Problem | Next step |
| --- | --- |
| The workspace is not detected | Run from the project/workspace or inspect `npx workspai project workspace status --json` |
| A check reports stale evidence | Re-run the complete Workspace Intelligence command |
| A runtime is missing | Install only the runtime required by that project |
| An agent cannot find current context | Run `npx workspai workspace agent-sync --write --refresh-context --json` |
| You need a specific flag | Open the [Command Reference](docs/commands-reference.md) |

## Contributing

Workspai is developed in the open by
[Chistiq](https://chistiq.com/), the intelligence infrastructure company behind
RapidKit and Workspai.

```bash
npm ci
npm run build
npm test
```

Read [CONTRIBUTING.md](CONTRIBUTING.md), the
[Development Guide](docs/DEVELOPMENT.md), and the
[Security Policy](docs/SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
