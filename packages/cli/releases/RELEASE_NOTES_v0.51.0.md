# Workspai CLI v0.51.0

Released July 28, 2026.

## Trustworthy Graph Retrieval and Clearer Workspace Onboarding

Workspai 0.51.0 makes two everyday paths more dependable: understanding what
the Workspace Knowledge Graph actually knows, and understanding what to do
immediately after a workspace is created.

Graph providers now distinguish applicable, skipped, partial, and failed work;
bounded search gives rare, meaningful terms more weight than conversational
filler; repeated logical interfaces are reconciled without erasing their
source-file evidence; and nested runtime signals improve polyglot discovery.
Workspace creation now ends with one concise receipt and a profile-aware README
that stays synchronized with the same versioned intelligence-loop contract used
by the CLI.

## Graph quality that does not overstate completeness

Provider execution and evidence completeness are now separate signals:

- `passed` means applicable input produced graph evidence;
- `partial` means applicable input was incomplete or produced no usable
  evidence;
- `skipped` means that source surface was not present;
- `failed` means the bounded provider run could not complete.

Applicable-but-empty providers contribute explicit unknowns instead of looking
more complete than providers that found partial evidence. Binding gaps,
bounded-scan limits, unresolved source relationships, and provider partials feed
the graph's unknown diagnostics.

## Better local, deterministic retrieval

`workspace graph search` remains offline and model-free, but its ranking is now
more useful for natural-language questions:

- common filler words are removed when meaningful terms remain;
- remaining terms receive deterministic inverse-document-frequency weighting;
- exact labels, identities, and aliases keep the strongest rank;
- bounded results preserve proof references and deterministic ordering.

Logical interface identities are reconciled across duplicated source copies
while the graph keeps distinct file entities and proofs. This prevents one
service copied across several schema files from consuming most of a bounded
agent context.

## Stronger polyglot and provider discovery

The canonical model now records bounded nested runtime candidates for adopted
monorepos and aggregates them into workspace runtime identity. The Knowledge
Graph uses explicit source-surface applicability for Kubernetes, ownership,
CI, infrastructure, architecture decisions, documentation, Compose, OpenAPI,
and interface contracts.

Changing a workspace profile updates canonical manifest and contract identity,
but profiles do not hide source providers or fabricate graph differences.

## A workspace that explains itself

Workspace creation now prints one compact receipt with:

- workspace name, profile, location, and runtime foundation;
- the synchronized contract, project registry, canonical Model, proof-backed
  Graph, agent grounding, and evidence index;
- the two useful next commands.

Every new workspace receives a profile-aware `README.md`. Its managed section
shows the current profile, registered-project count, optional Python-engine
state, canonical loop, useful commands, and consumer entry points. Successful
project creation, adoption, import, connection, and `workspace sync` refresh
that section without overwriting user-authored README content.

The displayed loop comes from the public Workspace Intelligence chain contract:

```text
Understand → Change → Evidence → Gate → Ground → Distribute → Explain
```

## Official generators and Doctor correctness

Official generator smoke coverage is now contract-driven rather than maintained
as a separate hand-written list. Available generator jobs can validate create,
metadata, registry membership, final build, and Doctor evidence across the
supported CI operating systems.

Doctor now:

- preserves Electron as a `desktop` project instead of applying Vite frontend
  `dev` and `build` gates;
- preserves VS Code extensions as `extension` projects;
- emits new typed internal repairs under the `workspai:` namespace while still
  accepting legacy durable `rapidkit:` repair tokens;
- removes duplicate Quick Fix commands before JSON, human, plan, or Studio
  consumers receive them.

Canonical FastAPI and NestJS templates are also synchronized with the current
RapidKit Core template baseline.

## Architecture remains unchanged

This release strengthens, but does not reverse, the source-of-truth direction:

```text
Workspace sources
      ↓
Canonical Workspace Model
      ↓
Evidence-backed Workspace Knowledge Graph
      ↓
Doctor · impact · verify · context · explain
```

The Model still owns workspace identity, project inventory, profile, policy,
contract state, and compact topology. The Knowledge Graph remains a
proof-carrying, hash-bound derived representation and cannot write back into
the Model during the run.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.51.0`.
- Existing workspaces and project metadata remain readable.
- Existing durable `rapidkit:doctor:repair` tokens remain resumable; newly
  produced tokens use `workspai:doctor:repair`.
- Python remains optional outside Python/Core-dependent workflows.

## Verification

- Graph tests cover provider applicability, truthful unknown accounting,
  interface reconciliation, deterministic natural-language ranking, nested
  polyglot discovery, model binding, and profile synchronization.
- Creation tests cover the concise receipt, managed README preservation,
  profile/project-count refresh, lifecycle synchronization, and official kit
  metadata.
- Doctor tests cover Electron/VS Code project taxonomy, repair namespace
  compatibility, duplicate-fix removal, dependency evidence, and graph-aware
  diagnosis.
- A real 10-project polyglot workspace exercised Model generation, bounded
  Graph search and proofs, project/workspace Doctor, lifecycle sync, and the
  strict Workspace Intelligence chain.
- TypeScript, lint, format, documentation, contracts, package, and complete CLI
  tests remain release gates.

## Upgrade

```bash
npm install -g workspai@0.51.0
workspai --version
workspai workspace sync --json
workspai workspace intelligence run --for-agent generic --strict --json
```

Optional short alias:

```bash
npm install -g wspai@0.51.0
wspai --version
```
