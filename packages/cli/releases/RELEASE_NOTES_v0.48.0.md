# Workspai CLI v0.48.0

Released July 22, 2026.

## Measurable Workspace Intelligence and Portable Graph Interchange

Workspai 0.48.0 connects three previously separate concerns: the canonical
Workspace Intelligence lifecycle, evidence-backed Graph retrieval, and
repeatable evaluation. The result is a contract-governed path from workspace
state to bounded agent context and measurable observations.

The Workspace Model remains the system source of truth. The Knowledge Graph is
a deterministic derived representation bound to that exact model revision;
JSON-LD, GraphML, GEXF, Mermaid, DOT, and JSON are projections of the same
revision rather than competing sources of truth.

## Governed evaluation

The new evaluation workflow supports independent, repeatable measurement:

```bash
workspai workspace eval init my-run workspace-intelligence --json
workspai workspace eval status --json
workspai workspace eval report --json
workspai workspace eval compare baseline.json candidate.json --json
```

- `init` creates the governed live evaluation artifact.
- `record` accepts contract-validated usage observations.
- `status` reports the current run without mutating it.
- `report` finalizes a portable evaluation result.
- `compare` compares two compatible governed reports.

Evaluation reports distinguish observed payload and usage data from inferred
benefits. Workspai does not turn fixture measurements into universal token,
cost, latency, or answer-quality claims.

## Portable Knowledge Graph

Graph consumers can now choose the format appropriate to their environment:

```bash
workspai workspace graph jsonld --output graph.jsonld
workspai workspace graph graphml --output graph.graphml
workspai workspace graph gexf --output graph.gexf
```

Bounded query surfaces remain the recommended default for agents:

```bash
workspai workspace graph search "authentication endpoint" --limit 12 --json
workspai workspace graph entities service --json
workspai workspace graph evidence <entity-id> --json
workspai workspace graph path <from-id> <to-id> --json
workspai workspace graph overlay --from baseline-graph.json --json
```

Graph and Evaluation capabilities are published through the runtime command
surface, Workspace Intelligence architecture, artifact registry, contract
catalog, MCP tools, IDE capability discovery, CI evidence, and agent grounding.

## Documentation as a governed surface

- Reworked the monorepo and CLI READMEs around user goals and fast paths.
- Added a documentation content contract defining truth ownership and required
  user journeys.
- Expanded drift checks for Graph command inventory, Evaluation artifacts,
  runtime selectors, source-of-truth language, links, examples, and README
  command smoke.
- Clarified the boundary between the canonical Model and its derived Graph
  representations.

## Runtime fixes

- Allowed the documented `--limit` option for Graph search and benchmark
  commands.
- Allowed the documented `--from` option for Graph change overlays.
- Made `--skip-install` a host-toolchain-free boundary for Java, Go, and .NET
  scaffolds, avoiding Windows Maven/Java process-tree stalls in coverage runs.
- Pinned canonical, legacy, and candidate registry paths for each locked
  transaction, preventing HOME/APPDATA drift from losing concurrent Windows
  registrations.
- Replaced clock-derived demo-kit fixture paths with atomic temporary
  directories and isolated structure-only NestJS tests from Git setup,
  eliminating a Windows coverage race while retaining a bounded timeout for
  the 28-file integration case.
- Completed the machine-readable architecture inventory for all current Graph
  and Evaluation surfaces.
- Replaced stale dependency-only and JavaScript/TypeScript-only graph wording
  with the current bounded, multi-language evidence model.

## Verification

- Full CLI suite: 2,076 passing tests across 191 test files, with 8 explicit
  skips and no failures.
- TypeScript typecheck and ESLint passed.
- Documentation links, examples, drift guard, README command smoke, generated
  contracts, shared-contract parity, and `git diff --check` passed.
- An isolated real workspace exercised Model/Graph production, bounded search,
  JSON-LD/GraphML/GEXF exports, Evaluation init/status/report, and the strict
  unified Workspace Intelligence runner.

## Upgrade

```bash
npm install -g workspai@0.48.0
workspai --version
workspai workspace intelligence run --for-agent generic --strict --json
```

The short alias is version-aligned:

```bash
npm install -g wspai@0.48.0
wspai --version
```

There are no breaking changes in this release.
