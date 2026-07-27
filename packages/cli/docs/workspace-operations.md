# Workspace Operations

Use this guide to bring existing software into Workspai, move or share workspace
state safely, and manage supporting local services. It explains what each
operation changes before you run it.

Command syntax: [commands-reference.md](./commands-reference.md).

## Import and adoption

Use `import` to copy or clone an existing project into a Workspai workspace.
Use `adopt` when the project must stay where it already lives but should become
visible to Workspai. In both cases, the project becomes part of the shared
system map, checks, and AI context.

RapidKit Core module commands remain available only when existing project
metadata identifies a kit that supports modules.

```bash
npx workspai import ../orders-api
npx workspai import https://github.com/acme/orders-api.git --git
npx workspai import ../orders-api --workspace ./my-workspace --name orders-api --json
npx workspai adopt ../marketing-web --workspace ./my-workspace
npx workspai adopt --json
```

### Import behavior

- Local folders are copied; git sources are cloned with shallow history.
- Outside any workspace (no `--workspace`), Workspai creates or reuses the managed `workspai` workspace. New defaults use `~/.workspai/workspaces/workspai`; valid legacy candidates under `~/rapidkit/workspaces/workspai` and `~/Workspai/rapidkits/workspai` can still be reused.
- Existing workspaces under legacy managed roots remain registered after upgrade.
- Workspai writes a validated machine-local workspace binding into the
  imported project. Workspace commands can then be launched from that project
  without changing directories.
- Failed workspace sync rolls back imported files and registry entries.

### Adopt behavior

- Source files are not moved or copied.
- Default workspace resolution matches import, including canonical creation and valid legacy managed-default reuse.
- Writes `.workspai/project.json`, `.workspai/adopt.json`, and `.workspai/adopt-readiness.json`.
- Registry and contract sync include adopted projects for `workspace model`, `workspace context`, Dashboard, and agents.
- Managed grounding writes a portable project lens, project grounding, and a
  bounded managed section in `AGENTS.md`. User-authored `AGENTS.md` content is
  preserved.
- `--dry-run --json` previews detection without writing metadata.

### Work from the project directory

After `adopt`, `import`, or project creation, the project is a first-class
entry point into its canonical workspace:

```bash
cd /absolute/path/to/project
npx workspai project workspace status --json
npx workspai doctor project --json
npx workspai workspace graph search "authentication endpoint" --limit 12 --json
npx workspai workspace intelligence run --for-agent generic --strict --json
```

Workspace resolution has one stable precedence:
`--workspace` → parent workspace → validated local link → reverse registry.
Workspai returns a specific error for an invalid explicit workspace, malformed
or stale link, ambiguous registration, or an unlinked project. It never picks
one workspace silently when ownership is ambiguous.

The project receives four distinct surfaces:

| File | Purpose | Portable |
| --- | --- | --- |
| `.workspai/workspace-link.local.json` | Machine-local canonical workspace binding | No; always gitignored |
| `.workspai/reports/project-context-agent.json` | Bounded project view of model, graph, proofs, diagnostics, and safe commands | Yes |
| `.workspai/PROJECT-GROUNDING.md` | Human- and agent-readable project entry guide | Yes |
| `AGENTS.md` managed section | Tells compatible agents where to start and when to cross the project boundary | Yes |

The bounded context includes project identity and commands, dependencies and
dependents, related API/deployment/test surfaces, current project findings,
portable proof locators, and model/graph freshness. It deliberately references
rather than duplicates workspace-wide evidence.

Use `--project-grounding managed` (default) to publish all portable surfaces,
`local` to keep the project lens and grounding gitignored without managing
`AGENTS.md`, or `off` to disable project grounding for that operation. The
machine-local link remains enabled in every mode because it owns command
resolution; it is private to the current machine and never belongs in a commit.
Mode reconciliation is convergent: changing modes removes stale managed
sections, portable files, or ignore rules that the new mode no longer owns,
while preserving user-authored `AGENTS.md` and `.gitignore` content.

