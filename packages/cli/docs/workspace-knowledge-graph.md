# Workspace Knowledge Graph

Most code graphs answer questions about one repository. Workspai connects code,
APIs, infrastructure, delivery, documentation, ownership, tests, and runtime
configuration across a whole workspace—and records why every relationship is
believed.

The graph is local-first and deterministic. Building it does not require an
LLM, a hosted service, embeddings, or a graph database.

## Why this is useful

A repository graph can tell you that function A calls function B. A workspace
question is usually wider:

> If we change this endpoint, which project consumes it, which deployment ships
> it, which tests cover it, which document describes it, and which release gate
> can stop it?

Workspai keeps those domains in one proof-carrying representation. The graph is
not the final product screen; it is the shared knowledge layer behind impact,
verification, context, MCP, IDE, CI, and agent workflows.

| If you are…          | The graph helps you…                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| A developer          | find the implementation, nearby dependencies, tests, and evidence without repo-wide search |
| A tech lead          | inspect cross-project boundaries, owners, contracts, and change paths                      |
| An AI coding agent   | retrieve question-sized context and verify every returned claim                            |
| A CI/release system  | consume versioned JSON, source hashes, quality diagnostics, and deterministic exits        |
| An IDE or MCP client | offer the same system understanding without rebuilding a private index                     |

## What makes it a workspace graph

Workspai does not stop at files, imports, functions, and classes. Repository
structure is one provider domain alongside APIs, containers, infrastructure,
pipelines, documents, decisions, ownership, tests, environments, and authored
workspace contracts.

That distinction matters when the answer crosses repositories. The canonical
Workspace Model remains the source of truth; the Knowledge Graph is its rich,
queryable, evidence-backed representation. AI is a consumer, never a requirement
for building the graph.

## Try it in two minutes

Run from a Workspai workspace:

```bash
npx workspai workspace model --write --json
npx workspai workspace graph search "authentication endpoint" --limit 12 --json
```

Useful follow-up questions:

```bash
# What APIs and endpoints exist?
npx workspai workspace graph entities endpoint --json

# Which languages are evidenced in one project? The flag form is equivalent.
npx workspai workspace graph entities --kind language --scope project:billing --limit 100 --json

# Why does Workspai believe this entity exists?
npx workspai workspace graph evidence "GET /users" --json

# How are two services, files, or APIs connected?
npx workspai workspace graph path frontend-api "GET /users" --json

# What changed since a saved graph revision?
npx workspai workspace graph overlay --from previous-graph.json --json
```

For agents and MCP clients, prefer bounded search over loading the complete
graph:

```bash
npx workspai workspace graph search "billing database" --limit 12 --json
npx workspai workspace graph search "billing database" --scope project:billing --limit 12 --json
```

A simplified response looks like this:

```json
{
  "schemaVersion": "workspace-knowledge-search.v1",
  "graphSourceHash": "<canonical-model-structural-sha256>",
  "query": "billing database",
  "projectId": "billing",
  "totalMatches": 23,
  "truncated": true,
  "entities": [{ "kind": "database", "label": "billing-db", "proofIds": ["proof:..."] }],
  "relations": [{ "kind": "reads-from", "from": "service:billing", "to": "database:billing-db" }],
  "proofs": [{ "provider": "compose", "artifact": "infra/compose.yml", "trust": "authoritative" }],
  "budget": { "mode": "agent", "limits": { "proofs": 16 }, "omitted": { "proofs": 4 } }
}
```

The response is intentionally bounded. `totalMatches` tells the consumer more
results exist, `truncated` prevents silent omission, and every returned claim can
be traced through `proofIds`. Use `--scope project:<name>` to keep a query within
one registered project while retaining workspace-level shared entities that are
proven to be connected to it.

Search remains deterministic, local, and offline. Natural-language filler words
are removed before ranking, and the remaining terms are weighted by how rare
they are in the current graph. Exact labels and identities still win. This keeps
a common word such as `check` from outranking a rarer term such as `user` merely
because it appears in more files. No embedding service or model call is involved.

