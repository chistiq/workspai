# Workspai documentation

**New here? Start with your project.** You do not need to learn the architecture
or move your source to try Workspai.

[Product overview](../README.md) · [Command reference](./commands-reference.md) ·
[Glossary](./GLOSSARY.md)

## First run

You need **Node.js 20.19+ and npm**. In your project's terminal:

```bash
npx workspai adopt .
npx workspai workspace intelligence run --for-agent generic
```

Workspai adds metadata and agent entry files to your project and saves shared
reports in a linked workspace. The system map and checks do not require an AI
API key. Read the terminal summary to find context and checks that need attention.

Starting a new project? Run `npx workspai create` for guided setup.

## What do you want to do next?

| Your goal | Start here |
| --- | --- |
| Set up an existing or new project | [Getting started](./creating-workspaces-and-projects.md) |
| Connect Codex, Claude Code, Cursor, or Copilot | [Agent setup](./agent-entry.md) |
| Find relationships and their source references | [Explore the graph](./workspace-knowledge-graph.md) |
| Give an agent a specific outcome | [Plan a goal](./goal-packs.md) |
| Record and verify an agent's changes | [Proof-Carrying Change](./proof-carrying-change.md) |
| Fix a reported blocker | [Doctor](./doctor-command.md) · [Repair workflow](./workspace-repair-engine.md) |
| Run checks in CI | [CI guide](./ci-workflows.md) |

You can keep working from the same project terminal. After changes, rerun the
intelligence command to refresh the saved view. A blocked check names something
to investigate; an empty graph search means no current evidence proves a match.

## For CI and automation

Use the strict JSON runner:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

[Runner behavior and exit codes](./workspace-intelligence-runner.md) ·
[Generated files and schemas](./contracts/ARTIFACT_CATALOG.md)

## Building agents or model gateways?

[Agent framework adapters](./agent-framework-adapters.md) covers the supported
framework kits. [Model gateways](./model-gateways.md) covers server-owned SDK
starters. These are separate from giving a coding agent context about your project.

## Reference library

Looking for a specific feature, integration, or contract? Open the complete index.

<details>
<summary>All guides, technical contracts, and contributor resources</summary>

## User documentation

| Document                                                                                       | Description                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [creating-workspaces-and-projects.md](./creating-workspaces-and-projects.md)                   | Plain-language guide to every workspace and project creation scenario                                               |
| [commands-reference.md](./commands-reference.md)                                               | Full CLI syntax, profiles, and policy keys                                                                          |
| [workspace-operations.md](./workspace-operations.md)                                           | Import, adopt, snapshots, archives, contracts, infra                                                                |
| [workspace-run.md](./workspace-run.md)                                                         | Polyglot fleet orchestration (`workspace run`)                                                                      |
| [workspace-live-activity.md](./workspace-live-activity.md)                                     | Unified CLI/Studio activity, Board projection, replay, accessibility, and SVG capture                               |
| [workspace-intelligence-runner.md](./workspace-intelligence-runner.md)                         | Canonical unified runner, execution envelope, report schema, exit codes, failure propagation, and CI consumption    |
| [workspace-repair-engine.md](./workspace-repair-engine.md)                                     | CLI-owned plan, approval, checkpoint, execution, verification, decision, and rollback state machine                 |
| [goal-packs.md](./goal-packs.md)                                                               | Plain-language intent compilation, scope/evidence binding, agent handoff, and mutation boundary                     |
| [proof-carrying-change.md](./proof-carrying-change.md)                                         | Generation-pinned Decisions ledger, predicted-vs-actual Graph delta, receipts, verification, and capsule validation |
| [agent-entry.md](./agent-entry.md)                                                             | Host-native discovery, canonical evidence preflight, receipt status, privacy, and consumer integration              |
| [agent-framework-adapters.md](./agent-framework-adapters.md)                                   | Framework-neutral kit/attach contract, admitted Microsoft pins, implemented OpenAI adapters pending admission, and conformance |
| [model-gateways.md](./model-gateways.md)                                                       | AI Gateway category, OpenRouter Client SDK baselines, routing/privacy policy, and lifecycle |
| [workspace-knowledge-graph.md](./workspace-knowledge-graph.md)                                 | Two-minute graph quickstart, proof model, AI/MCP consumption, performance, and honest token-efficiency measurement  |
| [graph-benchmark-methodology.md](./graph-benchmark-methodology.md)                             | Reproducible payload-reduction benchmark, formulas, claim boundaries, and publication rules                         |
| [workspace-intelligence-evaluation.md](./workspace-intelligence-evaluation.md)                 | Provider usage, cost provenance, verified outcomes, comparison, and extension consumption                           |
| [workspace-intelligence-benchmark.md](./workspace-intelligence-benchmark.md)                   | Fixed multi-scenario retrieval metrics, measured evaluation attachment, and publication-safe claim boundaries       |
| [GLOSSARY.md](./GLOSSARY.md)                                                                   | Plain-language definitions for workspace, model, graph, evidence, gates, and AI integrations                        |
| [README_CONTENT_CONTRACT.md](./README_CONTENT_CONTRACT.md)                                     | Required root README journey, architecture statements, claim policy, and drift guard                                |
| [create-planner-capabilities.md](./create-planner-capabilities.md)                             | Native create, official, and existing lanes                                                                         |
| [native-kit-baselines.md](./native-kit-baselines.md)                                           | Owned Go, Java, .NET, and Rust generator baselines, upgrade policy, and validation contract                         |
| [../contracts/project-entry-capability.v1.json](../contracts/project-entry-capability.v1.json) | Contract: any readable project can enter through adopt/import when it can be registered                             |
| [from-code-to-shared-understanding.md](./from-code-to-shared-understanding.md)                 | GitHub-rendered Workspace Intelligence diagram                                                                      |
| [OPEN_SOURCE_USER_SCENARIOS.md](./OPEN_SOURCE_USER_SCENARIOS.md)                               | Role-based workflows (junior → enterprise)                                                                          |
| [doctor-command.md](./doctor-command.md)                                                       | Doctor scopes, CI exit codes, JSON evidence                                                                         |
| [config-file-guide.md](./config-file-guide.md)                                                 | User config file (`~/.workspairc.json`, `workspai.config.*`, with legacy fallbacks)                                 |
| [WORKSPACE_MARKER_SPEC.md](./WORKSPACE_MARKER_SPEC.md)                                         | Workspace marker format                                                                                             |
| [PACKAGE_MANAGER_POLICY.md](./PACKAGE_MANAGER_POLICY.md)                                       | npm-only policy for this repository                                                                                 |