If a workspace moved, or a cloned project has no valid local link, reconcile
it explicitly:

```bash
npx workspai project workspace relink --workspace /absolute/path/to/my-workspace --json
```

Relink succeeds only when the project is already a member of the canonical
workspace contract.

### JSON output (`--json`)

- Import returns `workspacePath`, `workspaceResolution`,
  `defaultWorkspaceCreated`, `projectWorkspaceCommand`,
  `commandsResolveWorkspaceFromProject`, and `importedProject`. The imported
  project includes its `source`.
- Adopt returns `workspacePath`, `workspaceResolution`,
  `defaultWorkspaceCreated`, `wouldCreateDefaultWorkspace`,
  `projectWorkspaceCommand`, `commandsResolveWorkspaceFromProject`, `dryRun`,
  and `adoptedProject`.
- Project results include detected `name`, `path`, `stack`, `runtime`, `framework`, `supportTier`, `moduleSupport`, and `confidence` where available.

Imported projects receive `.workspai/import-readiness.json`. Adopted projects add frontend-aware detection for Next.js, React, Vite, Vue, Angular, SvelteKit, Nuxt, Astro, Remix, and Solid.

## Workspace snapshots and safe project operations

```bash
npx workspai snapshot create before-upgrade --reason "before dependency upgrade"
npx workspai snapshot list
npx workspai snapshot inspect before-upgrade
npx workspai snapshot restore before-upgrade --dry-run
npx workspai snapshot restore before-upgrade --force
```

Project delete is safe-by-default:

```bash
npx workspai project archive orders-api --reason "replaced by orders-v2"
npx workspai project archives
npx workspai project restore orders-api
npx workspai project delete orders-api
npx workspai project delete orders-api --permanent --confirm orders-api
```

Lifecycle safety:

- `project delete` archives by default; permanent removal requires `--permanent --confirm <exact-name>`.
- `snapshot restore` requires `--force` unless dry-run.
- Restore, archive, and permanent delete create pre-operation metadata snapshots.
- Archive manifests live under `.workspai/archive/projects`.
- Audit records append to `.workspai/audit/events.jsonl`.
- Workspace policy can require reasons, safety snapshots, or block permanent delete via `.workspai/policies.yml`.

## Workspace collaboration bundle

```bash
npx workspai workspace share
npx workspai workspace share --output ./team-share.json
npx workspai workspace share --include-paths
npx workspai workspace share --no-doctor
```

Bundle includes workspace metadata, discovered projects, report index, and latest doctor evidence (unless `--no-doctor`). `--include-paths` is for internal teams only (absolute paths).

## Workspace contract registry

```bash
npx workspai workspace contract init
npx workspai workspace contract inspect
npx workspai workspace contract verify --strict
npx workspai workspace contract graph
```

Contract file: `.workspai/workspace.contract.json`. Verification checks schema, duplicate slugs, port collisions, and unknown dependencies.

`workspace contract graph --json` preserves its original `nodes`, `edges`, and
summary fields for existing consumers, and now adds an evidence-backed
`dependencyGraph` using the public `workspace-dependency-graph.v1` contract. It
discovers package/workspace dependencies and supported cross-project imports,
records relationship provenance and confidence, and reports graph coverage,
orphans, hotspots, and cycles. Project nodes also expose safe package metadata,
public environment-template keys, command capabilities, key manifests,
entrypoints, API specifications, infrastructure, documentation, and an
operational verification profile. Environment values are never emitted.

The same response also exposes `knowledgeGraph` under the public
`workspace-knowledge-graph.v1` contract. It is a provider-neutral,
proof-carrying view spanning source structure, packages, service and API
contracts, infrastructure, delivery pipelines, docs/ADRs, ownership, tests,
runtime resources, and safe configuration keys. Use the dedicated query and
change-overlay surfaces when the full document is larger than a human needs:

```bash
npx workspai workspace graph entities endpoint --json
npx workspai workspace graph search "authentication endpoint" --limit 12 --json
npx workspai workspace graph benchmark "authentication endpoint" --limit 12 --json
npx workspai workspace graph evidence "GET /users" --json
npx workspai workspace graph path frontend-api "GET /users" --json
npx workspai workspace graph emit --json > .workspai/reports/knowledge-baseline.json
npx workspai workspace graph overlay --from .workspai/reports/knowledge-baseline.json --json
```

The Model step persists the same projection to
`.workspai/reports/workspace-knowledge-graph.json`. It is registered in the
artifact contract registry and agent report index, required by the unified
runner's Model stage, referenced from `workspace-context-agent.json`, and
queryable through the read-mostly MCP server. This keeps CLI, CI, IDE and agent
consumers on one contract revision without injecting the full graph into every
agent prompt.

The relationship is one-way and contract-enforced: the Workspace Model owns the
canonical project boundary and compact dependency topology in
`workspace-model.json.projectTopology`; providers enrich
that inventory into the Knowledge Graph. The graph source kind and artifact
path are fixed to the model, its source hash identifies the stable structural
model projection, and persisted current-state consumers reject a mismatched
graph. `workspace contract graph` follows the same model-first build path; it
does not create a competing contract- or source-owned Knowledge Graph.

The deprecated `workspace-model.json.graph` field is a temporary v1
compatibility alias. It is emitted with the same value as `projectTopology`,
excluded as a duplicate from the canonical hash, and rejected when the two
fields diverge. New integrations must consume `projectTopology`.

The overlay follows
`workspace-knowledge-graph-change-overlay.v1`: graph revisions are identified
by content-derived fingerprints (timestamps do not create false changes), and
changed artifacts are portable proof paths rather than machine-local absolute
paths. Proof additions, removals, and content-hash changes are first-class
overlay changes, so a source edit is visible even when the entity and relation
shape remains stable. The builder performs one bounded inventory pass per project and reuses
in-memory content hashes; query indexes live only for the immutable graph
instance, so replacing the graph is the invalidation boundary.

Direction is explicit: legacy `edges` remain producer-to-consumer for backward
compatibility; `dependencyGraph.edges` use consumer-to-dependency semantics so
impact and blast-radius consumers share one canonical interpretation.

Workspai keeps the contract alive during `create project` and `workspace sync` without overwriting manual API/event/owner declarations.

On a freshly cloned or moved workspace, `workspace sync` also repairs the
machine-local global registry entry before discovering projects. The command is
therefore safe to use as the first reconciliation step after clone. For a
legacy workspace, run `workspace foundation ensure` once to add canonical
`.workspai-workspace` and `.workspai/*` foundation files while retaining legacy
metadata as read compatibility input.

## Portable workspace archives

```bash
npx workspai workspace export --output team-workspace.workspai-archive.zip
npx workspai workspace archive inspect team-workspace.workspai-archive.zip
npx workspai workspace archive verify team-workspace.workspai-archive.zip --strict
npx workspai workspace archive doctor team-workspace.workspai-archive.zip
npx workspai workspace hydrate team-workspace.workspai-archive.zip --output ./team-workspace
```

Export excludes dependency folders, build output, git history, logs, `.env`, and private keys by default. Use `--include-env` only for trusted internal handoffs. Hydrate accepts legacy `.rapidkit-workspace` and `.rapidkit/*` archive entries, but restores them as canonical `.workspai-workspace` and `.workspai/*` paths.

Archive export, verification, and hydrate stream file payloads instead of loading the workspace into memory. Exports use ZIP64, so multi-gigabyte workspaces and archives with more than 65,535 files are supported. Stored ZIP entries are the default; use `--archive-compression deflate` when transfer size matters more than export CPU time.