For multi-term questions, a generic kind intent such as `service` or `api`
cannot qualify an otherwise unrelated entity by itself. The result must cover
the query's meaningful terms, except for deliberate broad architecture queries
whose purpose is to return a diversified set of languages, bindings,
dependencies, ownership, CI, deployment, documentation, and contracts.

Source-structure extraction is also deliberately sampled. Local import
resolution uses the larger bounded fingerprint inventory, so a sampled source
file can still link to a valid target outside the extraction window. A target
outside the sample receives a lightweight proof-backed file entity; its full
symbols are not implied to have been extracted. The graph diagnostic reports
the sampled and indexed candidate counts and must not be read as exhaustive
symbol coverage.

Language inventory is intentionally broader than source-structure parsing.
The complete eligible-path inventory recognizes systems languages and compiler
DSLs such as Assembly, CUDA, Fortran, HLSL, LLVM IR/MIR, MLIR, Objective-C,
OpenCL, and TableGen even when Workspai has no safe generic symbol parser for
that syntax. Language counts therefore remain project-wide inventory facts;
symbols, imports, and calls remain bounded to parser-supported source inputs.

Call binding follows the same proof boundary. Workspai binds a call only when
its target is uniquely defined in the same file or in a locally imported file
that the Graph already resolved. Overloads, dynamic dispatch, and ambiguous
names remain explicit unknowns for compiler or language-server evidence; the
CLI does not turn a repository-wide text match into semantic certainty.

When a previous graph has the same project set, provider versions, and live
project fingerprints, unchanged project slices are reused and only changed
projects repeat the expensive semantic scan. Workspace-level CI, governance,
infrastructure, and topology providers still run against the complete current
workspace. The `incremental-project-cache` provider receipt records reused and
rescanned scope counts. A provider-version change forces a full rebuild.

### Fast reads without stale answers

The read-oriented `search`, `entities`, `evidence`, `path`, and `benchmark`
commands first try the persisted Model and Knowledge Graph. A snapshot is a hit
only when all of the following remain true:

- both artifacts are structurally readable;
- the graph's stable model SHA-256 matches the persisted canonical model;
- no proof is marked stale;
- the graph fingerprint contains exactly one workspace scope and every
  canonical project scope with compatible scan limits;
- a fresh complete eligible-path inventory produces the same aggregate
  live-input hash.

Git-backed scopes use `git-worktree-v2`, covering tracked tree state plus
modified, deleted, renamed, and non-ignored untracked files. If Git cannot
prove the scanned inventory safely—for example because a traversed initialized
submodule or hidden index flag is present—Workspai falls back to
`content-merkle-v1`, which hashes each eligible file by portable path and content.
The graph records the combined strategy as `hybrid-git-content-v2`.

A miss rebuilds from live sources. Use `--refresh-graph` when the caller requires
an explicit rebuild even if the persisted snapshot is compatible:

```bash
npx workspai workspace graph search "protobuf ownership" --refresh-graph --json
```

The fingerprint normally covers every eligible Git-tracked and non-ignored
untracked file in each project scope. The default `500000`-file limit is an
emergency safety boundary, not a semantic completeness target. A scope with
`truncated: true` or `inventoryMode: emergency-bounded` must not be interpreted
as proof about files beyond that boundary. Git inventories publish an exact
`eligibleFileCount`; a non-Git fallback that reaches the boundary publishes
`eligibleFileCountExact: false` instead of inventing a total.

Path inventory and content-heavy extraction have separate budgets. Complete
inventory feeds freshness, manifest discovery, language counts, architecture
contracts, CI, ownership, infrastructure, and targeted providers. Semantic and
deep providers receive deterministic adaptive selections distributed across
component and language buckets. This prevents a large package, vendored tree,
or alphabetically early directory from starving the rest of a polyglot
monorepo. Every provider publishes `inputCoverage`; successful execution over a
bounded selection is reported as `partial`, never as exhaustive coverage.

Defaults scale with the eligible project population up to these safety
ceilings:

