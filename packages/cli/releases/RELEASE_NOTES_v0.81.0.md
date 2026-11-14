<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "More focused, budgeted context for coding agents",
  "summary": "Workspai CLI 0.81.0 adds task-scoped, budget-aware context for coding agents, compact Graph and bootstrap views, manifest-derived lifecycle guidance, and proportional change governance.",
  "highlights": [
    { "icon": "🧭", "text": "Get project-specific lifecycle commands from the nearest runtime manifest" },
    { "icon": "📦", "text": "Request compact Graph and bootstrap context with explicit byte budgets" },
    { "icon": "🔎", "text": "Expand revision-bound evidence and reuse only fresh, scope-matched delivery receipts" },
    { "icon": "🧪", "text": "Discover test-source references without treating them as proof that tests ran" },
    { "icon": "🛡️", "text": "Keep routine edits proportional and retain Goal-bound evidence for governed changes" }
  ]
}
-->

# Workspai CLI v0.81.0

Released November 13, 2026. **Publication status: Published November 13, 2026.**
Package metadata is aligned to `0.81.0`. Cross-platform qualification has not
been claimed.

## Focused context for agents

This release makes Workspace Intelligence context more task-proportional.
Agents can request compact projections with explicit UTF-8 byte budgets while
retaining scope, diagnostics, provenance, and typed refusal when the requested
evidence cannot fit safely.

- Add `workspai agent context --task <request>` for a single read-only packet
  that binds the user request to one canonical project, relevant Graph
  discovery and the nearest manifest-backed lifecycle checks. Workspai gaps are
  disclosed while native project work can continue; an oversized packet is
  rejected as a whole.

- Add `workspace graph search --view agent --json` with bounded output, ranked
  match explanations, selected proofs, and relevant/unscoped diagnostics. Use
  revision-bound `graph evidence` arguments to expand details when needed;
  `--view full` remains available.
- Add optional workspace-local delivery receipts. A later search can suppress
  unchanged matches only when the source revision and scope still match; stale
  or missing receipts return complete results.
- Add `agent bootstrap --view agent --json` as an opt-in compact consumer view.
  It retains readiness, warnings, failures, provenance, and explicit omissions,
  and rejects budgets that cannot carry the required evidence.
- Index bounded test-source paths and lexical references separately from
  production architecture. Discovery does not claim that a test was executed.
- Add `workspai project lifecycle plan --json` to return manifest-derived
  lifecycle commands for detected runtime units. `--path` selects the nearest
  package boundary; `--max-bytes` applies an exact output budget.

## More reliable retrieval and agent guidance

- Use the task query in project-lens retrieval and keep workspace Skills scoped
  to relevant evidence.
- Reuse completed preflight only while host, scope, integrity, and source
  freshness remain valid. Missing Graph matches are not treated as proof that
  code or tests do not exist; scoped native search remains the fallback.
- Report token-reduction percentages only for task-aligned runs with the same
  recorded model configuration and complete, consistently measured usage.
- Generate task-proportional, language-aware response guidance without a fixed
  answer template.
- Make generated mutation guidance proportional: routine project-local edits
  follow repository policy and native checks, while Goal-bound prediction,
  observed effect receipts and strict verification remain required when
  project policy, cross-boundary scope or a governed effect calls for them.
  Context retrieval alone creates no Goal or Change.

## Additional fixes

- Resolve a targeted Node workspace member's package manager from its proven
  owning boundary and expose that owner manifest. Member views omit independent
  install stages; excluded and independent packages retain their own lifecycle.
- Reuse one validated snapshot across task grounding and Graph retrieval.
  Freshness failures disclose logical scopes, reasons and available hashes,
  with bounded findings and explicit omission counts. Stale evidence remains
  unavailable and local native work can continue with the limitation disclosed.
- Remove unconditional workspace INDEX/context/verify reads and workspace-wide
  verification fallbacks from local runtime, test-recovery, delivery, API-diagnosis and dependency Skills;
  retain release and cross-boundary evidence requirements.
- Guide prerequisite checks and reuse of running setup/test commands, recommend
  longer polling intervals, and distinguish setup failure or tests not started
  from an executed failing test suite.
- Route task entry before source discovery or implementation/test reads while
  allowing minimal instruction/path discovery and disclosed native fallback.
  Explain how to consume saved JSON output as data regardless of file extension,
  avoiding code execution and repeated full-packet error output.
- Scope source extraction and call-binding diagnostics using project references.
  Compact project views disclose proven foreign omissions and retain relevant,
  global, cross-project and unresolved findings; aggregate coverage and freshness
  remain explicitly workspace-wide. Full Graph diagnostics are unchanged and
  legacy unscoped findings remain visible until intelligence is refreshed.
- Make task context the primary generated project entry and omit completed
  bootstrap, membership, project-lens and Graph reads from its continuation.
- Apply proportional policy and response guidance to every generated agent
  profile and customization report; include terminal execution for CLI reads
  and native verification commands.
- Share the aggregate context budget across components. Budget refusals carry
  valid whole-command retry sizes; component maxima recommend narrowing or
  native evidence. Nested working directories resolve the canonical project
  before selecting the closest lifecycle manifest.
- Accept legacy v1 entry and bootstrap policies with full integrity checks,
  preserving their restrictions until managed metadata is regenerated.
- Respect project scope for exact Graph relation evidence and shared-entity
  source proofs.
- Reuse immutable project-scope indexes and token postings during retrieval.
- Reject Graph snapshots from older provider generations, preserve camel-case
  attribute tokens, prioritize selected file proofs within the existing budget,
  and filter compact test references to the caller's query.
- Detect Rust frameworks from production dependency declarations, including
  renamed and inherited dependencies, rather than workspace catalogs,
  development dependencies, or incidental text.
- Preserve authored `AGENTS.md` whitespace, line endings, and final-newline
  state when managing Workspai grounding blocks.

## Compatibility and scope

This release adds opt-in projections and a lifecycle read command; existing
full Graph/bootstrap views remain the defaults. It does not publish the
independent Graph package or change framework qualification status.

## Install or upgrade

```bash
npm install -g workspai@0.81.0
workspai --version
```

The optional `wspai` alias should use the matching version.

## Release qualification

The release record is dated November 13, 2026. Cross-platform qualification
has not been claimed; consult the release workflow evidence for the exact
platform and package checks completed for this version.

See the [Agent Entry guide](../docs/agent-entry.md),
[Proof-Carrying Change](../docs/proof-carrying-change.md),
[Workspace Intelligence Evaluation](../docs/workspace-intelligence-evaluation.md),
and [Changelog](../CHANGELOG.md).
