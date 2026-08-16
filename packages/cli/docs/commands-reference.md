# Commands Reference

Human-readable CLI syntax for the Workspai CLI. The machine-complete command,
argument, option, alias, ownership, and integrity inventory is available through
`workspai commands --json` and
[`runtime-command-surface.v1.json`](../contracts/runtime-command-surface.v1.json).
For behavior and workflows, see
[workspace-operations.md](./workspace-operations.md) and
[OPEN_SOURCE_USER_SCENARIOS.md](./OPEN_SOURCE_USER_SCENARIOS.md).

## Workspace lifecycle

```bash
npx workspai create # Guided create or existing-software ingestion
npx workspai create workspace <name> [--profile <profile>] [--yes] [--here|--output <parent-dir>] [--skip-python-engine] [--skip-git] [--dry-run] [--install-method <poetry|venv|pipx>]
npx workspai bootstrap [--profile <profile>] [--ci] [--json] [--compliance-only]
npx workspai setup <python|node|go|java|dotnet|rust|php> [--warm-deps]
npx workspai pipeline [--json] [--strict] [--skip-verify] [--skip-analyze] [--skip-autopilot] [--autopilot-mode <audit|safe-fix|enforce>] [--agent-sync|--no-agent-sync]
npx workspai analyze [--workspace <path>] [--json] [--strict] [--output <file>]
npx workspai readiness [--workspace <path>] [--json] [--strict] [--skip-verify]
npx workspai autopilot release [--mode <audit|safe-fix|enforce>] [--json] [--output <file>] [--since <ref>] [--parallel] [--max-workers <n>]
npx workspai goal <intent> [--workspace <path>] [--scope <workspace|project:name>] [--for-agent <generic|claude|codex>] [--max-attempts <1-25>] [--refresh] [--dry-run] [--json]
npx workspai goal <--status [goal-id]|--list|--activate <goal-id>|--cancel <goal-id>|--prepare <goal-id>|--verify <goal-id>> [--workspace <path>] [--no-run] [--json]
```

Recommended CI:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

Run the broader governance and release orchestrators as separate gates; they
do not extend or redefine the canonical Workspace Intelligence chain:

```bash
npx workspai pipeline --json --strict
npx workspai autopilot release --mode enforce --json --output .workspai/reports/autopilot-release.json
```

`bootstrap --ci --json --compliance-only` runs deterministic compliance checks only (skips init). Default `bootstrap --ci --json` still runs init after compliance checks.

`create workspace --skip-python-engine` keeps Python-aware profiles such as
`python-only`, `polyglot`, and `enterprise` available for Workspace Intelligence
while skipping the immediate `rapidkit-core` install. Use it when you want
model/context/verify/adopt/import governance first. To add the workspace-local
Python engine later for RapidKit Core module-enabled kits, create or register the
Workspai-owned project first and then run `npx workspai workspace run init` from
the workspace root. Empty skipped workspaces and arbitrary adopted/imported
Python projects keep the Python engine skipped; use `npx workspai bootstrap
--profile <profile>` only when you need to change or realign the workspace
profile.

