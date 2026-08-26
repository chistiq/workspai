# Workspai CLI v0.44.0 Release Notes

Released: July 14, 2026

## Summary

Workspai CLI v0.44.0 is a minor release that hardens the Workspace
Intelligence foundation before the next stable publish. It promotes the
workspace model, graph, evidence chain, contracts, archive safety, and
agent-grounding outputs into a more deterministic, source-of-truth oriented
surface for developers, CI, IDEs, and AI agents.

The release keeps `workspai`, the monorepo root, and the short `wspai` alias
aligned on `0.44.0`, including the `wspai -> workspai@0.44.0` dependency.

## What's New

### Workspace Intelligence contract architecture

This release adds and validates first-class contracts for the Workspace
Intelligence runtime:

- `workspace-intelligence-architecture.v1`
- `workspace-intelligence-chain.v1`
- `published-contract-catalog.v1`
- `runtime-command-surface.v1`
- `command-capabilities.v1`
- `cli-operation-result.v1`

The chain now documents and verifies the deterministic intelligence flow from
modeling through snapshots, diffs, impact, contract verification, readiness,
workspace verification, context, agent sync, and explainability.

### Runtime conformance and adversarial validation

New release checks validate that the runtime command surface, generated
contracts, and Workspace Intelligence artifacts stay aligned:

- `check-workspace-intelligence-runtime-conformance.mjs`
- `check-workspace-intelligence-adversarial.mjs`
- generated-contract parity checks
- npm contract parity coverage

These checks protect the CLI, extension contracts, generated JSON schemas, and
agent-facing artifacts from drifting apart.

### Contract and artifact hardening

The release expands operational JSON schema coverage for:

- autopilot release evidence
- doctor workspace cache and project scans
- infra, product, and private product plan artifacts
- workspace model cache, sync, list, watch, and snapshot contracts
- workspace archive capabilities, manifest, and operation result contracts
- workspace contract verification evidence

The artifact catalog now maps `autopilot-release.v1.json` explicitly for both
the canonical last-run report and compatibility alias.

### Archive and recovery safety

Workspace archive and recovery flows were hardened for larger and safer
workspace operations:

- ZIP64 and streaming archive capability contracts
- opt-in archive download and expansion safety budgets
- archive operation result schemas
- selective snapshot/recovery contract improvements
- stronger archive inspect, verify, doctor, hydrate, and failure envelopes

### Workspace graph, evidence, and freshness gates

Workspace model, graph, impact, verify, and context flows now expose stronger
evidence semantics:

- graph-aware freshness and impact checks
- workspace git observation evidence
- workspace intelligence history records
- fact freshness contracts
- structured verification gates and policy violations
- richer workspace explain, trace, MCP, and agent-grounding outputs

### CLI gate and option stability

The CLI now accepts the Workspace Intelligence evidence flags consistently on
`workspace impact` and `workspace verify`:

- `--include-paths`
- `--include-evidence`
- `--scan-depth <count>`

`readiness` now supports `--workspace <path>`, and `pipeline --no-agent-sync`
correctly skips agent grounding writes at the CLI boundary.

Windows artifact writes now tolerate runner-level `fsync` `EPERM` on temporary
artifact files and lock files, preventing workspace init, contract sync, and
Workspace Intelligence evidence writes from failing after the payload has
already been written.

### Agent Customization Pack alignment

Agent customization outputs now have stronger contracts and drift checks for:

- `agent-customization-pack-report.v1`
- `agent-reports-index.v1`
- `agent-hooks.v1`
- MCP design evidence
- generated skills index and grounding surfaces

The docs now make the `--agent-sync`, `--no-agent-sync`, `--target`, and
`--hydrate-prompts` surfaces explicit.

### Release workflow idempotency

The manual npm release workflow now treats already-published versions
idempotently, reducing release rerun risk when a publish step has partially
completed.

## Breaking Changes

None.

## Verification

- `corepack npm run check`
- `corepack npm --workspace workspai run contracts:check`
- `corepack npm --workspace workspai run check:workspace-intelligence-runtime`
- `corepack npm --workspace workspai run check:workspace-intelligence-adversarial`
- `corepack npm --workspace workspai run docs:validate`
- `corepack npm test`

The first three completed the Workspace Intelligence chain through
`workspace verify`. `my-workspoly` correctly remained blocked because its
workspace contract currently has a real port collision:

```text
Port 3000 is claimed by both compass-web and vector-api.
```

## Install

```bash
npm install -g workspai@0.44.0
npx wspai --help
```
