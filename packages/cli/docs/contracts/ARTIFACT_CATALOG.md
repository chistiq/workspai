# Workspai CLI Artifact Catalog

Canonical map of **on-disk artifacts** produced by Workspai CLI commands. Dashboards, VS Code extension, and CI should read paths listed here — not infer from legacy fields (e.g. `workspace.json.projects`).

## Authority layers (identity)

| Artifact           | Path                                   | Writer                                                         | Reader purpose                                             |
| ------------------ | -------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| Workspace manifest | `.workspai/workspace.json`             | `create workspace`, `foundation ensure`, `bootstrap` (profile) | Profile, engine, bootstrap metadata — **not** project list |
| Workspace contract | `.workspai/workspace.contract.json`    | `workspace sync`, `workspace contract *`, import/adopt         | Operational project registry (ports, contracts)            |
| Registry summary   | `.workspai/workspace-registry.v1.json` | `workspace sync`, contract sync, `registry status --refresh`   | **Canonical** project count + authority for UI/CI          |
| Workspace marker   | `.workspai-workspace`                  | `create workspace`, `foundation ensure`                        | Portable root detection; commit with the workspace         |

Legacy `.rapidkit-workspace` and `.rapidkit/*` paths are read as fallback for
older workspaces. New Workspai CLI writes target `.workspai-workspace` and
`.workspai/*`. Workspace archive hydrate also normalizes legacy archive entries
to canonical Workspai paths on restore.

The canonical `.workspai-workspace` marker must remain trackable. Generated
workspace `.gitignore` files exclude legacy/local engine state but do not
exclude the canonical marker.

## Project entry and grounding

These paths are relative to each registered project root, not the workspace
root:

| Artifact                                       | Writer                                                                            | Schema / format             | Portability and reader purpose                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| `.workspai/workspace-link.local.json`          | `adopt`, `import`, project creation, `workspace sync`, `project workspace relink` | `project-workspace-link.v1` | Machine-local absolute binding; always gitignored and never an agent evidence payload |
| `.workspai/reports/project-context-agent.json` | Project lens reconciliation and `workspace agent-sync --write`                    | `project-context-agent.v1`  | Portable bounded model/graph/proof projection for project-local agents                |
| `.workspai/PROJECT-GROUNDING.md`               | Project lens reconciliation                                                       | Markdown                    | Portable human/agent entry guide with path-free workspace references                  |
| `AGENTS.md` managed section                    | Project lens reconciliation in `managed` mode                                     | Managed Markdown block      | Preserves user content and routes compatible agents to project/workspace evidence     |

The project link is validated against the canonical workspace contract and a
SHA-256 binding over workspace identity, project identity, portable relative
path, machine paths, and relationship. Project context generation rejects
absolute paths before writing. `managed`, `local`, and `off` grounding modes
control portable project surfaces and converge by removing stale managed
sections and ignore rules during transitions; they never make the
machine-local link publishable. The context is bounded but not count-only: it
includes topology, API/deployment/test surfaces, blockers, portable proofs,
and model/graph freshness for the selected project.

## Naming conventions

| Pattern           | Meaning                                | Examples                                                     |
| ----------------- | -------------------------------------- | ------------------------------------------------------------ |
| `*-last-run.json` | Latest gate/run evidence               | `doctor-last-run.json`, `pipeline-last-run.json`             |
| `*.latest.json`   | Rolling alias + timestamped siblings   | `bootstrap-compliance.latest.json`, `mirror-ops.latest.json` |
| Static state      | Current model/state (not a single run) | `workspace-model.json`, `workspace.contract.json`            |

## Governance evidence loop

