# Workspai

[![npm version](https://img.shields.io/npm/v/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![Downloads](https://img.shields.io/npm/dm/workspai.svg?style=flat-square)](https://www.npmjs.com/package/workspai)
[![CI](https://img.shields.io/github/actions/workflow/status/chistiq/workspai/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/chistiq/workspai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

## Workspace Intelligence for software systems

> One workspace. One truth. Humans and AI aligned.

Your software is more than source files in one repository. It is projects,
services, APIs, packages, infrastructure, documentation, policies, tests, and
release evidence—and the relationships between them.

Workspai turns those scattered surfaces into one governed view that developers,
CI, IDEs, MCP clients, and AI agents can share:

- **See the system:** a canonical Workspace Model across projects and runtimes.
- **Ask with proof:** a bounded Knowledge Graph answer linked to source evidence.
- **Act with confidence:** impact, verification, readiness, and agent context
  produced by one contract-backed intelligence chain.

[Quickstart](#start-in-two-minutes) ·
[How it works](#how-workspace-intelligence-works) ·
[Knowledge Graph](packages/cli/docs/workspace-knowledge-graph.md) ·
[Documentation](packages/cli/docs/README.md) ·
[Contracts](packages/cli/docs/contracts/README.md) ·
[VS Code](https://marketplace.visualstudio.com/items?itemName=rapidkit.rapidkit-vscode)

## See your workspace as a system

![From Code to Shared Understanding](packages/cli/docs/From%20Code%20to%20Shared%20Understanding.png)

Code search can find a symbol. Workspai can connect that symbol to the project,
API, service, dependency, deployment evidence, affected scope, verification
gate, and agent context around it.

```text
Question: What implements this endpoint, and what could this change affect?

Bounded result
├── matching endpoint and implementation
├── nearby dependencies and affected projects
├── proof paths back to files, lines, and content hashes
└── current verification and readiness evidence
```

Workspai does not invent missing relationships. An absent edge means “not
proven by current evidence,” not “these projects are independent.”

## Start in two minutes

Install the CLI, or keep using it through `npx`:

```bash
npm install -g workspai
workspai --help
```

Create a managed workspace and connect an existing project without moving its
source:

```bash
npx workspai create workspace platform --profile polyglot --skip-python-engine --yes
cd ~/.workspai/workspaces/platform
npx workspai adopt /absolute/path/to/project --json
```

Build the shared model, evidence, and agent-ready context:

```bash
npx workspai workspace intelligence run --for-agent codex --strict --json
```

The durable result is under `.workspai/`. Exit code `0` means passed, `1` means
execution failed, and `2` means the run completed but evidence still blocks the
requested decision.

Already have a Workspai workspace? Run only the final command.

## What Workspai gives you

| You need to know…                | Workspai gives you…                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| What is in this software system? | A canonical model of projects, runtimes, frameworks, commands, contracts, policies, and detected facts |
| How are things connected?        | A queryable Knowledge Graph with typed entities, relations, trust, derivation, and proofs              |
| What changed?                    | Model snapshots and deterministic diffs                                                                |
| What could break?                | Direct and transitive impact paths across registered projects                                          |
| Can this proceed?                | Doctor, contract, analysis, readiness, and verification evidence                                       |
| What should an agent read?       | Bounded context, report indexes, skills, instructions, and MCP tools                                   |
| Why is it blocked?               | Evidence-backed explanations and remediation handoffs                                                  |
| Is context actually smaller?     | Reproducible retrieval benchmarks plus provider-aware execution evaluation                             |

The first run produces a discoverable evidence set, including:

```text
.workspai/
├── workspace.json
├── workspace.contract.json
├── AGENT-GROUNDING.md
├── skills/
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

Canonical JSON artifacts publish versioned schemas. Consumers discover exact
versions and paths through the
[published contract catalog](packages/cli/contracts/published-contract-catalog.v1.json)
instead of scraping Markdown or guessing filenames.

## How Workspace Intelligence works

The Workspace Model is the canonical source of truth. The Knowledge Graph is a
derived, revision-bound representation—not a second competing truth and not a
prompt.

```text
Code · packages · APIs · infra · docs · CI · policies · runtime evidence
                                │
                     deterministic providers
                                │
                         facts + proofs
                                │
                    Canonical Workspace Model
                         │              │
                         │              └── Evidence-backed Knowledge Graph
                         │                         │
                         └──────────┬──────────────┘
                                    │
                  diff · impact · verify · context · explain
                                    │
                 Developers · CI · IDEs · MCP · AI agents
```

This separation keeps Workspai database-agnostic and model-agnostic. JSON,
JSON-LD, Mermaid, DOT, GraphML, GEXF, MCP responses, IDE views, and agent context
are projections of governed data; none silently replaces the model.

### Why this is more than a repository graph

| Repository-level intelligence                             | Workspace Intelligence                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Starts and ends at one codebase                           | Connects one or many projects, repositories, services, infrastructure, docs, and evidence |
| Primarily answers code navigation and retrieval questions | Also drives change impact, verification, readiness, CI, and agent grounding               |
| A graph can become the product truth                      | The model remains canonical; the graph is a proof-carrying representation                 |
| Missing edges can look like independence                  | Missing relationships remain explicitly unknown until evidence proves them                |
| One consumer builds its own context                       | Humans and tools consume the same versioned artifacts and contracts                       |

## Evidence, not guesses

Graph entities and relations carry stable identity and proof references. A proof
can identify its provider, source artifact, line, content hash, observation
time, derivation, trust, confidence, and freshness.

```bash
npx workspai workspace model --write --json
npx workspai workspace graph search "authentication endpoint" --limit 8 --json
npx workspai workspace graph evidence "GET /users" --json
```

Use bounded search for normal agent questions. Read the complete graph only for
interchange, offline analysis, audits, or tools that explicitly need it.

## Measure context honestly

Workspai separates two measurements that are often mixed together:

1. `workspace graph benchmark` measures deterministic retrieval payload size.
2. `workspace eval` records observed model/tool execution, token provenance,
   latency, cost, and independently verified outcomes.

On the current 16-project development fixture, one `api endpoint --limit 8`
query returned 2,812 estimated tokens from a 134,105-token readable corpus—a
97.9% payload reduction. This is one reproducible fixture result, not a
universal billing, quality, or token-saving claim.

```bash
npx workspai workspace graph benchmark "api endpoint" --limit 8 --json
npx workspai workspace eval init repair-readiness workspace-intelligence --json
```

Read the formulas and publication boundary in
[Graph Benchmark Methodology](packages/cli/docs/graph-benchmark-methodology.md)
and the provider/tokenizer provenance contract in
[Workspace Intelligence Evaluation](packages/cli/docs/workspace-intelligence-evaluation.md).

## One contract-backed intelligence chain

The supported chain is versioned, generated, and consumed by the CLI, CI,
documentation, IDE integrations, and agent surfaces:

```text
Model → Diff → Impact → Doctor + Contract Verify + Analyze → Readiness
      → Verify → Context → Agent Sync → Explain
```

Run it as one operation:

```bash
npx workspai workspace intelligence run --for-agent codex --strict --json
```

Each stage declares its inputs, outputs, order, and continuation semantics. The
broader `pipeline` command is a release/governance orchestrator; it complements
this chain and does not redefine it.

Read the [runner contract](packages/cli/docs/workspace-intelligence-runner.md)
or inspect the machine-readable
[chain schema](packages/cli/contracts/workspace-intelligence-chain.v1.json).

## Choose your workflow

| I want to…                           | Command or guide                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Connect an existing project in place | `npx workspai adopt /path/to/project --json`                                              |
| Create a workspace or project        | [Creating workspaces and projects](packages/cli/docs/creating-workspaces-and-projects.md) |
| Run the complete intelligence chain  | `npx workspai workspace intelligence run --for-agent codex --strict --json`               |
| Ask a bounded architecture question  | `npx workspai workspace graph search "authentication endpoint" --limit 12 --json`         |
| Trace why a relationship exists      | `npx workspai workspace graph evidence "GET /users" --json`                               |
| Inspect a change and blast radius    | [Workspace Knowledge Graph](packages/cli/docs/workspace-knowledge-graph.md)               |
| Verify current evidence              | `npx workspai workspace verify --strict --json`                                           |
| Prepare agent and IDE surfaces       | `npx workspai workspace agent-sync --write --preset enterprise --json`                    |
| Integrate CI and release gates       | [CI workflows](packages/cli/docs/ci-workflows.md)                                         |
| Find an artifact writer or schema    | [Artifact Catalog](packages/cli/docs/contracts/ARTIFACT_CATALOG.md)                       |
| Browse every command and flag        | [Command reference](packages/cli/docs/commands-reference.md)                              |

## Open outputs for every consumer

| Consumer                 | Stable surface                                                      |
| ------------------------ | ------------------------------------------------------------------- |
| Developers               | Human summaries, explanations, and next actions                     |
| Automation and CI        | JSON stdout, exit codes, versioned report schemas                   |
| AI agents                | Bounded context, `AGENTS.md`, skills, prompts, proof paths          |
| MCP clients              | Read-oriented model, graph, context, evidence, and evaluation tools |
| IDEs and dashboards      | Canonical reports, command inventory, watch events, live evaluation |
| Graph and semantic tools | JSON, JSON-LD, Mermaid, DOT, GraphML, and GEXF                      |

Workspai is local-first for deterministic workspace discovery and graph
construction. Optional AI-backed features are identified separately; the core
Workspace Intelligence model and evidence chain do not require an AI API key.

## Documentation

| Start here                                                                                  | Use it for                                                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Documentation index](packages/cli/docs/README.md)                                          | Goal-based navigation across all user and contributor guides           |
| [CLI README](packages/cli/README.md)                                                        | Complete package quickstart, workflows, outputs, and integrations      |
| [Workspace Knowledge Graph](packages/cli/docs/workspace-knowledge-graph.md)                 | Queries, proofs, overlays, export formats, MCP, and current boundaries |
| [Unified runner](packages/cli/docs/workspace-intelligence-runner.md)                        | Exact chain, baseline, failure propagation, reports, and exit codes    |
| [Workspace Intelligence Evaluation](packages/cli/docs/workspace-intelligence-evaluation.md) | Live token/cost provenance and verified outcome comparison             |
| [Artifact Catalog](packages/cli/docs/contracts/ARTIFACT_CATALOG.md)                         | Canonical writers, paths, schemas, and consumers                       |
| [Glossary](packages/cli/docs/GLOSSARY.md)                                                   | Plain-language meaning of model, graph, proof, gate, and context       |
| [README content contract](packages/cli/docs/README_CONTENT_CONTRACT.md)                     | Required product narrative, claim boundaries, and drift guard          |

## Packages

The integrated CLI already exposes these capabilities. Package boundaries are
being hardened for independent use; they do not represent missing CLI features.

| Package                               | Status                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| [`workspai`](packages/cli)            | Published CLI and canonical orchestration surface                       |
| [`wspai`](packages/wspai)             | Published optional short alias for `npx` workflows                      |
| [`@workspai/shared`](packages/shared) | Private contract and primitive foundation under conformance development |
| [`@workspai/graph`](packages/graph)   | Private standalone graph foundation under public-API development        |

As these boundaries become independently publishable, the CLI will consume
them while preserving one integrated workspace experience.

## Develop this monorepo

Requirements: Node.js `>=20.19.0` and the package manager declared in
`package.json`. Additional runtimes are needed only for their acceptance flows.

```bash
npm ci
npm run build
npm test
npm run validate
```

Before contributing, read the
[Development Guide](packages/cli/docs/DEVELOPMENT.md),
[Contributing Guide](packages/cli/CONTRIBUTING.md), and
[README content contract](packages/cli/docs/README_CONTENT_CONTRACT.md).

## Community

Workspai is an open-source project by [Chistiq](https://chistiq.com/), the
intelligence infrastructure company behind RapidKit and Workspai.

- [Issues](https://github.com/chistiq/workspai/issues) for reproducible bugs and feature requests
- [Discussions](https://github.com/chistiq/workspai/discussions) for questions and design proposals
- [Security policy](packages/cli/docs/SECURITY.md) for private vulnerability reporting
- [Changelog](packages/cli/CHANGELOG.md) for release history

## License

MIT. See [LICENSE](LICENSE).
