# Graph Retrieval Benchmark Methodology

This document defines what Workspai measures when it reports graph retrieval
payload reduction, how to reproduce a result, and what the result does—and does
not—prove.

## The question being measured

For one query, how much smaller is the bounded, proof-carrying graph response
than the readable source corpus that supplied the graph's proofs?

This is useful because AI agents do not need every indexed file for every
question. It is deliberately narrower than “How many tokens will this model
bill?” or “Will the model produce an equally good answer?”

## Run it

From a Workspai workspace:

```bash
npx workspai workspace model --write --json
npx workspai workspace graph benchmark "authentication endpoint" --limit 12 --json
npx workspai workspace graph benchmark "authentication endpoint" --scope project:api --limit 12 --json
```

The result conforms to
[`workspace-graph-token-efficiency.v1.json`](../contracts/workspace-intelligence/workspace-graph-token-efficiency.v1.json).
It records:

- the query and result limit;
- the graph schema, entity/relation/proof counts, source artifact, and stable
  structural model SHA-256;
- the number and size of readable, deduplicated proof-source artifacts;
- the bounded retrieval size and match count;
- unreadable artifacts rather than silently excluding them;
- the estimate formula, reduction ratio, percentage, and claim boundary.

For linked projects, portable proof artifacts such as
`external/api/src/server.ts` are resolved through the canonical workspace
contract's `externalPath`. Resolution remains containment-checked beneath that
registered project root. A missing or unsafe mapping stays in
`unreadableArtifacts`; it is never silently dropped from the denominator
explanation.

The benchmark uses the same bounded agent projection as Graph search. A project
scope therefore includes facts owned by that project and connected
workspace-level shared entities, while the response's omission budget makes
payload caps explicit.

## Baseline and formula

The current methodology is `indexed-corpus-vs-bounded-retrieval.v1`.

```text
corpus characters    = sum(unique readable proof-source files)
retrieval characters = compact JSON length of bounded search response
estimated tokens     = ceil(characters / 4)
reduction ratio      = corpus estimated tokens / retrieval estimated tokens
reduction percent    = (corpus - retrieval) / corpus × 100
```

`characters / 4` is intentionally labelled as an estimate. It is portable and
reproducible without downloading a tokenizer, but it is not exact for every
language, model, or tokenizer.

## Current fixture observation

The 16-project development workspace reproduced the following result on
2026-07-22 for `api endpoint --limit 8`:

| Measure                         | Observed value |
| ------------------------------- | -------------: |
| Graph entities                  |          1,738 |
| Graph relations                 |          2,244 |
| Graph proofs                    |          2,106 |
| Readable proof-source artifacts |            392 |
| Corpus estimated tokens         |        134,105 |
| Retrieval estimated tokens      |          2,812 |
| Returned entities               |              8 |
| Retrieval ratio                 |         47.69× |
| Payload reduction               |          97.9% |

Source-model SHA-256:
`2b8abd415420cc421707c726e6f6c96641554594e84440bf2e539f04ba5836e8`.

This row demonstrates that measurement is possible. It is not a representative
cross-project benchmark and must not be marketed as a universal Workspai result.

## What can be claimed today

Safe wording:

> Workspai can return bounded, proof-carrying workspace context instead of the
> complete indexed corpus. On the current 16-project development fixture, one
> `api endpoint` query reduced the estimated retrieval payload by 97.9%; results
> vary by workspace and query.

Unsafe wording:

- “Workspai always reduces model tokens by 97.9%.”
- “Agents are 47.69× cheaper with no quality loss.”
- “Workspai beats another product” without a shared corpus and evaluation
  harness.

## Gate for a public headline benchmark

Before publishing a general token-efficiency number, the benchmark suite must:

1. pin public repositories and exact commit SHAs;
2. publish fixed question sets and graph configuration;
3. compare at least three baselines:
   - entire readable corpus;
   - a realistic grep/top-file retrieval strategy;
   - bounded Workspai graph retrieval;
4. count with at least one real, named tokenizer in addition to the portable
   character estimate;
5. measure answer relevance or task completion so smaller context is not treated
   as automatically better context;
6. repeat runs and publish variance, failures, unreadable files, hardware, and
   software versions;
7. publish raw machine-readable results and a one-command reproduction path;
8. report median and range—not only the best repository.

## Performance is a separate benchmark

Payload size and graph speed answer different questions. Build time, incremental
update time, peak memory, artifact size, and p50/p95 query latency must be
measured separately. Do not infer runtime performance from the token-efficiency
report.

For normal interactive use, prefer `workspace graph search` or the MCP
`searchWorkspaceGraph` tool. Use the complete graph artifact for interchange,
offline analysis, audits, and consumers that explicitly require the entire
workspace representation.