| Command                              | Primary artifact                                            | Schema version                              | JSON Schema                                                             |
| ------------------------------------ | ----------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `doctor workspace`                   | `.workspai/reports/doctor-last-run.json`                    | `doctor-workspace-evidence-v1`              | `contracts/doctor-workspace-evidence.v1.json`                           |
| `doctor project`                     | `.workspai/reports/doctor-project-last-run.json`            | `doctor-project-evidence-v1`                | `contracts/doctor-project-evidence.v1.json`                             |
| `project coverage`                   | `.workspai/reports/project-test-coverage-last-run.json`     | `workspai.project-test-coverage.v1`         | `contracts/project-test-coverage.v1.json`                               |
| `doctor * --plan`                    | `.workspai/reports/doctor-remediation-plan-last-run.json`   | `doctor-remediation-plan-v2`                | `contracts/doctor-remediation-plan.v2.json`                             |
| `doctor * --fix/--apply`             | `.workspai/reports/doctor-fix-result-last-run.json`         | `rapidkit-doctor-fix-result-v1`             | `contracts/workspace-intelligence/doctor-fix-result.v1.json`            |
| `workspace remediation-plan --write` | `.workspai/reports/artifact-remediation-plan-last-run.json` | `artifact-remediation-plan-v1`              | `contracts/artifact-remediation-plan.v1.json`                           |
| `workspace repair *`                 | `.workspai/reports/workspace-repair-last-run.json`          | `workspai.workspace-repair-transaction.v1`  | `contracts/workspace-intelligence/workspace-repair-transaction.v1.json` |
| `workspace repair capabilities`      | CLI capability output                                       | `workspai.workspace-repair-capabilities.v1` | `contracts/workspace-repair-capabilities.v1.json`                       |
| `analyze`                            | `.workspai/reports/analyze-last-run.json`                   | `rapidkit-analyze-v1`                       | `contracts/analyze-last-run.v1.json`                                    |
| `readiness`                          | `.workspai/reports/release-readiness-last-run.json`         | `release-readiness-v1`                      | `contracts/release-readiness.v1.json`                                   |
| `pipeline`                           | `.workspai/reports/pipeline-last-run.json`                  | `rapidkit-pipeline-v1`                      | `contracts/pipeline-last-run.v1.json`                                   |
| `autopilot release`                  | `.workspai/reports/autopilot-release-last-run.json`         | `autopilot-release-v1`                      | `contracts/autopilot-release.v1.json`                                   |
|                                      | `.workspai/reports/autopilot-release.json`                  | (alias, same payload)                       | `contracts/autopilot-release.v1.json`                                   |

Side/cache (not gates): `.workspai/reports/doctor-workspace-cache.json` (`doctor-workspace-cache-v2`).

Doctor Studio handoff:
`doctor-remediation-plan-v2` (`contracts/doctor-remediation-plan.v2.json`) is emitted in JSON
responses and persisted to `.workspai/reports/doctor-remediation-plan-last-run.json` by
`doctor workspace|project --plan`, `--fix`, and `--apply` so IDEs can render approved commands,
typed file edits, diff previews, ordered phases, step dependencies, rollback, and verification
steps without inferring them. `doctor-fix-result-last-run.json` records the approved execution
outcome, and fix/apply runs append a `kind: doctor-fix` entry to
`workspace-intelligence-history.json`.

Artifact remediation handoff:
`artifact-remediation-plan-v1` (`contracts/artifact-remediation-plan.v1.json`) is emitted by
`workspace remediation-plan --json` and persisted with `--write`. Add `--ci` to produce
CI-oriented verify commands where the underlying command supports stricter gates. It is the cross-card Studio
handoff for governance artifacts outside Doctor: Bootstrap compliance, Analyze, Readiness,
Pipeline, Workspace Run, Workspace Verify, and Doctor plan bridging. Consumers should ask npm for
this plan before inventing per-card repair logic. The plan carries ordered actions, safe file
operations where deterministic, refresh/verify commands, risk, approval state, and rollback
strategy.

When `doctor project` runs inside a workspace, the project-local report is written beside the
project and the workspace receives both a latest alias and a collision-safe project copy under
`.workspai/reports/projects/<project-slug>--<identity-hash>/`. Coverage evidence follows the same
three-location rule. The hash is derived from workspace-relative identity, so projects with the
same folder name cannot overwrite each other. Remediation plans and fix results are also mirrored
into the scoped project. Studio, CI, and project-local tools can therefore use the same evidence
without guessing which project produced a latest alias.

## Workspace intelligence

Bare artifact names in this table are relative to `.workspai/reports/`.
Entries beginning with `reports/` are relative to `.workspai/`; paths such as
`AGENTS.md` are relative to the workspace root.

