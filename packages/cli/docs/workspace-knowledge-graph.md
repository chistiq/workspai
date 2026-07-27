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
```

A simplified response looks like this:

```json
{
  "schemaVersion": "workspace-knowledge-search.v1",
  "query": "billing database",
  "totalMatches": 23,
  "truncated": true,
  "entities": [{ "kind": "database", "label": "billing-db", "proofIds": ["proof:..."] }],
  "relations": [{ "kind": "reads-from", "from": "service:billing", "to": "database:billing-db" }],
  "proofs": [{ "provider": "compose", "artifact": "infra/compose.yml", "trust": "authoritative" }]
}
```

The response is intentionally bounded. `totalMatches` tells the consumer more
results exist, `truncated` prevents silent omission, and every returned claim can
be traced through `proofIds`.

## Pick the command by question

| You want to know…                                    | Use                                                     |
| ---------------------------------------------------- | ------------------------------------------------------- |
| What is relevant to a natural-language question?     | `workspace graph search <query> --limit <n> --json`     |
| Which entities of one type exist?                    | `workspace graph entities <kind> --json`                |
| Why does Workspai believe an item exists?            | `workspace graph evidence <entity-or-relation> --json`  |
| How are two things connected?                        | `workspace graph path <from> <to> --json`               |
| What changed between graph revisions?                | `workspace graph overlay --from <graph.json> --json`    |
| What is the full portable graph?                     | `workspace graph emit --json`                           |
| How do I export to semantic or graph-analysis tools? | `workspace graph jsonld\|graphml\|gexf --output <file>` |
| How much retrieval payload did one query avoid?      | `workspace graph benchmark <query> --limit <n> --json`  |
| How should an MCP-compatible agent retrieve context? | `workspace mcp serve` → `searchWorkspaceGraph`          |

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

The two artifacts are published under one workspace lock using a
rollback-capable artifact transaction. Each file replacement is atomic; if any
write fails, Workspai restores both preimages. `graph.source.kind` is fixed to
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

`workspace model --write` publishes these two artifacts as one locked,
rollback-capable artifact set:

```text
.workspai/reports/workspace-model.json
.workspai/reports/workspace-knowledge-graph.json
```

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
start with `INDEX.json`, use bounded search, then retrieve evidence or a path
for the selected result.

### Interchange and visualization

The JSON artifact is the canonical interchange form of the derived graph; the
Workspace Model remains the system source of truth. Other formats are
deterministic projections of that same graph revision:

```bash
npx workspai workspace graph mermaid
npx workspai workspace graph dot
npx workspai workspace graph jsonld --output workspace-graph.jsonld
npx workspai workspace graph graphml --output workspace-graph.graphml
npx workspai workspace graph gexf --output workspace-graph.gexf
```

- Mermaid and DOT are suited to documentation and architecture diagrams.
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
is the invalidation boundary. `workspace model --cache` and `--incremental`
avoid unnecessary model/project work when inputs are unchanged.

Use full graph export for interchange or offline analysis. Use bounded search
for interactive agents. The latter keeps response size proportional to the
question instead of workspace size.

## Measuring retrieval payload reduction

Workspai does not publish an unqualified “N× fewer tokens” claim. Such a claim
depends on the workspace, query, tokenizer, model, answer-quality target, and
baseline.

Measure the current workspace instead:

```bash
npx workspai workspace graph benchmark "authentication endpoint" --limit 12 --json
```

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
- Compiler/LSP-grade symbol resolution belongs in deeper language providers.
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
