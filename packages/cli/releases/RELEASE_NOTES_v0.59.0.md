<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Canonical-first agent entry and hardened governed workflows",
  "summary": "Workspai 0.59.0 gives coding agents one portable, integrity-checked entry into an adopted project, keeps workspace paths runtime-private, and strengthens Goal-bound source repair without weakening CLI-owned verification and rollback.",
  "highlights": [
    {
      "icon": "🧭",
      "text": "One agent bootstrap receipt establishes project identity, read order, evidence freshness, and active Goal state"
    },
    {
      "icon": "🔌",
      "text": "Generic intelligence now publishes provider-neutral grounding plus every supported host entry surface"
    },
    {
      "icon": "🛡️",
      "text": "Machine-local workspace paths remain runtime-private and are rejected from portable agent artifacts"
    },
    {
      "icon": "🎯",
      "text": "Goal attempts and successful source transitions remain durable, integrity-bound, and fail closed"
    },
    {
      "icon": "⌨️",
      "text": "Outcome-first help and README flows guide new users from software to intelligence, action, and proof"
    }
  ]
}
-->

# Workspai CLI v0.59.0

Publication status: Released August 17, 2026.

## Canonical-First Agent Entry and Governed Workflow Hardening

Workspai 0.59.0 makes the first interaction between a coding agent and an
adopted project deterministic. Instead of asking every agent to rediscover the
repository, workspace binding, Model, Graph, evidence, and active Goal on its
own, Workspai now publishes one portable entry contract and produces a bounded,
integrity-checked bootstrap receipt for the requested host.

The receipt is a gate, not a convenience hint. An agent may claim complete
architecture or begin source mutation only when project/workspace resolution,
contract integrity, Model and Graph freshness, live inputs, and Goal evidence
support that action.

## One command establishes the agent's entry boundary

From an adopted project:

```bash
workspai agent bootstrap --for-agent generic --json
```

The command resolves the canonical workspace at runtime and returns a bounded
receipt containing:

- portable project and logical workspace identity;
- the required evidence read order for the resolved host;
- Model, Graph, and live-input freshness;
- active Goal applicability and lifecycle status;
- permitted architecture, inspection, mutation, and verification claims;
- passed, warning, or failed checks plus exact next actions;
- integrity hashes proving which manifest and project context were evaluated.

Broken binding, invalid schema, stale or mismatched evidence, unsafe Goal state,
and non-portable output fail closed instead of silently falling back to a broad
source scan.

## Generic intelligence prepares every supported consumer

Projects are not always adopted with a known future model or IDE. Therefore:

```bash
workspai workspace intelligence run --for-agent generic --strict --json
```

continues to generate one provider-neutral context while also synchronizing the
supported host entry surfaces. Claude, Gemini, Qwen, Amazon Q, Codex-compatible,
and provider-neutral consumers can begin from the same canonical evidence
without replacing authored repository guidance.

Managed grounding places the Workspai gate before broad source discovery. It
preserves authored instruction files, tracked deletions, and symbolic links,
and explicitly reports degraded mode when complete grounding is unavailable.

## Workspace identity stays portable

Portable artifacts distinguish three concepts that were previously easy for a
consumer to confuse:

- project-local `.workspai/...` artifacts;
- logical `workspace:` references to canonical evidence;
- the absolute workspace path resolved only while a command is executing.

The bootstrap receipt never emits the machine-local path. The resolver command
may obtain that path inside the active process, but agents must not persist,
copy, disclose, or commit it. Contract and integrity validation happen before
the agent is allowed to make complete architectural or verification claims.

## Goal-bound work remains durable and bounded

This release also strengthens the governed Goal and Repair lifecycle:

- valid custom engineering objectives remain executable even when they do not
  match a built-in category;
- objective-first Graph retrieval cannot be displaced by category fallback;
- immutable Goal attempt budgets survive IDE or agent restarts;
- proposal creation and verification are serialized per Goal;
- successful source transitions bind post-repair Model, Graph, stable Graph
  inputs, checkpoint, and transaction-closure hashes;
- linked-project source repair remains limited to one canonically registered
  project and rejects absolute, sibling, parent, or symbolic-link escapes;
- Workspace Verify proves canonical safety and freshness without claiming to
  prove an arbitrary semantic outcome.

IDE consumers can inspect explicit capability invariants before enabling
mutation rather than inferring support from the package version alone.

## Clearer first-run command discovery

Root help now presents the product around the complete path:

```text
Understand → Impact → Act → Verify
```

Outcome-first examples explain how to create a workspace, scaffold an official
project kit, adopt existing software, generate Workspace Intelligence, give an
agent a Goal, inspect impact, run governed lifecycle commands, and verify the
result. The ownership-grouped command map is derived from the same runtime
inventory consumed by `workspai commands --json`, reducing help/runtime drift.

The CLI and package READMEs also include compact, real terminal demonstrations
for adoption, bounded Graph retrieval, and governed Goal handoff.

## Compatibility

There are no intentional breaking command changes. Agent entry manifests,
bootstrap receipts, capability invariants, and the new help presentation are
additive. Existing Model, Graph, Doctor, Goal, Repair, Workspace Intelligence,
and project lifecycle commands remain available.

Consumers that want canonical-first behavior should validate the published
agent-entry and bootstrap-receipt contracts instead of relying only on a version
comparison.

## Install

```bash
npm install -g workspai@0.59.0
workspai --version
workspai adopt .
workspai agent bootstrap --for-agent generic --json
```

Expected version:

```text
0.59.0
```
