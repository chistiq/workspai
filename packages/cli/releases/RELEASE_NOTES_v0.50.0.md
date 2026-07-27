# Workspai CLI v0.50.0

Released July 27, 2026.

## Project-Native Workspace Intelligence

Workspai 0.50.0 makes every registered project a reliable entry point into the
workspace that governs it. Developers and agents can work from a project
directory while Workspai resolves the canonical workspace, keeps machine-local
paths out of portable evidence, and provides a bounded project view of the
shared Model and Knowledge Graph.

This release also connects Doctor to graph evidence, expands creation and
ingestion, adds governed project-coverage evidence, and strengthens portable
workspace archives.

## Work from the project you already have open

Adopt a project without moving it:

```bash
cd /absolute/path/to/project
workspai adopt .
```

The project receives:

- a validated, gitignored machine-local workspace binding;
- portable `AGENTS.md` and Workspai grounding;
- `.workspai/reports/project-context-agent.json`, containing bounded project
  identity, commands, topology, related projects, APIs, deployment and test
  surfaces, blockers, proof paths, and Model/Graph freshness.

Workspace-aware commands launched from that project resolve the canonical
workspace automatically. Creation, adoption, import, connection, and registry
sync refresh the same governed Model, Graph, report index, and supported agent
surfaces.

## Graph-aware Doctor

Doctor now combines runtime-native project checks with current Workspace
Knowledge Graph evidence. A diagnosis can identify:

- the project entity associated with a finding;
- evidence-backed structural paths and impact candidates;
- relevant proofs and verification targets;
- missing, stale, or mismatched graph/model evidence.

The output remains careful about its limits: graph reachability identifies
structural investigation and verification candidates; it does not claim to
prove runtime causality.

## A clearer create and ingestion workflow

Interactive `workspai create` can now create a workspace or project, or bring
in existing local software, a Git repository, or a Workspai archive through a
versioned ingestion plan.

The project picker is organized by project kind—Backend, Frontend, Desktop, and
Extension—and adds official or Workspai-owned flows for:

- Rust/Axum;
- Tauri;
- Electron Forge;
- VS Code extensions;
- Laravel.

Official generators request their latest stable channel and record the
resolved generator/runtime evidence. Host runtime compatibility still applies,
and unavailable official tooling fails with an actionable prerequisite rather
than silently substituting a different scaffold.

Turning the current folder into a workspace is foundation-only. It does not
install Python or Poetry. The optional Python engine is requested only by a
Python/Core-dependent workflow.

## Governed coverage and portable archives

Projects can publish structured test-coverage evidence:

```bash
workspai project coverage --run --target 80 --strict --json
```

The command detects runtime-native coverage surfaces, records the observed
metric and provenance, and can enforce a requested target without treating a
generic test command as proof of coverage.

Workspace archive capabilities, manifests, verification, diagnosis, import,
and hydration now share explicit versioned contracts. Import verifies an
archive before registration; hydration remains an extraction-only operation.

## Architecture and contracts

The canonical direction remains:

```text
Workspace sources
      ↓
Canonical Workspace Model
      ↓
Evidence-backed Knowledge Graph
      ↓
Doctor · impact · verify · context · explain
```

The Model owns workspace identity, project inventory, policy, contract state,
and compact topology. Graph providers enrich that authorized inventory with
proof-backed code, package, API, infrastructure, test, ownership, and decision
relationships without writing back into the Model during the run.

New and expanded public contracts cover project entry capability,
project/workspace resolution, machine-local links, portable project context,
ingestion plans and results, project coverage, archive capabilities and
results, and graph-aware Doctor diagnosis.

## Help and documentation

Root Help now explains the product, the canonical Model-to-Graph relationship,
the shortest onboarding paths, and where to discover detailed commands without
printing the entire command catalog. Command-specific Help remains focused on
its own surface, while `workspai commands --json` provides complete
machine-readable discovery.

The root and CLI READMEs document project-native operation, current kit
categories, foundation-only creation, project coverage, Graph/Doctor behavior,
portable evidence, and the published contract boundaries in plain language.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.50.0`.
- Existing workspaces and project metadata remain readable.
- The machine-local project binding is always gitignored and is never included
  in portable agent evidence.
- Python remains optional outside Python/Core-dependent workflows.

## Verification

- Full CLI suite: 2,218 tests passed across 205 test files; 8 tests remain
  explicitly skipped.
- Project-entry tests cover resolution precedence, stale and moved workspace
  links, portability, grounding, and lifecycle refresh behavior.
- Doctor tests cover graph-aware diagnosis, evidence freshness, dependency
  audits, runtime surfaces, and conservative causality boundaries.
- Creation tests cover categorized kits, latest-stable generator policy,
  ingestion decisions, current-folder foundation creation, and Python-free
  non-Python flows.
- Contract, artifact, documentation, TypeScript, lint, format, package, and
  cross-platform invariants are part of the release validation path.
- Enterprise prepack runs its creation and registry smoke tests in an isolated
  home, so packaging cannot read or mutate the publisher's real Workspai
  registry.

## Upgrade

```bash
npm install -g workspai@0.50.0
workspai --version
workspai workspace intelligence run --for-agent generic --strict --json
```

Optional short alias:

```bash
npm install -g wspai@0.50.0
wspai --version
```