```bash
npx workspai workspace sync [--json]
npx workspai workspace registry [--json]
npx workspai workspace policy show
npx workspai workspace policy set <key> <value>
npx workspai doctor
npx workspai doctor workspace [--json] [--strict] [--ci] [--fix] [--plan] [--apply]
npx workspai doctor project [--json] [--strict] [--ci] [--fix] [--plan] [--apply]
npx workspai project coverage [--project <path>] [--target <0-100>] [--run] [--strict] [--json]
npx workspai workspace list
npx workspai workspace foundation ensure [--force] [--json]
npx workspai workspace share [--output <file>] [--include-paths] [--no-doctor]
npx workspai workspace contract init [--force] [--json]
npx workspai workspace contract inspect [--json]
npx workspai workspace contract verify [--strict] [--json]
npx workspai workspace contract graph [--output <graph.json>] [--json]
npx workspai workspace intelligence run [--workspace <path>] [--for-agent <agent>] [--strict] [--json]
npx workspai workspace goal plan <release-readiness|dependency-security|test-coverage> [--scope project:<name>] [--target <0-100>] [--allow-breaking] [--allow-force] [--no-build] [--no-tests] [--json]
npx workspai workspace goal status <goal-id> [--json]
npx workspai workspace goal verify <goal-id> [--no-run] [--reuse-intelligence] [--json]
npx workspai workspace model [--workspace <path>] [--json] [--write] [--strict] [--cache] [--incremental] [--include-paths] [--include-evidence] [--scan-depth <count>]
npx workspai workspace context --for-agent [generic|codex|claude|cursor|orca] [--workspace <path>] [--scope project:<name>] [--json] [--write] [--agent-sync|--no-agent-sync] [--target <targets>] [--preset minimal|enterprise] [--project-grounding managed|local|off] [--include-evidence] [--scan-depth <count>] [--strict]
npx workspai workspace agent-sync [--workspace <path>] [--write] [--refresh-context] [--strict] [--json] [--preset minimal|enterprise] [--target all|vscode|agents,copilot,cursor,claude,codex,orca] [--project-grounding managed|local|off] [--experimental-hooks] [--hydrate-prompts]
npx workspai workspace remediation-plan [--json] [--write] [--ci] [--include-paths]
npx workspai workspace repair <capabilities|plan|propose|approve|decide|execute|resume|status|list|rollback|cancel> [--workspace <path>] [--card <id>] [--action-id <id>] [--project <name>] [--proposal <file>] [--transaction <id>] [--approved-by <actor>] [--decision <choice>] [--max-risk safe|guarded|invasive] [--allow-breaking] [--allow-force] [--no-auto-rollback] [--json]
npx workspai workspace snapshot [--workspace <path>] [--json] [--include-paths] [--include-evidence] [--scan-depth <count>]
npx workspai workspace diff --from <snapshot-or-model|git[:ref]> [--workspace <path>] [--json] [--include-paths] [--include-evidence] [--scan-depth <count>] [--strict]
npx workspai workspace impact --from <workspace-diff-report> [--workspace <path>] [--scope project:<name>] [--json] [--include-paths] [--include-evidence] [--scan-depth <count>] [--strict]
npx workspai workspace verify [--from-impact <file>] [--workspace <path>] [--scope project:<name>] [--strict] [--json] [--include-paths] [--include-evidence] [--scan-depth <count>]
npx workspai workspace graph [emit|explain|search|benchmark|entities|evidence|path|overlay|dot|mermaid|jsonld|graphml|gexf] [key] [value] [--from <graph.json>] [--output <file>] [--limit <1..100>] [--workspace <path>] [--scope project:<name>] [--refresh-graph] [--json] [--include-paths] [--include-evidence] [--scan-depth <count>]
npx workspai workspace eval [init <task> [strategy]|record|status|report|compare --from <report>] [--workspace <path>] [--output <file>] [--json]
npx workspai workspace watch [--workspace <path>] [--json] [--graph-stream] [--once] [--scan-depth <count>]
npx workspai workspace explain <target> [--workspace <path>] [--json] [--write]
npx workspai workspace why <target> [--workspace <path>] [--json] [--write]
npx workspai workspace trace --from <workspace-diff-report> [--workspace <path>] [--json] [--write]
printf '%s\n' '{"actionId":"fix-api","summary":"API tests passed","outcome":"ok"}' | npx workspai workspace feedback record [--workspace <path>] --json
npx workspai workspace mcp serve [--workspace <path>] [--json]
npx workspai workspace export --output team-workspace.workspai-archive.zip [--archive-compression store|deflate]
npx workspai workspace archive inspect team-workspace.workspai-archive.zip [--max-download-size <size>] [--max-expanded-size <size>] [--download-timeout-ms <ms>] [--allow-private-network] [--json]
npx workspai workspace archive verify team-workspace.workspai-archive.zip [--max-download-size <size>] [--max-expanded-size <size>] [--download-timeout-ms <ms>] [--allow-private-network] [--strict] [--json]
npx workspai workspace archive doctor team-workspace.workspai-archive.zip [--max-download-size <size>] [--max-expanded-size <size>] [--download-timeout-ms <ms>] [--allow-private-network] [--strict] [--json]
npx workspai workspace hydrate team-workspace.workspai-archive.zip --output ./team-workspace [--max-download-size <size>] [--max-expanded-size <size>] [--download-timeout-ms <ms>] [--allow-private-network]
npx workspai workspace import team-workspace.workspai-archive.zip --output ./team-workspace [--project-grounding managed|local|off] [--dry-run] [--strict] [--json]
npx workspai workspace connect [directory] [--project-grounding managed|local|off] [--dry-run] [--json]
npx workspai import <path|git-url> [--workspace <path>] [--name <project-name>] [--git] [--enable-modules] [--project-grounding managed|local|off] [--json]
npx workspai adopt [path] [--workspace <path>] [--name <project-name>] [--enable-modules] [--project-grounding managed|local|off] [--dry-run] [--json]
npx workspai snapshot create [name] [--include-projects] [--reason <text>] [--json]
npx workspai snapshot list [--json]
npx workspai snapshot inspect <name> [--json]
npx workspai snapshot restore <name> [--dry-run] [--force] [--json]
npx workspai project archive <name> [--reason <text>] [--dry-run] [--json]
npx workspai project archives [--json]
npx workspai project restore <archive> [--name <project-name>] [--force] [--dry-run] [--json]
npx workspai project delete <name> [--permanent --confirm <name>] [--dry-run] [--json]
npx workspai project workspace [status|relink] [--workspace <path>] [--project <path>] [--json]
npx workspai workspace init
npx workspai workspace run <init|test|build|start|custom-stage> [--workspace <path>] [--scope project:<name>] [--plan] [--runtime <runtime>] [--affected] [--blast-radius] [--since <ref>] [--parallel] [--max-workers <n>] [--continue-on-error] [--reuse-passed] [--strict] [--no-gates] [--json]
npx workspai infra plan [--workspace <path>] [--json] [--dry-run] [--verbose]
npx workspai infra up [--workspace <path>] [--no-plan] [--build]
npx workspai infra down [--workspace <path>] [--volumes]
npx workspai infra status [--workspace <path>] [--json] [--strict]
```

