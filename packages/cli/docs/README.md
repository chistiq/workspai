# Workspai NPM — Documentation Index

Workspai helps people and tools understand the same software system. Use these
guides to connect existing projects, create new ones, map their relationships,
check changes, prepare AI context, and automate release checks.

Start with the [main README](../README.md) for the product overview, or use the
quickstart below. `workspai` is the main package and command; `wspai` is only a
shorter optional name.

## Quickstart: connect an existing project

Connect an existing project without moving it, then create one saved,
checkable view for developers, CI, IDEs, MCP clients, and AI agents:

```bash
cd /absolute/path/to/project
npx workspai adopt .
```

`adopt` keeps the project in place and creates or reuses the minimal default
workspace. Continue from the same project terminal:

```bash
npx workspai project workspace status --json
npx workspai workspace intelligence run --for-agent generic --strict --json
npx workspai agent bootstrap --for-agent generic --json
```

The first command proves which canonical workspace owns the project. Workspai
uses a gitignored machine-local binding and portable project grounding, so
workspace commands and compatible agents do not need a manual `cd`.

Use `generic` for a vendor-neutral context pack, or select a published host
target such as `codex`, `claude`, `gemini`, `qwen`, `kimi`, `grok`, `copilot`,
`cursor`, `windsurf`, or `amazon-q`. Agent Sync publishes shared files and thin
host adapters that route every consumer to the same evidence.

Use the release pipeline when you need the broader release workflow:

```bash
npx workspai pipeline --json --strict
```

Adoption keeps source in place. The command maps the system and its
connections, checks what changes may affect, runs health and release checks,
and prepares focused AI context under `.workspai/`. When the workspace is not
ready, the report shows the reason and points to the files or reports behind
it. Automation details and supported AI tools are documented in the
[Unified runner](./workspace-intelligence-runner.md). See the
[Artifact Catalog](./contracts/ARTIFACT_CATALOG.md) for exact paths, writers,
schemas, and consumers.

To start with a new workspace instead:

```bash
npx workspai create workspace my-workspace --profile minimal --yes
cd ~/.workspai/workspaces/my-workspace
npx workspai create project nextjs web --yes
```

From the workspace terminal, create a project, use `adopt` to link one in place,
or use `import` to copy or clone one into the workspace.

## Table of contents

