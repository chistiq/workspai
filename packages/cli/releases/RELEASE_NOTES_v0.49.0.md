# Workspai CLI v0.49.0

Released July 25, 2026.

## Live, Contract-Backed Workspace Graph Updates

Workspai 0.49.0 adds a public, transport-neutral event contract for following
Workspace Knowledge Graph changes without repeatedly transferring the complete
graph. The release also shortens existing-project onboarding, completes the
repository's move to Chistiq, and makes GitHub Release-note publishing
fail closed.

The Workspace Model remains the canonical source of truth. Graph-stream events
are revision-bound projections derived from the authoritative model held by the
watch engine; they do not introduce another model or database.

## Revision-safe graph streaming

Run:

```bash
workspai workspace watch --graph-stream --json
```

The first NDJSON event is a complete `graph.snapshot`. Later changes produce
bounded `graph.delta` events containing added, updated, and removed entities,
relations, and proofs, plus provider, quality, and diagnostic changes.

Every event follows `workspace-graph-stream.v1` and carries:

- stable workspace and session identities;
- generation and revision numbers;
- current model and graph hashes;
- base revision and hashes for delta continuity;
- causation and correlation identifiers;
- an explicit event type and schema-validated payload.

The contract also defines provider progress, quality changes, proof
invalidation, resynchronization, pause, completion, heartbeat, and error
events. A consumer that detects a revision or hash gap can fail closed and
request a fresh snapshot instead of applying an unsafe delta.

The stream surface is published through the command inventory, runtime command
contract, contract catalog, extension compatibility contract, and artifact
documentation so CLI, CI, IDE, and extension consumers discover the same
capability.

## Simpler existing-project onboarding

From an existing project:

```bash
cd /absolute/path/to/project
workspai adopt .
```

When no workspace is active, Workspai creates or reuses the minimal managed
workspace in the default system location. It keeps the project source in place,
registers it, and prints the exact workspace shell step and canonical
intelligence command to run next.

The user-facing documentation now presents this direct route first. Agent
examples use the vendor-neutral `generic` selector while retaining dedicated
outputs for supported agent surfaces.

## Chistiq ownership

Workspai is now developed by Chistiq. Repository metadata, issue and discussion
links, contribution guidance, raw documentation images, packages, and release
references now use the canonical `chistiq/workspai` location.

A repository-level brand contract detects ownership and URL drift before
changes are published.

## GitHub Release integrity

The release workflow now renders the GitHub Release body from this exact
versioned document. Validation rejects:

- relative release-note links;
- links outside the canonical Chistiq repository path;
- tag and filename version mismatches;
- an aggregate Release Notes file that omits the current version.

This closes the failure mode where a GitHub Release linked to a file that did
not exist at the tagged path.

## Compatibility

There are no breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.49.0`.
- Existing graph JSON and portable exports remain supported.
- Graph streaming is opt-in and requires JSON output.
- Existing project source remains in place during adoption.

## Verification

- Full CLI suite: 2,088 tests passed across 194 test files; 8 tests remain
  explicitly skipped.
- Graph-stream schema tests cover snapshots, deltas, lifecycle events,
  continuity requirements, and deterministic resync behavior.
- Publisher tests cover initial hydration, hash-linked bounded updates, and
  proof timestamp stability.
- Watch tests cover authoritative model delivery to stream consumers.
- Release tests cover canonical body generation and fail-closed link
  validation.
- Generated and mirrored contract inventories include the graph-stream surface.

## Upgrade

```bash
npm install -g workspai@0.49.0
workspai --version
workspai workspace intelligence run --for-agent generic --strict --json
```

Optional short alias:

```bash
npm install -g wspai@0.49.0
wspai --version
```
