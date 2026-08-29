# Workspace Intelligence Benchmark

Workspai exposes two deliberately separate measurement lanes:

1. deterministic retrieval-payload estimates from the Workspace Knowledge Graph;
2. observed model/tool usage and verified outcomes recorded by `workspace eval`.

They are combined in one report for presentation, but their provenance is never
collapsed into one unsupported “tokens saved” claim.

## Run the fixed suite

```bash
npx workspai workspace graph benchmark-suite agent-core.v1 --json
npx workspai workspace graph benchmark-suite agent-core.v1 --write --json
```

The `agent-core.v1` suite runs five stable scenario categories:

- architecture and runtime discovery;
- dependency and ownership discovery;
- interface and contract discovery;
- change-safety and verification discovery;
- build and delivery discovery.

For each category, Workspai selects the first evidence-backed entity from a
published kind priority (then stable entity ID), records that target ID/kind,
and queries its unique real label (or stable identity key when labels collide).
The scenario passes only when that exact target entity is retrieved. This keeps
the benchmark applicable to arbitrary architectures without hiding a
repository-specific query or pretending that an irrelevant fixed phrase
measures retrieval quality.

The suite is offline, deterministic, bounded, and repository-neutral. It reads
the proof-indexed source corpus once and applies the same retrieval limit to
every scenario. The report contains per-scenario results plus median and p95
retrieval sizes. Empty scenarios remain visible as `empty`; they are never
silently removed from the denominator.

With `--write`, the artifact is:

```text
.workspai/reports/workspace-intelligence-benchmark-last-run.json
contracts/workspace-intelligence/workspace-intelligence-benchmark.v1.json
```

## Add measured model evidence

Finalize a task evaluation first:

```bash
npx workspai workspace eval init repair-readiness workspace-intelligence --json
# record provider/tool/outcome events through workspace eval record --json
npx workspai workspace eval report --json
npx workspai workspace graph benchmark-suite agent-core.v1 --write --json
```

The benchmark classifies evaluation provenance as `measured`, `mixed`,
`estimated`, or `unavailable`. Provider-reported and tokenizer-counted calls are
measured. Estimated and unavailable calls remain explicitly labelled.

For a baseline comparison:

```bash
npx workspai workspace graph benchmark-suite agent-core.v1 \
  --from .workspai/reports/baseline-evaluation.json \
  --write --json
```

`trustedMeasuredReductionPercent` is non-null only when:

- current and baseline task IDs match;
- both outcomes are verified and comparable;
- every model call in both runs is provider-reported or tokenizer-counted.

## Claim boundary

The graph lane estimates JSON retrieval payload size using `characters / 4`
against readable proof-source text. It does not prove equivalent answer quality,
model billing savings, or task completion. The evaluation lane can report real
usage only to the precision supplied by its recorded source. Verified task
success remains a separate required outcome signal.