| Command                                         | Artifact                                                                                                                     | Schema                                 | Contract file                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `workspace model --write`                       | `workspace-model.json`                                                                                                       | `workspace-model.v1`                   | `contracts/workspace-intelligence/workspace-model.v1.json`                   |
| `workspace model --write`                       | `workspace-knowledge-graph.json`                                                                                             | `workspace-knowledge-graph.v1`         | `contracts/workspace-intelligence/workspace-knowledge-graph.v1.json`         |
| `workspace snapshot`                            | `workspace-model-snapshot.json`                                                                                              | `workspace-model-snapshot.v1`          | `contracts/workspace-intelligence/workspace-model-snapshot.v1.json`          |
| `workspace diff`                                | `workspace-model-diff-last-run.json`                                                                                         | `workspace-model-diff.v1`              | `contracts/workspace-intelligence/workspace-model-diff.v1.json`              |
| `workspace impact --from <diff>`                | `workspace-impact-last-run.json`                                                                                             | `workspace-impact.v1`                  | `contracts/workspace-intelligence/workspace-impact.v1.json`                  |
| `analyze --json`                                | `analyze-last-run.json`                                                                                                      | `rapidkit-analyze-v1`                  | `contracts/analyze-last-run.v1.json`                                         |
| `workspace verify`                              | `workspace-verify-last-run.json`                                                                                             | `workspace-verify.v1`                  | `contracts/workspace-intelligence/workspace-verify.v1.json`                  |
| `workspace context --write`                     | `workspace-context-agent.json`                                                                                               | `workspace-context.v1`                 | `contracts/workspace-intelligence/workspace-context.v1.json`                 |
| `workspace agent-sync --write`                  | `reports/agent-customization-pack.json`                                                                                      | `rapidkit-agent-customization-pack.v1` | `contracts/workspace-intelligence/agent-customization-pack-report.v1.json`   |
| `workspace agent-sync --write`                  | `reports/INDEX.json`                                                                                                         | `rapidkit-agent-reports-index.v1`      | `contracts/workspace-intelligence/agent-reports-index.v1.json`               |
| `workspace agent-sync --write`                  | `reports/workspace-skills-index.json`                                                                                        | `workspace-skills-index.v1`            | `contracts/workspace-intelligence/workspace-skills-index.v1.json`            |
| `workspace agent-sync --write`                  | `reports/workspai-mcp-design.json`, `.workspai/skills/*.md`, `.workspai/AGENT-GROUNDING.md`, `AGENTS.md`, IDE agent surfaces | Mixed generated surfaces               | See customization pack output inventory                                      |
| `workspace explain --write`                     | `workspace-explain-last-run.json`                                                                                            | `workspace-explain.v1`                 | `contracts/workspace-intelligence/workspace-explain.v1.json`                 |
| `workspace why --write`                         | `workspace-why-last-run.json`                                                                                                | `workspace-explain.v1`                 | `contracts/workspace-intelligence/workspace-explain.v1.json`                 |
| `workspace trace --write`                       | `workspace-trace-last-run.json`                                                                                              | `workspace-explain.v1`                 | `contracts/workspace-intelligence/workspace-explain.v1.json`                 |
| `workspace intelligence run`                    | `workspace-intelligence-run-last-run.json`                                                                                   | `workspace-intelligence-run.v1`        | `contracts/workspace-intelligence/workspace-intelligence-run.v1.json`        |
| `workspace feedback record` / `doctor * --fix`  | `workspace-intelligence-history.json` (`kind: agent-action`, `doctor-fix`)                                                   | `workspace-intelligence-history.v1`    | `contracts/workspace-intelligence/workspace-intelligence-history.v1.json`    |
| `workspace eval init` / `workspace eval record` | `workspace-intelligence-evaluation-live.json`                                                                                | `workspace-intelligence-evaluation.v1` | `contracts/workspace-intelligence/workspace-intelligence-evaluation.v1.json` |
| `workspace eval report`                         | `workspace-intelligence-evaluation-last-run.json`                                                                            | `workspace-intelligence-evaluation.v1` | `contracts/workspace-intelligence/workspace-intelligence-evaluation.v1.json` |

The unified runner report separates its execution envelope from the canonical
intelligence chain. `preflight` always contains exactly `sync` and `baseline`;
baseline resolution runs after `model` and before `diff`, recording `created` or
`reused`. `stages` always contains exactly the 11 ordered steps declared by
`workspace-intelligence-chain.v1`. JSON Schema enforces the transport shape and
the runtime semantic validator additionally enforces artifact parity,
status/exit coherence, hard-failure skip propagation, and the aggregate verdict.
See [Unified Workspace Intelligence Runner](../workspace-intelligence-runner.md)
for the normative user and integration semantics.

`workspace-model.json` and `workspace-knowledge-graph.json` are published under
one workspace lock as a rollback-capable artifact transaction. Individual file
replacement is atomic, and a partial set failure restores both preimages. The
model is canonical; the graph is derived and cannot mutate it during the run.
The graph contract fixes `source.kind` to `workspace-model`,
`source.artifact` to `.workspai/reports/workspace-model.json`, and `source.hash`
to the model's stable structural SHA-256. Current-state consumers must reject a
graph whose binding does not match the current model.

