# README Content Contract

The root and npm package READMEs are product entry points, not release logs,
command references, or architecture specifications.

Their job is to help a new reader answer four questions quickly:

1. What is Workspai?
2. What problem does it solve?
3. How can I try it safely?
4. Where do I go for more detail?

The root README presents the product. The CLI README adds a practical first-run
path and a small set of everyday commands. Detailed behavior belongs in the
versioned contracts and focused guides.

## Stable reader journey

The root README keeps this order:

1. product category, slogan, and three outcomes;
2. one copyable path for existing software and one guided path for new software;
3. a short outcome-oriented view of what Workspai provides;
4. the canonical Model → derived Graph boundary and intelligence chain;
5. consumer surfaces and goal-based documentation links;
6. package, contributor, community, and license routes.

The CLI README keeps this order:

1. product category, slogan, and value;
2. a two-minute existing-project path and the guided create path;
3. the small set of durable outputs a user should recognize;
4. the canonical Model → derived Graph boundary and intelligence chain;
5. everyday workflows grouped by goal;
6. outputs, requirements, documentation, troubleshooting, and contribution.

## What does not belong in a main README

Keep these in their focused documents:

- release-specific changes and version numbers;
- exhaustive commands, flags, and artifact inventories;
- exact runner exit-code and failure-propagation semantics;
- benchmark tables, fixture metadata, and formulas;
- CI workflow inventories;
- provider implementation details;
- schema property documentation;
- long troubleshooting catalogs;
- internal package extraction plans.

A README changes only when the product promise, primary onboarding path,
canonical architecture, supported consumer boundary, or documentation routes
change. A small implementation feature normally changes the Changelog, Release
Notes, or a focused guide—not the README.

## Architectural statements that must remain true

- The **Workspace Model is the canonical source of truth**.
- The Knowledge Graph is a **derived, revision-bound representation** of the
  governed Workspace Model.
- Providers enrich the graph with facts and proofs; they do not mutate the
  authorizing model during the same run.
- Persisted current-state consumers reject a graph that no longer matches the
  current model revision and workspace identity.
- Missing relationships mean **not proven**, not independent.
- The graph is broader than a repository code graph, but it is not the entire
  product.
- The canonical runner is
  `npx workspai workspace intelligence run --for-agent generic --strict --json`.
- `pipeline` is the broader release/governance workflow and does not replace the
  canonical intelligence chain.
- Current integrated capabilities are not described as future missing packages.

Normative machine sources:

| Statement | Source of truth |
| --- | --- |
| Ordered intelligence chain | `contracts/workspace-intelligence-chain.v1.json` |
| Runtime commands and flags | `contracts/runtime-command-surface.v1.json` |
| Published schemas and paths | `contracts/published-contract-catalog.v1.json` |
| Architecture boundaries | `contracts/workspace-intelligence-architecture.v1.json` |
| Model → Graph binding | `contracts/workspace-intelligence/workspace-knowledge-graph.v1.json` |
| Artifact writers and consumers | `docs/contracts/ARTIFACT_CATALOG.md` |

Markdown explains these contracts; it does not redefine them.

## Claim policy

Performance and token claims belong in the benchmark and evaluation guides.
They must identify the fixture, query, limit, tokenizer or estimate, baseline,
revision, and limitations. Results vary by workspace and query.

Do not turn a retrieval-payload result into a universal cost, quality, or
task-success claim.

## Command policy

- Quickstarts must be copyable and use the canonical `workspai` package.
- `wspai` is only an optional short alias.
- The main path uses the complete contract-backed intelligence runner.
- A partial command sequence must not be presented as a replacement loop.
- Exhaustive syntax belongs in `docs/commands-reference.md`.

## Writing policy

- Prefer plain language and short sentences.
- Explain user outcomes before internal terms.
- Introduce only the architecture needed to trust the product.
- Prefer one representative command over a wall of variants.
- Link to deeper guidance instead of duplicating it.
- Do not add a README section for every feature or release.

## Validation

Run from `packages/cli`:

```bash
npm run validate:docs
npm run check:generated-contracts
npm run check:contracts
```

`docs-drift-guard.mjs` verifies the stable reader journey, canonical runner,
Model/Graph truth boundary, claim boundaries, and documentation routes.

## Review checklist

Before merging a README change, confirm:

- the first screen states the product value and slogan;
- a new user can run one safe path without learning internal architecture;
- the root README remains comfortably under 250 lines;
- the CLI README remains comfortably under 350 lines;
- details already explained elsewhere are linked, not repeated;
- every architecture statement matches generated contracts;
- no release-specific prose was added to a main README;
- the package section cannot be read as a list of missing capabilities.