Every workspace action has action-scoped help generated from the same contract
that governs its accepted flags. For example:

```bash
npx workspai workspace impact --help
npx workspai workspace graph search --help
```

This avoids guessing whether an option such as `--write`, `--from`, or
`--output` belongs to a particular action.

The contract graph includes its backward-compatible service projection, the
canonical `workspace-dependency-graph.v1` project topology, and the portable
`workspace-knowledge-graph.v1` evidence graph. The knowledge projection covers
workspace/project structure, packages and dependencies, source files, modules,
symbols, HTTP endpoints, OpenAPI/GraphQL/Protocol Buffers/AsyncAPI contracts,
Compose/Kubernetes/Dockerfile/Terraform/Helm infrastructure, CI workflows,
documentation, ADRs, tests, owners, environments, databases, and queues.
Every entity and relation has stable identity and portable proof paths; proof
taxonomy separates authored, extracted, and inferred facts and records trust,
confidence, and freshness. Environment and secret values are never emitted.

`workspace intelligence run` writes
`.workspai/reports/workspace-intelligence-run-last-run.json`. Its `preflight`
contains exactly `sync` and `baseline`, while `stages` contains exactly the 11
ordered canonical chain steps. Exit `0` is passed, `1` is a hard execution
failure, and `2` is a completed but evidence-blocked run. With `--strict`,
warning-grade Analyze and Readiness verdicts can block the run without becoming
execution failures. See
[Unified Workspace Intelligence Runner](./workspace-intelligence-runner.md) for
baseline creation/reuse, JSON fields, artifact invariants, skip propagation, and
CI handling.