`workspace graph jsonld|graphml|gexf --output <path>` creates explicit interchange
projections from that bound graph. These files are portable exports, not competing
canonical or `last-run` artifacts: JSON-LD preserves semantic identifiers,
GraphML targets general graph tooling, and GEXF targets exploration and
visualization tools. `workspace graph dot|mermaid --output <path>` writes the
bounded project-topology projections used by docs and diagrams. For DOT and
Mermaid, `--output --json` returns a `cli-operation-result-v1` receipt containing
the resolved output path; omitting `--output` keeps raw graph text on stdout.

**CLI semantics:** `workspace diff --from` expects a **model, snapshot, or explicit
Git (`git[:ref]`)** baseline. `workspace impact --from` expects a **diff report**.
Persisted artifacts retain their artifact schema. JSON command projections that add operation metadata
such as `outputPath`, `status`, or structured errors use
`contracts/cli-operation-result.v1.json`; the canonical artifact is nested under `artifact`.

### Dependency graph (`workspace-dependency-graph.v1`)

The dependency graph is the first-class structure that promotes inter-project
relationships out of `workspace run`'s private logic into one versioned source
of truth consumed by `impact` (transitive blast radius), `verify`
(subgraph-scoped gating), `run --blast-radius`, and risk weighting.

| Field   | Meaning                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nodes` | Projects in the workspace (`id`, workspace-relative `path`).                                                                                                                               |
| `edges` | Directed `from → to` relationships (`from` depends on `to`). Each edge carries a typed `kind`, a `source` (provenance), a `confidence` bucket, and `evidence` (the files that justify it). |
| `stats` | Counts (`nodeCount`, `edgeCount`, per-source edge counts) and `hasCycle` for the integrity gate.                                                                                           |

Edge `kind` ∈ `code-import`, `package-dep`, `event-pub-sub`, `service-dependsOn`,
`shared-resource`. Edge `source` ∈ `inferred`, `contract`, `manual` (`manual`/`contract`
are authoritative and override an `inferred` edge of the same kind between the same
nodes). Canonical source: `src/contracts/workspace-dependency-graph-contract.ts`;
JSON Schema: `contracts/workspace-intelligence/workspace-dependency-graph.v1.json`.

**Inference engine.** The graph is derived deterministically by
`src/workspace-dependency-graph.ts` (`inferWorkspaceDependencyGraph`) from multiple
sources: package manifests (`package.json` deps, `pyproject.toml` path deps, `go.mod`
replace → `package-dep`), cross-boundary JS/TS source imports (`code-import`), the
workspace contract (`dependsOn` → `service-dependsOn`, matched `publishes`/`consumes`
→ `event-pub-sub`, env↔port references → `shared-resource`), and an optional manual
override file. Node/edge ordering and `hashDependencyGraph` are stable, so the compact
topology is embedded as the canonical `workspace-model.v1.projectTopology` field on every
`buildWorkspaceModel` run. `hashWorkspaceModel` normalizes
`projectTopology.generatedAt`, so the structural topology participates in the model hash
without causing timestamp drift. During the v1 migration window the CLI also emits the
deprecated `graph` compatibility alias. Consumers must read `projectTopology`; when both
fields exist, validation requires them to be structurally identical.

**Manual overrides.** `.workspai/workspace-graph.overrides.json` (`{ "edges": [{ "from",
"to", "kind", "evidence" }] }`) declares authoritative edges that win over inference for
the same `(from, to, kind)`.

**Graph-aware impact.** `workspace impact` consumes the graph for a true transitive
blast radius: alongside `affectedProjects` (directly changed) it emits `transitiveImpact[]`
— projects reached only through the graph, each with `origin: 'transitive'`, `distance`,
the shortest dependency `path`, and `via` (edge kind). `summary.blastRadius`
(`directlyAffected`, `transitivelyAffected`, `maxDistance`, `graphEdges`) summarizes the
reach. Both arrays feed the `verificationPlan`.

**Graph-aware verify.** `workspace verify` gates the **whole affected subgraph**, not just
the changed node. `affectedSubgraph` (`directlyChanged`, `transitiveDependents`, `covered`,
`uncovered`, `unverifiable`) records coverage per project: a dependent with failed or
missing-required verification evidence becomes a `graph.subgraph.<project>` blocking reason;
missing non-required evidence escalates the verdict to `needs-attention`; a dependent with no
applicable verification command is `unverifiable` (informational, never blocking).

**Centrality-weighted risk.** `workspace impact` computes graph centrality
(`fanIn`/`fanOut`/`reach`/`betweenness`) per project; each impact item carries `centrality`,
a directly-changed critical-path hotspot escalates its risk one level, and the report lists
`criticalPathHotspots[]` (ranked by reach then betweenness). Canonical source:
`src/workspace-graph-centrality.ts` (`computeGraphCentrality`).

**Graph integrity gate.** `workspace verify` emits `graphIntegrity` (`ok`, `cycles`,
`danglingEdges`, `orphans`, `stats`). Cycles and dangling edges are blocking
(`graph.integrity.cycle` / `graph.integrity.dangling` reasons); orphans are informational.
Canonical source: `src/workspace-graph-integrity.ts` (`checkGraphIntegrity`).

**Watch / daemon mode.** `workspace watch [--json] [--once]` keeps the model + graph in
memory and streams `workspace-watch-event.v1` records (`ready`/`changed`/`unchanged`/`error`)
on each settled change, driven by graph-aware incremental rebuilds. Events carry changed/added/
removed projects, graph edge deltas, structural `modelHash`, and `mode`/`durationMs`. Canonical
source: `src/workspace-watch.ts`.

Use `workspace watch --graph-stream --json` for the transport-neutral
`workspace-graph-stream.v1` feed consumed by IDEs. The first line is an
authoritative snapshot; subsequent lines are hash-linked, revisioned deltas.
Consumers must request a new snapshot after any revision, identity, generation,
schema, validation, or hash-continuity failure.

**Health/impact history.** Each `workspace verify` run appends a compact record to
`.workspai/reports/workspace-intelligence-history.json` (`workspace-intelligence-history.v1`),
a ring buffer capped at the 50 most-recent entries (verdict, risk, freshness, gate, counts).
Canonical source: `src/workspace-history.ts`.

**Verify gate + policy violations.** `workspace verify --json` emits a `gate`
object (`passed`, `mode`, `exitCode`, `reasons`) from `evaluateWorkspaceVerifyGate` — the
definitive pre-action gate (default fails on `blocked`; `--strict` also fails on
`needs-attention` and `stale` freshness). It also emits `policyMode` + `policyViolations[]`
(model validation issues + contract `violations`); in `enforce` mode error-severity violations
block, in `warn` mode they escalate to needs-attention.

**Graph-aware freshness.** `workspace verify` emits a `freshness` block
(`verdict: fresh|stale|unknown`, `changed`/`added`/`removed`, `projectHashes`). Each project's
`transitiveInputsHash` chains its own content hash with its transitive dependencies' hashes, so
a dependency change makes every dependent stale deterministically. The verdict compares against
the previously written verify report. Canonical source: `src/workspace-graph-freshness.ts`.

**Graph command surface.** `workspace graph` emits the dependency graph plus
integrity and hotspots. `explain <project>` returns centrality and
direct/transitive relationships. `search`, `entities`, `evidence`, and `path`
return bounded Knowledge Graph projections with proof references; `benchmark`
measures corpus-versus-retrieval payload; `overlay --from` compares a proposed
or earlier graph with the current graph; `emit` returns the complete
interchange graph; and `dot|mermaid` render deterministic dependency views.
Canonical sources are `src/workspace-graph.ts`,
`src/workspace-knowledge-graph-query.ts`,
`src/workspace-knowledge-graph-change-overlay.ts`, and
`src/workspace-graph-token-efficiency.ts`. These command surfaces are published
through `runtime-command-surface.v1` for IDE/CI capability detection.

### Model cache (`workspace-model-cache.v1`)

On-disk path: `.workspai/cache/workspace-model.v1.json`. Opt-in (`workspace model --cache`)
cache keyed by `inputsHash` — a deterministic fingerprint of the project set, per-project
manifest contents, workspace files (contract/workspace.json/policies), build flags, and CLI
version. On a hit the stored model is returned byte-for-byte; on a miss it is rebuilt and
rewritten. Canonical source: `src/workspace-model-cache.ts` (`computeModelInputsHash`,
`buildWorkspaceModelCached`). Granularity is manifest/project-set level, not per-source-file.

The envelope also stores per-project signatures (`computeProjectSignatures`: manifest hashes +
a source fingerprint of `path:size:mtime`) and workspace-file signatures, powering
`workspace model --incremental` (`buildWorkspaceModelIncremental`): unchanged project models are
reused and the dependency graph re-infers only edges incident to changed projects
(`inferWorkspaceDependencyGraphIncremental`). It falls back to a full rebuild on workspace-file
changes or project renames, and rescans code-imports fully when the node set changes. Reported
modes: `full` / `incremental` / `unchanged`.

The model command adds a non-structural `build` object to its JSON output and,
when `--write` is used, to the persisted model result. `mode`, `outcome`, and
`engineStatus` tell IDE/CI consumers
whether the result was rebuilt, partially reused, or fully reused. This
provenance is deliberately excluded from the canonical workspace-model hash,
so switching between full, cached, and incremental execution cannot make the
paired knowledge graph appear stale.

### Freshness metadata (`rapidkit-freshness-metadata-v1`)

Intelligence reports carry a shared freshness envelope so any consumer (CLI
`workspace verify`, Workspai, CI) can detect staleness **without** re-running the
whole chain:

| Field         | Meaning                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `generatedAt` | ISO-8601 timestamp the report was produced.                                                                             |
| `inputsHash`  | Stable sha256 of the inputs that produced the report. If a freshly recomputed inputs hash differs, the report is stale. |

Canonical source: `src/contracts/freshness-metadata-contract.ts`
(`computeInputsHash`, `buildFreshnessMetadata`, `assessFreshness`). Verdicts:
`fresh` (hashes match), `stale` (hashes differ), `unknown` (either side missing,
e.g. legacy reports).

### Fact freshness (`rapidkit-fact-freshness-v1`)

Artifact-level freshness answers "is this report still valid?" Fact-level freshness answers
"may an agent safely remember this specific claim?" `workspace model` and
`workspace context --for-agent --write` now emit `facts[]` plus a `factFreshness` summary so
agents, Workspai, and CI can distinguish durable structure from perishable evidence.

| Kind                | Meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| `durable`           | Structural configuration such as workspace identity or policy mode       |
| `derived`           | Inferred structure such as project count, runtime, framework, commands   |
| `evidence-backed`   | A fact backed by a report that can expire or become stale                |
| `live`              | Runtime state that must be re-observed quickly                           |
| `verify-before-use` | Missing, stale, or release-sensitive fact that must be regenerated first |

Every fact carries `category` (`structure`, `verification`, `state`), `generatedAt`,
`ttlSeconds`, `status`, `verifyBeforeUse`, `sourceArtifact`, optional `sourcePath`, and a
stable `inputsHash` for the fact value. Consumers must treat `verifyBeforeUse: true` as a hard
refresh boundary before advice, edits, or release decisions. Canonical source:
`src/contracts/fact-freshness-contract.ts`; JSON Schema:
`contracts/workspace-intelligence/fact-freshness.v1.json`.

### Run correlation (`runId`)

When a command runs through the CLI with the structured log stream active, the
persisted intelligence artifacts (`workspace-model.json`, `workspace-model-snapshot.json`,
`workspace-model-diff-last-run.json`, `workspace-impact*.json`, `workspace-context-agent.json`)
carry a top-level `runId`. It matches the `runId` on the `cli-log-event.v1` stream
(`run.started`/`progress`/`run.completed`), so a consumer can tie an on-disk report
to the exact run that produced it. `runId` is added at write time only and is
ignored by `modelHash`/diff comparisons, so deterministic hashing is unaffected.
Canonical source: `src/observability/run-correlation.ts` (`attachRunCorrelation`).

## Operational / platform

| Command                          | Artifact                                                                       | Notes                                                                                        | Contract                                                             |
| -------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `workspace run`                  | `workspace-run-last.json`                                                      | `workspace-run-v1` (multi-stage: `stages.test`, `stages.build`, …)                           | `contracts/workspace-run-last.v1.json`                               |
| `autopilot release` (run stages) | same `workspace-run-last.json`                                                 | Autopilot publishes test/build into aggregate (no separate `autopilot-workspace-run-*.json`) | —                                                                    |
| `bootstrap`                      | `bootstrap-compliance-{ts}.json`, `bootstrap-compliance.latest.json`           | `bootstrap-compliance.v1`                                                                    | `contracts/bootstrap-compliance.v1.json`                             |
| `mirror status`                  | `mirror-ops-{ts}.json`, `mirror-ops.latest.json`                               | `mirror-ops.v1`                                                                              | `contracts/mirror-ops.v1.json`                                       |
| `mirror` (transparency)          | `transparency-evidence-{ts}.json`, `transparency-evidence.latest.json`         | `transparency-evidence.v1`                                                                   | `contracts/transparency-evidence.v1.json`                            |
| `infra plan`                     | `infra-plan.json`                                                              | `rapidkit.infra-plan.v1`                                                                     | —                                                                    |
| `workspace archive`              | `.workspai/archive-manifest.json` inside ZIP/ZIP64                             | Streaming handoff; workspace payload is unlimited by default and safety budgets are opt-in   | `contracts/workspace-archive-manifest.v1.json`                       |
| `workspace share`                | `reports/share-bundle.json` (default)                                          | Aggregation bundle (`1.1`)                                                                   | `contracts/workspace-share-bundle.v1.json`                           |
| `import`                         | `{project}/.workspai/import.json`, `{project}/.workspai/import-readiness.json` | Copied/cloned project metadata and readiness                                                 | —                                                                    |
| `adopt`                          | `{project}/.workspai/adopt.json`, `{project}/.workspai/adopt-readiness.json`   | In-place project metadata and readiness                                                      | —                                                                    |
| `workspace contract verify`      | `workspace-contract-verify-last-run.json`                                      | CLI verify cache                                                                             | `contracts/workspace-intelligence/workspace-contract-verify.v1.json` |

## Static capability contracts

| Contract                                               | Schema version                                   | Consumer purpose                                                                   |
| ------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `contracts/runtime-command-surface.v1.json`            | `rapidkit-runtime-command-surface-v1`            | Runtime commands, scaffold kits, and create planner summary                        |
| `contracts/cli-operation-result.v1.json`               | `workspai-cli-operation-result-v1`               | Stable success/error envelope for JSON command projections                         |
| `contracts/command-capabilities.v1.json`               | `rapidkit-command-capabilities-v1`               | Effective command ownership and workspace command discovery                        |
| `contracts/version.v1.json`                            | `rapidkit-version-v1`                            | Version and published-contract discovery response                                  |
| `contracts/published-contract-catalog.v1.json`         | `workspai-published-contract-catalog-v1`         | Schema versions plus resolvable contract paths                                     |
| `contracts/project-entry-capability.v1.json`           | `workspai-project-entry-capability-v1`           | Open-ended adopt/import capability boundaries for readable projects                |
| `contracts/create-planner-capabilities.v1.json`        | `rapidkit-create-planner-capabilities-v1`        | Native create, official, and existing lanes for CLI, CI, VS Code, and AI planners  |
| `contracts/workspace-archive-capabilities.v1.json`     | `workspai-workspace-archive-capabilities-v1`     | ZIP64, streaming, compression, limits, commands, flags, and linked archive schemas |
| `contracts/workspace-archive-manifest.v1.json`         | `workspai-workspace-archive-manifest-v1`         | Runtime-validated archive manifest, file inventory, checksums, and security policy |
| `contracts/workspace-archive-operation-result.v1.json` | `workspai-workspace-archive-operation-result-v1` | Stable JSON results for export, inspect, verify, doctor, hydrate, and failures     |

## Observability stream (not on-disk)

Separate from the on-disk artifacts above, Workspai CLI emits a structured
**NDJSON log stream on stderr** when `--log-format json` (or `RAPIDKIT_LOG_FORMAT=json`)
is set. This is the deterministic progress/outcome channel for IDEs and CI.

| Stream                  | Schema version     | Contract file                     | Doc                                                  |
| ----------------------- | ------------------ | --------------------------------- | ---------------------------------------------------- |
| CLI log events (stderr) | `cli-log-event-v1` | `contracts/cli-log-event.v1.json` | [CLI_LOG_EVENT_STREAM.md](./CLI_LOG_EVENT_STREAM.md) |

**Channel rule:** command **results** go to stdout (`--json`); **progress/lifecycle**
events go to stderr (`--log-format json`). The two never mix.

## Registry commands

| Command                                          | Output                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `workspace sync [--json]`                        | Updates contract + `workspace-registry.v1.json`; JSON includes `registrySummary` |
| `workspace registry status [--refresh] [--json]` | Reads or publishes registry summary                                              |

`workspace-registry.v1.json`, adoption records, and verification reports can
contain machine-local absolute paths. Regenerate them after cloning; do not use
them as portable repository contracts. The portable source is
`.workspai/workspace.contract.json` plus canonical workspace/project metadata.

## Project-scoped reports

Under `{project}/.workspai/reports/` when commands run at project scope (e.g. project doctor). Workspace-level reports stay under `{workspace}/.workspai/reports/`.

After a Python Core bridge creates a project, Workspai validates and mirrors
legacy `.rapidkit/project.json`, `context.json`, and `file-hashes.json` into the
canonical project `.workspai/` directory without overwriting an existing
canonical file. Legacy files remain readable during the compatibility window.

## Consumer rules

1. **Project count:** read `workspace-registry.v1.json` (or run `workspace registry status --json`).
2. **Workspace Intelligence chain:** run `workspace intelligence run --for-agent generic --strict --json` to preserve Model → Diff → Impact → Doctor + Contract Verify + Analyze → Readiness → Verify → Context → Agent Sync → Explain. `pipeline` is the broader governance/release orchestrator and `autopilot` is a separate release surface; neither redefines the canonical chain. Use `pipeline-last-run.json` only for the pipeline orchestration summary.
3. **Do not** use `workspace.json.projects` (removed in schema 1.0).
4. Prefer `schemaVersion` constants in each artifact; legacy `v1` on readiness is accepted when reading old reports.
5. **Agent retrieval:** start with `AGENTS.md` and `.workspai/reports/INDEX.json`, then use `workspace graph search <query> --limit <n> --json` or MCP `searchWorkspaceGraph` for question-sized facts. Follow returned proof paths to source evidence. Read the full context, model, or graph only when the bounded result is insufficient.
6. **Agent customization state:** use `.workspai/reports/agent-customization-pack.json` to inspect generated surfaces and drift; regenerate with `workspace agent-sync --write --refresh-context --preset enterprise`.

## Agent customization files (repo hooks)

Written by `workspace agent-sync --write --refresh-context --preset enterprise` (and by default after `workspace context --for-agent --write`):

The generated output inventory is committed as one journaled transaction. On
failure, all touched files are restored; an interrupted transaction is recovered
before the next agent-sync. `agent-customization-pack.json` is written last and
serves as the completed-generation marker.

| Path                                                                    | Consumer                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `AGENTS.md`                                                             | Copilot, Cursor, Claude Code, Codex, Grok (open standard)      |
| `.github/copilot-instructions.md`                                       | GitHub Copilot / VS Code Chat                                  |
| `.github/instructions/workspai-workspace.instructions.md`               | Copilot workspace scope and command discipline                 |
| `.github/instructions/workspai-evidence.instructions.md`                | Copilot scoped `.workspai/**` and compatibility evidence rules |
| `.github/prompts/workspai-diagnose.prompt.md`                           | Copilot prompt library                                         |
| `.github/prompts/workspai-repair.prompt.md`                             | Copilot repair workflow prompt                                 |
| `.github/prompts/workspai-release-readiness.prompt.md`                  | Copilot release readiness workflow prompt                      |
| `.github/prompts/workspai-project-onboard.prompt.md`                    | Copilot project onboarding workflow prompt                     |
| `.github/prompts/workspai-adopt-project.prompt.md`                      | Copilot adopt/import workflow prompt                           |
| `.github/skills/workspai-grounding/SKILL.md`                            | Copilot skills                                                 |
| `.github/skills/workspai-workspace-intelligence/SKILL.md`               | Enterprise Workspace Intelligence skill                        |
| `.github/skills/workspai-workspace-intelligence/resources/mcp-tools.md` | MCP tool and evidence-retrieval reference                      |
| `.github/agents/workspai-advisor.agent.md`                              | Read-only workspace advisor agent                              |
| `.github/agents/workspai-repair.agent.md`                               | Blocker repair agent                                           |
| `.github/agents/workspai-release.agent.md`                              | Release safety agent                                           |
| `.github/agents/workspai-project-onboarder.agent.md`                    | Project onboarding agent                                       |
| `.cursor/rules/workspai-grounding.mdc`                                  | Cursor always-on rule                                          |
| `CLAUDE.md`                                                             | Claude Code (imports `@AGENTS.md`)                             |
| `.claude/rules/workspai-evidence.md`                                    | Claude Code scoped evidence rule                               |
| `.claude/rules/rapidkit-evidence.md`                                    | Legacy compatibility alias pointing to the canonical rule      |
| `.workspai/AGENT-GROUNDING.md`                                          | Tool-agnostic operator doc                                     |
| `.workspai/reports/agent-customization-pack.json`                       | Versioned output inventory, target matrix, drift state         |
| `.workspai/reports/workspai-mcp-design.json`                            | Read-mostly MCP-ready design manifest                          |
| `.vscode/workspai-agent-hooks.json`                                     | Optional advisory VS Code agent hooks (`--experimental-hooks`) |

Some `rapidkit-*` prompt, skill, Cursor, MCP-design, and hook paths remain available for older consumers during the rebrand window. New consumers should use the `workspai-*` paths first.

## See also

- [README.md](./README.md)
- [COMMAND_OWNERSHIP_MATRIX.md](./COMMAND_OWNERSHIP_MATRIX.md)
- [CLI_LOG_EVENT_STREAM.md](./CLI_LOG_EVENT_STREAM.md)
- [commands-reference.md](../commands-reference.md)
