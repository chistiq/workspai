# README Content Contract

The repository README is Workspai's primary product entry point. It must help a
new user understand the problem, see a concrete result, run a safe quickstart,
and choose the next document without first learning the internal architecture.

This contract keeps that experience aligned with the CLI's machine-readable
contracts. It applies to the root `README.md`; the package README may add detail
but must not contradict it.

The npm package README at `packages/cli/README.md` is the operational product
entry point. It follows the same truth boundaries but adds beginner definitions,
a copyable workspace onboarding path, exact exit semantics, command families,
durable outputs, requirements, and troubleshooting.

## Required reader journey

The root README keeps these sections in this order:

1. `Workspace Intelligence for software systems` — the category, slogan, and
   three user outcomes;
2. `See your workspace as a system` — a concrete before/after mental model;
3. `Start in two minutes` — install, connect software, run the canonical chain;
4. `What Workspai gives you` — user questions mapped to product outcomes;
5. `How Workspace Intelligence works` — sources, facts, model, graph, decisions,
   and consumers;
6. `Evidence, not guesses` — identity, proof, bounded retrieval, and unknown
   relationships;
7. `Measure context honestly` — reproducible numbers and claim boundaries;
8. `One contract-backed intelligence chain` — the canonical runner and its
   distinction from `pipeline`;
9. `Choose your workflow` — goal-oriented routing;
10. `Open outputs for every consumer` — human, CI, agent, MCP, IDE, and graph
    interoperability surfaces;
11. documentation, packages, contributor, community, and license routes.

Do not move package internals, exhaustive flags, troubleshooting, or contributor
implementation details above the user value and quickstart.

## CLI package README journey

The CLI README keeps these sections in order:

1. product category and the `See / Ask with proof / Act with confidence` value;
2. plain-language definitions of Workspace, Project, Model, Graph, Evidence,
   and Artifact;
3. a copyable two-minute path that creates a minimal workspace, adopts source,
   and runs the canonical chain;
4. the Model → derived Graph architecture and its unknown-relationship rule;
5. the exact intelligence chain, evidence, and bounded measurement semantics;
6. grouped commands, outputs, onboarding choices, integrations, requirements,
   documentation, and troubleshooting.

Measurement tables must not precede installation or the first successful run.
Advanced command inventories must be grouped by user goal instead of appearing
as one undifferentiated command wall.

## Architectural statements that must remain true

- The **Workspace Model is the canonical source of truth**.
- The Knowledge Graph is a **derived, structurally bound representation** of
  governed workspace knowledge. Its source kind and source artifact are fixed
  to the canonical Workspace Model contract.
- Providers emit facts and proofs; they do not independently own the canonical
  graph.
- Graph enrichment must not mutate the authorizing model during the same run.
- The canonical project inventory must reconcile discovered, imported,
  adopted, and contract-declared projects. A missing contract-declared path is
  a validation warning, not a silently deleted project.
- Persisted current-state consumers must reject a graph whose structural model
  hash, workspace identity, or project topology no longer matches the current
  model.
- Missing relationships mean **not proven**, not independent.
- The graph is broader than a code graph, but it is not the entire product.
- The canonical runner is
  `npx workspai workspace intelligence run --for-agent generic --strict --json`.
- `pipeline` is a broader governance/release orchestrator and must not be taught
  as a replacement for the intelligence chain.
- The integrated CLI already exposes current capabilities. Future standalone
  packages are extraction boundaries, not promises to add currently missing CLI
  features.

Normative machine sources:

| Statement                      | Source of truth                                                      |
| ------------------------------ | -------------------------------------------------------------------- |
| Ordered intelligence chain     | `contracts/workspace-intelligence-chain.v1.json`                     |
| Runtime commands and flags     | `contracts/runtime-command-surface.v1.json`                          |
| Published schemas and paths    | `contracts/published-contract-catalog.v1.json`                       |
| Architecture boundaries        | `contracts/workspace-intelligence-architecture.v1.json`              |
| Model → Graph source binding   | `contracts/workspace-intelligence/workspace-knowledge-graph.v1.json` |
| Artifact writers and consumers | `docs/contracts/ARTIFACT_CATALOG.md`                                 |

Markdown summarizes these contracts; it does not redefine them.

## Claim policy

Every performance or token statement must identify:

- the workspace or pinned corpus;
- the query and result limit;
- whether token counts are estimated, tokenizer-counted, or provider-reported;
- the baseline;
- the date or revision;
- what the measurement does not prove.

The current fixture may be used only with wording equivalent to:

> On the current 16-project development fixture, one bounded query reduced the
> estimated retrieval payload by 97.9%; results vary by workspace and query.

Never turn a retrieval-payload result into a universal model-cost, answer-quality,
or task-success claim. Use `workspace eval` and a verified outcome before making
execution-efficiency comparisons.

## Command policy

- Quickstarts must be copyable and use the canonical `workspai` package.
- `wspai` is described only as an optional short alias.
- A partial sequence such as `model → context` must not be taught as a replacement
  for the canonical intelligence chain.
- Every documented command must exist in the runtime command surface or be an
  ordinary shell command such as `cd` or `npm install`.
- Durable filenames must come from published contracts or the Artifact Catalog.

## Information hierarchy

Write for three reading depths:

1. **Ten seconds:** category, user problem, three outcomes.
2. **Two minutes:** quickstart, concrete artifacts, architecture, proof example.
3. **Deep evaluation:** measurements, contracts, guides, boundaries, contributor
   material.

Prefer user questions and outcomes over internal phase names. Define unavoidable
terms in plain language and link to the glossary.

## Validation

Run from `packages/cli`:

```bash
npm run validate:docs
npm run check:generated-contracts
npm run check:contracts
```

`docs-drift-guard.mjs` enforces the required root headings, their order,
canonical runner, Model/Graph truth boundary, honest measurement language,
documentation routes, and package-status semantics. `smoke-readme-commands.mjs`
executes representative documented CLI help surfaces.

## Review checklist

Before merging a README change, confirm:

- a new user can explain Workspai without saying “chatbot” or “code generator”;
- the first quickstart reaches a durable evidence artifact;
- every architecture statement agrees with the generated contracts;
- every number is reproducible and bounded;
- every promised output exists today or is explicitly labelled as future work;
- links route users by goal rather than exposing the documentation tree;
- the package table cannot be read as a list of missing product capabilities.