- complete inventory emergency bound: `500000` files per project;
- adaptive semantic input: up to `100000` files per project;
- adaptive deep-provider input: up to `25000` files per project;
- source extraction: up to `20000` files per project.

Use `--graph-inventory-limit`, `--graph-semantic-budget`,
`--graph-deep-budget`, and `--graph-source-budget` on `workspace graph`, or the
equivalent `WORKSPAI_GRAPH_INVENTORY_LIMIT`,
`WORKSPAI_GRAPH_SEMANTIC_BUDGET`, `WORKSPAI_GRAPH_DEEP_BUDGET`, and
`WORKSPAI_GRAPH_SOURCE_BUDGET` environment variables for non-interactive model,
Adopt, and Intelligence runs. Increasing deep budgets affects cost, not the
canonical per-project storage boundary.

Workspai-generated agent entry projections are downstream consumers and are
excluded from Graph inventory and Git diff hashing. Regenerating `AGENTS.md`,
adapter entry files, GitHub agent definitions, or the Amazon Q entry rule
therefore cannot invalidate the Graph that produced them or become circular
architecture evidence. The reserved `.workspai-workspace` marker is excluded
for the same ownership reason: its extension/CLI usage telemetry and other
operational metadata describe Workspai activity, not source architecture. Real
repository and workspace source changes remain part of the live fingerprint.

## Pick the command by question

| You want to know…                                    | Use                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| What is relevant to a natural-language question?     | `workspace graph search <query> --limit <n> --json`                           |
| Which entities of one type exist?                    | `workspace graph entities <kind> [--scope project:name] [--limit <n>] --json` |
| Why does Workspai believe an item exists?            | `workspace graph evidence <entity-or-relation> --json`                        |
| How are two things connected?                        | `workspace graph path <from> <to> --json`                                     |
| What changed between graph revisions?                | `workspace graph overlay --from <graph.json> --json`                          |
| What is the full portable graph?                     | `workspace graph emit --output graph.json --json`                             |
| How do I render the project topology?                | `workspace graph dot\|mermaid [--output <file>]`                              |
| How do I export to semantic or graph-analysis tools? | `workspace graph jsonld\|graphml\|gexf --output <file>`                       |
| How much retrieval payload did one query avoid?      | `workspace graph benchmark <query> --limit <n> --json`                        |

`graph emit --json` writes the complete dependency and Knowledge Graph to
stdout and can be very large. Automation, IDEs, and agents should pass
`--output`; stdout then contains only a bounded
`workspai-cli-operation-result-v1` receipt. Use `search`, `entities`,
`evidence`, or `path` for bounded retrieval rather than loading the full
export.
| How should an MCP-compatible agent retrieve context? | `workspace mcp serve` → `searchWorkspaceGraph` |

## What it models

The current graph can represent:

- workspaces, projects, services, packages, modules, files, and symbols;
- APIs, endpoints, schemas, events, queues, and databases;
- containers, deployments, environments, pipelines, and infrastructure;
- documentation, architecture decisions, tests, and owners.

Relations include `contains`, `imports`, `depends-on`, `calls`, `exposes`,
`implements`, `reads-from`, `writes-to`, `publishes`, `consumes`, `deploys`,
`documents`, `decided-by`, `tests`, and `owns`.

Every entity and relation carries portable proof references. A proof records its
provider, source artifact, optional pointer/line, content hash, freshness,
derivation, trust, and confidence. Secret values and machine-local absolute
paths are excluded from the portable graph contract.

## Read graph quality correctly

Provider execution and graph completeness are separate signals:

| Provider status | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `passed`        | A matching source surface was found and graph evidence was produced.        |
| `partial`       | The provider found applicable input but produced incomplete or no evidence. |
| `skipped`       | No applicable source surface was present in this workspace.                 |
| `failed`        | The provider could not complete its bounded scan.                           |

`quality.providerSuccessRatio` is an execution-health ratio, not a completeness
claim. A skipped provider is healthy but not applicable. Applicable providers
that emit no evidence become `partial` and add an explicit unknown diagnostic,
which contributes to `quality.unknownCount`. Bounded-scan limits and unresolved
source relationships also contribute unknowns instead of being presented as
complete coverage. Binding coverage remains the dimension-specific source for
API implementation, tests, deployment, and ownership gaps; its unknowns are
included in the aggregate count.

