<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Revision-bound Live evidence and governed agent recovery",
  "summary": "Workspai 0.68.0 adds bounded evidence bindings between Live execution and canonical workspace artifacts, exact Graph revision identity for safe IDE and agent correlation, and more reliable workspace-owned repair planning across linked projects.",
  "highlights": [
    {
      "icon": "🔗",
      "text": "Live events, monitor snapshots, and Boards now carry bounded typed references to canonical evidence"
    },
    {
      "icon": "🧭",
      "text": "Graph search returns its exact source hash so consumers never overlay identities on the wrong revision"
    },
    {
      "icon": "🛡️",
      "text": "Concurrent execution remains honest: ambiguous artifact-to-stage links are deliberately withheld"
    },
    {
      "icon": "🤖",
      "text": "Linked-project blockers retain their workspace-owned repair actions for CLI and Studio consumers"
    }
  ]
}
-->

# Workspai CLI v0.68.0

Released August 29, 2026.

**Publication status:** Published.

## Revision-Bound Live Evidence and Governed Agent Recovery

Workspai 0.68.0 makes the connection between observed execution and canonical
workspace evidence explicit, portable, and revision-safe. Live activity can now
reference the artifacts, projects, Graph entities, relations, and proofs involved
in an operation without becoming a second Evidence or Decision Ledger.

The same contracts are intended for terminal, IDE, dashboard, automation, and
agent consumers. A consumer can navigate from a running stage to its authoritative
artifact or exact Graph revision while still independently validating integrity,
freshness, and verification status before making an engineering claim.

## Typed evidence bindings across Live projections

Activity events, monitor snapshots, and renderer-neutral Board runs and stages
can expose bounded `evidenceBindings`. Every binding declares:

- a typed target: `artifact`, `project`, `graph-entity`, `graph-relation`, or
  `proof`;
- its role as an input, output, verification reference, or subject;
- authoritative or observed provenance;
- the exact `graphSourceHash` whenever a Graph identity is referenced.

The monitor validates incoming bindings, removes exact duplicates, applies
deterministic ordering, and retains at most 100 references per bounded
projection. Existing journals without bindings remain valid.

Bindings are correlation and navigation metadata. They do not convert a
successful process exit or a Live stage into verified architecture, repair, or
release evidence.

## Honest artifact-to-stage attribution

Authoritative artifact publication now emits an output evidence binding
automatically. A publication is attached to a stage only when the producer names
that stage explicitly or exactly one non-root stage is active.

When multiple stages are active, Workspai keeps the artifact at run scope instead
of guessing which stage produced it. This prevents dashboards and agents from
displaying a confident but fabricated execution-to-evidence relationship during
parallel work.

The workspace-run report uses an explicit publication-stage binding, preserving
the exact lifecycle relation without relying on timing inference.

## Revision-safe Graph correlation

Bounded Graph search now returns the canonical Graph source hash alongside its
ranked entities, relations, and proofs:

```bash
workspai workspace graph search "where is authentication handled" --json
```

IDE and agent consumers can compare `graphSourceHash` with the Graph currently
displayed or grounded before highlighting an entity, relation, or proof. A stale
or different revision must be refreshed rather than silently correlated by an ID
that may have changed meaning.

The search response remains deterministic, offline, bounded, and backward
compatible. The new field is additive.

## More reliable linked-project repair planning

Workspace-scoped repair cards may describe a blocker through evidence from one
affected linked project. Repair planning now keeps workspace-owned actions
eligible in that case while still applying project identity to actions that are
actually project-owned.

This closes a consumer-visible gap where Studio or another IDE could select the
affected project correctly but receive no executable workspace action. The fix
is scope-driven and applies to arbitrary repair families; it is not tied to a
specific command, language, framework, or CMake diagnostic.

## Consumer guidance

Consumers should follow this sequence:

1. read the Live binding as a navigation reference;
2. resolve the referenced artifact or exact Graph revision;
3. validate its schema, integrity, freshness, and target scope;
4. use the owning Verify or Repair receipt before presenting a verified result.

Live remains observational. Graph remains architecture evidence. Repair and
domain verifiers remain the authorities for mutation and closure.

## Upgrade

```bash
npm install -g workspai@0.68.0
workspai --version
```

Expected output:

```text
0.68.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias is released at the matching `0.68.0` version.
- Existing version-one Workspace Intelligence, Model, Graph, Goal, MCP,
  Repair, Skill, project-entry, and Live behavior remains supported.
- Existing activity journals and Board consumers may omit evidence bindings.
- Graph-bearing bindings require an exact source hash; artifact and project
  bindings remain usable without one.
- No public command is removed.

## Breaking changes

None.
