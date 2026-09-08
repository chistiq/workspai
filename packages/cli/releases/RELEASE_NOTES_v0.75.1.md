<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Safer adoption. More reliable agent evidence.",
  "summary": "Workspai 0.75.1 strengthens adoption recovery, generated-source provenance, and governed agent attachment for existing repositories.",
  "highlights": [
    {
      "icon": "🛡️",
      "text": "Safe workspace selection and recoverable adoption with minimal progress feedback"
    },
    {
      "icon": "🔎",
      "text": "Generated-source provenance preserves authored evidence in Graph retrieval"
    },
    {
      "icon": "🔗",
      "text": "Portable Agent Framework plan and effect paths for externally adopted projects"
    }
  ]
}
-->

# Workspai CLI v0.75.1

Released September 8, 2026.

**Publication status:** Published.

## Safer Adoption and Reliable Agent Evidence

This patch release hardens existing adoption and agent workflows. It does not
introduce a new framework, relax verification, or automatically upgrade project
dependencies.

## Adoption

- Interactive adoption outside a workspace can offer parent-workspace
  bootstrap when that parent contains exactly the project being adopted.
- An explicitly selected empty directory can become a standard workspace.
  Non-empty non-workspace targets are rejected without conversion.
- Bootstrap and adoption share recovery: failures during registry, Model,
  Graph, consumer sync, or grounding restore workspace and project preimages.
- Minimal progress feedback covers detection, linking, intelligence publication,
  and grounding while preserving machine-readable output.
- Non-interactive adoption retains managed-default resolution.

## CLI and Evidence Corrections

- Lifecycle help returns before runtime probes, command execution, or readiness
  writes, including when the project toolchain is unavailable.
- Source extraction identifies explicit generated-file headers independently
  of optional polyglot analysis. Files and symbols carry consistent provenance;
  authored evidence retains priority while generated evidence stays searchable.
- Agent Framework plans and effect receipts use portable artifact identities
  for externally adopted projects, keeping managed writes under their project
  roots and subject to authorization and ownership checks.
- Enterprise qualification respects terminal PCC states instead of attempting
  invalid resume or abort operations after successful verification.

## Compatibility and Verification Boundaries

Existing public commands and schema versions remain supported. Framework
release admission and PCC verification remain enforced. This release does not
claim complete runtime validation for every repository: application toolchains,
dependencies, credentials, and integration services remain project prerequisites.
Unpredicted architecture changes can still block verification.

Regression coverage exercises adoption recovery, lifecycle help, generated
provenance, and internal/external Agent Framework authorization and receipts.

## Install

```bash
npm install -g workspai@0.75.1
workspai --version
```

The optional npm alias `wspai@0.75.1` targets the same CLI version.

See the [Changelog](../CHANGELOG.md), [Command Reference](../docs/commands-reference.md),
and [Workspace Operations](../docs/workspace-operations.md).