Profiles govern workspace policy and verification expectations; they do not hide
source providers. Running the same unchanged workspace with `minimal` and
`polyglot` can therefore produce identical graph content. Changing a profile
does update the canonical workspace manifest and contract identity.

## Model first, graph second

The canonical direction is one-way:

```text
Workspace sources
      ↓
Canonical Workspace Model + project topology
      ↓
Evidence-backed Workspace Knowledge Graph
      ↓
CLI queries · Context · MCP · Agents · IDEs · CI
```

The graph does not rewrite or replace the canonical Workspace Model. It is a
derived representation bound to an exact model revision by the SHA-256 hash of
the model's stable structural projection. Volatile timestamps, run correlation,
live evidence references, and freshness fields are intentionally excluded from
that structural identity. Context, Doctor, MCP, and graph-stream consumers
reject a graph whose source binding no longer matches the current model.

### Model and graph relationship

The current integrated CLI follows this order:

```text
workspace files + registered projects + contracts + selected evidence
                              |
                              v
                 canonical Workspace Model
                    |                 |
                    |                 +-- compact project dependency topology
                    |
                    v
       provider scan + facts/proofs + identity reconciliation
                              |
                              v
                  Workspace Knowledge Graph
```

The model owns the canonical workspace boundary: project identity, runtime and
framework observations, policies, contract state, evidence references, and the
compact project topology used by the intelligence loop. The Knowledge Graph
receives that project inventory and topology, then enriches it from bounded
source providers. It can add files, symbols, packages, APIs, infrastructure,
tests, owners, decisions, and proof-carrying relations, but it cannot mutate the
model that authorized the build.

The canonical project inventory reconciles filesystem discovery, imported and
adopted registries, and `workspace.contract.json` declarations. A project that
is still declared by the contract but missing on disk is preserved in the
model and reported as `project.path.missing`; it is never silently removed from
the graph boundary. A persisted Knowledge Graph is accepted only when its
workspace identity and project topology also match that model.

An adopted monorepo remains one canonical project unless its internal projects
are separately registered, discovered inside the workspace boundary, or
declared by contract. The model still records bounded nested runtime manifests
in `project.runtimeCandidates` and aggregates them into
`workspace.identity.runtimeFamilies`. Graph providers can then discover the
monorepo's internal services, contracts, delivery surfaces, and proofs without
pretending that the primary runtime describes the whole repository.

The model, workspace aggregate, and all project graph artifacts are published
under one workspace lock using a rollback-capable multi-root artifact
transaction. Each file replacement is atomic; if any write fails, Workspai
restores every preimage. `graph.source.kind` is fixed to
`workspace-model`, `graph.source.artifact` is fixed to
`.workspai/reports/workspace-model.json`, and `graph.source.hash` contains the
stable structural hash of the persisted model. A current-state consumer must
reject the graph when that binding no longer matches `workspace-model.json`.

This is therefore not a circular source-of-truth relationship. In the current
CLI, the direction is **Model → Knowledge Graph**. Providers may use the same
workspace sources that informed the model, but their output enriches the
derived graph; it does not flow back into the model during that run. A future
fact-first package may make normalized facts the shared input to both
representations, but that is not the shipped contract today.

The model also contains a smaller project dependency graph under the canonical
`projectTopology` field. That projection is used for impact, blast radius,
verify, explain, watch, and affected fleet runs. The richer Knowledge Graph is
used for proof-backed retrieval and cross-domain understanding. The deprecated
`graph` field is emitted only as a v1 compatibility alias and must remain
structurally identical to `projectTopology`; new consumers must not depend on
the alias.

These rules are machine-owned, not Markdown conventions:

- `workspace-intelligence-architecture.v1.json` declares the one-way direction,
  artifact authority, mutation rule, publication rule, and stale-consumer rule;
