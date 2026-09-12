# `@workspai/graph`

Evidence-backed, storage-neutral workspace graph engine for Workspai.

Status: **internal repository preview candidate · development-only · npm publication prohibited**

> This is the developing independent Graph implementation. The released
> Workspai CLI already contains the current official internal graph capability.
> Graph is not imported by or connected to the CLI runtime while it is under
> development; CLI adoption is permitted only after internal standalone stability,
> followed by explicit bridge, shadow-parity, replacement and legacy-removal
> gates.

The package is intentionally private and consumed only inside the Workspai
monorepo. Package boundaries exist to isolate ownership, contracts, tests and
runtime behavior, not to create an npm product. Its root API exposes the
admitted deterministic composer, the bounded proof-carrying query engine and
the host-neutral G4 repository build candidate. Node filesystem access is
isolated under `@workspai/graph/adapters/node`.
The G4 candidate now includes an explicitly invoked internal executable and
project-local atomic persistence for conformance and product composition. CLI
replacement remains unavailable until its later shadow-parity and migration
gates complete.

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

Contracted query presets are `GRAPH_QUERY_PRESETS`. Subject-required presets
fail closed without `--subject`. Existing-workspace inspect without
`--workspace` is rejected.

Workspace inspect without an injected onboarding adapter stays `partial` with
`handoff-unavailable`. The packed tarball ships the query-candidate conformance
profile, G1 admit/reject corpus, G4 language fixtures, G6 schema fixtures and
G7 CLI envelope fixtures. Contracted reject paths (unknown preset, missing
subject, `--slice` on the wrong preset, `--write` on non-inspect, unknown
provider, existing-workspace without `--workspace`) fail closed from the
installed executable. Incident classes are exported; rollback is not proven.

An explicit write commits immutable, content-addressed artifacts below
`.workspai/reports/graph-generations/` and advances the portable
`graph-generation.json` pointer only after all artifacts are durable. The
pointer records project-relative immutable artifact paths and their digests, so
consumers do not need host paths or directory guessing to resolve a generation.

The offline provider set currently covers file/package topology and static
imports for Node, Python, Go, Java, .NET, Rust, C/C++, Objective-C/MATLAB,
PHP, Ruby and Swift. It also extracts literal route declarations for the first
five profiles, Protobuf contracts, services, schemas and RPCs, declared Bazel
and CMake target dependencies, cross-language source entry points, CODEOWNERS
ownership, Docker Compose topology, repository contract/runtime/delivery
surfaces, MATLAB artifact families and safe repository-local Git `HEAD`
identity. Every admitted repository file remains in the inventory even when
deeper semantics are unavailable. Computed routes and dependencies, dynamic
imports, source languages outside the structural profile, symlinks and Git
worktree indirection remain explicit unknown or unsupported zones rather than
silent omissions. Git config, remotes, credentials and external worktree
metadata are never ingested.

Text `.m` inputs use an explicitly ambiguous Objective-C/MATLAB static-import
profile. Protected `.p`, live-script `.mlx`, application `.mlapp`, data,
figure, toolbox, installer and platform-specific `.mex*` formats are preserved
as artifact surfaces. Binary, protected or packaged MATLAB payloads are never
decoded by the preview provider.

The fixed `source`, `structural` and `evidence` preview views are bounded
read-only selections over the same immutable canonical generation. They retain
canonical node/edge identities, proof and source generation. They are produced
by the G5 profile-driven projection engine through those three admitted view
profiles; they are not a second graph and do not authorize similarity, vector or
central-CLI consumption.

JSON executable results use `schemaVersion` `workspai.graph.cli-result.v1`.
Exit codes are `0` success, `2` partial, `1` failed, `3` rejected, `4`
publication failed and `130` cancelled. The exported support and limitations
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
corepack npm --workspace @workspai/graph run admission:standalone:audit
```

Do not add a central CLI bridge merely to make the package look complete. Each
integration surface is released only at its roadmap gate with contract and
fixture evidence.

The canonical source, versioning and quality gates remain in the
`chistiq/workspai` monorepo. npm publication is prohibited for the current
architecture. If distribution strategy changes in the future, it requires a
separate decision and admission process. A future `workspai-graph` repository
is a read-only discovery mirror and owns no tags, releases or workflows.

The committed G8 target is a Graph-owned Rust core delivered first as a bundled
WASM asset. Runtime activation remains prohibited in G7 and later requires
TypeScript parity, end-to-end performance, recovery, portability and product-
bundle evidence. Users never install Cargo, resolve an unpublished package or
select an implementation engine.

Queries are deterministic and bounded. Every accepted result identifies its
immutable graph generation and carries paths, evidence, disputes, unknown
boundaries, cost, truncation and an explicit analytical claim level.

Consumer contracts, API guidance, provider authoring, security, architecture
and roadmaps are maintained once in the canonical Workspai documentation
portfolio. They are intentionally not duplicated in this public package
repository or npm artifact. The approved G3 evidence authorizes G4 repository
preview work only; it does not claim standalone stability or release admission.
G5 and G6 local engines exist as candidates. G7 local source is complete for
the private packed product surface. G6 remote OS-matrix evidence, final internal
contract policy, internal promotion and rollback proof, standalone-stable
admission and G8 CLI integration remain unauthorized. Public npm release is not
part of the current delivery path. The CycloneDX SBOM remains an internal
verification artifact.
