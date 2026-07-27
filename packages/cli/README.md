# Workspai CLI

[![npm version](https://img.shields.io/npm/v/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![Downloads](https://img.shields.io/npm/dm/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Built by Workspai](https://img.shields.io/badge/Built%20by-Workspai-0f172a?logo=github)](https://workspai.dev)

## Workspace Intelligence for software systems

> One workspace. One truth. Humans and AI aligned.

Workspai is an open-source CLI that connects one or many software projects and
keeps a current, checkable view of the whole system. Developers, CI, IDEs,
MCP-compatible tools, and AI agents can use that same view instead of rebuilding
different context from scattered files.

- **See the system:** projects, runtimes, APIs, dependencies, infrastructure,
  documentation, policies, and release state in one model.
- **Ask with proof:** get focused answers that link back to the supporting files
  and facts.
- **Change with confidence:** see what may be affected, run the right checks,
  and prepare useful context for AI tools.

[Quickstart](#start-in-two-minutes) ·
[Architecture](#from-code-to-shared-understanding) ·
[Commands](#core-workflows) ·
[Outputs](#outputs-and-consumers) ·
[Documentation](#documentation)

## Understand Workspai in one minute

Your software system is more than a repository. It may include several
applications and services, shared packages, API definitions, deployment files,
documentation, tests, owners, and CI results. Workspai connects those parts
without asking an AI model to decide what is true.

| Term                | Plain-language meaning                                                               |
| ------------------- | ------------------------------------------------------------------------------------ |
| **Workspace**       | A home for related projects, shared rules, and saved results                         |
| **Project**         | An application, service, library, or existing source folder connected to a workspace |
| **Workspace Model** | The main saved record of what Workspai knows about the system                        |
| **Knowledge Graph** | A searchable map built from the model, with links back to supporting files           |
| **Evidence**        | The file, observation, hash, or report that supports an answer                       |
| **Artifact**        | A file under `.workspai/` that people and other tools can read                       |

The Workspace Model is the canonical source of truth. This means it is the main
saved record. The Knowledge Graph is built from that record to make
relationships easy to search; it is not a second truth and it is not an AI
guess. In the technical contract, the graph is a derived, revision-bound
representation of the model.

The deterministic model, graph, contracts, and verification chain do not
require an AI API key. Optional AI-backed features declare that dependency
separately.

## Start in two minutes

### 1. Install or use `npx`

```bash
npm install -g workspai
workspai --help
```

Global installation is optional. Every example below also works with
`npx workspai`. The separate `wspai` package is only a short alias:

```bash
npx wspai --help
```

`workspai` is the main npm package and command. `wspai` is an optional shorter
name for interactive use. This package is the active CLI in the
[Workspai monorepo](../../README.md).

### 2. Connect an existing project

```bash
cd /absolute/path/to/project
npx workspai adopt .
```

`adopt` registers the project without moving or copying it. When run outside a
workspace, it creates or reuses the minimal default workspace and prints the
exact `Next shell step`.

### 3. Continue from the workspace root

Without the VS Code extension, copy the printed `Next shell step` and continue
in that workspace terminal:

```bash
cd ~/.workspai/workspaces/workspai
npx workspai workspace intelligence run --for-agent generic --strict --json
```

`generic` creates vendor-neutral context. Use `codex`, `claude`, `cursor`, or
`orca` when you want context shaped for that agent. Agent Sync also writes the
shared files used by GitHub Copilot, VS Code, and `AGENTS.md` consumers without
changing the system information or the checks Workspai runs.

The run saves its results so people and tools can inspect and reuse them:

```text
.workspai/
├── workspace.json
├── workspace.contract.json
├── AGENT-GROUNDING.md
└── reports/
    ├── workspace-model.json
    ├── workspace-knowledge-graph.json
    ├── workspace-impact-last-run.json
    ├── workspace-verify-last-run.json
    ├── workspace-context-agent.json
    ├── workspace-intelligence-run-last-run.json
    └── INDEX.json
AGENTS.md
```

For automation details, including exit codes and blocked results, see the
[Unified runner guide](docs/workspace-intelligence-runner.md). A blocked result
is useful evidence, not a crashed command.

When you are ready for the broader release workflow, run:

```bash
npx workspai pipeline --json --strict
```

Starting new software instead?

```bash
npx workspai create workspace my-workspace --profile minimal --yes
cd ~/.workspai/workspaces/my-workspace
npx workspai create project nextjs web --yes
```

From the `my-workspace` terminal, create a project, use `adopt` to link one in
place, or use `import` to copy or clone one into the workspace. See
[Creating Workspaces and Projects](docs/creating-workspaces-and-projects.md)
for supported starters.

## From Code to Shared Understanding

![From Code to Shared Understanding](https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/From%20Code%20to%20Shared%20Understanding.png)

[View the Mermaid source and explanation](docs/from-code-to-shared-understanding.md).

Workspai is the deterministic layer between source code and its consumers:

```text
Code · packages · APIs · infrastructure · docs · CI · policies
                              │
             registration · detection · contract reconciliation
                              │
                  Canonical Workspace Model
                              │
               bounded providers · facts · proofs
                              │
               Evidence-backed Knowledge Graph
                              │
                diff · impact · verify · context · explain
                              │
               Developers · CI · IDEs · MCP · AI agents
```

| Capability            | What it answers                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------- |
| **Model**             | What projects, runtimes, frameworks, commands, policies, contracts, and dependencies exist? |
| **Snapshot and diff** | What changed between two known workspace states?                                            |
| **Impact**            | Which projects and transitive dependents are affected?                                      |
| **Evidence**          | What do health, analysis, contracts, and readiness reports prove?                           |
| **Verify**            | Is the affected workspace ready, blocked, stale, or missing evidence?                       |
| **Context**           | What should developers, IDEs, and AI agents know before acting?                             |
| **Explain**           | Why is a project, change, or release blocked, and what should happen next?                  |
| **Sync**              | How do tools stay aligned with the same current workspace truth?                            |

Create, import, and adopt add software to this boundary. Workspace Intelligence
then models and governs every registered project, whether Workspai created it or
it already existed.

Unlike repository-only code intelligence, the workspace boundary can connect
evidence across multiple projects and repositories. A missing relationship
means **not proven by current evidence**, not "these projects are independent."

## One Intelligence Chain

The canonical execution order is versioned in
[`workspace-intelligence-chain.v1.json`](contracts/workspace-intelligence-chain.v1.json):

```text
Model -> Diff -> Impact -> Doctor + Contract Verify + Analyze -> Readiness
      -> Verify -> Context -> Agent Sync -> Explain
```

Each step declares what it consumes, what it produces, and whether its verdict
continues or stops the chain. The CLI, CI, IDE integrations, generated agent
instructions, and documentation can therefore use the same contract instead of
inventing separate workflows.

The execution envelope reports `sync` before Model and baseline resolution
after Model/before Diff as exactly two `preflight` entries. They are not extra
chain stages. The report always contains exactly 11 ordered `stages`; exit `0`
means passed, `1` is a hard execution failure, and `2` is an evidence-blocked
completed run. See [Unified Workspace Intelligence Runner](docs/workspace-intelligence-runner.md)
for the complete report, baseline, failure-propagation, and CI contract.

Use `workspace intelligence run --for-agent <agent> --strict --json` to execute
and enforce this exact contract-backed order. `pipeline --json --strict` remains
the broader governance/release orchestrator (`sync → doctor → analyze → readiness
→ autopilot`); it is not an alias for the canonical intelligence chain.

## Evidence and measurable context

Without bounded retrieval, a developer or agent often has to search and read a
large part of the workspace before answering a local question. Workspai can
return the matching entities, nearby relations, and source proofs first:

```bash
npx workspai workspace graph search "who implements the login API?" --limit 8 --json
```

Use the complete graph for interchange and audits; use bounded search for
normal questions and agent context. Workspai reports unknown or unproven
relationships instead of inventing an edge.

### Current measured fixture

| Measure                              | Observed value |
| ------------------------------------ | -------------: |
| Registered projects                  |             16 |
| Knowledge Graph entities             |          1,738 |
| Knowledge Graph relations            |          2,244 |
| Portable proofs                      |          2,106 |
| Readable proof-source artifacts      |            392 |
| Corpus size (`characters / 4`)       | 134,105 tokens |
| `api endpoint --limit 8` retrieval   |   2,812 tokens |
| Observed retrieval payload reduction |          97.9% |
| Observed corpus/retrieval ratio      |         47.69× |

This is a reproducible observation from one 16-project development workspace on
2026-07-22, not a universal token-cost, answer-quality, or task-success claim.
See [Graph Benchmark Methodology](docs/graph-benchmark-methodology.md) for the
source hash, formulas, limitations, and publication gate. Use
`workspace eval` when measuring provider-reported tokens, latency, cost, and a
verified execution outcome.

## Core Workflows

Use the complete intelligence runner for the normal end-to-end path. The
individual commands below are useful for inspection, automation, and targeted
reruns.

### Model, change, and decisions

| What you need                              | Command                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Build and persist the current system model | `npx workspai workspace model --json --write`                                 |
| Save a model baseline                      | `npx workspai workspace snapshot --json`                                      |
| Compare with a baseline or Git state       | `npx workspai workspace diff --from <snapshot-or-git-ref> --json`             |
| Calculate transitive blast radius          | `npx workspai workspace impact --from <diff-report> --json`                   |
| Verify affected projects and evidence      | `npx workspai workspace verify --from-impact <impact-report> --json --strict` |
| Explain a blocker                          | `npx workspai workspace explain release-blocked --json --write`               |

### Graph, agents, and interoperability

| What you need                             | Command                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Inspect a project in the dependency graph | `npx workspai workspace graph explain <project> --json`                                  |
| Query proof-backed workspace entities     | `npx workspai workspace graph entities endpoint --json`                                  |
| Retrieve bounded context for an agent     | `npx workspai workspace graph search "authentication endpoint" --limit 12 --json`        |
| Measure retrieval payload reduction       | `npx workspai workspace graph benchmark "authentication endpoint" --limit 12 --json`     |
| Start a model-usage evaluation            | `npx workspai workspace eval init repair-readiness workspace-intelligence --json`        |
| Export graph for semantic/visual tools    | `npx workspai workspace graph graphml --output workspace-graph.graphml`                  |
| Trace a relationship and its evidence     | `npx workspai workspace graph path <from> <to> --json`                                   |
| Compare two knowledge-graph revisions     | `npx workspai workspace graph overlay --from <graph.json> --json`                        |
| Generate agent-ready context              | `npx workspai workspace context --for-agent --json --write`                              |
| Generate portable agent and IDE surfaces  | `npx workspai workspace agent-sync --write --refresh-context --preset enterprise --json` |
| Expose current evidence to MCP clients    | `npx workspai workspace mcp serve`                                                       |

### Governance and operations

| What you need                        | Command                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Run affected project tests           | `npx workspai workspace run test --affected --blast-radius --json`            |
| Measure one project's test coverage  | `npx workspai project coverage --run --target 80 --strict --json`             |
| Diagnose one project                 | `npx workspai doctor project --json`                                          |
| Run the release/governance gate      | `npx workspai pipeline --json --strict`                                       |
| Run the canonical intelligence chain | `npx workspai workspace intelligence run --for-agent generic --strict --json` |

`workspace verify` consumes current impact, doctor, contract, analysis, and
readiness evidence. Use `workspace intelligence run` for the canonical chain,
or `pipeline` for the broader governance/release workflow.

Other useful operational commands:

```bash
npx workspai doctor workspace
npx workspai setup <python|node|go|java|dotnet> [--warm-deps]
npx workspai workspace list
npx workspai cache <status|clear|prune|repair>
npx workspai mirror <status|sync|verify|rotate>
```

### Understand a change

Create a baseline:

```bash
npx workspai workspace model --json --write
npx workspai workspace snapshot --json
```

After a change:

```bash
npx workspai workspace model --json --write
npx workspai workspace diff \
  --from .workspai/reports/workspace-model-snapshot.json \
  --json
npx workspai workspace impact \
  --from .workspai/reports/workspace-model-diff-last-run.json \
  --json
```

Impact reports include affected projects and graph paths back to the change, so
developers, CI, IDEs, and agents reason over the same blast radius.

### Ground AI tools

```bash
npx workspai workspace agent-sync \
  --write \
  --refresh-context \
  --preset enterprise \
  --json
```

This generates a versioned Agent Customization Pack from workspace evidence,
including `AGENTS.md`, report indexes, skills, and supported Copilot, Cursor,
Claude, and Codex surfaces. AI tools begin with the same scope, commands,
contracts, blockers, and verification evidence used by humans and CI.

For a user-focused graph quickstart, AI output paths, performance boundaries,
and reproducible token-efficiency methodology, see the
[Workspace Knowledge Graph guide](docs/workspace-knowledge-graph.md) and
[Graph Benchmark Methodology](docs/graph-benchmark-methodology.md).

The integrated CLI has one canonical direction: **Workspace Model → Knowledge
Graph**. The model owns the workspace boundary and compact project topology;
bounded providers enrich that inventory into proof-backed cross-domain
relationships without writing back into the model. Both artifacts are published
under one lock with rollback, and the graph contract fixes its source to
`.workspai/reports/workspace-model.json` plus the model's stable structural
SHA-256. Doctor, Context, MCP, and graph streaming reject a mismatched persisted
graph.

## Outputs and Consumers

Workspai separates human output, machine output, and durable cross-tool state:

| Output                                    | Primary consumers                                  |
| ----------------------------------------- | -------------------------------------------------- |
| CLI summaries and next actions            | Developers and operators                           |
| JSON stdout                               | Scripts, CI jobs, IDE command bridges, and agents  |
| Exit codes                                | CI and release gates                               |
| Persisted `.workspai/reports/*` artifacts | Developers, CI, IDEs, dashboards, and agents       |
| Generated grounding files                 | Copilot, Cursor, Claude, Codex, and other AI tools |
| MCP stdio tools                           | MCP-compatible clients                             |
| Workspace watch events                    | Incremental IDE and automation consumers           |

Important durable outputs:

| Artifact                                                            | Producer                       | Used for                                         |
| ------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------ |
| `.workspai/reports/workspace-model.json`                            | `workspace model --write`      | Canonical system structure                       |
| `.workspai/reports/workspace-knowledge-graph.json`                  | `workspace model --write`      | Proof-backed retrieval and MCP                   |
| `.workspai/reports/workspace-model-diff-last-run.json`              | `workspace diff`               | Structural change evidence                       |
| `.workspai/reports/workspace-impact-last-run.json`                  | `workspace impact`             | Blast radius and affected scope                  |
| `.workspai/reports/workspace-verify-last-run.json`                  | `workspace verify`             | Structured verification gate                     |
| `.workspai/reports/workspace-context-agent.json`                    | `workspace context --write`    | Canonical agent context                          |
| `.workspai/reports/INDEX.json`                                      | `workspace agent-sync --write` | Agent read order and report discovery            |
| `.workspai/reports/workspace-explain-last-run.json`                 | `workspace explain --write`    | Evidence-backed narrative                        |
| `.workspai/reports/workspace-intelligence-history.json`             | Verify and feedback flows      | Trends and audit history                         |
| `.workspai/reports/workspace-intelligence-evaluation-live.json`     | `workspace eval init/record`   | Live provider/tokenizer usage and activity       |
| `.workspai/reports/workspace-intelligence-evaluation-last-run.json` | `workspace eval report`        | Final usage, cost, and verified outcome evidence |
| `.workspai/reports/pipeline-last-run.json`                          | `pipeline --json`              | CI and release workflow result                   |

See the [Artifact Catalog](docs/contracts/ARTIFACT_CATALOG.md) for the complete
writer, schema, and consumer map.

### Graph interchange formats

The canonical persisted graph is JSON. Explicit projections make the same
governed data usable in documentation, semantic systems, and visualization
tools without changing the source of truth:

| Format  | Typical use                             | Command selector              |
| ------- | --------------------------------------- | ----------------------------- |
| JSON    | Canonical artifact and programmatic use | `workspace graph emit --json` |
| JSON-LD | Semantic-web and linked-data tools      | `workspace graph jsonld`      |
| Mermaid | Markdown documentation and diagrams     | `workspace graph mermaid`     |
| DOT     | Graphviz rendering                      | `workspace graph dot`         |
| GraphML | General graph analysis tools            | `workspace graph graphml`     |
| GEXF    | Exploration and visualization tools     | `workspace graph gexf`        |

## Onboard Software

All onboarding routes feed the same Workspace Intelligence model.

| Route            | Use it when                                       | Example                                                                                                  |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Adopt            | Existing source should stay in place              | `npx workspai adopt /path/to/project --json`                                                             |
| Import local     | Existing source should be copied into a workspace | `npx workspai import ../orders-api --workspace /path/to/workspace --json`                                |
| Import Git       | A repository should be cloned into a workspace    | `npx workspai import https://github.com/acme/orders-api.git --git --workspace /path/to/workspace --json` |
| Create workspace | You need a new governed boundary                  | `npx workspai create workspace my-workspace --profile polyglot --yes`                                    |
| Create project   | You need a supported new scaffold                 | `npx workspai create project nextjs web --yes`                                                           |
| Interactive      | You want Workspai to guide the choice             | `npx workspai create`                                                                                    |

Adopt never moves or copies source. Create can use a Workspai-managed kit or an
available official ecosystem generator. Unsupported native create requests are
directed toward official tooling followed by adoption.

Detailed onboarding behavior:

- [Creating Workspaces and Projects](docs/creating-workspaces-and-projects.md)
- [Workspace Operations](docs/workspace-operations.md)
- [Create Planner Capabilities](docs/create-planner-capabilities.md)

## Integrations

- **AI tools:** Generate context, `AGENTS.md`, instructions, skills, and tool-specific surfaces with `workspace agent-sync`.
- **CI:** Consume structured reports and exit codes with `pipeline --json --strict`.
- **IDEs:** Read the same model, impact, verification, contract, and context artifacts used by CI.
- **MCP:** Expose read-mostly workspace evidence with `workspace mcp serve`.
- **VS Code:** Use the [Workspai extension](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode) for dashboards, impact, evidence, guided workflows, and Incident Studio.

The VS Code extension invokes this npm CLI, so command-line and visual workflows
share the same contracts and artifacts.

The Marketplace listing may temporarily retain legacy `rapidkit` wording. The
canonical package, command, metadata namespace, and Node.js requirement are the
`workspai`, `.workspai`, and Node.js `>=20.19.0` contracts documented here.

## Requirements

- Node.js `>=20.19.0`
- npm
- Python `>=3.10` only for Python/Core-dependent workflows
- Java, Go, or .NET SDK only when operating those project types

Python is not required for Python-free workspace profiles, npm-owned backend
generators, frontend generators, or workspaces created with
`--skip-python-engine`.

RapidKit Core is the optional Python engine used only by Python/Core-dependent
workflows; it is not a replacement CLI.

## Documentation

| Documentation                                                                  | Purpose                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [Documentation index](docs/README.md)                                          | All user, operator, contract, and contributor docs            |
| [Command reference](docs/commands-reference.md)                                | Complete command syntax and flags                             |
| [Creating workspaces and projects](docs/creating-workspaces-and-projects.md)   | Interactive, automated, location, and linking behavior        |
| [Workspace operations](docs/workspace-operations.md)                           | Adopt, import, snapshots, archives, contracts, and infra      |
| [Workspace run](docs/workspace-run.md)                                         | Polyglot and affected-project execution                       |
| [Workspace Knowledge Graph](docs/workspace-knowledge-graph.md)                 | Proof-backed queries, AI/MCP retrieval, and graph outputs     |
| [Graph benchmark methodology](docs/graph-benchmark-methodology.md)             | Reproducible payload-reduction measurements and claim limits  |
| [Workspace Intelligence Evaluation](docs/workspace-intelligence-evaluation.md) | Live token, cost, activity, and verified-outcome measurements |
| [Glossary](docs/GLOSSARY.md)                                                   | Plain-language meanings for model, graph, evidence, and gates |
| [Doctor command](docs/doctor-command.md)                                       | Health checks, evidence, fixes, and exit codes                |
| [CI workflows](docs/ci-workflows.md)                                           | CI examples and repository validation                         |
| [Configuration](docs/config-file-guide.md)                                     | User configuration and precedence                             |
| [Open-source scenarios](docs/OPEN_SOURCE_USER_SCENARIOS.md)                    | Role-oriented examples                                        |
| [Artifact Catalog](docs/contracts/ARTIFACT_CATALOG.md)                         | Canonical files, writers, schemas, and readers                |

Repository workflows include
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml),
[`.github/workflows/workspace-e2e-matrix.yml`](../../.github/workflows/workspace-e2e-matrix.yml),
[`.github/workflows/windows-bridge-e2e.yml`](../../.github/workflows/windows-bridge-e2e.yml),
[`.github/workflows/e2e-smoke.yml`](../../.github/workflows/e2e-smoke.yml),
[`.github/workflows/frontend-generator-smoke.yml`](../../.github/workflows/frontend-generator-smoke.yml),
[`.github/workflows/security.yml`](../../.github/workflows/security.yml), and the
maintainer-only
[`.github/workflows/release-npm-manual.yml`](../../.github/workflows/release-npm-manual.yml).
See [CI Workflows](docs/ci-workflows.md) for the complete validation and
contributor-automation map.

## Troubleshooting

| Problem                            | What to check                                  | Next step                                                                |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| Node version is rejected           | `node --version`                               | Install Node.js `>=20.19.0`                                              |
| `npx` resolves an old CLI          | `npx workspai --version`                       | Run `npx workspai@latest --version` or update the global package         |
| Python/Core workflow cannot start  | `python3 --version`                            | Install Python 3.10+ or use a Python-free profile where supported        |
| Workspace is not detected          | Look for `.workspai-workspace`                 | Run from the workspace or pass `--workspace <path>`                      |
| Strict policy blocks a command     | `.workspai/policies.yml`                       | Inspect `workspace policy show` before changing policy                   |
| Reports are stale                  | Report timestamps                              | Re-run `workspace intelligence run` or the documented producing command  |
| AI tools ignore workspace evidence | `AGENTS.md` and `.workspai/reports/INDEX.json` | Run `workspace agent-sync --write --refresh-context`                     |
| Project generator fails            | Runtime and network output                     | Fix the reported prerequisite, then retry or create officially and adopt |

For command-specific behavior, use the
[Command Reference](docs/commands-reference.md) and
[Documentation Index](docs/README.md).

## Contributing and Support

Workspai is MIT-licensed and developed in the open. Contributions to runtime
support, contracts, documentation, tests, and Workspace Intelligence workflows
are welcome. Workspai is built by [Chistiq](https://chistiq.com/).

From a source checkout:

```bash
npm ci
npm run build
npm test
npm run validate
```

Use the npm version declared by the repository's `packageManager` field. Python,
Go, Java, and .NET are required only for workflows that exercise those runtimes.
To validate only this package, run `npm --workspace workspai run validate` from
the monorepo root.

- Read [CONTRIBUTING.md](https://github.com/chistiq/workspai/blob/main/packages/cli/CONTRIBUTING.md) before submitting changes.
- Use [GitHub Issues](https://github.com/chistiq/workspai/issues) for reproducible bugs and feature requests.
- Use [GitHub Discussions](https://github.com/chistiq/workspai/discussions) for questions and design conversations.
- Read the [Development Guide](docs/DEVELOPMENT.md) for local workflows.
- Report vulnerabilities through the [Security Policy](docs/SECURITY.md), not a public issue.
- Review the [Changelog](https://github.com/chistiq/workspai/blob/main/packages/cli/CHANGELOG.md) before upgrading.

## License

MIT. See [LICENSE](LICENSE).