**Common tasks**

- Create a workspace or project: [creating-workspaces-and-projects.md](./creating-workspaces-and-projects.md)
- Adopt an existing repo: [workspace-operations.md#import-and-adoption](./workspace-operations.md#import-and-adoption)
- Scaffold a frontend app: [commands-reference.md](./commands-reference.md) (`create project nextjs <name>`)
- Canonical intelligence gate: `workspace intelligence run --for-agent generic --strict --json`
- Agent entry preflight: `agent bootstrap --for-agent <host> --json`
- Governed agent runtime: `agent framework attach --project <name> --runtime <python|dotnet|node> --name <agent>`
- Broader CI release gate: [commands-reference.md](./commands-reference.md) (`pipeline`, `readiness`)
- Targeted model/context inspection — schemas in [contracts/workspace-intelligence/](../contracts/workspace-intelligence/)

## Operations & security

| Document                                                                                 | Description                                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [SECURITY.md](./SECURITY.md)                                                             | Vulnerability reporting and supported versions |
| [policies.workspace.example.yml](./policies.workspace.example.yml)                       | Workspace policy template                      |
| [governance-policy.enterprise.example.json](./governance-policy.enterprise.example.json) | Sigstore governance allowlist template         |
| [mirror-config.enterprise.example.json](./mirror-config.enterprise.example.json)         | Mirror + evidence export template              |

## AI module recommendations

FastAPI/NestJS module suggestions via OpenAI embeddings (optional).

| Document                                                 | Description                |
| -------------------------------------------------------- | -------------------------- |
| [AI_QUICKSTART.md](./AI_QUICKSTART.md)                   | 60-second setup            |
| [AI_FEATURES.md](./AI_FEATURES.md)                       | Complete feature reference |
| [AI_EXAMPLES.md](./AI_EXAMPLES.md)                       | Use-case examples          |
| [AI_DYNAMIC_INTEGRATION.md](./AI_DYNAMIC_INTEGRATION.md) | Integration architecture   |

## Technical contracts

JSON schemas and ownership rules for tooling parity.

| Location                                                                           | Description                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| [contracts/README.md](./contracts/README.md)                                       | Core CLI JSON contracts + generator scripts       |
| [contracts/COMMAND_OWNERSHIP_MATRIX.md](./contracts/COMMAND_OWNERSHIP_MATRIX.md)   | npm wrapper vs Core command ownership             |
| [contracts/RUNTIME_SUPPORT_MATRIX.md](./contracts/RUNTIME_SUPPORT_MATRIX.md)       | Scaffold/import/lifecycle support tiers           |
| [contracts/RUNTIME_ACCEPTANCE_MATRIX.md](./contracts/RUNTIME_ACCEPTANCE_MATRIX.md) | Runtime acceptance test expectations              |
| [../contracts/](../contracts/)                                                     | Canonical JSON schemas (published in npm tarball) |

Regenerate and verify:

```bash
npm run generate:contracts
npm run check:generated-contracts
npm run contracts:validate
```

## Contributor documentation

| Document                                             | Description                                        |
| ---------------------------------------------------- | -------------------------------------------------- |
| [Contribution Hub](../../../.github/CONTRIBUTING.md) | First-task routes, support, and validation planner |
| [DEVELOPMENT.md](./DEVELOPMENT.md)                   | Local dev, testing, debugging                      |
| [SETUP.md](./SETUP.md)                               | Build gates, smoke flows, release hygiene          |
| [ci-workflows.md](./ci-workflows.md)                 | GitHub Actions workflow map                        |
| [OPTIMIZATION_GUIDE.md](./OPTIMIZATION_GUIDE.md)     | Performance and improvement notes                  |
| [UTILITIES.md](./UTILITIES.md)                       | Internal cache and metrics helpers                 |

Also see [../CONTRIBUTING.md](../CONTRIBUTING.md) and [../CHANGELOG.md](../CHANGELOG.md).

## Validation commands

```bash
npm run validate:docs          # links + drift guard + examples + README smoke
npm run check:markdown-links   # local markdown link integrity
npm run validate:docs-examples # example JSON/YAML in docs
npm run smoke:readme           # CLI help smoke for documented commands
```


</details>

## Help and feedback

[Ask a question](https://github.com/chistiq/workspai/discussions) ·
[Report a problem](https://github.com/chistiq/workspai/issues) ·
[Contribute](../../../.github/CONTRIBUTING.md)
