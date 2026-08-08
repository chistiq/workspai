<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Truthful Evidence Posture and Typed Repair Decisions",
  "summary": "Workspai now keeps advisory evidence out of the blocked lane and gives IDEs and agents structured causes for every governed repair decision.",
  "highlights": [
    {
      "icon": "🧭",
      "text": "Workspace Explain publishes verdict, freshness, and blocking posture explicitly"
    },
    {
      "icon": "🧩",
      "text": "Decision-required repairs expose typed causes instead of prose-only diagnostics"
    },
    {
      "icon": "🗂️",
      "text": "Multi-project Doctor repairs retain truthful workspace scope"
    }
  ]
}
-->

# Workspai CLI v0.55.1

Released August 8, 2026.

## Truthful Evidence Posture and Typed Repair Decisions

Workspai 0.55.1 strengthens the contract between the CLI-owned source of truth
and its IDE, CI, and agent consumers. Evidence now says explicitly whether it
blocks release, and repair transactions identify why a decision is required in
a structured form.

## Explain no longer turns attention into a blocker

Workspace Explain reports now publish three explicit fields:

- `releaseVerdict`: `ready`, `needs-attention`, or `blocked`;
- `evidenceFreshness`: `fresh`, `stale`, or `unknown`;
- `blocking`: whether the referenced evidence contains an active release
  blocker.

Consumers no longer need to infer status from `releaseRisk`, target kind, or a
human-readable summary. A high-risk `needs-attention` report with zero blocking
reasons remains an advisory finding.

## Every repair decision carries a typed cause

`decision-required` transactions now include stable causes for:

- missing executables;
- unsupported runtime adapters;
- failed preconditions;
- risk approval;
- force or breaking-change policy exceptions;
- source repair requirements.

Each cause carries a stable identifier and may include project, adapter, and
executable context. Extensions and agents can therefore present the correct
decision or remediation path without parsing prose or repeating failed work.

## Multi-project repairs keep workspace scope

A Doctor card may select causal actions from more than one project. Such a
transaction now publishes `scope: workspace` unless one exact project was
explicitly selected or all actions resolve to one project path. This prevents
an extension or agent from routing a workspace repair to an arbitrary project.

## Compatibility

There are no breaking command changes. The new Explain fields are additive,
and current repair transactions always write the new `decision.causes` array.

## Upgrade

```bash
npm install -g workspai@0.55.1
workspai --version
workspai workspace repair capabilities --json
workspai workspace repair list --json
```

Expected version:

```text
0.55.1
```
