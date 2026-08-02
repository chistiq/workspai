<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Safer Dependency Repair Decisions",
  "summary": "Workspai now distinguishes safe dependency fixes from breaking-only paths and keeps every review-required decision visible in the governed remediation plan.",
  "highlights": [
    {
      "icon": "🛡️",
      "text": "Compatible and breaking-only dependency repairs are classified separately"
    },
    {
      "icon": "🧭",
      "text": "Review-required decisions remain visible in project-scoped remediation plans"
    },
    {
      "icon": "🔄",
      "text": "Doctor rebuilds repair intent from current evidence instead of stale cache policy"
    },
    {
      "icon": "🔗",
      "text": "CLI, CI, IDE, and agent consumers share the normalized repair contract"
    }
  ]
}
-->

# Workspai CLI v0.52.1

Released August 2, 2026.

## Safer Dependency Repair Decisions

Workspai 0.52.1 makes dependency remediation more truthful. Finding a
vulnerability does not necessarily mean that a compatible automatic fix
exists. Doctor now distinguishes a safe repair from a mixed or breaking-only
path before the result reaches remediation plans, Studio, CI, or another agent
consumer.

When the available path requires a major downgrade, breaking upgrade,
replacement, exception, or an upstream fix, Workspai keeps that choice visible
as a review-required step. It no longer labels the path as safe, silently drops
it because no executable command exists, or spends repair cycles repeating a
command that cannot satisfy the blocker safely.

## Dependency audit results carry an explicit disposition

Doctor normalizes dependency remediation into these outcomes:

- `compatible`: a non-breaking candidate is available;
- `mixed`: compatible and breaking candidates both exist;
- `breaking-only`: every known candidate requires an explicit decision;
- `none`: the audit reports no available fix;
- `unknown`: the ecosystem output cannot prove a supported path;
- `not-needed`: no blocking dependency vulnerability remains.

Both boolean and object-shaped npm `fixAvailable` values are handled. Candidate
package, version, and breaking-change metadata remain bounded and portable in
the Doctor evidence contract.

## Review-required work remains governable

A dependency issue without a safe executable command still belongs in the
remediation plan. Workspai now publishes it as a project-scoped
`manual-review` step carrying:

- the affected project and evidence source;
- the reason automatic repair is unsafe;
- candidate and risk information;
- the dependency-security transaction that must eventually close;
- the focused Doctor command required to verify the decision.

This gives Studio and other consumers a deterministic stopping point. They can
request approval instead of retrying provider calls or presenting a breaking
change as a one-click fix.

## Current evidence wins over cached policy

Repair intent is derived policy, not source evidence. Doctor now rebuilds it on
every run from the current capability, freshness, issue class, and operational
impact. Cached project scans therefore cannot retain an obsolete automatic
action after the dependency classifier or orchestration policy changes.

Project and workspace Doctor schemas expose the same normalized disposition
and candidates, keeping CLI, CI, IDE, and agent consumers aligned without a
second repair model.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.52.1`.
- Existing workspaces and Doctor evidence remain readable.
- Safe automatic fixes remain available when a compatible path is proven.
- Breaking-only choices require explicit review rather than automatic action.

## Verification

- Full CLI suite: 2,257 tests passed across 210 test files; 8 tests remain
  explicitly skipped.
- Dependency-audit tests cover boolean and object-shaped npm fix metadata,
  compatible, mixed, breaking-only, unavailable, and clean outcomes.
- Doctor surface-probe and remediation-plan tests cover safe automation,
  review-required plans, project scope, transaction retention, and cached
  evidence normalization.
- Doctor canary and evidence-schema suites passed.
- Contract synchronization, shared-contract parity, and parity snapshots
  passed.

## Upgrade

```bash
npm install -g workspai@0.52.1
workspai --version
workspai workspace sync --json
workspai doctor workspace --plan --json
```

Optional short alias:

```bash
npm install -g wspai@0.52.1
wspai --version
```
