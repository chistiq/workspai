<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Deterministic Governance Repair",
  "summary": "Workspai now turns blocked governance evidence into ordered root actions, preserves exact Doctor blockers, and verifies long-lived start commands without hanging the workspace loop.",
  "highlights": [
    {
      "icon": "🧭",
      "text": "Pipeline evidence preserves exact project blockers and the active Doctor policy profile"
    },
    {
      "icon": "🧩",
      "text": "Aggregate gates declare and respect their contract-owned upstream repair actions"
    },
    {
      "icon": "🧪",
      "text": "Missing project init, test, build, and start evidence receives an ordered producer plan"
    },
    {
      "icon": "⏱️",
      "text": "Long-lived start commands produce bounded health or liveness evidence instead of hanging"
    }
  ]
}
-->

# Workspai CLI v0.52.3

Released August 3, 2026.

## Deterministic Governance Repair

Workspai 0.52.3 closes a failure mode where a governance card could report
`doctor workspace gate failed`, then repeatedly refresh aggregate evidence
without exposing the project-level work that actually owned the blocker.

The CLI now preserves the causal path. Pipeline records the exact Doctor policy
profile and blockers observed during that run. The remediation artifact turns
those upstream findings and missing Workspace Verify evidence into ordered,
scoped actions that IDE and agent consumers can execute before rerunning the
aggregate gate.

## Pipeline evidence keeps the original diagnosis

Doctor evidence can be refreshed by later commands in the same workflow. A
consumer must still be able to explain which Doctor result caused Pipeline to
fail. Pipeline stages therefore snapshot:

- the active Doctor policy profile;
- the project-level blocker messages observed by that stage;
- the stage exit code and evidence path;
- the same blocker details in the Pipeline's aggregate blocking reasons.

The published Pipeline schema now describes these fields explicitly, while
remaining compatible with existing `rapidkit-pipeline-v1` artifacts.

## Remediation follows dependencies, not card labels

The artifact remediation plan now produces causal actions for two previously
underspecified cases.

When Workspace Verify is missing or rejecting project evidence, it emits the
required project-scoped `workspace run` producers in stage order. Those commands
use `--no-gates` so an already-blocked aggregate gate cannot prevent production
of the evidence needed to evaluate it.

When Readiness detects unpinned project runtimes, it emits a runtime-specific
`setup` action followed by an ordered workspace `bootstrap`. Aggregate
Readiness, Verify, and Pipeline reruns declare their non-invasive upstream
dependencies, allowing contract consumers to repair root causes before they
refresh the final gate.

## Polyglot Readiness reflects registered projects

A command launched from the workspace root no longer collapses registered
projects to a single `unknown` runtime. Readiness resolves the project inventory
from the canonical workspace contract and evaluates every represented runtime.
The resulting toolchain blocker names the missing runtime pins and remains
portable across workspace locations.

## Start verification is finite and reusable

`workspace run start` is an evidence producer, not a request to leave a
development server running forever. This release gives the stage bounded
semantics:

- a configured framework health contract is checked within a finite window;
- frameworks without a health contract use a bounded process-liveness smoke;
- early non-zero exits remain failures with diagnostics;
- the launched process is terminated after evidence is captured;
- the generic stage timeout remains the final cleanup safety net.

This keeps local verification, CI, and Studio from hanging on otherwise healthy
long-lived services.

## Release dependencies are patched

The release toolchain lockfile now resolves patched `brace-expansion`,
`fast-uri`, `ip-address`, and `postcss` versions. Exact root overrides no longer
hold the graph on releases covered by current security advisories.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.52.3`.
- Existing Pipeline and Workspace Run evidence remains readable.
- Existing project command overrides and framework health contracts continue to
  apply.

## Verification

- Full CLI suite completed across 214 test files. The restricted run passed 207
  files; the three local-HTTP files blocked by sandbox socket policy passed
  60/60 when rerun with loopback access. Four files remain explicitly skipped.
- Focused Workspace Run, Pipeline, Readiness, artifact-remediation, and
  CLI/extension parity suites passed.
- TypeScript, production build, formatting, and contract synchronization
  passed.
- `npm audit --audit-level=high` completed with zero known vulnerabilities.
- The built CLI was exercised against a real multi-project workspace. Pipeline
  persisted the `release` Doctor profile, ten exact project-level Doctor
  blockers, and the separate unpinned Python runtime blocker.

## Upgrade

```bash
npm install -g workspai@0.52.3
workspai --version
workspai pipeline --json --strict
workspai workspace remediation-plan --write --json
```

Optional short alias:

```bash
npm install -g wspai@0.52.3
wspai --version
```
