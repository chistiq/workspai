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
workspai-graph quality . --json
workspai-graph query . --preset entryPoints --json
workspai-graph providers list
workspai-graph inspect . --write --json
```

An explicit write commits immutable, content-addressed artifacts below
`.workspai/reports/graph-generations/` and advances the portable
`graph-generation.json` pointer only after all artifacts are durable.

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
