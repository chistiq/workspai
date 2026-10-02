# Workspai CLI

[![npm version](https://img.shields.io/npm/v/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![Downloads](https://img.shields.io/npm/dm/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![CI](https://img.shields.io/github/actions/workflow/status/chistiq/workspai/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/chistiq/workspai/actions/workflows/ci.yml)
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

| Your question | What Workspai gives you |
| --- | --- |
| **How does this system fit together?** | A map of projects and proven relationships, with source references |
| **What is blocking the next step?** | Recorded checks, missing evidence, and targets to investigate |
| **Where should my agent start?** | A compact project entry, focused context, and saved evidence it can validate |

[Get started](#start-with-your-software) ·
[Watch the workflow](#see-the-first-run) ·
[Give your agent a goal](#from-intent-to-a-verified-change) ·
[Documentation](packages/cli/docs/README.md)

Use it for a repository you are joining, an agent working on existing code, or a
team connecting several projects. Workspai supplies evidence and context;
your coding agent still implements the change.

`generic` prepares portable context and entry adapters for supported hosts,
including Codex, Claude Code, Cursor, and GitHub Copilot. Each host uses the same
workspace evidence. [Agent integration guide](packages/cli/docs/agent-entry.md).

### See the first run

![Workspai CLI adopting and analyzing the gRPC repository](packages/cli/docs/workspai-grpc-readme-cli.gif)

## Start with your software

You do not need to move an existing project. Open its directory and adopt it:

```bash
cd /absolute/path/to/project
npx workspai adopt .
```

Workspai creates or reuses a minimal workspace in the default system location
and links the project to it. You can stay in the project directory:

```bash
npx workspai workspace intelligence run --for-agent generic
```

This run builds the current system view, checks its evidence, and prepares
shared context for people and tools. Governed reports are saved in the resolved
canonical workspace under `.workspai/reports/`; the adopted project retains its
portable entry and scoped context locally.
Read the terminal summary for detected projects, generated context, and recorded
blockers. A blocked check points to missing or failing evidence; it does not
mean you must abandon the project.

Then try a focused graph search. Replace `authentication` with a term from your
own system:

```bash
npx workspai workspace graph search "authentication" --limit 5 --json
```

Inspect the returned evidence references before changing source. An empty
result means the current graph has not proven a match.

For CI and machine consumers, use the canonical strict JSON runner:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

Starting from scratch? Use the guided flow:

```bash
npx workspai create
```

It can create a workspace, scaffold a project, or add existing software.

## From intent to a verified change

Give the agent an outcome instead of an open-ended prompt:

```bash
npx workspai goal "Add retry with exponential backoff" --for-agent generic
```

The Goal binds intent, scope, acceptance criteria, and current architecture. It
prepares governed work; it does not edit source or claim completion. Polyglot
and multi-project automation can bind choices explicitly with `--runtime` and
`--scope`.

Before broad discovery, an agent can prove that it entered through current
canonical evidence:

```bash
npx workspai agent bootstrap --for-agent generic --strict --json
```

For source-changing work, Proof-Carrying Change extends that Goal into an
auditable lifecycle:

```text
Intent → baseline → authorization → effects → verification → sealed capsule
```

Start the Goal-bound transaction before the first source mutation:

```bash
npx workspai change begin --json
```

Prediction can guide the agent, but only authorized, observed effects and
independent verification can seal the capsule; the PCC guide contains the
complete executable loop.

![Workspai creates a Goal-bound Proof-Carrying Change before source mutation](packages/cli/docs/workspai-pcc-readme-cli.gif)

[Goal Packs](packages/cli/docs/goal-packs.md) ·
[Proof-Carrying Change](packages/cli/docs/proof-carrying-change.md) ·
[Canonical-first agent entry](packages/cli/docs/agent-entry.md)

## How it works

```text
Code · APIs · packages · infrastructure · docs · CI · policies
                              │
                              ▼
                    Canonical Workspace Model
                              │
                              ▼
              Evidence-backed Knowledge Graph
                              │
                              ▼
          impact · doctor · verify · context · explain
                              │
                              ▼
             Developers · CI · IDEs · MCP · AI agents
```

The **Workspace Model is the canonical source of truth**. The Knowledge Graph is
a **derived, revision-bound representation** of that model. Providers can enrich
the graph with files, symbols, APIs, tests, infrastructure, ownership, and
proofs, but they do not rewrite the model during the same run.

A missing relationship means **not proven by current evidence**, not “these
projects are independent.”

The complete decision loop is versioned as a contract:

```text
Model → Diff → Impact → Doctor + Contract Verify + Analyze → Readiness
      → Verify → Context → Agent Sync → Explain
```

The model, graph, and verification chain run locally and do not require an AI
API key. AI providers are optional consumers of the same governed context.

### See the evidence-backed graph

The graph connects projects, APIs, packages, tests, infrastructure, ownership,
and runtime topology only when current evidence supports the relationship.
Search results and visual nodes retain their proof references; missing edges
remain unknown rather than being presented as independence.

![Interactive 3D view of a real Workspai workspace graph](packages/cli/docs/workspace-graph.gif)

[Query, explain, and export the graph](packages/cli/docs/workspace-knowledge-graph.md)

## One foundation, many consumers

- **Developers** get clear summaries, proof paths, and next actions.
- **CI** gets structured JSON and versioned evidence.
- **AI agents** get focused context instead of an unbounded repository dump.
- **IDEs and dashboards** read the same model, graph, and verification results.
- **MCP clients** can query current workspace evidence through versioned read-oriented tools via `workspace mcp serve`.
- **Live views** observe CLI and Studio activity without turning telemetry into proof.
- **Graph tools** can use JSON, JSON-LD, Mermaid, DOT, GraphML, or GEXF exports.

## Go deeper

| Goal                                              | Guide                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Learn the main concepts                           | [Plain-language glossary](packages/cli/docs/GLOSSARY.md)                                  |
| Create, adopt, or import software                 | [Creating workspaces and projects](packages/cli/docs/creating-workspaces-and-projects.md) |
| Query the graph and inspect proof                 | [Workspace Knowledge Graph](packages/cli/docs/workspace-knowledge-graph.md)               |
| Understand the full decision loop                 | [Workspace Intelligence runner](packages/cli/docs/workspace-intelligence-runner.md)       |
| Repair a governed blocker safely                  | [Workspace Repair Engine](packages/cli/docs/workspace-repair-engine.md)                   |
| Compile intent into a scope-bound agent handoff   | [Goal Packs](packages/cli/docs/goal-packs.md)                                             |
| Prove what an agent changed and why               | [Proof-Carrying Change](packages/cli/docs/proof-carrying-change.md)                       |
| Give every coding agent a canonical project entry | [Canonical-first agent entry](packages/cli/docs/agent-entry.md)                           |
| Observe current CLI and Studio activity           | [Workspai Live](packages/cli/docs/workspace-live-activity.md)                             |
| Integrate CI                                      | [CI workflows](packages/cli/docs/ci-workflows.md)                                         |
| Find a command or flag                            | [Command reference](packages/cli/docs/commands-reference.md)                              |
| Inspect schemas and artifact ownership            | [Artifact Catalog](packages/cli/docs/contracts/ARTIFACT_CATALOG.md)                       |

## Packages

- [`workspai`](packages/cli) - the published CLI.
- [`wspai`](packages/wspai) - an optional short npm alias.

## Develop

Read the [Development Guide](packages/cli/docs/DEVELOPMENT.md),
[Contribution Hub](.github/CONTRIBUTING.md),
[complete Contributing Guide](packages/cli/CONTRIBUTING.md), and
[README content contract](packages/cli/docs/README_CONTENT_CONTRACT.md).

## Community

Workspai is an open-source project by [Chistiq](https://chistiq.com/), the
intelligence infrastructure company behind RapidKit and Workspai.

- [Issues](https://github.com/chistiq/workspai/issues)
- [Start contributing](.github/CONTRIBUTING.md)
- [Discussions](https://github.com/chistiq/workspai/discussions)
- [Security policy](packages/cli/docs/SECURITY.md)
- [Changelog](packages/cli/CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).