- [Choose a guide by goal](#choose-a-guide-by-goal)
- [User documentation](#user-documentation)
- [Operations & security](#operations--security)
- [AI module recommendations](#ai-module-recommendations)
- [Technical contracts](#technical-contracts)
- [Contributor documentation](#contributor-documentation)
- [Validation commands](#validation-commands)

## Choose a guide by goal

| I want to…                                        | Start here                                                                                  | Expected outcome                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Create a workspace or project                     | [Creating workspaces and projects](./creating-workspaces-and-projects.md)                   | A registered project with canonical `.workspai` metadata                 |
| Bring an existing repository under governance     | [Workspace operations](./workspace-operations.md#import-and-adoption)                       | Source stays in place with `adopt`, or is copied/cloned with `import`    |
| Run the complete intelligence loop                | [Unified runner](./workspace-intelligence-runner.md)                                        | One ordered run report with durable stage evidence                       |
| Turn plain language into governed work            | [Goal Packs](./goal-packs.md)                                                               | A scope-bound, evidence-pinned plan and portable agent handoff           |
| Ground an agent before broad source discovery     | [Canonical-first agent entry](./agent-entry.md)                                             | A portable receipt for host discovery, evidence integrity, and freshness |
| Repair a blocker through an approved transaction  | [Workspace Repair Engine](./workspace-repair-engine.md)                                     | Checkpointed execution, validation, canonical verify, and safe rollback  |
| Set a release, security, or coverage outcome      | [Verified engineering goals](./workspace-intelligence-runner.md#verified-engineering-goals) | A durable success contract with a current evidence-backed verdict        |
| Ask an architecture or dependency question        | [Workspace Knowledge Graph](./workspace-knowledge-graph.md)                                 | A bounded answer with proof references rather than the whole graph       |
| Measure agent token, cost, and outcome efficiency | [Workspace Intelligence Evaluation](./workspace-intelligence-evaluation.md)                 | A live, provenance-aware report suitable for CLI, IDE, and CI            |
| Integrate CI or release gates                     | [CI workflows](./ci-workflows.md)                                                           | Machine-readable exit codes and uploadable evidence                      |
| Find the writer, schema, or path for an output    | [Artifact Catalog](./contracts/ARTIFACT_CATALOG.md)                                         | One canonical source instead of path guessing                            |
| Understand Workspai terminology                   | [Glossary](./GLOSSARY.md)                                                                   | Shared meanings for model, graph, evidence, gate, and artifacts          |
| Review or change the main product README          | [README content contract](./README_CONTENT_CONTRACT.md)                                     | Stable narrative, claim boundaries, and machine-enforced drift rules     |
| Contribute to the CLI                             | [Development](./DEVELOPMENT.md)                                                             | Local build, test, contract, and documentation gates                     |

There are two different AI-facing features. Workspace Intelligence is
deterministic, proof-backed, and does not require an AI API key. The optional
module recommender uses embeddings to suggest FastAPI or NestJS modules; start
with [AI Quickstart](./AI_QUICKSTART.md) only when that is your goal.

## User documentation

| Document                                                                                       | Description                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [creating-workspaces-and-projects.md](./creating-workspaces-and-projects.md)                   | Plain-language guide to every workspace and project creation scenario                                              |
| [commands-reference.md](./commands-reference.md)                                               | Full CLI syntax, profiles, and policy keys                                                                         |
| [workspace-operations.md](./workspace-operations.md)                                           | Import, adopt, snapshots, archives, contracts, infra                                                               |
| [workspace-run.md](./workspace-run.md)                                                         | Polyglot fleet orchestration (`workspace run`)                                                                     |
| [workspace-intelligence-runner.md](./workspace-intelligence-runner.md)                         | Canonical unified runner, execution envelope, report schema, exit codes, failure propagation, and CI consumption   |
| [workspace-repair-engine.md](./workspace-repair-engine.md)                                     | CLI-owned plan, approval, checkpoint, execution, verification, decision, and rollback state machine                |
| [goal-packs.md](./goal-packs.md)                                                               | Plain-language intent compilation, scope/evidence binding, agent handoff, and mutation boundary                    |
| [agent-entry.md](./agent-entry.md)                                                             | Host-native discovery, canonical evidence preflight, receipt status, privacy, and consumer integration             |
| [workspace-knowledge-graph.md](./workspace-knowledge-graph.md)                                 | Two-minute graph quickstart, proof model, AI/MCP consumption, performance, and honest token-efficiency measurement |
| [graph-benchmark-methodology.md](./graph-benchmark-methodology.md)                             | Reproducible payload-reduction benchmark, formulas, claim boundaries, and publication rules                        |
| [workspace-intelligence-evaluation.md](./workspace-intelligence-evaluation.md)                 | Provider usage, cost provenance, verified outcomes, comparison, and extension consumption                          |
| [GLOSSARY.md](./GLOSSARY.md)                                                                   | Plain-language definitions for workspace, model, graph, evidence, gates, and AI integrations                       |
| [README_CONTENT_CONTRACT.md](./README_CONTENT_CONTRACT.md)                                     | Required root README journey, architecture statements, claim policy, and drift guard                               |
| [create-planner-capabilities.md](./create-planner-capabilities.md)                             | Native create, official, and existing lanes                                                                        |
| [../contracts/project-entry-capability.v1.json](../contracts/project-entry-capability.v1.json) | Contract: any readable project can enter through adopt/import when it can be registered                            |
| [from-code-to-shared-understanding.md](./from-code-to-shared-understanding.md)                 | GitHub-rendered Workspace Intelligence diagram                                                                     |
| [OPEN_SOURCE_USER_SCENARIOS.md](./OPEN_SOURCE_USER_SCENARIOS.md)                               | Role-based workflows (junior → enterprise)                                                                         |
| [doctor-command.md](./doctor-command.md)                                                       | Doctor scopes, CI exit codes, JSON evidence                                                                        |
| [config-file-guide.md](./config-file-guide.md)                                                 | User config file (`~/.workspairc.json`, `workspai.config.*`, with legacy fallbacks)                                |
| [WORKSPACE_MARKER_SPEC.md](./WORKSPACE_MARKER_SPEC.md)                                         | Workspace marker format                                                                                            |
| [PACKAGE_MANAGER_POLICY.md](./PACKAGE_MANAGER_POLICY.md)                                       | npm-only policy for this repository                                                                                |

**Common tasks**

- Create a workspace or project: [creating-workspaces-and-projects.md](./creating-workspaces-and-projects.md)
- Adopt an existing repo: [workspace-operations.md#import-and-adoption](./workspace-operations.md#import-and-adoption)
- Scaffold a frontend app: [commands-reference.md](./commands-reference.md) (`create project nextjs <name>`)
- Canonical intelligence gate: `workspace intelligence run --for-agent generic --strict --json`
- Agent entry preflight: `agent bootstrap --for-agent <host> --json`
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

| Document                                         | Description                               |
| ------------------------------------------------ | ----------------------------------------- |
| [DEVELOPMENT.md](./DEVELOPMENT.md)               | Local dev, testing, debugging             |
| [SETUP.md](./SETUP.md)                           | Build gates, smoke flows, release hygiene |
| [ci-workflows.md](./ci-workflows.md)             | GitHub Actions workflow map               |
| [OPTIMIZATION_GUIDE.md](./OPTIMIZATION_GUIDE.md) | Performance and improvement notes         |
| [UTILITIES.md](./UTILITIES.md)                   | Internal cache and metrics helpers        |

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
