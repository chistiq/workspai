# Workspai CLI

[![npm version](https://img.shields.io/npm/v/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![Downloads](https://img.shields.io/npm/dm/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![CI](https://img.shields.io/github/actions/workflow/status/chistiq/workspai/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/chistiq/workspai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?style=flat-square&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode)

## Give your AI agent the system, not just the repository

**Less rediscovery. More time building.**

Workspai helps your coding agent start with a map of your software, source
references, and saved context instead of piecing everything together again.
You can inspect the same map and see what still needs attention.

> One workspace. One truth. Humans and AI aligned.

## Workspace Intelligence for software systems

Workspai is an open-source CLI for understanding existing software and preparing
context for coding agents. Use it with Codex, Claude Code, Cursor, or GitHub
Copilot. No AI API key is needed for the system map and checks.

**Try it from your project's terminal:**

```bash
npx workspai adopt .
npx workspai workspace intelligence run --for-agent generic
```

Requires **Node.js 20.19+ and npm**. Your project stays where it is. Workspai adds
metadata and agent entry files, then saves shared reports in a linked workspace.
`generic` prepares portable context for supported agent hosts.

[Get started](#start-with-your-software) ·
[Agent setup](packages/cli/docs/agent-entry.md) ·
[Browse the guides](packages/cli/docs/README.md)

![Workspai adopting and analyzing the gRPC repository](packages/cli/docs/workspai-grpc-readme-cli.gif)

| When you need to… | Workspai helps you… |
| --- | --- |
| Understand unfamiliar code | Find projects and relationships, then follow references to the source |
| Start an agent session | Reuse saved project context and check that it is current |
| Decide what to fix next | Inspect recorded checks, blockers, and missing evidence |

## Start with your software

**Existing project:** run the two commands above from its directory. Read the
terminal summary to see detected projects, generated context, and checks that
need attention. Your project remains in place; shared reports live under
`.workspai/reports/` in the linked workspace.

Then explore a topic from your own code:

```bash
npx workspai workspace graph search "authentication" --limit 5 --json
```

Follow the source references in the result. No match means the current graph
has not proven a match. After changing your project, rerun the intelligence
command to refresh its saved view.

### Build something new

**One guided flow for your workspace and your next project:**

```bash
npx workspai create
```

```text
What would you like to set up?
  Create a workspace
  Create a project
  Add existing software
```

Create a **workspace** to organize your apps and services with shared context and
checks. Create a **project** to choose a starter and register it in your workspace.

| What are you building? | Example starters |
| --- | --- |
| APIs and services | FastAPI, NestJS, Go, ASP.NET Core, Rust Axum, Spring Boot |
| Web apps | Next.js, React + Vite, Vue, Angular, SvelteKit, Astro |
| Agents and model gateways | Google ADK, OpenAI Agents SDK, Microsoft Agent Framework, OpenRouter |
| Desktop apps or extensions | Choose a kit from the guided picker |

Choose a category, a kit, and a name. Workspai handles scaffolding and workspace
registration; each kit shows its current support status.

[Explore project and workspace setup](packages/cli/docs/creating-workspaces-and-projects.md)

## From intent to a verified change

Once your project is linked, give your agent a specific outcome:

```bash
npx workspai goal "Add retry with exponential backoff" --for-agent generic
```

Workspai prepares a focused handoff with scope and acceptance criteria.
It prepares governed work; it does not edit source or claim completion.
Your coding agent implements the change.

For changes that need an audit trail, **Proof-Carrying Change** records:

```text
Intent → baseline → authorization → effects → verification → sealed capsule
```

[Plan a goal](packages/cli/docs/goal-packs.md) ·
[Record and verify a change](packages/cli/docs/proof-carrying-change.md)

## How it works

Workspai reads your workspace, builds a system map, runs checks, and prepares
context for people and tools. Relationships link back to supporting evidence.
A missing relationship means **not proven**, not “these projects are independent.”

<details>
<summary>Architecture and CI usage</summary>

The **Workspace Model is the canonical source of truth**. The Knowledge Graph is
a **derived, revision-bound representation** of that model. Providers add facts
and evidence without rewriting the authorizing model during the same run.

The complete intelligence chain is:

```text
Model → Diff → Impact → Doctor + Contract Verify + Analyze → Readiness
      → Verify → Context → Agent Sync → Explain
```

For CI and machine consumers:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

[Runner behavior and exit codes](packages/cli/docs/workspace-intelligence-runner.md)

</details>

## One foundation, many consumers

Use the CLI yourself, hand its context to an agent, or read its JSON from CI.
IDEs and MCP clients can use the same workspace evidence.
Live views observe CLI and Studio activity without turning telemetry into proof.

![Interactive view of a Workspai workspace graph](packages/cli/docs/workspace-graph.gif)

[Explore the graph](packages/cli/docs/workspace-knowledge-graph.md)

## Go deeper

| Your next step | Guide |
| --- | --- |
| Set up an existing or new project | [Getting started](packages/cli/docs/creating-workspaces-and-projects.md) |
| Connect your coding agent | [Agent entry](packages/cli/docs/agent-entry.md) |
| Search and inspect the system map | [Knowledge Graph](packages/cli/docs/workspace-knowledge-graph.md) |
| Automate checks | [CI workflows](packages/cli/docs/ci-workflows.md) |
| Find a command or understand a term | [Command reference](packages/cli/docs/commands-reference.md) · [Glossary](packages/cli/docs/GLOSSARY.md) |

[All documentation](packages/cli/docs/README.md)

## Packages

Install **`workspai`** for the CLI. **`wspai`** is an optional short npm alias.

## Develop

Start with the [Contribution Hub](.github/CONTRIBUTING.md) and
[Development Guide](packages/cli/docs/DEVELOPMENT.md).
README changes follow the [content contract](packages/cli/docs/README_CONTENT_CONTRACT.md).

## Community

Built by [Chistiq](https://chistiq.com/), the team behind RapidKit and Workspai.

[Ask a question](https://github.com/chistiq/workspai/discussions) ·
[Report a problem](https://github.com/chistiq/workspai/issues) ·
[Changelog](packages/cli/CHANGELOG.md) ·
[Security policy](packages/cli/docs/SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
