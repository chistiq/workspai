# Workspai CLI

[![npm version](https://img.shields.io/npm/v/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![Downloads](https://img.shields.io/npm/dm/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?style=flat-square&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode)

## Give your AI agent the system, not just the repository

**Your AI coding agent wastes time guessing your project structure. Workspai fixes that.**

> One workspace. One truth. Humans and AI aligned.

## Workspace Intelligence for software systems

```bash
npx workspai adopt .
npx workspai workspace intelligence run --for-agent generic
```

Two commands. Your project becomes a fully understood workspace:

### Before vs After

| Before Workspai | After Workspai |
| --- | --- |
| Agent scans thousands of files for context | Agent reads one bounded context document |
| No dependency map between services | Searchable graph with source-level proof |
| Broken test blocks release, no one knows why | Doctor names the failing project and fix path |
| Every AI session starts from scratch | Sessions resume from durable evidence |

Here is what you get:

| What it produces | Why it matters |
| --- | --- |
| **Workspace Model** | A canonical inventory of every project, runtime, framework, and dependency |
| **Knowledge Graph** | Searchable relationships between projects, backed by source-level proof |
| **Health & Readiness** | Doctor checks, verification gates, and release posture based on evidence, not guesses |
| **Agent Context** | Bounded, focused instructions so AI tools read what they need, not the entire repo |
| **Agent Rules** | Ready-to-use grounding for Cursor, Copilot, Claude, Codex, Gemini, and more |
| **Agent Skills** | Runtime-, polyglot-, test-, and delivery-aware operational playbooks, with portable `SKILL.md` projections where the host supports Agent Skills |
| **MCP Server** | 14 read-oriented tools so MCP clients can query evidence, graph, blockers, and context live |

`generic` is the safe default when you do not yet know which agent will use the
project: Workspai builds one portable context and prepares discovery adapters
for every supported host, without duplicating the Model or Graph.

### What the output looks like

After a single run, `.workspai/` contains everything agents and CI need:

```text
your-workspace/                              # ── Workspace level ──
├── .workspai/
│   ├── workspace.json                       # workspace identity & profile
│   ├── workspace.contract.json              # project registry, ports, APIs
│   ├── reports/                             # intelligence artifacts
│   │   ├── workspace-model.json             # projects, runtimes, deps
│   │   ├── workspace-knowledge-graph.json   # proof-backed relationships
│   │   ├── workspace-context-agent.json     # bounded context for AI agents
│   │   ├── workspace-skills-index.json      # operational skills inventory
│   │   ├── workspace-verify-last-run.json   # pass/fail with evidence
│   │   ├── INDEX.json                       # evidence inventory & read order
│   │   └── ...                              # impact, doctor, analyze, explain, etc.
│   └── skills/                              # generated operational skills
│       ├── workspai-release-readiness.md     # always available
│       ├── workspai-node-runtime-validation.md  # only when Node is detected
│       └── workspai-polyglot-change-validation.md # only for multi-runtime workspaces
│
│  # Workspace-level agent grounding (per host):
├── AGENTS.md · CLAUDE.md · GEMINI.md · QWEN.md
├── .cursor/rules/workspai-*.mdc             # 5 rules + skill
├── .claude/rules/workspai-*.md              # workspace + evidence
├── .grok/rules/ · .windsurf/rules/          # grounding + evidence
├── .amazonq/rules/ · .github/               # Copilot, prompts, agents, skills
│
│  # ── Project level (repeated per project) ──
├── nova-api/
│   ├── .workspai/
│   │   ├── project.json                     # project identity & metadata
│   │   ├── workspace-link.local.json        # machine-local workspace binding
│   │   ├── agent-entry.v1.json              # canonical agent entry point
│   │   ├── PROJECT-GROUNDING.md             # project-level grounding
│   │   └── reports/
│   │       └── project-context-agent.json   # scoped project context
│   ├── AGENTS.md · CLAUDE.md · GEMINI.md · QWEN.md
│   └── .amazonq/rules/workspai-agent-entry.md
│
└── summit-web/                              # (same structure per project)
```

Your agent starts with `agent-entry.v1.json`, compact workspace context, and the Skills
index; it then retrieves only task-scoped Graph evidence and targeted source. No broad
scan or complete Graph load is needed for ordinary work.

![Workspai CLI adopting and analyzing the gRPC repository](https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/workspai-grpc-readme-cli.gif)

[Get started](#start-in-two-minutes) ·
[See what you get](#what-happens-after-the-first-run) ·
[How it works](#how-workspace-intelligence-works) ·
[Documentation](docs/README.md)

## Why Workspai

Workspai is an open-source CLI that brings related software projects together,
so people and AI tools can understand and work with the same system.

- **See the whole system:** every project, service, and dependency in one model.
- **Ask with proof:** trace any answer back to the exact file and line.
- **Change safely:** know impact before you commit, verify after, and give AI agents
  only the context they need.

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

## Give your agent a goal, not an open-ended prompt

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

![Workspai turns a plain-language objective into a governed Goal Pack](https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/workspai-goal-readme-cli.gif)

[Learn how Goal Packs work](docs/goal-packs.md)

## What happens after the first run

Everything shown in the [output tree above](#what-the-output-looks-like) is
generated in one run. The key files for each audience:

| Audience | What to read |
| --- | --- |
| **AI agent** | `agent-entry.v1.json` (project) → `workspace-context-agent.json` (workspace) |
| **Developer** | Terminal summary, or `workspace-explain-last-run.json` for diagnosis |
| **CI / automation** | `workspace-verify-last-run.json` (exit code 0 = pass, 2 = blocked) |
| **MCP client** | `workspace mcp serve` (14 read-oriented tools over JSON-RPC) |
| **IDE extension** | Same artifacts + watch events |

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

## Everyday workflows

| Goal                                       | Command                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Use guided setup                           | `npx workspai create`                                                            |
| Link a project without moving it           | `npx workspai adopt .`                                                           |
| Turn an outcome into governed work         | `npx workspai goal "Raise test coverage to 85%"`                                 |
| Ground an agent before source discovery    | `npx workspai agent bootstrap --for-agent codex --strict --json`                 |
| Audit every agent entry adapter            | `npx workspai project agent-entry verify --for-agent all --strict --json`        |
| Copy or clone a project into a workspace   | `npx workspai import <path-or-git-url> --workspace <path>`                       |
| Check the current project                  | `npx workspai doctor project`                                                    |
| Check the whole workspace                  | `npx workspai doctor workspace`                                                  |
| Refresh Model and Graph                    | `npx workspai workspace model --write --json`                                    |
| Ask a focused architecture question        | `npx workspai workspace graph search "authentication service" --limit 12 --json` |
| Verify current evidence                    | `npx workspai workspace verify --strict --json`                                  |
| Inspect a governed repair before execution | `npx workspai workspace repair capabilities --json`                              |
| Refresh agent and IDE context              | `npx workspai workspace agent-sync --write --preset enterprise --json`           |
| Start MCP server for workspace queries     | `npx workspai workspace mcp serve`                                               |

For every command and flag, use the
[Command Reference](docs/commands-reference.md).

## Outputs and integrations

Workspai exposes the same governed data through several stable surfaces:

- human-readable terminal summaries;
- JSON output for scripts and CI;
- versioned artifacts under `.workspai/reports/`;
- focused context and instructions for AI agents;
- MCP server with 14 read-oriented workspace tools (`workspace mcp serve`);
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

| Goal                                          | Guide                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Learn the main terms                          | [Glossary](docs/GLOSSARY.md)                                                                   |
| Create, adopt, import, or connect software    | [Creating workspaces and projects](docs/creating-workspaces-and-projects.md)                   |
| Query Graph and inspect proof                 | [Workspace Knowledge Graph](docs/workspace-knowledge-graph.md)                                 |
| Understand the exact decision loop            | [Workspace Intelligence runner](docs/workspace-intelligence-runner.md)                         |
| Plan, approve, execute, or roll back a repair | [Workspace Repair Engine](docs/workspace-repair-engine.md)                                     |
| Set a release, security, or coverage outcome  | [Verified engineering goals](docs/workspace-intelligence-runner.md#verified-engineering-goals) |
| Compile plain language into a governed plan   | [Goal Packs](docs/goal-packs.md)                                                               |
| Ground an agent in canonical project evidence | [Canonical-first agent entry](docs/agent-entry.md)                                             |
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