Remote archives are protected by secure defaults: 5 GB maximum download, 20 GB
maximum expanded payload, 200,000 entries, per-entry and compression-ratio
guards, and a five-minute timeout. Public HTTPS destinations are accepted;
loopback, private, link-local, and private redirect destinations are rejected.
Budgets can be lowered or explicitly raised for a controlled workflow:

```bash
npx workspai workspace hydrate https://example.test/team.zip \
  --output ./team-workspace \
  --max-download-size 2gb \
  --max-expanded-size 8gb \
  --download-timeout-ms 120000
```

For a reviewed archive served from a private development network, opt in with
`--allow-private-network`. Never use that flag for user-controlled URLs in CI
or agent services.

IDE, CI, and AI consumers can discover archive behavior from
`contracts/workspace-archive-capabilities.v1.json`. The embedded manifest and every successful
`--json` operation result are runtime-validated against
`contracts/workspace-archive-manifest.v1.json` and
`contracts/workspace-archive-operation-result.v1.json`.

## Workspace infrastructure (sidecar)

Discovery sources: Core module slugs, project `.env.example`, workspace contract env, and `.workspai/infra/overrides.json`.

```bash
cd my-workspace
npx workspai infra plan
npx workspai infra up
npx workspai infra status --strict
npx workspai infra down
```

Artifacts:

- `.workspai/infra/docker-compose.yml`
- `.workspai/reports/infra-plan.json`
- `.workspai/infra/.env.example`

## Command ownership

| Command family                                              | Owner                  | Notes                                              |
| ----------------------------------------------------------- | ---------------------- | -------------------------------------------------- |
| `create workspace`, `workspace`, `cache`, `mirror`, `infra` | Workspai CLI           | Platform orchestration                             |
| `init`                                                      | Wrapper orchestrated   | Project init; full-init alias at workspace root    |
| `dev`, `test`, `build`, `start`                             | Runtime aware          | Delegates to active project/runtime                |
| `readiness`                                                 | Wrapper release gate   | Env + doctor + analyze + verify + dependency gates |
| `pipeline`                                                  | Wrapper orchestrator   | sync → doctor → analyze → readiness → autopilot    |
| `autopilot release`                                         | Wrapper orchestrator   | End-to-end release gate evidence                   |
| `import`                                                    | Workspace ingestion    | Rollback-safe sync                                 |
| `adopt`                                                     | Workspace adoption     | In-place linking + registry sync                   |
| `workspace model/context/diff/impact/verify`                | Workspace intelligence | Model, context packs, blast radius                 |
| `workspace intelligence run`                                | Workspace intelligence | Canonical contract-backed chain and strict gate    |
| `snapshot`                                                  | Workspace recovery     | Metadata or full snapshots                         |
| `project archive/restore/delete`                            | Project lifecycle      | Safe delete with confirmation                      |
| `doctor` / `doctor workspace` / `doctor project`            | Wrapper health         | Host, workspace, and project scopes                |
| `workspace run`                                             | Workspace orchestrator | Fleet stage execution                              |
| `infra`                                                     | Workspace sidecar      | Contract-driven local dependencies                 |

The unified intelligence runner keeps `sync` and baseline resolution in a
separate two-entry execution envelope and emits exactly 11 canonical stages.
Exit `2` means the evidence gate blocked readiness after successful execution;
exit `1` means a hard runtime failure. Read the complete
[Unified Workspace Intelligence Runner contract](./workspace-intelligence-runner.md)
before consuming its report from CI, IDE, or agent integrations.

## Verification evidence freshness

`workspace verify` treats evidence as release-gate material, not just as a file
presence check. Required project evidence must match the affected project in
`workspace-run-last.json`, and evidence generated before the current impact
report is treated as stale and blocking. Re-run the recommended commands from
`workspace impact --json` before using `workspace verify --strict` in CI.

For doctor CI exit codes and JSON evidence fields, see [doctor-command.md](./doctor-command.md).

## See also

- [Documentation index](./README.md)
- [commands-reference.md](./commands-reference.md)
- [doctor-command.md](./doctor-command.md)
