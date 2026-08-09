<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Universal Doctor Intelligence and Exact Evidence Repair",
  "summary": "Workspai now diagnoses polyglot workspaces through one causal evidence model and routes missing evidence back to the exact command that owns it.",
  "highlights": [
    {
      "icon": "🩺",
      "text": "Doctor publishes truthful diagnosis, applicability, freshness, summary, and receipt evidence"
    },
    {
      "icon": "🌐",
      "text": "17 runtime adapters and 44 framework identities share one fail-closed diagnostic vocabulary"
    },
    {
      "icon": "🎯",
      "text": "Verify and Repair retain causal findings and exact evidence-producer commands"
    }
  ]
}
-->

# Workspai CLI v0.56.0

Released August 9, 2026.

## Universal Doctor Intelligence and Exact Evidence Repair

Workspai 0.56.0 gives every CLI, IDE, CI, and agent consumer the same
machine-readable answer to three questions: what was observed, what it means,
and which governed action can prove the issue is closed.

## One diagnosis model across polyglot workspaces

Doctor now normalizes runtime-specific observations through one causal
diagnosis boundary. Findings carry stable identities, confidence, proof
bindings, repair disposition, causal groups, unknowns, contradictions, and
domain completeness.

The capability registry covers 17 runtime adapters, 44 framework identities,
and Linux, macOS, and Windows declarations. Unsupported or unobserved evidence
remains unknown; it is never reported as healthy merely because a provider did
not run.

## Smaller, truthful handoffs for consumers

`doctor workspace --fresh --json=summary` provides a bounded operational view
without weakening the complete Doctor artifact. Every Doctor run also writes a
receipt that separates blocking causes, advisories, unknowns, dependency
advisories, vulnerabilities, and not-applicable checks.

Freshness and applicability are explicit. Cache age is bounded, live security
state can be forced with `--fresh`, and checks that do not apply no longer
inflate warnings or passing counts.

## Repair stays attached to the causal finding

Remediation plans retain diagnosis finding identifiers and causal keys across
multi-project transactions. Repair can close the selected causal action set
without confusing unrelated workspace findings with a failed repair.

Workspace Verify now binds a missing evidence step to its exact
`sourceCommand` and `sourceArtifact`. A missing `workspace run test` report, for
example, routes back to that project-scoped test producer rather than a generic
Analyze refresh.

## Compatibility

There are no breaking command changes. Doctor evidence and remediation fields
are additive within their versioned contracts. The extension compatibility
floor remains 0.55.1; publishing a newer backward-compatible CLI no longer
raises that floor automatically.

## Verification

- 2,388 tests passed across 222 test files with 8 explicit environment skips.
- Coverage reached 81.65% statements and 82.67% lines.
- The 170-case versioned Doctor validation corpus passed across all 17 adapters;
  this is deterministic contract validation, not a claim of production-world
  diagnostic accuracy.
- A nine-project polyglot workspace exercised Sync, Model, Graph, Doctor,
  Contract, Analyze, Readiness, Verify, Explain, Agent Sync, and governed Repair
  planning.
- Type checking, linting, formatting, contract validation, documentation gates,
  runtime acceptance, bundle limits, and zero-vulnerability npm audit passed.

## Upgrade

```bash
npm install -g workspai@0.56.0
workspai --version
workspai doctor capabilities --validate --json
workspai workspace intelligence run --for-agent generic --strict --json
```

Expected version:

```text
0.56.0
```
