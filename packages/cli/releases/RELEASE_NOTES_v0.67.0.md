<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Live workspace operations and measurable agent efficiency",
  "summary": "Workspai 0.67.0 publishes renderer-neutral Live activity contracts, an evidence-bound agent retrieval benchmark, stronger natural-language Graph relevance, and repeatable enterprise qualification on a real 12-runtime system.",
  "highlights": [
    {
      "icon": "⚡",
      "text": "Live activity now exposes stable monitor, fleet, and board contracts plus social-ready SVG capture"
    },
    {
      "icon": "📊",
      "text": "The agent-core benchmark measures five engineering scenarios with explicit estimated or measured token provenance"
    },
    {
      "icon": "🔎",
      "text": "Natural-language Graph search now protects distinguishing project terms from generic entity-kind boosts"
    },
    {
      "icon": "🤖",
      "text": "Operational Skills and provider adapters retain exact evidence without duplicate authored imports"
    },
    {
      "icon": "🛡️",
      "text": "A 58-command enterprise qualification passed on OpenTelemetry Demo across 12 detected runtimes"
    }
  ]
}
-->

# Workspai CLI v0.67.0

Released August 29, 2026.

**Publication status:** Published.

## Live Workspace Operations and Measurable Agent Efficiency

Workspai 0.67.0 makes live workspace state and agent-context efficiency public,
versioned product surfaces. IDEs, dashboards, automation, and AI agents can now
consume the same renderer-neutral activity model instead of reconstructing state
from terminal output. A new deterministic benchmark suite measures how much of a
workspace proof corpus a bounded agent query retrieves while keeping estimates,
provider measurements, and verified outcomes explicitly separate.

This release was qualified against OpenTelemetry Demo: an externally linked,
real-world microservice platform containing 12 detected runtime families,
authored interfaces, Compose topology, CI, ownership, telemetry schemas, and
multiple agent instruction surfaces.

## Versioned Live activity contracts

`workspai live` now publishes stable JSON projections for three related views:

- `workspace-activity-monitor-snapshot.v1` for one bounded activity scope;
- `workspace-activity-monitor-fleet.v1` for multi-scope fleet status;
- `workspace-activity-board.v1` for a renderer-neutral flow board.

Use the board projection directly from a dashboard or extension:

```bash
workspai live --once --json --projection board
```

The CLI remains the owner of activity semantics, run/block identity, ordering,
status, and accessibility labels. Consumers remain free to render a terminal,
IDE panel, web dashboard, screenshot, or animation without changing the source
activity journals.

SVG capture is also exercised by the enterprise qualification gate. The
existing social presets can produce deterministic, non-interactive assets such
as a 1200×627 LinkedIn capture from the exact same Board model.

## Evidence-bound agent retrieval benchmark

The new benchmark suite evaluates five fixed engineering categories:

- architecture;
- ownership;
- interfaces;
- change safety;
- delivery.

Run it with:

```bash
workspai workspace graph benchmark-suite agent-core.v1 --write --json
```

The result is written to:

```text
.workspai/reports/workspace-intelligence-benchmark-last-run.json
```

Each scenario selects a deterministic target from current Graph evidence and
must retrieve that exact entity. The report includes corpus size, bounded
retrieval size, median and p95 estimated retrieval tokens, target coverage, and
optional comparison with a previous benchmark.

Token claims are deliberately provenance-aware. Character-based estimates are
reported as `estimated`. A trusted measured reduction is published only when
aligned tasks have comparable verified outcomes and every relevant model call
is provider-reported or tokenizer-counted. Workspai does not turn estimates into
model billing claims.

## Stronger natural-language Graph relevance

Graph search now distinguishes the caller's subject from generic architectural
intent. Entity-kind boosts such as `schema`, `service`, or `pipeline` cannot
displace an authored artifact that matches the complete distinguishing phrase.

For example, on OpenTelemetry Demo:

```text
Where is the telemetry schema defined?
```

now ranks the authored `telemetry-schema/README.md` evidence first instead of
unrelated protobuf messages that match only the word `schema`. Exact identity,
alias, proof, project scope, and deterministic ordering behavior remain intact.

## More precise consumer and agent output

Evidence-derived operational Skills now retain an explicit model signal when a
polyglot capability is generated. A high-confidence generated Skill can no
longer carry an empty signal list or a contradictory “no authoritative signal”
explanation.

Project agent adapters also recognize repository-authored imports. If an
existing `CLAUDE.md` already imports `AGENTS.md`, Workspai adds its bounded host
binding without repeating that import. Authored content and symlink safety
remain preserved.

## Repeatable enterprise pre-release qualification

The enterprise qualification runner now covers the complete path from adopted
repository evidence to consumer output, including:

- Model cache and incremental rebuild;
- snapshot, diff, impact, trace, verify, and history;
- Graph emit, explain, search, evidence, benchmark, and all export formats;
- the `agent-core.v1` benchmark suite;
- Live monitor, board, and social SVG capture;
- Doctor, Analyze, Readiness, contract verification, and the canonical
  Workspace Intelligence loop;
- project workspace resolution, agent bootstrap, and all-host entry
  verification;
- archive, share, repair, policy, and lifecycle dry-run boundaries.

The final OpenTelemetry Demo run accepted all 58 commands. Four non-zero exits
were correctly classified as governed domain blocks because the isolated clone
intentionally had no materialized Node dependencies; Doctor, Verify, and the
strict Intelligence loop refused to claim release readiness while Model, Graph,
context, Skills, and project entry remained usable and fresh.

The same run produced 2,891 entities, 4,266 relations, and 3,800 proofs with
complete entity and relation proof coverage. The five benchmark scenarios all
retrieved their exact target. These figures describe this qualification fixture,
not a universal performance claim.

## Faster repeat validation

The pre-push runtime-contract and official-generator dry-run gates now support a
content-addressed local cache. Unchanged inputs can reuse a previously successful
result while changed CLI sources, contracts, scripts, package metadata, or gate
configuration invalidate the cache and execute the real gate again.

## Upgrade

```bash
npm install -g workspai@0.67.0
workspai --version
```

Expected output:

```text
0.67.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias is released at the matching `0.67.0` version.
- Existing version-one Workspace Intelligence, Model, Graph, Goal, MCP,
  repair, Skill, project-entry, and activity inputs remain supported.
- Activity projections and the benchmark artifact use new additive version-one
  contracts.
- Existing `workspace graph benchmark` behavior is unchanged; the multi-scenario
  suite is exposed separately as `benchmark-suite`.
- Existing Live terminal, replay, accessible, classic, and capture modes remain
  supported.
- No public command is removed.

## Breaking changes

None.
