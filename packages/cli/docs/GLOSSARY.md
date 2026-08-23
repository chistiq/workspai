# Workspai Glossary

Short definitions for terms used by the CLI, its reports, IDE integrations,
CI workflows, and AI consumers.

## Core concepts

| Term                  | Plain-language meaning                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace             | A governed collection of one or more registered projects. It is not required to be a Git monorepo.                                                                                                    |
| Project               | One registered application, service, library, or infrastructure unit inside or linked to a workspace.                                                                                                 |
| Workspace manifest    | `.workspai/workspace.json`; workspace identity, profile, engine, and bootstrap metadata. It is not the project registry.                                                                              |
| Workspace contract    | `.workspai/workspace.contract.json`; the operational registry of projects and their declared ports, APIs, ownership, and relationships.                                                               |
| Registry summary      | `.workspai/workspace-registry.v1.json`; the canonical lightweight project count and registry status for UI and CI.                                                                                    |
| Workspace Model       | The canonical, deterministic structural description produced from registered projects, manifests, contracts, policies, and detected facts.                                                            |
| Knowledge Graph       | A proof-backed representation derived from and structurally bound to the canonical Workspace Model. It makes entities and relationships queryable; it cannot replace or mutate the authorizing model. |
| Structural model hash | A stable SHA-256 over model structure. Volatile timestamps, run correlation, live evidence references, and freshness fields are excluded so harmless refreshes do not create false graph drift.       |
| Dependency graph      | The project-to-project dependency subgraph embedded in the Workspace Model and used by impact and verification.                                                                                       |
| Provider              | A deterministic source adapter that emits facts from code, manifests, APIs, infrastructure, documentation, Git, or another supported source.                                                          |
| Fact                  | A normalized observation about the workspace, such as a package, endpoint, import, deployment, or owner.                                                                                              |
| Evidence / proof      | The source location and extraction details that justify a fact or relationship.                                                                                                                       |
| Proof path            | A traceable route from a query result or relationship back to its supporting evidence.                                                                                                                |
| Artifact              | A versioned file written under `.workspai/`, usually `.workspai/reports/`, for people or automation to consume.                                                                                       |
| Command projection    | The JSON returned on stdout for one command. It can include status and output metadata around a canonical artifact payload.                                                                           |

## Intelligence and governance

| Term             | Plain-language meaning                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Unified runner   | `workspace intelligence run`; the supported way to execute the complete intelligence chain in contract order.                    |
| Preflight        | `sync` and baseline resolution. These prepare the run but are not stages in the 11-stage intelligence chain.                     |
| Stage            | One contract-defined operation in the intelligence chain. Stage order comes from `workspace-intelligence-chain.v1.json`.         |
| Gate             | A decision that can pass, need attention, or block automation according to evidence and policy.                                  |
| Blocked          | The command completed, but evidence or policy prevents the requested release/action. The unified runner uses exit code `2`.      |
| Failed           | Execution itself failed. The unified runner uses exit code `1`.                                                                  |
| Needs attention  | Evidence is usable but contains warnings or non-blocking gaps. Strict policy can promote it to a blocking result.                |
| Fresh / stale    | Whether an artifact still matches its governed inputs and dependency closure. A recent timestamp alone does not prove freshness. |
| Snapshot         | A stable baseline of the model used for later comparison.                                                                        |
| Diff             | The structural change between the current model and a baseline model or snapshot.                                                |
| Impact           | Direct and transitive consequences of a model diff, including verification scope and risk.                                       |
| Verify           | The evidence-backed gate over the affected dependency subgraph and workspace policies.                                           |
| Context          | A bounded, agent-oriented projection of current workspace evidence.                                                              |
| Agent sync       | Generation of tool-specific instructions, skills, prompts, indexes, and MCP metadata from canonical evidence.                    |
| Evaluation       | A provenance-aware record of model calls, tool activity, cost, latency, and verified task outcome produced by `workspace eval`.  |
| Verified outcome | A task result supported by the workspace verification path; smaller context alone is not treated as task success.                |

## AI and integration

| Term                    | Plain-language meaning                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent grounding         | Instructions and evidence references that keep an AI agent inside the correct workspace, contracts, and command loop.                      |
| Canonical-first entry   | A host-discovered project protocol that validates Workspai identity, evidence, freshness, and Goal bindings before broad source discovery. |
| Agent bootstrap receipt | A portable per-session result proving which entry and evidence checks passed, degraded, or blocked; it does not prove model compliance.    |
| Bounded retrieval       | Returning only the most relevant entities and proof paths for a question instead of injecting the complete graph or model.                 |
| Retrieval benchmark     | A deterministic comparison of readable proof-source corpus size with one bounded graph response; it is not billing evidence.               |
| Token provenance        | Whether a token value was provider-reported, counted by a named tokenizer, estimated, or unavailable.                                      |
| MCP                     | Model Context Protocol; Workspai exposes read-oriented workspace tools through `workspace mcp serve`.                                      |
| Module recommender      | The optional embedding-based FastAPI/NestJS recommendation feature. It is separate from deterministic Workspace Intelligence.              |
| Canonical path          | The current `.workspai` path that new writers and consumers should prefer.                                                                 |
| Legacy path             | A `.rapidkit` compatibility path read for older workspaces; it is not the target for new integrations.                                     |

## Where to continue

- Run the full loop: [Unified Workspace Intelligence Runner](./workspace-intelligence-runner.md)
- Query evidence: [Workspace Knowledge Graph](./workspace-knowledge-graph.md)
- Ground an agent: [Canonical-first agent entry](./agent-entry.md)
- Find an output: [Artifact Catalog](./contracts/ARTIFACT_CATALOG.md)
- Look up syntax: [Command Reference](./commands-reference.md)