- `workspace-knowledge-graph.v1.json` permits only the canonical model source
  kind and artifact path;
- `workspace-intelligence-chain.v1.json` requires the Model stage to produce
  both artifacts;
- runtime source-binding guards enforce the structural hash before persisted
  graph consumption.

## Sources and providers

The current CLI uses bounded providers for:

- workspace/project foundations and service contracts;
- language-neutral source structure and package manifests;
- OpenAPI, GraphQL, Protobuf, and AsyncAPI interfaces;
- C/C++ source, CMake/Meson lifecycle units, Bazel/CMake packages, and
  cross-language protocol bindings;
- Docker/Compose, Kubernetes, Terraform, and CI workflows;
- README/docs, ADRs, tests, and CODEOWNERS.

Providers emit facts and proofs. The graph engine owns stable identity,
deduplication, typed relations, reconciliation, quality metrics, diagnostics,
and deterministic ordering. Regex-backed source observations are explicitly
marked as observed/medium-confidence; authored contracts remain authoritative.

Local source imports are resolved to indexed file entities when the target can
be proven. External packages remain module entities, while unresolved relative
imports are labelled `unresolved-local` and produce a diagnostic. This prevents
an unknown local path from being silently presented as a third-party
dependency.

Protocol Buffers services and messages retain definition-level identity
variants. Two projects may use the same fully qualified name without being
silently collapsed; proven cross-project or cross-language equivalence is
represented as a relation instead. In a C++-primary repository, ambiguous
`.h` headers inherit the authoritative project language so C/C++ inventories do
not split solely because the extension is shared.

### Binding quality, not just graph size

Entity and relation counts do not tell you whether a graph can answer useful
engineering questions. `graph.quality.bindingCoverage` therefore reports four
independent dimensions:

- authored or observed endpoints connected to implementation evidence;
- registered projects connected to test evidence;
- registered projects connected to deployment evidence;
- registered projects connected to ownership evidence.

Each dimension reports eligible, bound, and unknown counts plus a ratio. A
`null` ratio means the dimension was not applicable; zero means applicable
surfaces were found but none were bound. Consumers must not turn either state
into a false “complete” claim.

## Outputs and consumers

`workspace model --write` publishes the canonical model, one complete workspace
aggregate, and one compact integrity-bound reference for every registered
project as one locked, rollback-capable multi-root artifact set:

```text
<workspace>/.workspai/reports/workspace-model.json
<workspace>/.workspai/reports/workspace-knowledge-graph.json
<project>/.workspai/reports/project-knowledge-graph-reference.json
```

The workspace artifact preserves all registered projects and cross-project
relations for Graph, Doctor, Context, Goal, and MCP consumers. Each project
reference carries source and projection hashes, summary counts, a bounded query,
and a portable canonical URI; it does not duplicate graph entities or proofs.
Nested and external projects follow the same rule. Any publication failure
restores the model, aggregate, and all project reference preimages together.

The Knowledge Graph is consumed by:

- `workspace graph search|entities|evidence|path|overlay`;
- `doctor workspace|project`, which maps unresolved probes to structural root
  candidates, reachable affected surfaces, proof paths, and graph-connected
  test/pipeline verification targets. When a runtime audit names affected
  dependencies, Doctor binds those subjects to exact package/module entities
  instead of selecting an arbitrary project package. Names that cannot be
  resolved remain explicit unknowns;
- `workspace context`, which validates the model hash and publishes graph
  availability and query commands;
- `workspace agent-sync`, which places it in the evidence index and generated
  agent/MCP instructions;
- `workspace mcp serve`, through `getWorkspaceKnowledgeGraph`,
  `searchWorkspaceGraph`, `queryWorkspaceEntities`,
  `getWorkspaceGraphEvidence`, and `findWorkspaceGraphPath`;
- `workspace contract graph`, which exposes the contract projection, project
  topology, rich graph, and quality summary in one response.

