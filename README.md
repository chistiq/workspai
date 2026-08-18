# Workspai

[![npm version](https://img.shields.io/npm/v/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![Downloads](https://img.shields.io/npm/dm/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![CI](https://img.shields.io/github/actions/workflow/status/chistiq/workspai/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/chistiq/workspai/actions/workflows/ci.yml)
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

`generic` is the portable default: one canonical context, plus lightweight
entry adapters for every supported agent host—without rebuilding the Model or
Graph per provider.

A single run gives developers and tools the same operational picture:

```text
System     projects · runtimes · APIs · dependencies · infrastructure
Evidence   relationships linked back to canonical proof
Change     affected projects and verification targets
Agents     bounded context instead of an unfiltered repository dump
```

**Understand the system before an agent changes it.**

![Workspai CLI adopting and analyzing the gRPC repository](packages/cli/docs/workspai-grpc-readme-cli.gif)

[Get started](#start-with-your-software) ·
[See what you get](#what-workspai-gives-you) ·
[How it works](#how-it-works) ·
[Documentation](packages/cli/docs/README.md)

## Workspace Intelligence for software systems

Software is more than a folder of source files. It includes projects, services,
APIs, dependencies, infrastructure, documentation, tests, policies, and release
evidence.

Workspai brings those scattered parts together, so people and AI tools can
understand and work with the same software system:

- **See the whole workspace:** understand what exists and how it fits together.
- **Ask with proof:** trace answers back to the files and facts that support them.
- **Change with confidence:** see impact, run the right checks, and give AI tools
  focused context.

[VS Code extension](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode)

![From Code to Shared Understanding](packages/cli/docs/From%20Code%20to%20Shared%20Understanding.png)

## Start with your software

You do not need to move an existing project. Open its directory and adopt it:

```bash
cd /absolute/path/to/project
npx workspai adopt .
```

Workspai creates or reuses a minimal workspace in the default system location
and links the project to it. You can stay in the project directory:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

This run builds the current system view, checks its evidence, and prepares
shared context for people and tools. Results are saved under `.workspai/`.
When something is missing or blocked, Workspai reports it instead of claiming
the workspace is healthy. This canonical form gives CI, agents, and other
machine consumers strict gate semantics through the versioned JSON contract;
omit `--strict --json` for the shorter human-readable first run shown above.

Starting from scratch? Use the guided flow:

```bash
npx workspai create
```

It can create a workspace, scaffold a project, or add existing software.

## Give your agent a goal—not an open-ended prompt

Describe the outcome in plain language from the adopted project:

```bash
npx workspai goal "Raise test coverage to 85%" --for-agent generic
# In a polyglot scope, choose interactively or bind a canonical runtime:
npx workspai goal "Raise test coverage to 85%" --runtime cpp --for-agent generic
# Or pursue feature, defect, refactor, performance, documentation, or
# system-understanding outcomes in the same governed flow.
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

![Workspai turns a plain-language objective into a governed Goal Pack](packages/cli/docs/workspai-goal-readme-cli.gif)

[Learn how Goal Packs work](packages/cli/docs/goal-packs.md)

## What Workspai gives you

| Question                     | Answer from Workspai                                                             |
| ---------------------------- | -------------------------------------------------------------------------------- |
| What is in this system?      | A canonical model of projects, runtimes, frameworks, rules, and current evidence |
| How is it connected?         | A searchable graph whose relationships link back to proof                        |
| What changed?                | Saved snapshots, differences, and affected projects                              |
| Is it healthy or ready?      | Doctor, analysis, policy, readiness, and verification results                    |
| What should an AI tool read? | Bounded context, instructions, skills, and MCP-accessible evidence               |
| Why is something blocked?    | A diagnosis, supporting evidence, and the next verification target               |

The evidence index at `.workspai/reports/INDEX.json` is the workspace-wide
inventory. Inside an adopted project, agents first discover
`.workspai/agent-entry.v1.json` through their native instruction file and run:

```bash
npx workspai agent bootstrap --for-agent codex --strict --json
```

The receipt validates project membership, artifact integrity, Model/Graph
freshness, live inputs, and the active Goal handoff before broad source
discovery. [Read the canonical-first entry protocol](packages/cli/docs/agent-entry.md).

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

## One foundation, many consumers

- **Developers** get clear summaries, proof paths, and next actions.
- **CI** gets structured JSON and versioned evidence.
- **AI agents** get focused context instead of an unbounded repository dump.
- **IDEs and dashboards** read the same model, graph, and verification results.
- **MCP clients** can query current workspace evidence.
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
| Give every coding agent a canonical project entry | [Canonical-first agent entry](packages/cli/docs/agent-entry.md)                           |
| Integrate CI                                      | [CI workflows](packages/cli/docs/ci-workflows.md)                                         |
| Find a command or flag                            | [Command reference](packages/cli/docs/commands-reference.md)                              |
| Inspect schemas and artifact ownership            | [Artifact Catalog](packages/cli/docs/contracts/ARTIFACT_CATALOG.md)                       |

## Packages

The current CLI already includes the integrated Workspace Intelligence
capabilities described above.

- [`workspai`](packages/cli) — the published CLI.
- [`wspai`](packages/wspai) — an optional short npm alias.

Shared and graph foundations are being hardened as future independent packages.
They are extraction boundaries for existing capabilities, not a list of missing
features.

## Develop

```bash
npm ci
npm run build
npm test
```

Read the [Development Guide](packages/cli/docs/DEVELOPMENT.md),
[Contributing Guide](packages/cli/CONTRIBUTING.md), and
[README content contract](packages/cli/docs/README_CONTENT_CONTRACT.md).

## Community

Workspai is an open-source project by [Chistiq](https://chistiq.com/), the
intelligence infrastructure company behind RapidKit and Workspai.

- [Issues](https://github.com/chistiq/workspai/issues)
- [Discussions](https://github.com/chistiq/workspai/discussions)
- [Security policy](packages/cli/docs/SECURITY.md)
- [Changelog](packages/cli/CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).
