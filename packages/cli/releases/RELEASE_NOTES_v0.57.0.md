<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Truthful Repository Intelligence and Enterprise Qualification",
  "summary": "Workspai 0.57.0 understands repository archetypes and composite runtimes more accurately, validates real polyglot workspaces without leaking local data, and keeps Graph and adoption outputs bounded for every consumer.",
  "highlights": [
    {
      "icon": "🧭",
      "text": "Doctor separates blockers, advisories, unknowns, contradictions, and non-applicable evidence by repository archetype"
    },
    {
      "icon": "🧩",
      "text": "Composite runtimes and large-repository source relations stay explicit and proof-backed"
    },
    {
      "icon": "🛡️",
      "text": "Real-world qualification is reproducible, bounded, and fail-closed against local-path disclosure"
    },
    {
      "icon": "📦",
      "text": "Adoption previews, Graph export receipts, SBOM checks, and native dependency locks are consumer-safe"
    }
  ]
}
-->

# Workspai CLI v0.57.0

Publication status: pending.

## Truthful Repository Intelligence and Enterprise Qualification

Workspai 0.57.0 improves the stable CLI's understanding of real software
repositories before an agent, developer, or automation consumer acts on them.
Doctor now accounts for what a repository actually is, source and Graph
retrieval remain reliable at large scale, adoption effects are previewable, and
real-world qualification can be retained or published without exposing local
machine data.

## Doctor reasons about the repository it observes

Doctor now classifies project archetype independently from runtime detection.
Libraries, SDKs, plugins, monorepos, applications, services, and cross-language
platforms therefore keep their actual operating expectations. A library is no
longer warned for lacking a service health endpoint, environment template,
migration directory, or boot entrypoint that does not apply to it.

Default terminal output leads with the authoritative verdict and a bounded
remediation plan. Blocking findings, advisories, unknown evidence,
contradictions, and not-applicable checks remain separate. The legacy
percentage is labelled as a diagnostic pass rate rather than being presented as
an overall workspace-health score. `--verbose` retains the complete probe and
lifecycle detail for operators who need it.

Canonical workspace resolution also works when `doctor workspace` or
`doctor --workspace` is invoked from a linked or adopted project.

## Large source trees retain their structural relationships

Source extraction still uses a bounded sample for predictable cost, but local
import resolution now consults the complete bounded fingerprint inventory.
Relations targeting files outside the extraction sample no longer become false
unresolved edges or point to missing entities.

Natural-language Graph retrieval also requires meaningful multi-term query
coverage before generic service or API intent can qualify a result. Specific
workspace terms therefore remain stronger than conversational filler or a
broad entity-kind boost.

## Adoption effects are explicit before mutation

The additive `workspai.adopt-effects.v1` contract lets CLI, IDE, and agent
consumers preview the project metadata, repository-control reconciliation, and
downstream Workspace Intelligence operations associated with adoption.

Re-adopt dry runs preserve a valid existing workspace binding and no longer
claim that workspace commands cannot resolve. Authored `AGENTS.md` symlinks and
intentional tracked deletion are respected; portable managed grounding remains
available under `.workspai` without silently replacing repository-owned files.

## Composite runtimes remain honest

Nested runtime composition is first-class across adoption, Doctor, project
metadata, and command-capability output. A repository can expose several
runtime families without implying that every lifecycle stage is supported by
every adapter. When execution coverage belongs only to the primary adapter,
the limitation is explicit rather than inferred by consumers.

## Qualification is reproducible and publication-safe

New isolated and cumulative qualification harnesses exercise the read-mostly
enterprise command surface against real polyglot repositories. They accept the
reference root as an explicit runtime input and anonymize project identity in
retained reports.

Publication safety is fail-closed: raw invocation paths and command output are
not retained, machine-specific roots are rejected, and a report cannot be
written if local path disclosure is detected. This keeps qualification useful
for regression analysis without turning a developer machine into public
artifact content.

## Large exports return bounded receipts

`workspace graph emit` and `workspace contract graph` continue writing the full
requested artifact when `--output` is supplied. Their JSON stdout now returns a
bounded receipt describing that artifact instead of echoing the complete graph
into an agent, IDE, terminal, or CI log buffer.

Snapshot create, list, inspect, and restore failures likewise use the shared
versioned operation-error envelope under `--json`; consumers no longer receive
human prose where a machine contract was requested.

## Cross-platform development and release integrity

The development dependency graph uses the patched `nanoid` release so npm
audit and CycloneDX SBOM generation agree on one valid tree. Canonical physical
path checks preserve authored Git state across macOS path aliases and Windows
workspace paths.

The repository now treats `package-lock.json` as a cross-platform build
artifact. Install and pre-push validation derive the complete native binding
families from Rolldown, Rollup, and esbuild metadata and fail before build or
test startup when a platform-pruned lockfile is detected.

## Compatibility

There are no breaking command changes. The adoption-effects contract and
evidence fields are additive. Existing human commands remain available, while
JSON consumers receive more explicit and bounded output contracts.

## Verification status

Publication remains pending until the complete release matrix, package smoke,
security, documentation, contract, and npm dry-run gates pass for the release
commit. Focused source, Graph, adoption, grounding, package-contract,
cross-platform lockfile, documentation, build, and SBOM checks pass on the
current candidate.

## Install after publication

```bash
npm install -g workspai@0.57.0
workspai --version
workspai doctor workspace
workspai workspace intelligence run --for-agent generic --strict --json
```

Expected version after publication:

```text
0.57.0
```