The complete graph is an interchange artifact, not a prompt. Agents should
start with compact project context, use bounded search, then retrieve evidence
or a path for the selected result. Generated `project-context-agent.json`,
`agent-entry.v1.json`, and bootstrap receipts expose a small project graph
reference separately from the `workspace:` aggregate. Bootstrap schema-validates
the reference and compares its projection hash with a fresh projection of the
aggregate before it allows architecture claims. The complete graph is stored once.

### Interchange and visualization

The JSON artifact is the canonical interchange form of the derived graph; the
Workspace Model remains the system source of truth. Other formats are
deterministic projections of that same graph revision:

```bash
npx workspai workspace graph mermaid
npx workspai workspace graph dot
npx workspai workspace graph mermaid --output workspace-graph.mmd --json
npx workspai workspace graph dot --output workspace-graph.dot --json
npx workspai workspace graph jsonld --output workspace-graph.jsonld
npx workspai workspace graph graphml --output workspace-graph.graphml
npx workspai workspace graph gexf --output workspace-graph.gexf
```

- Mermaid and DOT are suited to documentation and architecture diagrams. They
  print raw text when `--output` is omitted. With `--output --json`, the file is
  written and stdout is a structured operation receipt rather than graph text.
- JSON-LD carries semantic identities, relations, and proof references.
- GraphML and GEXF work with graph-analysis and interactive visualization tools.
- The canonical JSON, JSON-LD, GraphML, and GEXF outputs can drive 2D or 3D
  viewers; a 3D view is a presentation layer, not a separate source of truth.

## AI tool output locations

`workspace agent-sync --write --preset enterprise` generates native surfaces
without changing project source:

| Consumer               | Canonical output                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-tool/Codex       | `AGENTS.md`, `.workspai/reports/INDEX.json`                                                                                                                        |
| Claude Code            | `CLAUDE.md`, `.claude/rules/workspai-evidence.md`                                                                                                                  |
| GitHub Copilot/VS Code | `.github/copilot-instructions.md`, `.github/instructions/workspai-*.instructions.md`, `.github/agents/workspai-*.agent.md`, `.github/prompts/workspai-*.prompt.md` |
| Cursor                 | `.cursor/rules/workspai-grounding.mdc`                                                                                                                             |
| MCP clients            | `.workspai/reports/workspai-mcp-design.json`, `workspace mcp serve`                                                                                                |

Files named `rapidkit-*` are compatibility aliases for older consumers. They
must stay narrowly scoped and must not duplicate an always-applied canonical
rule.

### Avoiding duplicate AI instructions

Canonical Workspai rules are the only always-applied surfaces. Legacy RapidKit
aliases point to the canonical files and apply only to `.rapidkit/**`. This
prevents two equivalent instruction files from being injected into one prompt.

The recommended read order is:

1. `AGENTS.md` for stable workspace policy and navigation;
2. `.workspai/reports/INDEX.json` for artifact discovery and freshness;
3. `workspace graph search` or `searchWorkspaceGraph` for question-sized facts;
4. `workspace graph evidence|path` when a claim needs proof;
5. the complete model or graph only for export, audit, or whole-system analysis.

## Performance and scale

Graph construction inventories each project once per build and caps the number
of scanned files. Providers reuse the same in-memory inventory and content
hashes. Query indexes are cached per immutable graph object; replacing the graph
is the in-memory invalidation boundary. Across CLI processes, compatible
persisted read queries validate the live Git/Merkle fingerprint before reuse.
`workspace model --cache` and `--incremental` avoid unnecessary model/project
work when inputs are unchanged. Full, cached, and incremental builds use the
same project-discovery contract, including adopted/imported projects and
projects declared only through a workspace contract `externalPath`. Manifest
or source changes under an external project therefore invalidate the same
signatures as equivalent in-workspace projects.

Use full graph export for interchange or offline analysis. Use bounded search
for interactive agents. The latter keeps response size proportional to the
question instead of workspace size.

### Runtime-generated API topology

