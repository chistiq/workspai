# `@workspai/graph`

Evidence-backed, storage-neutral workspace graph engine for Workspai.

Status: **composition candidate · development-only · not publishable**

> This is the developing independent Graph implementation. The released
> Workspai CLI already contains the current official internal graph capability.
> Graph is not imported by or connected to the CLI runtime while it is under
> development; CLI adoption is permitted only after standalone stability,
> followed by explicit bridge, shadow-parity, replacement and legacy-removal
> gates.

The package is intentionally available for internal and community development
before publication. Its root API exposes package status and the G2 deterministic
composition candidate. Query, persistence, provider execution and CLI
replacement stay unavailable until their later conformance gates are complete.

The current `/conformance` surface includes the SH6 Shared-adoption boundary,
the admitted G1 contract layer and G2 reference-engine suites. It validates WIS
envelope identity, provider detection/manifests, FactBatch provenance and
accounting, ontology-constrained canonical graphs, immutable generations,
quality and exact query-cache lifecycle envelopes. The composer is a semantic
reference candidate, not a standalone-stability or release claim.

Node hosts may explicitly import `@workspai/graph/adapters/node` to execute the
portable reference-composition task outside the event loop. The package root
remains host-neutral. Worker output is revalidated against admitted facts before
it can influence a canonical graph.

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

Do not add a CLI bridge, executable command or public build/query API merely to
make the scaffold look complete. Each surface is released only at its roadmap
gate with contract and fixture evidence.

The canonical source, versioning, quality gates and any future npm publication
remain in the `chistiq/workspai` monorepo. A future `workspai-graph` repository
is a read-only discovery mirror and owns no tags, releases, workflows or npm
publication.

Consumer contracts, API guidance, provider authoring, security, architecture
and roadmaps are maintained once in the canonical Workspai documentation
portfolio. They are intentionally not duplicated in this public package
repository or npm artifact. The approved G1 evidence authorizes G2 composition
work only; it does not claim standalone stability or release admission.
