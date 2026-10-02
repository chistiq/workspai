# Workspai NPM — Documentation Index

Start here to map an existing project, inspect blockers, and give your coding
agent focused context. These guides also cover new projects, teams, and CI.

Start with the [main README](../README.md) for the product overview, or use the
quickstart below. `workspai` is the main package and command; `wspai` is only a
shorter optional name.

## Start with an existing project

You need Node.js **20.19+** and npm. The system map and checks do not require an
AI API key. Open your project and run:

```bash
cd /path/to/your/project
npx workspai adopt .
npx workspai workspace intelligence run --for-agent generic
```

Your source stays in place. Workspai writes project metadata and agent entry
files and saves shared reports in the linked workspace. Read the terminal
summary for detected projects, context, and recorded blockers.

Choose your next step:

| You want to… | Try this |
| --- | --- |
| Inspect a system relationship | `npx workspai workspace graph search "authentication" --limit 5 --json` — use a term from your code |
| Validate the entry for a coding agent | `npx workspai agent bootstrap --for-agent generic --strict --json` |
| Use the complete runner in CI | `npx workspai workspace intelligence run --for-agent generic --strict --json` |

Keep using the same project terminal. `generic` prepares portable context for
supported agent hosts; use a named host such as `codex`, `claude`, or `cursor`
for its bootstrap receipt. [Agent entry guide](./agent-entry.md).

If a check is blocked, inspect the report and its evidence before claiming
readiness. An empty graph search means no match is proven by the current graph.
Refreshing Workspace Intelligence updates the saved system view after changes.

Starting a new project instead? Open the guided flow:

```bash
npx workspai create
```

[Creating workspaces and projects](./creating-workspaces-and-projects.md) covers
the choices. For the broader release workflow, see
[CI workflows](./ci-workflows.md); `pipeline` complements the intelligence runner.

## Table of contents

- [Choose a guide by goal](#choose-a-guide-by-goal)
- [User documentation](#user-documentation)
- [Operations & security](#operations--security)
- [AI module recommendations](#ai-module-recommendations)
- [Technical contracts](#technical-contracts)
- [Contributor documentation](#contributor-documentation)
- [Validation commands](#validation-commands)

## Choose a guide by goal

| I want to…                                         | Start here                                                                                  | Expected outcome                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Create a workspace or project                      | [Creating workspaces and projects](./creating-workspaces-and-projects.md)                   | A registered project with canonical `.workspai` metadata                 |
| Bring an existing repository under governance      | [Workspace operations](./workspace-operations.md#import-and-adoption)                       | Source stays in place with `adopt`, or is copied/cloned with `import`    |
| Run the complete intelligence loop                 | [Unified runner](./workspace-intelligence-runner.md)                                        | One ordered run report with durable stage evidence                       |
| Turn plain language into governed work             | [Goal Packs](./goal-packs.md)                                                               | A scope-bound, evidence-pinned plan and portable agent handoff           |
| Prove what an agent changed and why                | [Proof-Carrying Change](./proof-carrying-change.md)                                         | A Goal-bound, effect-receipted, independently verified change capsule    |
| Define or implement an agent framework integration | [Agent Framework Adapter Contract](./agent-framework-adapters.md)                           | One provider-neutral manifest, ownership boundary, and conformance gate  |
| Create a server-owned model gateway                | [AI Gateway](./model-gateways.md)                                                           | OpenRouter TypeScript or Python Client SDK starter with workspace lifecycle |
| Ground an agent before broad source discovery      | [Canonical-first agent entry](./agent-entry.md)                                             | A portable receipt for host discovery, evidence integrity, and freshness |
| Repair a blocker through an approved transaction   | [Workspace Repair Engine](./workspace-repair-engine.md)                                     | Checkpointed execution, validation, canonical verify, and safe rollback  |
| Observe current CLI and Studio activity            | [Workspai Live](./workspace-live-activity.md)                                               | One bounded activity projection for terminal, IDE, replay, and capture   |
| Set a release, security, or coverage outcome       | [Verified engineering goals](./workspace-intelligence-runner.md#verified-engineering-goals) | A durable success contract with a current evidence-backed verdict        |
| Ask an architecture or dependency question         | [Workspace Knowledge Graph](./workspace-knowledge-graph.md)                                 | A bounded answer with proof references rather than the whole graph       |
| Measure agent token, cost, and outcome efficiency  | [Workspace Intelligence Evaluation](./workspace-intelligence-evaluation.md)                 | A live, provenance-aware report suitable for CLI, IDE, and CI            |
| Benchmark bounded retrieval across fixed scenarios | [Workspace Intelligence Benchmark](./workspace-intelligence-benchmark.md)                   | An offline suite with honest estimate/measurement boundaries             |
| Integrate CI or release gates                      | [CI workflows](./ci-workflows.md)                                                           | Machine-readable exit codes and uploadable evidence                      |
| Find the writer, schema, or path for an output     | [Artifact Catalog](./contracts/ARTIFACT_CATALOG.md)                                         | One canonical source instead of path guessing                            |
| Understand Workspai terminology                    | [Glossary](./GLOSSARY.md)                                                                   | Shared meanings for model, graph, evidence, gate, and artifacts          |
| Review or change the main product README           | [README content contract](./README_CONTENT_CONTRACT.md)                                     | Stable narrative, claim boundaries, and machine-enforced drift rules     |
| Choose a first contribution path                   | [Contribution Hub](../../../.github/CONTRIBUTING.md)                                        | One bounded task, support route, and file-aware validation plan          |
| Contribute to the CLI                              | [Development](./DEVELOPMENT.md)                                                             | Local build, test, contract, and documentation gates                     |

There are two different AI-facing features. Workspace Intelligence is
deterministic, proof-backed, and does not require an AI API key. The optional
module recommender uses embeddings to suggest FastAPI or NestJS modules; start
with [AI Quickstart](./AI_QUICKSTART.md) only when that is your goal.

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

## Repository layout

```text
workspai/
├── README.md                 # Monorepo overview
├── package.json              # Private workspace root
└── packages/
    └── cli/
        ├── README.md         # CLI user hub (install, quickstarts, doc links)
        ├── CHANGELOG.md
        ├── RELEASE_NOTES.md
        ├── releases/         # Per-version release notes
        └── docs/
            ├── README.md     # This index
            ├── README_CONTENT_CONTRACT.md
            ├── commands-reference.md
            ├── workspace-knowledge-graph.md
            ├── workspace-intelligence-evaluation.md
            ├── workspace-operations.md
            ├── workspace-run.md
            ├── ci-workflows.md
            ├── doctor-command.md
            ├── OPEN_SOURCE_USER_SCENARIOS.md
            ├── config-file-guide.md
            ├── SECURITY.md
            ├── SETUP.md
            ├── DEVELOPMENT.md
            ├── contracts/    # Contract docs (mirrors + matrices)
            └── …             # AI guides, policies, examples
```

Enterprise governance runbooks are maintained outside this OSS docs tree.
