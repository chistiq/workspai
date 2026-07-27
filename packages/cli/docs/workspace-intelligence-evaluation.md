# Measure Workspace Intelligence Usage

Use this feature to answer a practical question: did focused workspace context
help an AI task use fewer tokens, cost less, or reach a verified result?

Workspai records model usage, tool activity, reported cost, and the final
verified outcome in one report that the CLI, IDE, CI, and dashboards can read.

It does not store prompt or response text. Optional SHA-256 hashes can connect
related calls without copying private content into the report.

## Start a measured task

```bash
npx workspai workspace eval init repair-readiness workspace-intelligence --json
```

The optional strategy is one of `full-corpus`, `grep`, `vector`, `graph`,
`workspace-intelligence`, or `custom`.

The live source of truth is:

```text
.workspai/reports/workspace-intelligence-evaluation-live.json
```

## Record events

Providers and IDE integrations append privacy-bounded events through stdin:

```bash
printf '%s\n' '{
  "kind": "model-call",
  "stage": "context",
  "modelCall": {
    "provider": "vscode-lm",
    "model": "selected-model",
    "source": "provider-reported",
    "inputTokens": 18420,
    "outputTokens": 2150,
    "cachedInputTokens": 6200,
    "reasoningTokens": null,
    "latencyMs": 4820
  }
}' | npx workspai workspace eval record --json
```

`source` is mandatory:

| Source              | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `provider-reported` | The provider returned the count                                |
| `tokenizer-counted` | A named tokenizer counted the exact serialized input or output |
| `estimated`         | A documented estimate; never presented as provider billing     |
| `unavailable`       | The provider exposed no usable count                           |

Tool events record progress and repeated work without storing command output:

```json
{
  "kind": "tool-call",
  "stage": "verify",
  "toolCall": {
    "tool": "workspace verify",
    "result": "passed",
    "changedSource": false,
    "durationMs": 814,
    "artifact": ".workspai/reports/workspace-verify-last-run.json"
  }
}
```

Finish with a verified outcome event. Tokens per successful outcome remain
`null` until `status` is `passed` and `verified` is `true`.

```json
{
  "kind": "outcome",
  "stage": "verify",
  "outcome": {
    "status": "passed",
    "verified": true,
    "blockersResolved": 1,
    "summary": "Readiness passed after dependency remediation."
  }
}
```

Event bodies conform to
[`model-usage-event.v1.json`](../contracts/workspace-intelligence/model-usage-event.v1.json).

## Inspect and finalize

```bash
npx workspai workspace eval status --json
npx workspai workspace eval report --json
npx workspai workspace eval report --output ./evidence/my-evaluation.json --json
```

Finalization writes:

```text
.workspai/reports/workspace-intelligence-evaluation-last-run.json
```

`--output` keeps that governed last-run artifact and also copies the finalized
report to the requested workspace-relative or absolute path. JSON output reports
the path that was actually requested, so automation does not need to infer it.

Both live and final reports conform to
[`workspace-intelligence-evaluation.v1.json`](../contracts/workspace-intelligence/workspace-intelligence-evaluation.v1.json).

## Compare strategies

Save a completed baseline, run the same fixed task using another strategy, then
compare:

```bash
npx workspai workspace eval compare --from .workspai/reports/baselines/full-corpus.json --json
```

The comparison reports token, model-call, tool-call, latency, and verified
outcome differences. A smaller prompt is not treated as a better result unless
the outcomes are task-aligned and independently verified.

Comparison JSON conforms to
[`workspace-intelligence-evaluation-comparison.v1.json`](../contracts/workspace-intelligence/workspace-intelligence-evaluation-comparison.v1.json),
so CI, IDE, and dashboard consumers do not need to infer its shape.

## Extension and dashboard contract

The VS Code extension should watch the live artifact and display its values; it
must not independently estimate or relabel them. At minimum the UI should show:

- run and session identity;
- live/final status and update time;
- input, output, cached-input, and reasoning token components;
- provider-reported, tokenizer-counted, estimated, and unavailable call counts;
- cost grouped by currency and source;
- tool calls, repeated artifact reads, and no-progress decisions;
- verified outcome and blockers resolved.

This makes the CLI artifact the source of truth for terminal, extension, CI,
and future hosted dashboards. MCP clients can read the same artifact through
`getWorkspaceEvaluation`; agent-sync also includes the finalized report in the
governed evidence index when it exists.

## Relationship to the graph benchmark

`workspace graph benchmark` measures **retrieval payload size** using a portable
character estimate. `workspace eval` measures **observed agent execution** and
requires outcome evidence. Keep both: the first is deterministic and
provider-independent; the second is the basis for real token, cost, and task
efficiency claims.
