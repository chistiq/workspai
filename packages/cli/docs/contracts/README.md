# Workspai CLI Contracts

Contract documentation for JSON payloads, support matrices, and cross-repo parity.

## Complete contract discovery

The complete machine-readable inventory is
[`../../contracts/published-contract-catalog.v1.json`](../../contracts/published-contract-catalog.v1.json).
It is the source of truth for every published schema/capability path; the lists
below are grouped entry points, not a substitute for that catalog.

Installed consumers can discover the active package version and contract map
without scraping Markdown:

```bash
npx workspai --version --json
```

Resolve contract files from the installed `workspai/contracts/` directory and
validate payloads against the exact catalog revision shipped with that CLI.
Do not copy a schema from `main` and assume it matches an older installed CLI.

## Monorepo workflow

Canonical JSON lives in **`../../contracts/`** (CLI package root, published in the tarball).

| Script                                      | Purpose                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run generate:contracts`                | Regenerate runtime surface, create planner, agent customization pack, import-stack parity, module-layout, infra-stack |
| `npm run check:generated-contracts`         | Verify committed JSON matches generators                                                                              |
| `npm run sync:shared-contracts`             | Generate canonical JSON and sync root plus locally available consumer mirrors                                          |
| `npm run sync:parity-snapshot`              | Compatibility alias for canonical and consumer mirror synchronization                                                  |
| `npm run check:parity-snapshot`             | Verify mirrors match canonical                                                                                        |
| `npm run contracts:prepush`                 | Sync local consumers and require generated canonical CLI mirrors to be committed                                      |
| `npm run validate:contracts`                | Shared-contract checks and focused contract tests                                                                     |
| `npm run contracts:validate`                | Comprehensive generated/shared contract, parity, runtime-conformance, and adversarial gate                            |
| `npm run check:agent-customization-drift`   | Verify generated agent customization files are committed in a consumer workspace                                      |
| `npm run test:real-world -- ...`            | Qualify explicitly selected linked repositories in isolated or cumulative workspaces                                  |
| `npm run test:real-world:enterprise -- ...` | Exercise the read-mostly, export, archive, agent dry-run, snapshot, and destructive dry-run command surface           |

Workflow: change code → `npm run sync:shared-contracts` → review and commit
the CLI mirrors plus every locally available consumer mirror → push. When the
VS Code repository is available, pre-commit synchronizes and stages its mirrored
contracts. Pre-push refuses uncommitted canonical CLI outputs while consumer
drift remains visible without coupling release cadence.

The CLI does not require a cross-repository consumer workflow before npm
publication. Workspai VS Code enforces hard parity in its own release CI against
the CLI version it selects. Consumer-specific version floors remain owned by
the consumer; schema synchronization never forces a redundant CLI release.
Breaking schema changes are still blocked by versioned contract compatibility
gates in the CLI.

## Documents in this folder

| File                                                           | Purpose                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| [ARTIFACT_CATALOG.md](./ARTIFACT_CATALOG.md)                   | On-disk artifact paths, schema versions, and consumer rules       |
| [COMMAND_OWNERSHIP_MATRIX.md](./COMMAND_OWNERSHIP_MATRIX.md)   | Which commands the npm wrapper owns vs Python Core                |
| [NAMING_AND_COEXISTENCE.md](./NAMING_AND_COEXISTENCE.md)       | Workspace Intelligence command naming and generated surface rules |
| [RUNTIME_SUPPORT_MATRIX.md](./RUNTIME_SUPPORT_MATRIX.md)       | Scaffold, import, lifecycle, and module support tiers             |
| [RUNTIME_ACCEPTANCE_MATRIX.md](./RUNTIME_ACCEPTANCE_MATRIX.md) | Runtime acceptance matrix expectations                            |
| [rapidkit-cli-contracts.json](./rapidkit-cli-contracts.json)   | Core CLI JSON schema fragments                                    |

## Workspace intelligence schemas

Published under `../../contracts/` (not duplicated in this folder):

- `published-contract-catalog.v1.json` — complete machine-readable contract inventory
- `workspace-contract.v1.json` — canonical workspace project/relationship contract
- `runtime-command-surface.v1.json` and `cli-runtime-command-inventory.v1.snapshot.json` — supported command/capability discovery
- `workspace-intelligence-architecture.v1.json` and `workspace-intelligence-chain.v1.json` — architecture boundaries and ordered loop
- `workspace-registry.v1.json` — canonical project registry summary (see [ARTIFACT_CATALOG.md](./ARTIFACT_CATALOG.md))
- `release-readiness.v1.json` — release readiness gate evidence
- `workspace-run-last.v1.json` — multi-stage workspace run evidence
- `doctor-workspace-evidence.v1.json` / `doctor-project-evidence.v1.json` — doctor evidence
- `workspace-intelligence/doctor-diagnosis.v1.json` — runtime-neutral causal findings, proof bindings, confidence, unknowns, contradictions, and repair disposition embedded in Doctor evidence
- `workspace-intelligence/doctor-capabilities.v1.json` — fail-closed runtime/framework ownership, six-domain support levels, platform boundaries, repair modes, and extraction-safe adapter inventory
- `workspace-intelligence/doctor-validation.v1.json` — versioned disease-corpus results across every registered adapter, with bounded synthetic precision/recall and explicit limitations
- `workspace-intelligence/doctor-receipt.v1.json` — compact Doctor verdict, unambiguous counts, freshness, affected projects, blockers, and next-action handoff; full evidence remains canonical
- `workspace-intelligence/doctor-summary.v1.json` — bounded stdout contract emitted by `doctor --json=summary` for system, workspace, and project consumers
- `doctor-remediation-plan.v2.json` — canonical persisted Doctor fix/plan Studio handoff contract (`v1` path is a deprecated compatibility alias)
- `artifact-remediation-plan.v1.json` — cross-artifact Studio handoff for Bootstrap, Analyze, Readiness, Pipeline, Workspace Run, Workspace Verify, and Doctor plan bridging
- `workspace-intelligence/workspace-repair-proposal.v1.json` — bounded, hash-pinned source changes and optional runtime-native validation proposed by an IDE model; proposals never execute themselves
- `workspace-intelligence/workspace-repair-transaction.v1.json` — durable CLI-owned repair state from immutable plan and approval through checkpoint, execution, canonical verification, rollback, or an explicit decision
- `workspace-repair-capabilities.v1.json` — canonical multi-runtime adapter inventory, conditional support boundaries, preflight policy, and fail-closed repair invariants
- `analyze-last-run.v1.json` — analyze evidence
- `pipeline-last-run.v1.json` — governance pipeline orchestration
- `project-entry-capability.v1.json` — open-ended adopt/import contract for readable projects
- `workspace-intelligence/project-agent-entry.v1.json` — portable host discovery, canonical read order, authority boundaries, and integrity for an adopted project
- `workspace-intelligence/agent-bootstrap-receipt.v1.json` — per-session proof of workspace membership, host coverage, schema validity, freshness, live inputs, and active Goal bindings
- `adopt-effects.v1.json` — dry-run disclosure of project metadata, conditional repository-control reconciliation, and workspace operations before adoption
- `create-planner-capabilities.v1.json` — native, official, and existing capability lanes
- `agent-customization-pack.v1.json` — generated instructions, prompts, skills, agents, optional hooks, MCP-ready design metadata, target matrix, and drift state for AI agent surfaces
- `workspace-list.v1.json`, `workspace-sync.v1.json`, and `compatibility-matrix.v1.json` — workspace discovery, synchronization, and platform compatibility
- `project-archive.v1.json`, `workspace-snapshot.v1.json`, and `workspace-snapshot.v2.json` — recoverable lifecycle records
- `infra-plan.v1.json`, `private-product-manifest.v1.json`, and `product-factory-plan.v1.json` — infrastructure and product planning payloads
- `workspace-model-cache.v1.json`, `workspace-watch-event.v1.json`, `doctor-project-scan.v2.json`, and `doctor-workspace-cache.v2.json` — cache/watch/diagnostic support contracts

Workspace intelligence (`../../contracts/workspace-intelligence/`):

- `workspace-intelligence-run.v1.json` — authoritative full-chain result, stage outcomes, verdict, exit code, and durable artifact path
- `workspace-model.v1.json`
- `workspace-context.v1.json`
- `workspace-dependency-graph.v1.json`
- `workspace-knowledge-graph.v1.json` — proof-backed entities, relations, evidence, providers, and model binding
- `workspace-knowledge-graph-change-overlay.v1.json` — proposed/change-set facts and relations without mutating the base graph
- `workspace-knowledge-search.v1.json` — bounded ranked retrieval for CLI, MCP, IDE, and agent consumers
- `workspace-graph-token-efficiency.v1.json` — reproducible corpus-versus-retrieval payload measurement
- `model-usage-event.v1.json` — privacy-bounded model, tool, milestone, and verified-outcome events with explicit measurement provenance
- `workspace-intelligence-evaluation.v1.json` — live/final token, cost, latency, activity, and verified-outcome evaluation
- `workspace-intelligence-evaluation-comparison.v1.json` — task-aligned comparison of two completed evaluation strategies
- `workspace-model-snapshot.v1.json`
- `workspace-model-diff.v1.json`
- `workspace-impact.v1.json`
- `workspace-verify.v1.json`
- `workspace-explain.v1.json`
- `workspace-intelligence-history.v1.json`
- `workspace-operational-skill.v1.json`
- `workspace-skills-index.v1.json`
- `workspace-contract-verify.v1.json`
- `agent-action-outcome.v1.json`
- `blocker-resolution.v1.json`
- `doctor-fix-result.v1.json`
- `studio-blocker-handoff.v1.json`
- `mcp-design.v1.json` and `agent-hooks.v1.json` — generated MCP/IDE integration surfaces

These schemas describe durable artifacts or bounded query results. A command's
stdout may wrap an artifact with operation metadata such as `status`,
`outputPath`, or a structured error; that envelope follows
`cli-operation-result.v1.json` and does not change the nested artifact contract.
`status: "success"` means the command completed and returned its contracted
artifact; it does not override a policy gate. For gated operations such as
`workspace verify --strict`, the envelope `exitCode`, process exit code, and
nested gate exit code are identical even when the artifact was produced
successfully and the gate blocked progression.

CLI commands: see [commands-reference.md](../commands-reference.md) and the
[CLI README](../../README.md#one-intelligence-chain).

## Core CLI JSON payloads

`rapidkit-cli-contracts.json` describes:

- `VersionResponse` — `workspai version --json`
- `CommandsResponse` — `workspai commands --json`
- `ProjectDetectResponse` — `workspai project detect --json`
- `ModulesListResponseV1` — `workspai modules list --json-schema 1`

## Versioning

- Payloads include `schema_version` where applicable.
- Backward-compatible changes keep the same schema version.
- Breaking changes require a schema bump and updated tests in `src/__tests__/contracts/`.

## See also

- [Documentation index](../README.md)
- [commands-reference.md](../commands-reference.md)
- [workspace-operations.md](../workspace-operations.md)
- [real-world-qualification.md](../real-world-qualification.md)