When an authored API contract is wired through framework registration or
configuration rather than a literal route handler, the
`dynamic-api-registration-binding` provider creates a proof-backed
`runtime-unit -> implements -> api` relation. Detection is runtime-specific,
production-only, filename-aware for routing configuration, and bounded per API.
It intentionally does not claim endpoint implementation: endpoint coverage
remains unknown until a method/path or operation-id binding is proven. Consumers
can distinguish the two guarantees through `bindingCoverage.apiRuntimeRegistration`
and `bindingCoverage.apiImplementation`.

Runtime-registration eligibility is explicit. Network and event contracts such
as OpenAPI, server-root GraphQL schemas, AsyncAPI, and authored workspace API
contracts participate; command palettes, console scripts, chat participants,
shared protocol identities, and client GraphQL operations do not. GraphQL query,
mutation, subscription, and fragment documents are modeled as proof-backed
symbols that consume the GraphQL protocol. Only an authored root `schema` or
non-extension `Query`, `Mutation`, or `Subscription` type establishes a
runtime-served GraphQL API. This prevents client-heavy repositories from
inflating API registration unknowns while preserving their operation topology.

## Measuring retrieval payload reduction

Workspai does not publish an unqualified “N× fewer tokens” claim. Such a claim
depends on the workspace, query, tokenizer, model, answer-quality target, and
baseline.

Measure the current workspace instead:

```bash
npx workspai workspace graph benchmark "authentication endpoint" --limit 12 --json
```

Use `--kind <entity-kind>` with search when the task requires a precise
semantic surface, for example `--kind runtime-unit` for dynamic registration
units or `--kind endpoint` for authored operations.

The report compares the readable, proof-indexed source corpus with the bounded
search payload using a clearly labelled `characters / 4` token estimate. It
reports corpus size, retrieval size, estimated ratio, percentage reduction,
unreadable artifacts, query, limit, graph counts, and the exact source-model
SHA-256 needed to reproduce the run.

This proves **retrieval payload reduction**, not equivalent answer quality,
model-specific billing savings, or universal token savings. A publishable
cross-project claim additionally requires pinned source revisions, fixed
queries, a real tokenizer, repeated runs, and answer-quality evaluation.

In the current 16-project development fixture, the query `api endpoint` with
`--limit 8` returned 8 entities and 9 proofs. The compact retrieval was 2,812
estimated tokens versus 134,105 estimated tokens in 392 readable proof-source
artifacts: an observed 47.69× / 97.9% payload reduction. This is a transparent
fixture result, not a headline claim for every workspace.

See [Graph Benchmark Methodology](./graph-benchmark-methodology.md) for formulas,
reproduction rules, realistic baselines, and the gate required before publishing
a general performance claim.

## Current boundaries

- The CLI graph is intentionally file-backed; a graph database is not required.
- Text search is deterministic lexical retrieval, not embedding similarity.
- The live-input fingerprint enables whole-graph snapshot reuse; it is not yet
  a per-file incremental graph rebuild or a hosted semantic-vector index.
- Compiler/LSP-grade symbol resolution belongs in deeper language providers.
- Runtime registration evidence proves that an API enters the running topology;
  it does not prove that every authored operation has a reachable handler.
- Missing project edges mean “relationship not proven,” not “projects are
  independent.” Author service contracts or provide API/package/runtime
  evidence to close that gap.
- The standalone `@workspai/graph` package remains unpublished while its public
  contracts and conformance gates are developed.

## When the graph looks incomplete

Workspai does not invent relationships. If projects appear as disconnected
nodes, check the following in order:

1. run `workspace sync --json` and regenerate the model;
2. declare `dependsOn`, APIs, published events, and consumed events in the
   workspace/project contracts;
3. confirm package manifests, OpenAPI/AsyncAPI/GraphQL/Protobuf documents,
   Compose/Kubernetes/Terraform files, and CI definitions are inside registered
   project paths;
4. inspect `graph.quality`, `providers`, and `diagnostics` before treating a
   missing edge as proof of independence.

An absent edge means “not proven by current evidence,” not “no dependency
exists.”

For schemas and machine contracts, see the
[Artifact Catalog](./contracts/ARTIFACT_CATALOG.md). For the full command
surface, see [Commands Reference](./commands-reference.md).
