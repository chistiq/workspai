<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Stable Goal verification across evidence refreshes",
  "summary": "Workspai 0.60.1 keeps bounded Goal attempts valid across CLI-owned Model and Graph refreshes while continuing to reject unrelated drift and tampering.",
  "highlights": [
    {
      "icon": "🧾",
      "text": "Every verification attempt records an auditable status, Model, and Graph binding receipt"
    },
    {
      "icon": "🔁",
      "text": "A later bounded attempt can safely consume evidence refreshed by the previous CLI verification"
    },
    {
      "icon": "🛡️",
      "text": "Unrelated source changes, tampered status, and unmatched fingerprints still fail closed"
    },
    {
      "icon": "🔌",
      "text": "Goal index and lifecycle contracts remain synchronized for CLI, IDE, and agent consumers"
    }
  ]
}
-->

# Workspai CLI v0.60.1

Released August 18, 2026.

## Stable Goal Verification Across Evidence Refreshes

Workspai Goals are bound to a canonical Workspace Model and proof-backed
Knowledge Graph. Verification may legitimately refresh both artifacts while
measuring the selected target. Before this patch, that CLI-owned refresh could
make the same immutable Goal appear stale before its next bounded attempt.

Version 0.60.1 closes that lifecycle gap without weakening freshness policy.

## Verification now leaves an auditable binding receipt

After each CLI-owned verification attempt, Workspai records a receipt containing:

- the exact verified-goal id and attempt number
- the canonical digest of the verified-goal status
- the structural Workspace Model hash
- the Graph input fingerprint and its hash semantics
- the receipt timestamp

The next attempt accepts the refreshed Model and Graph only when every receipt
binding still matches. The immutable Goal Pack remains unchanged.

## Freshness remains fail-closed

The receipt authorizes only the state produced by the recorded verification.
Workspai still marks the Goal stale when it observes:

- an unrelated source or manifest change
- a tampered or missing verified-goal status
- a different Model hash or Graph fingerprint
- a mismatched verified-goal id or attempt
- evidence changed outside a closed Goal Repair transaction or recorded CLI
  verification attempt

Recovery continues through the explicit `--refresh` path rather than by
silently widening trust.

## Consumer contract alignment

The optional `verificationReceipt` field is published in both
`workspai.goal-index.v1` and `workspai.goal-lifecycle-result.v1`. Canonical root
contracts and supported local consumer mirrors are generated from the same CLI
source.

Older Goal indexes remain readable because the field is optional. New
receipt-bearing lifecycle results are schema-valid and can be consumed without
parsing CLI prose.

## Qualification

The patch was verified with:

- repeated verification attempts in a four-project Python, .NET, Go, and Node
  workspace
- explicit stale-Goal renewal with preserved project scope and runtime
- the polyglot gRPC repository, where C++ coverage correctly remains
  `needs-evidence` until native coverage instrumentation exists
- tamper and unrelated-source-drift regression tests
- shared-contract parity with the VS Code extension
- complete CLI type, contract, formatting, English-text, and test gates

## Upgrade

```bash
npm install -g workspai@0.60.1
workspai --version
```

Expected output:

```text
0.60.1
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias is published at the matching `0.60.1` version.
- Existing Goal Pack identities and previously persisted indexes remain valid.
- The new receipt fields are additive.
- No public command or artifact contract is removed.

## Breaking changes

None.
