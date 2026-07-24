# Workspai CLI v0.47.0

Released July 21, 2026.

## Evidence-backed Workspace Knowledge Graph

Workspai 0.47.0 turns the current Workspace Model into a richer, proof-backed
Knowledge Graph for developers, CI, IDEs, MCP clients, and AI agents. The graph
connects projects, source structure, packages, APIs, events, infrastructure,
delivery, documentation, decisions, tests, and ownership across the workspace.

The Workspace Model remains canonical. The Knowledge Graph is a deterministic
derived representation bound to the exact model revision by SHA-256; consumers
can reject stale or mismatched graph data instead of silently trusting it.

## Queryable, bounded intelligence

- Added `workspace graph search` for question-sized lexical retrieval with
  related entities, relations, and portable proofs.
- Added `workspace graph entities`, `evidence`, and `path` for typed discovery,
  claim tracing, and relationship traversal.
- Added `workspace graph overlay --from` for change/PR comparison without
  mutating the base graph.
- Added `workspace graph benchmark` for reproducible corpus-versus-retrieval
  payload measurement with explicit claim boundaries.
- Added `workspace graph emit` for complete portable interchange while keeping
  bounded retrieval as the default agent path.
- Added deterministic indexes, bounded one-hop impact, proof change tracking,
  stable identity, trust/derivation taxonomy, quality metrics, and secret/path
  portability guards.

## Agent, MCP, and lifecycle integration

- Made `workspace-knowledge-graph.json` a required, atomic output of the Model
  stage alongside `workspace-model.json`.
- Added graph identity, quality, and bounded query guidance to agent context,
  report indexes, generated instructions, and customization packs.
- Added MCP tools for bounded graph search, entity queries, evidence lookup,
  relationship paths, and complete graph export.
- Connected the same graph revision to CLI queries, the unified intelligence
  runner, context generation, Agent Sync, IDE capability discovery, and
  workspace contract graph output.
- Canonicalized bridged project metadata from legacy `.rapidkit` paths into
  `.workspai` without overwriting existing canonical state.

## Contracts and documentation

- Published versioned contracts for the Knowledge Graph, change overlay,
  bounded search result, and token-efficiency report.
- Expanded the published contract catalog, artifact producer registry, runtime
  command surface, architecture contract, and Workspace Intelligence chain
  conformance checks.
- Added a user-focused Knowledge Graph guide, reproducible benchmark
  methodology, role-based Agent/IDE/MCP scenario, and a plain-language glossary.
- Reworked the documentation index around user goals and clarified the
  difference between deterministic Workspace Intelligence and the optional
  embedding-based module recommender.
- Added documentation drift gates for graph schemas, bounded retrieval,
  model-to-graph direction, AI claim boundaries, and complete contract
  discovery.

## Security and reliability

- Updated `brace-expansion` to the patched release required by the high-severity
  npm audit advisory.
- Updated `fast-uri` to `3.1.4` to resolve the high-severity host-confusion
  advisory discovered by the final online release audit.
- Preserved structured command/contract parity across CLI, CI, agent, MCP, and
  extension consumers.
- Kept token-efficiency results explicitly scoped to retrieval payload; Workspai
  does not claim universal model cost or answer-quality savings.

## Verification

- Full CLI suite: 2,062 passing tests with 8 explicit skips.
- Workspace Intelligence runtime conformance: 11 ordered stages and all required
  artifacts passed.
- Documentation links, drift guard, examples, README command smoke, and CLI
  command-surface parity passed.
- Online `npm audit --audit-level=high` passed with zero vulnerabilities after
  the lockfile security updates.
- The enterprise graph fixture produced 1,738 entities, 2,244 relations, and
  2,106 portable proofs across 16 registered projects. These are fixture
  observations, not universal product claims.

## Upgrade

```bash
npm install -g workspai@0.47.0
workspai --version
workspai workspace intelligence run --for-agent generic --strict --json
workspai workspace graph search "authentication endpoint" --limit 12 --json
```

There are no breaking changes in this release.