`workspace goal` turns a user outcome into a durable success contract. Plan a
release-readiness, dependency-security, or test-coverage goal once; Studio or
another agent can then work toward it and ask the CLI to verify current
evidence. Goal definitions live under `.workspai/goals/`, while the latest
portable verdict is written to
`.workspai/reports/verified-goal-last-run.json`. See
[Verified engineering goals](./workspace-intelligence-runner.md#verified-engineering-goals)
for the supported scopes, safety constraints, and verification boundary.

Top-level `goal <intent>` is the plain-language planning front door. It binds
the intent to the current canonical Model and Graph, resolves project/workspace
scope, runs capability/retrieval preflight, and atomically writes a Goal Pack,
portable agent handoff, and active-goal index. Use `goal --status`, `--list`,
`--activate`, or `--cancel` for discovery/lifecycle; deterministic goals may use
`--prepare` and `--verify`. It does not silently mutate source or let an agent
claim verification. Lifecycle operations are mutually exclusive, cannot be
combined with an intent or planning-only flags, and `--no-run` is valid only
with `--verify`. See [Goal Packs](./goal-packs.md).

`workspace feedback record` is a non-interactive machine interface. It requires
exactly one JSON object on stdin and `--json`; an empty stdin or interactive TTY
is rejected. Required fields are `actionId`, `summary`, and `outcome`. The
accepted outcome values and optional scope/evidence fields are governed by
`contracts/workspace-intelligence/agent-action-outcome.v1.json`. Successful
records are appended to
`.workspai/reports/workspace-intelligence-history.json`; no separate feedback
artifact is created.

`workspace graph emit --json` returns both the compatibility project graph and
the knowledge graph. Use `workspace graph entities [kind]`, `workspace graph
evidence <id-or-unique-label>`, and `workspace graph path <from> <to>` for
indexed queries. `workspace graph overlay --from <prior-graph.json>` produces a
portable change/PR overlay with additions, removals, changed fields, proof
artifacts, proof additions/removals/content changes, bounded one-hop impact,
and a risk summary. Observation timestamps and freshness alone do not create
false change noise. Query indexes are cached
per immutable graph object and invalidated automatically when a new graph is
built. `dot` and `mermaid` intentionally remain project-topology renderers.
Without `--output` they emit raw text for direct piping. With `--output` they
write a durable file; adding `--json` returns a structured operation receipt
with the format, node and edge counts, and resolved output path.

Every integrated `workspace graph` Knowledge Graph is derived from the
canonical Workspace Model. Its contract fixes the source artifact to
`.workspai/reports/workspace-model.json` and binds the graph to the model's
stable structural SHA-256. Graph providers enrich that model-owned inventory;
they never write facts back into the authorizing model during the same run.

`workspace graph search <query> --limit <n> --json` returns bounded entities,
one-hop relations, related entity summaries, and portable proofs instead of the
complete graph. Ranking is deterministic and offline: it removes natural-language
stopwords, weights rarer graph terms more strongly, and prefers exact labels and
identities. `workspace graph benchmark <query> --limit <n> --json` compares
that retrieval payload with the readable proof-indexed corpus using a labelled
`characters / 4` estimate. It measures payload reduction only; it does not
assert equivalent answer quality or model-specific billing savings.

Add `--scope project:<name>` to retrieve project-owned facts plus
workspace-level shared entities proven to be connected to that project. The
agent projection reports explicit omission budgets for relations, related
entities, proofs, aliases, attributes, and proof references. Read-oriented
`search`, `entities`, `evidence`, `path`, and `benchmark` modes reuse the
persisted graph only when its model binding, proofs, project scopes, and live
Git/Merkle input fingerprint still match. `--refresh-graph` bypasses that
compatible snapshot and rebuilds from current sources.

`workspace graph jsonld|graphml|gexf` exports the current derived,
evidence-backed Knowledge Graph for semantic, graph-analysis, and interactive
2D/3D consumers. All five export modes accept `--output <file>`; Mermaid and
DOT remain compact documentation-oriented project-topology renderings.

`workspace eval` records provider/tokenizer/estimate provenance, tool activity,
cost, latency, and verified task outcome. `eval record` accepts a
`model-usage-event.v1` JSON document on stdin. The live and finalized artifacts
are suitable for IDE dashboards and conform to
`workspace-intelligence-evaluation.v1`.

`workspace model --write` also materializes the derived, contract-validated
knowledge graph at `.workspai/reports/workspace-knowledge-graph.json`. The
unified intelligence runner treats that artifact as a required output of the
Model step, so CI, IDE adapters, agent grounding, and MCP all observe the same
revision. Agent contexts carry its reference, quality counts, and bounded query
commands instead of copying the entire graph into every prompt. MCP exposes
`getWorkspaceKnowledgeGraph`, `searchWorkspaceGraph`, `queryWorkspaceEntities`,
`getWorkspaceGraphEvidence`, and `findWorkspaceGraphPath`.

Source extraction is bounded and language-neutral by contract. It recognizes
the primary source formats for TypeScript/JavaScript, Python, Go, Java/Kotlin,
.NET/F#, Rust, Ruby, PHP, Swift, Dart, Elixir, Scala, Clojure, Lua, R, C/C++,
Vue, and Svelte. Package baselines also recognize npm/Deno, Python, Go, Cargo,
Maven/Gradle, NuGet, Composer, Ruby, Elixir, Dart, SwiftPM, CMake, Bazel, and SBT.
Regex-backed
source facts are marked `observed` with medium confidence; authored manifests
and interface/infrastructure specifications remain authoritative. This avoids
presenting heuristic symbol discovery as compiler-grade truth while keeping the
current CLI useful until deeper language providers move into the standalone
graph package.

See [workspace-run.md](./workspace-run.md) for fleet orchestration semantics.

After cloning or moving an existing workspace, `workspace sync` repairs its
machine-local global registry entry before project discovery. For workspaces
that only have legacy `.rapidkit-workspace` metadata, run `workspace foundation
ensure` to add the canonical marker and foundation without deleting legacy
compatibility inputs.

Workspace profile compatibility is enforced consistently across `create project`,
`import`, `adopt`, and `bootstrap` compliance. In default `warn` policy mode,
cross-runtime additions are allowed with a recommendation such as
`npx workspai bootstrap --profile polyglot`; in `strict` mode, mismatches are
blocked before the project is registered. Rust is an extended runtime with
Axum/Tauri scaffolding and Cargo lifecycle support. PHP is extended through
Laravel and Composer lifecycle support. Observed runtimes such as C and C++ are
counted in the workspace runtime mix even when Workspai does not own a native
scaffold for them. Existing CMake and Meson projects can also expose discovered
lifecycle units to `workspace run`; inspect them without execution using
`workspace run <stage> --plan`, and select one runtime family with
`--runtime <runtime>`.

Core module/template commands are intentionally narrower than runtime detection.
RapidKit Core modules are guaranteed only for RapidKit Core module-enabled kits:
`fastapi.standard`, `fastapi.ddd`, and `nestjs.standard`. They are not enabled
for every project that happens to use a first-class framework. For example, an
arbitrary existing FastAPI application can be adopted and modeled as a
Python/FastAPI project, but module mutation remains disabled unless its RapidKit
project metadata identifies one of those module-enabled kits.
`--enable-modules` preserves module commands only when existing RapidKit
metadata already identifies a module-enabled kit; it does not enable Core module
mutation for an arbitrary detected framework.

## Project lifecycle

```bash
npx workspai create project <kit> <name> [--yes] [--skip-install] [--skip-git] [--dry-run] [--output <dir>] [--create-workspace|--no-workspace]
npx workspai project commands [--json]
npx workspai commands --scope project [--json]
npx workspai init
npx workspai dev
npx workspai test
npx workspai build
npx workspai start
```

Examples:

```bash
npx workspai create project fastapi.standard my-api --yes
npx workspai create project nextjs my-web --yes
npx workspai create project rust.axum my-rust-api --yes
npx workspai create project desktop.tauri my-desktop-app --yes
npx workspai create project extension.vscode my-extension --yes
npx workspai create project php.laravel my-laravel-api --yes
```

Generator-specific options include `--port`, Spring Boot
`--java-version`/`--spring-version`/`--package-name`/`--group-id`/`--artifact-id`,
and .NET `--dotnet-version`/`--target-framework`/`--nullable`. Use
`npx workspai create project --help` for the live option inventory.

`create frontend <id> <name>` is still accepted and routes to the same generators.

`project commands` shows the effective command contract for the current project.
Core-backed FastAPI/NestJS projects can use module commands such as `add` and
`modules`. Frontend, desktop, extension, Go, Spring Boot, .NET, Rust, PHP, and
adopted/imported projects use runtime lifecycle commands and workspace
governance while Core module mutation remains disabled.

## Operations

```bash
npx workspai cache <status|clear|prune|repair>
npx workspai mirror <status|sync|verify|rotate>
npx workspai infra <plan|up|down|status>
npx workspai ai <info|recommend|generate-embeddings|update-embeddings>
npx workspai config <show|ai|set-api-key|remove-api-key>
npx workspai product <manifest|plan>
npx workspai shell
```

These groups are part of the public CLI surface, but availability of an
operation can still depend on project runtime, optional provider configuration,
or product metadata. Use the action's `--help` and `workspai commands --json`
instead of inferring support from this compact synopsis.

See [workspace-operations.md](./workspace-operations.md#workspace-infrastructure-sidecar) for infra discovery rules.

## Profiles

- `minimal` — baseline workspace scaffolding
- `java-only` — Java-focused workspace
- `python-only` — Python-focused workspace
- `node-only` — Node.js-focused workspace
- `go-only` — Go-focused workspace
- `dotnet-only` — .NET-focused workspace
- `polyglot` — Python + Node.js + Go + Java + .NET
- `enterprise` — polyglot + governance-oriented checks

## Policy modes

`mode` in `.workspai/policies.yml`:

- `warn` (default): report violations, continue
- `strict`: block incompatible operations

```bash
npx workspai workspace policy show
npx workspai workspace policy set mode strict
npx workspai workspace policy set dependency_sharing_mode shared-runtime-caches
npx workspai workspace policy set rules.enforce_toolchain_lock true
```

Supported keys: `mode`, `dependency_sharing_mode`, `rules.enforce_workspace_marker`, `rules.enforce_toolchain_lock`, `rules.disallow_untrusted_tool_sources`, `rules.enforce_compatibility_matrix`, `rules.require_mirror_lock_for_offline`.

## Setup and warm dependencies

`setup <runtime>` validates toolchain and updates `.workspai/toolchain.lock`.

`--warm-deps` adds optional dependency warm-up (Node lock/deps, Go modules). Warm-deps is non-fatal and reports `completed` / `failed` / `skipped`.

## See also

- [Documentation index](./README.md)
- [workspace-operations.md](./workspace-operations.md)
- [workspace-run.md](./workspace-run.md)
- [contracts/COMMAND_OWNERSHIP_MATRIX.md](./contracts/COMMAND_OWNERSHIP_MATRIX.md)
