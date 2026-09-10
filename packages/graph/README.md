# `@workspai/graph`

Evidence-backed, storage-neutral workspace graph engine for Workspai.

Status: **repository preview candidate · development-only · not publishable**

> This is the developing independent Graph implementation. The released
> Workspai CLI already contains the current official internal graph capability.
> Graph is not imported by or connected to the CLI runtime while it is under
> development; CLI adoption is permitted only after standalone stability,
> followed by explicit bridge, shadow-parity, replacement and legacy-removal
> gates.

The package is intentionally available for internal and community development
before publication. Its root API exposes the admitted deterministic composer,
the bounded proof-carrying query engine and the host-neutral G4 repository build
candidate. Node filesystem access is isolated under `@workspai/graph/adapters/node`.
The G4 candidate now includes an explicitly invoked standalone executable and
project-local atomic persistence. CLI replacement remains unavailable until its
later shadow-parity and migration gates complete.

The current `/conformance` surface includes the SH6 Shared-adoption boundary,
the admitted G1 contract layer, G2 reference engine and G3 query suites. It validates WIS
envelope identity, provider detection/manifests, FactBatch provenance and
accounting, ontology-constrained canonical graphs, immutable generations,
quality, binding completeness, proof paths, explicit unknowns and exact
query-cache lifecycle envelopes. These are semantic reference candidates, not
standalone-stability or release claims.

The G5 profile-driven projection engine is available as bounded read views over
the same immutable canonical generation. Generic projection, derived analytics
and graph-slice helpers stay off the package root; the root surface exposes the
fixed `source`, `structural` and `evidence` preview views plus the review-context
slice. Incremental orchestration exists as a local G6 engine and is not exported
from `@workspai/graph`. Standalone-stable admission is not claimed.

Node hosts may explicitly import `@workspai/graph/adapters/node` to execute the
portable reference-composition task outside the event loop. The package root
remains host-neutral. Worker output is revalidated against admitted facts before
it can influence a canonical graph.

The G4 repository preview remains read-only, offline and explicit. The root
`buildRepoGraph` API requires injected host ports and never creates `.workspai`
metadata. The Node adapter provides the bounded filesystem implementation and
official deterministic provider set as a separate convenience surface.

The executable is read-only unless `--write` is supplied. It never executes
repository-controlled code and its default provider set denies network,
credentials and process access.

```bash
workspai-graph inspect .
workspai-graph inspect . --mode project-only --json
workspai-graph inspect . --view source --json
workspai-graph inspect . --view structural --json
workspai-graph inspect . --view evidence --json
workspai-graph quality . --json
workspai-graph query . --preset entryPoints --json
workspai-graph query . --preset reviewContext --slice --json
workspai-graph providers list
workspai-graph inspect . --write --json
```

Published query presets are `GRAPH_QUERY_PRESETS`. Subject-required presets
fail closed without `--subject`. Existing-workspace inspect without
`--workspace` is rejected.

Workspace inspect without an injected onboarding adapter stays `partial` with
`handoff-unavailable`. The packed tarball ships the query-candidate conformance
profile and G1 admit/reject corpus. Incident classes are published; rollback is
not proven.

An explicit write commits immutable, content-addressed artifacts below
`.workspai/reports/graph-generations/` and advances the portable
`graph-generation.json` pointer only after all artifacts are durable. The
pointer records project-relative immutable artifact paths and their digests, so
consumers do not need host paths or directory guessing to resolve a generation.

The offline provider set currently covers file/package topology, static imports
for Node, Python, Go, Java, .NET and Rust, literal route declarations for the
first five of those profiles, repository contract/runtime/delivery surfaces and
safe repository-local Git `HEAD` identity. Computed routes, dynamic imports,
unsupported source languages and Git worktree indirection remain explicit
unknown or unsupported zones. Git config, remotes, credentials and external
worktree metadata are never ingested.

The fixed `source`, `structural` and `evidence` preview views are bounded
read-only selections over the same immutable canonical generation. They retain
canonical node/edge identities, proof and source generation. They are produced
by the G5 profile-driven projection engine through those three admitted view
profiles; they are not a second graph and do not authorize similarity, vector or
central-CLI consumption.

JSON executable results use `schemaVersion` `workspai.graph.cli-result.v1`.
Exit codes are `0` success, `2` partial, `1` failed, `3` rejected, `4`
publication failed and `130` cancelled. The published support and limitations
matrix is `GRAPH_STANDALONE_SUPPORT_MATRIX`; query-cache storage is optional and
injected, never a default network or host cache, and query result envelopes do
not carry a `cache` field.

The fixed review-context slice turns the admitted `reviewContext` query into a
deterministic, size-bounded payload for model and review consumers. It retains
the source generation, query digest, proof paths, evidence, disputes, unknown
boundaries, quality and analytical limitations. It is not a new graph, does not
infer missing facts and does not authorize a generic projection or slice engine.

```ts
import { admitGraphProviderOutput, assessGraphSharedEnvelope } from '@workspai/graph/conformance';

const assessment = assessGraphSharedEnvelope(candidate);
if (!assessment.accepted) {
  // Handle the typed, payload-free diagnostics.
}

const admitted = admitGraphProviderOutput(untrustedManifest, untrustedBatch);
if (!admitted.accepted) {
  // Nothing reaches composition through this provider output.
}
```

## Architectural promise

```text
WIS contracts
  -> facts and evidence
  -> identity / ontology / composition / proof
  -> canonical graph generation
  -> query / projection / slice / delta
  -> Model, Doctor, Context, Agents, MCP and CLI consumers
```

Graph is independent from the central CLI, LLMs and storage products. JSON,
SQLite, Neo4j, RDF and future backends are adapters that cannot change logical
identity, proof, conflict, unknown or relation semantics.

## Local checks

```bash
corepack npm --workspace @workspai/graph run check
corepack npm --workspace @workspai/graph run test:architecture
corepack npm --workspace @workspai/graph run test:contracts
corepack npm --workspace @workspai/graph run pack:check
corepack npm --workspace @workspai/graph run sbom:check
corepack npm --workspace @workspai/graph run inventory:check
corepack npm --workspace @workspai/graph run retrieval:check
```

Do not add a central CLI bridge merely to make the package look complete. Each
integration surface is released only at its roadmap gate with contract and
fixture evidence.

The canonical source, versioning, quality gates and any future npm publication
remain in the `chistiq/workspai` monorepo. A future `workspai-graph` repository
is a read-only discovery mirror and owns no tags, releases, workflows or npm
publication.

Queries are deterministic and bounded. Every accepted result identifies its
immutable graph generation and carries paths, evidence, disputes, unknown
boundaries, cost, truncation and an explicit analytical claim level.

Consumer contracts, API guidance, provider authoring, security, architecture
and roadmaps are maintained once in the canonical Workspai documentation
portfolio. They are intentionally not duplicated in this public package
repository or npm artifact. The approved G3 evidence authorizes G4 repository
preview work only; it does not claim standalone stability or release admission.
G5 and G6 local engines exist as candidates. G7 local source is complete for
the packed product surface. G6 remote OS-matrix evidence, signed provenance,
independent retrieval accuracy, public preview, standalone-stable admission and
G8 CLI integration remain unauthorized. The CycloneDX SBOM candidate is
unattested.
