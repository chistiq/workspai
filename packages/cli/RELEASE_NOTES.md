# Release Notes

> **Historical archive:** `workspai` is the current package and command, with
> `wspai` as an optional alias. Older entries intentionally preserve historical
> `rapidkit` commands and `.rapidkit` paths. Use the [CLI README](./README.md) and
> [Command Reference](./docs/commands-reference.md) for current usage.

## Latest Release: v0.52.2 (August 2, 2026)

### Guarded Dependency Resolution

This patch prevents Doctor and Studio from treating a downgrade—or the version
already installed—as an actionable dependency fix. When no direct automatic
fix exists, Doctor now preserves structured, guarded resolution paths instead
of prematurely declaring that only a breaking choice remains.

**What's Improved:**

- **Forward-only npm candidates**
  - Exact candidate versions are compared with installed versions from the
    project lockfile.
  - Downgrade-only and already-installed candidates are rejected before they
    reach Studio.

- **One stable remediation choice**
  - Duplicate direct and transitive audit records converge on one
    package/version candidate.
  - Conflicting records preserve the most conservative breaking-change risk.

- **Structured source-resolution evidence**
  - Direct and transitive findings retain owning packages, advisory identity,
    vulnerable ranges, bounded safe constraints, and allowed strategies.
  - Python, Go, Rust, PHP, Ruby, .NET, JVM, Elixir, Deno, Bun, and native audit
    evidence follows the same guarded contract without npm assumptions.

- **Truthful repair behavior**
  - A missing direct fix delegates to a reconcile, audit, test, build, and
    canonical verification transaction before a breaking decision is requested.

**Breaking changes:** None.

**Verification:**

- Dependency-audit tests cover downgrade-only, already-installed, duplicated,
  transitive-owner, multi-ecosystem, compatible, mixed, unavailable, and clean
  outcomes.
- Version alignment, release-document validation, TypeScript, and formatting
  checks passed.

**Upgrade:**

```bash
npm install -g workspai@0.52.2
workspai --version
workspai workspace sync --json
workspai doctor workspace --plan --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.52.2/packages/cli/releases/RELEASE_NOTES_v0.52.2.md)

---

## Previous Release: v0.52.1 (August 2, 2026)

### Safer Dependency Repair Decisions

This patch makes Doctor and its consumers tell the difference between a safe
dependency repair and a path that requires a breaking change or human choice.
Workspai now keeps those decisions visible instead of presenting them as an
automatic fix or dropping them from the remediation plan.

**What's Improved:**

- **Truthful dependency classification**
  - npm audit results are normalized as compatible, mixed, breaking-only,
    unavailable, or unknown repair paths.
  - Boolean and object-shaped `fixAvailable` payloads are both handled.

- **Review stays part of the plan**
  - Breaking-only repairs become explicit project-scoped `manual-review`
    steps with risk and transaction context.
  - Cached Doctor evidence cannot retain a stale automatic repair decision.

- **Stronger consumer contracts**
  - Doctor project and workspace evidence expose the same normalized repair
    disposition and candidates to CLI, CI, IDE, and agent consumers.

**Breaking changes:** None.

**Verification:**

- Full CLI suite: 2,257 tests passed across 210 test files; 8 tests remain
  explicitly skipped.
- Doctor dependency, remediation, canary, schema, and contract-parity suites
  passed.

**Upgrade:**

```bash
npm install -g workspai@0.52.1
workspai --version
workspai workspace sync --json
workspai doctor workspace --plan --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.52.1/packages/cli/releases/RELEASE_NOTES_v0.52.1.md)

---

## Previous Release: v0.52.0 (July 31, 2026)

### Verified Engineering Goals and Transaction-Safe Repair

This minor release lets Workspai turn release-readiness, dependency-security,
and test-coverage requests into durable goals with measurable success criteria.
It also prevents dependency repairs from being declared complete until the
manifest, lockfile, audit, tests, build, and canonical workspace verification
all agree.

**What's New:**

- **Durable engineering goals**
  - Added `workspace goal plan|status|verify` for release readiness, dependency
    security, and coverage targets.
  - Goals preserve scope, safety constraints, baselines, progress, evidence,
    and the final governed verdict across CLI, CI, IDE, and agent sessions.

- **Transaction-safe dependency repair**
  - Doctor and remediation plans now describe project-level dependency work as
    an ordered reconcile, audit, test, build, and verification transaction.
  - A manifest edit alone is progress, not a completed repair.

- **One evidence contract**
  - Verified-goal paths and schemas are bound to the canonical Workspace
    Intelligence artifact registry and published consumer contracts.
  - Agent handoff carries the active goal and dependency transaction without
    creating a competing source of truth.

- **Release announcements from versioned notes**
  - Added validated release metadata and a shared GitHub/Discord release
    document pipeline.
  - Product, tag, upgrade command, limits, URLs, and safe mention behavior are
    checked before an announcement can be sent.

**Breaking changes:** None.

**Verification:**

- Full CLI suite: 2,248 tests passed across 209 test files; 8 tests remain
  explicitly skipped.
- Workspace Intelligence runtime conformance passed 11 stages and 16 governed
  artifacts; all 12 adversarial groups passed.
- TypeScript, ESLint, format, documentation, contracts, package size, alias,
  CLI/extension parity, and security checks passed.
- `npm audit --audit-level=moderate` reported zero vulnerabilities.

**Upgrade:**

```bash
npm install -g workspai@0.52.0
workspai --version
workspai workspace sync --json
workspai workspace intelligence run --for-agent generic --strict --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.52.0/packages/cli/releases/RELEASE_NOTES_v0.52.0.md)

---

## Previous Release: v0.51.0 (July 28, 2026)

### Trustworthy Graph Retrieval and Clearer Workspace Onboarding

This minor release makes graph quality more honest, bounded natural-language
retrieval more relevant, and workspace creation easier to understand. It also
turns official-generator smoke coverage into a contract-driven matrix and
corrects Doctor taxonomy for desktop and extension projects.

**What's New:**

- **Truthful graph quality**
  - Providers distinguish applicable evidence, partial extraction,
    non-applicable skips, and execution failures.
  - Applicable-but-empty sources, bounded scans, unresolved relationships, and
    binding gaps contribute explicit unknowns.
  - Nested runtime candidates improve polyglot monorepo understanding.

- **Better bounded search**
  - Deterministic stopword filtering and inverse-document-frequency weighting
    keep rare project terms above conversational filler.
  - Duplicated logical interfaces are reconciled without discarding their
    source-file proofs.

- **A workspace that explains itself**
  - Creation ends with one compact receipt for profile, runtime foundation,
    synchronized intelligence surfaces, and next actions.
  - A managed `README.md` section stays aligned with the workspace profile,
    project count, canonical contract-backed loop, and consumer entry points
    while preserving user content.

- **Stronger official generators and Doctor**
  - Official generator smoke is derived from the canonical capability contract
    and validates artifacts, metadata, registry, build, and Doctor stages.
  - Electron remains `desktop`; VS Code extensions remain `extension`.
  - Typed repairs now use `workspai:` while legacy durable repair tokens remain
    readable, and duplicate Quick Fix commands are removed.

**Breaking changes:** None.

**Verification:**

- Graph, creation, Doctor, official-generator, contract, and documentation
  suites cover the new boundaries.
- A real 10-project polyglot workspace exercised Model, bounded Graph
  search/evidence, Doctor, lifecycle sync, and the strict intelligence chain.
- TypeScript, lint, format, package, cross-platform, and complete CLI checks
  remain release gates.

**Upgrade:**

```bash
npm install -g workspai@0.51.0
workspai --version
workspai workspace sync --json
workspai workspace intelligence run --for-agent generic --strict --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.51.0/packages/cli/releases/RELEASE_NOTES_v0.51.0.md)

---

## Previous Release: v0.50.0 (July 27, 2026)

### Project-Native Workspace Intelligence

This minor release makes every registered project a reliable entry point into
its canonical workspace. Workspai now keeps machine-local resolution private,
publishes a portable bounded project lens for humans and agents, connects
Doctor findings to current graph evidence, and keeps downstream intelligence
artifacts synchronized after project lifecycle changes.

**What's New:**

- **Work from an adopted or created project**
  - Added a validated, gitignored machine-local workspace binding.
  - Added portable project grounding and
    `.workspai/reports/project-context-agent.json`.
  - Workspace-aware commands launched from a project resolve the governing
    workspace automatically.

- **Deeper Doctor and Graph integration**
  - Doctor reports evidence-backed project roots, structural paths, impact
    candidates, proofs, and verification targets.
  - Diagnosis distinguishes structural reachability from proven runtime
    causality and reports stale, missing, or mismatched graph evidence.
  - Model and Graph artifacts remain an atomic, hash-bound set with the Model
    as the canonical source of truth.

- **Clearer creation and ingestion**
  - Interactive Create can scaffold new software or ingest a local path, Git
    repository, project archive, or workspace archive through versioned plans.
  - The picker groups kits as Backend, Frontend, Desktop, and Extension.
  - Added Rust/Axum, Tauri, Electron Forge, VS Code Extension, and Laravel
    flows with latest-stable upstream policy and recorded resolution evidence.
  - Turning the current folder into a workspace is foundation-only and does not
    install Python or Poetry.

- **Governed project coverage and archives**
  - Added `project coverage --run --target <percent> --strict --json`.
  - Added explicit workspace archive capability, manifest, verification,
    diagnosis, import, and hydration contracts.
  - Successful create/adopt/import/connect/sync flows refresh the Model, Graph,
    project lenses, report index, grounding, and supported agent surfaces.

- **Focused Help and documentation**
  - Root Help now explains the shortest lifecycle and canonical
    Model-to-Graph architecture instead of repeating the complete catalog.
  - Command-specific Help stays scoped, while `workspai commands --json`
    provides exhaustive machine-readable discovery.
  - Main READMEs explain project-native usage and the new capabilities in plain
    language without moving detailed reference material into the quickstart.

**Breaking changes:** None.

**Verification:**

- Full CLI suite: 2,218 tests passed across 205 test files; 8 tests remain
  explicitly skipped.
- New suites cover project entry/resolution, portable grounding, graph-aware
  Doctor, ingestion, archives, categorized kits, latest-stable policy,
  project coverage, and Model/Graph artifact atomicity.
- Contract, artifact, documentation, TypeScript, lint, format, package, and
  cross-platform invariants remain part of release validation.
- Enterprise prepack creation and registry smoke runs in an isolated home and
  cannot alter the publisher's real Workspai registry.

**Upgrade:**

```bash
npm install -g workspai@0.50.0
workspai --version
workspai workspace intelligence run --for-agent generic --strict --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.50.0/packages/cli/releases/RELEASE_NOTES_v0.50.0.md)

---

## Previous Release: v0.49.0 (July 25, 2026)

### Live, Contract-Backed Workspace Graph Updates

This minor release gives IDEs and other long-running consumers a stable way to
follow Workspace Knowledge Graph changes as they happen. It also makes
existing-project onboarding shorter, completes the repository's move to
Chistiq, and prevents broken GitHub Release links from being published again.

**What's New:**

- **Revision-safe graph streaming**
  - Added the public `workspace-graph-stream.v1` event contract.
  - Added `workspace watch --graph-stream --json` for an initial graph snapshot
    followed by bounded entity, relation, proof, provider, quality, and
    diagnostic deltas.
  - Every delta carries base and current revisions plus model and graph hashes,
    allowing consumers to detect gaps and request a complete resynchronization.

- **One model, live derived views**
  - The canonical Workspace Model remains the source of truth.
  - The watch engine passes its authoritative in-memory model to the
    graph-stream publisher; the publisher derives the matching graph revision
    without creating a competing model or persistence boundary.
  - Runtime, published-contract, extension-compatibility, and artifact
    inventories expose the same stream capability.

- **Faster existing-project onboarding**
  - Running `workspai adopt .` from a project creates or reuses the minimal
    default workspace when needed.
  - The command prints the exact workspace shell step and the canonical
    intelligence command to run next.
  - Documentation now starts with this direct path and uses `generic` for
    vendor-neutral agent context.

- **Chistiq ownership and release integrity**
  - Repository, issue, discussion, contribution, package, and image references
    now point to Chistiq.
  - Added a repository-wide brand contract.
  - Added GitHub Release body generation from the exact versioned source file.
  - Release validation now rejects relative, noncanonical, tag-mismatched, or
    missing-current-version links before publishing.

**Breaking changes:** None.

**Verification:**

- Full CLI suite: 2,088 tests passed across 194 test files; 8 tests remain
  explicitly skipped.
- Contract tests validate all graph-stream event families and revision rules.
- Publisher tests validate snapshots, deterministic hash-linked deltas, and
  stable proof comparison.
- Release tests validate tag-bound GitHub bodies and fail-closed aggregate
  links.
- Mirrored command and contract inventories expose the same graph-stream
  capability to CLI, CI, IDE, and extension consumers.

**Upgrade:**

```bash
npm install -g workspai@0.49.0
workspai --version
workspai workspace watch --graph-stream --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.49.0/packages/cli/releases/RELEASE_NOTES_v0.49.0.md)

---

## Previous Release: v0.48.0 (July 22, 2026)

### Measurable Workspace Intelligence and Portable Graph Interchange

This minor release makes Workspace Intelligence outcomes easier to measure,
exchange, and consume without weakening Workspai's evidence boundaries. Teams
can record retrieval and model-usage observations, compare governed evaluation
runs, and export the model-bound Knowledge Graph to standard ecosystem formats.

**What's New:**

- **Governed evaluation workflow**
  - Added `workspace eval init`, `record`, `status`, `report`, and `compare`.
  - Added versioned contracts for evaluation state, comparisons, and
    model-usage observations.
  - Kept token and payload claims scoped to recorded evidence instead of
    presenting fixture results as universal model savings.

- **Portable and queryable graph**
  - Added JSON-LD, GraphML, and GEXF exports alongside bounded search, typed
    entities, evidence lookup, path traversal, benchmarks, and change overlays.
  - Bound every representation to the canonical Workspace Model revision.
  - Published Graph and Evaluation capabilities through runtime, architecture,
    artifact, MCP, IDE, CI, and agent-facing contracts.

- **Documentation and contract integrity**
  - Reworked the root and CLI documentation around user goals, the canonical
    lifecycle, generated evidence, and consumer workflows.
  - Added a documentation content contract and stronger automated drift checks.
  - Clarified that the Model is the system source of truth and Graph is its
    evidence-backed, deterministic derived representation.

- **Runtime correctness**
  - Fixed validation of the documented `graph search --limit` and
    `graph overlay --from` options.
  - Made `--skip-install` avoid Maven, Go, and .NET host-tool probes so offline
    scaffolds remain deterministic across Linux, macOS, and Windows.
  - Pinned registry paths for the lifetime of each locked transaction so
    concurrent Windows workers cannot redirect or lose a registration.
  - Replaced clock-derived demo-kit fixture paths with atomic temporary
    directories and isolated template assertions from Git setup, removing a
    Windows coverage race while keeping a bounded timeout for the 28-file case.
  - Completed the machine-readable Graph command and Evaluation artifact
    inventories.

**Breaking changes:** None.

**Verification:**

- 2,076 CLI tests passed across 191 test files; 8 tests remain explicitly
  skipped.
- TypeScript, ESLint, documentation validation, README command smoke, generated
  contract checks, shared-contract parity, and diff hygiene passed.
- A real isolated workspace exercised Model/Graph generation, bounded search,
  all three portable graph exports, Evaluation init/status/report, and the
  strict unified Workspace Intelligence runner.

**Upgrade:**

```bash
npm install -g workspai@0.48.0
workspai workspace intelligence run --for-agent generic --strict --json
workspai workspace graph jsonld --output .workspai/reports/workspace-graph.jsonld
workspai workspace eval status --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.48.0/packages/cli/releases/RELEASE_NOTES_v0.48.0.md)

---

## Previous Release: v0.47.0 (July 21, 2026)

### Evidence-Backed Workspace Knowledge Graph

This minor release makes the current Workspace Model directly useful for
proof-backed retrieval across projects, code, packages, APIs, infrastructure,
delivery, documentation, decisions, tests, and ownership. The graph is derived
deterministically from the canonical model and bound to its exact SHA-256
revision.

**What's New:**

- **Queryable workspace knowledge**
  - Added bounded graph search, typed entity/evidence/path queries, complete
    portable emission, change/PR overlays, and retrieval payload benchmarks.
  - Added stable identities, proof paths, derivation/trust metadata, quality
    diagnostics, secret filtering, and deterministic query indexes.

- **One graph revision for every consumer**
  - The Model stage now publishes `workspace-model.json` and
    `workspace-knowledge-graph.json` atomically.
  - CLI, unified runner, context, Agent Sync, MCP, IDE capability discovery, CI,
    and workspace contract graph output consume the same model-bound revision.
  - Agents now start with bounded search and proof traversal instead of loading
    the complete graph into every prompt.

- **Versioned public contracts**
  - Added Knowledge Graph, change overlay, bounded search, and token-efficiency
    schemas.
  - Expanded the published catalog, artifact registry, runtime command surface,
    architecture contract, and semantic conformance gates.

- **Clearer user documentation**
  - Added a two-minute graph guide, reproducible benchmark methodology,
    Agent/IDE/MCP workflow, and plain-language glossary.
  - Separated deterministic Workspace Intelligence from the optional embedding
    module recommender and removed unqualified AI score/cost claims.

- **Security and canonical paths**
  - Updated vulnerable `brace-expansion` and `fast-uri` dependencies to their
    patched releases; the final online npm audit reports zero vulnerabilities.
  - Canonicalized bridged project metadata into `.workspai` while retaining
    legacy read compatibility.

**Breaking changes:** None.

**Verification:**

- 2,062 CLI tests passed with 8 explicit skips.
- All 11 runtime-conformance stages and required artifacts passed.
- Documentation links, examples, drift guard, README smoke, and live command
  surface parity passed.
- The measured 16-project fixture produced 1,738 entities, 2,244 relations, and
  2,106 portable proofs; fixture statistics are not universal product claims.

**Upgrade:**

```bash
npm install -g workspai@0.47.0
workspai workspace intelligence run --for-agent generic --strict --json
workspai workspace graph search "authentication endpoint" --limit 12 --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.47.0/packages/cli/releases/RELEASE_NOTES_v0.47.0.md)

---

## Previous Release: v0.46.0 (July 18, 2026)

### Contract-Backed Unified Workspace Intelligence Runner

This minor release turns the complete Workspace Intelligence lifecycle into a
single governed execution surface. Runtime behavior, ordered stage evidence,
artifacts, contracts, CLI help, CI guidance, and agent grounding now share the
same canonical source of truth.

**What's New:**

- **Unified intelligence execution**
  - Added `workspace intelligence run` for the mandatory sync-through-
    remediation lifecycle.
  - Added deterministic per-stage status, command, timing, artifact, and failure
    evidence for humans, CI systems, IDEs, portals, and agents.

- **Semantic runner contract**
  - Added the versioned `workspai-workspace-intelligence-run-v1` report contract.
  - Linked the report through the runtime registry, artifact registry, published
    contract catalog, and producer-command inventory.
  - Added semantic enforcement for canonical stage ordering and blocking
    outcomes in addition to JSON Schema validation.

- **Transactional project lifecycle**
  - Added rollback protection for create, adopt, import, register, and mirror
    operations.
  - Hardened metadata path safety, registry consistency, archives, platform
    probes, runtime adapters, and polyglot project generators.
  - Added Windows-safe lifecycle journal durability handling and concurrent
    journal initialization recovery without weakening atomic writes.

- **Release-gate integrity**
  - Repaired the npm tree used by CycloneDX SBOM generation so Nunjucks, Tsup,
    ESLint, `chokidar`, and `minimatch` resolve without invalid nodes.
  - Preserved the 80% aggregate coverage target and made test, lint, and audit
    collection fail closed.
  - Expanded the suite to 2,042 passing tests, including targeted contract,
    Workspace Intelligence, Doctor, recovery, archive, runtime adapter, and
    platform-boundary coverage.
  - Verified 81.66% statement, 71.27% branch, 91.95% function, and 82.38% line
    coverage; the official metrics gate reports 82%.
  - Made `test:coverage` publish a machine-readable Vitest result for `metrics`,
    removing the duplicate suite execution and fragile console parsing that
    could report a passing run as invalid.
  - Hardened Linux, macOS, and Windows parity for project-local Python venvs,
    pip metadata, Doctor PowerShell remediation guards, Go adapter Makefile
    routing, npm runner paths and environment keys, and filesystem mode tests.

- **Documentation and runtime alignment**
  - Aligned CLI documentation, help, contracts, artifact catalogs, CI examples,
    and agent-grounding material around the mandatory lifecycle.
  - Removed accidental Python-version pins from config examples. Python 3.10
    remains the supported minimum, with automatic newer-version detection and
    optional explicit pins for reproducible CI.

**Breaking changes:** None.

**Verification:**

- Monorepo checks and CLI build/test gates.
- Generated/shared contract drift and documentation validation.
- Unified runner contract and CLI-chain suites.
- Lifecycle transaction, frontend execution, Python-engine state, registry,
  mirror, archive, runtime adapter, and package-publish suites.
- 2,042 tests passed, 8 tests were explicitly skipped, ESLint reported zero
  errors or warnings, and npm audit reported zero vulnerabilities.

**Upgrade:**

```bash
npm install -g workspai@0.46.0
workspai workspace intelligence run --for-agent generic --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.46.0/packages/cli/releases/RELEASE_NOTES_v0.46.0.md)

---

## Previous Release: v0.45.0 (July 15, 2026)

### Contract-Backed Live Command Inventory and Release-Gate Consistency

This minor release makes the installed CLI command tree a verifiable source of
truth. Command discovery, published contracts, artifact producers, help output,
documentation, and Workspace Intelligence runtime behavior are now checked
against the same live inventory.

**What's New:**

- **Live command inventory**
  - Added `workspai-cli-runtime-command-inventory-v1`, generated from the live
    Commander tree and exposed by `workspai commands --json`.
  - Added drift gates for all registered and declared top-level/scoped command
    paths, including manual workspace dispatch and Core-backed ownership.

- **Command, artifact, and contract linkage**
  - Runtime command-surface contracts now include command documentation,
    package ownership, artifact schemas, and producer command mappings.
  - Command documentation publishes canonical argv and structured stdin,
    output-media, and exit-semantics metadata where the command requires it.
  - Workspace feedback is registered as a producer of the governed
    Workspace Intelligence history artifact.
  - Shared-contract generation and enterprise prepack now verify and publish the
    runtime inventory snapshot.

- **Workspace Intelligence usability**
  - `workspace --help` now enumerates every action family instead of hiding the
    manual dispatcher surface.
  - Feedback documentation now includes the required stdin JSON payload and
    history artifact behavior.
  - DOT and Mermaid graph renderers are explicitly documented as raw-text
    outputs; structured consumers use graph emit/explain JSON.
  - Contract verification, graph, watch, feedback, and MCP are now classified
    consistently as Workspace Intelligence capabilities for portal and IDE use.

- **Gate correctness**
  - Warning-only pipelines exit successfully by default and become blocking
    when `--strict` is supplied.
  - Failed pipeline stages remain blocking in both modes.

**Breaking changes:** None.

**Verification:**

- 45/45 installed command paths passed help smoke tests.
- Three real workspaces completed the Workspace Intelligence and governance
  loops; 66 generated artifact/schema validations passed.
- Workspace archives passed export, inspect, verify, doctor, hydrate, and
  project archive/restore checksum round trips.
- 1,776 tests were covered across two shards; 11 runtime steps, 15 artifacts,
  and 12 adversarial groups passed.
- Windows registry invariants passed and npm audit reported zero vulnerabilities.

**Upgrade:**

```bash
npm install -g workspai@0.45.0
npx wspai commands --json
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.45.0/packages/cli/releases/RELEASE_NOTES_v0.45.0.md)

---

## Previous Release: v0.44.0 (July 14, 2026)

### Workspace Intelligence Contract Architecture and Stable CLI Gates

This minor release hardens Workspai's Workspace Intelligence foundation:
canonical contracts, command discovery, runtime conformance, archive safety,
agent grounding, and CLI gate behavior now align around the same source of
truth.

**What's New:**

- **Workspace Intelligence contracts**
  - Added first-class architecture and chain contracts for model, snapshot,
    diff, impact, contract verify, readiness, verify, context, agent sync, and
    explainability.
  - Published generated contracts for runtime command surfaces, command
    capabilities, operation result envelopes, version discovery, and contract
    catalogs.

- **Runtime and artifact conformance**
  - Added runtime conformance and adversarial validation checks for Workspace
    Intelligence command/artifact alignment.
  - Expanded generated schema coverage across autopilot, doctor, infra,
    product, workspace list/sync/watch/cache, archive, and Workspace
    Intelligence evidence.

- **Archive and recovery hardening**
  - Added ZIP64/streaming archive capability contracts and stable archive
    operation result schemas.
  - Hardened snapshot, archive inspect, verify, doctor, hydrate, and failure
    envelopes for large workspace workflows.

- **CLI gate stability**
  - `readiness` now supports `--workspace <path>`.
  - `pipeline --no-agent-sync` now correctly skips agent grounding writes.
  - `workspace impact` and `workspace verify` now accept
    `--include-paths`, `--include-evidence`, and `--scan-depth <count>`.
  - Windows artifact writes now tolerate runner-level `fsync` `EPERM` so
    workspace init, contract sync, and evidence writes do not fail after the
    payload has already been written.

- **Package alignment**
  - Bumped the monorepo root, `workspai`, and `wspai` to `0.44.0`.
  - Updated the `wspai` alias dependency to `workspai@0.44.0`.

**Breaking changes:** None.

**Verification:**

- `corepack npm run check`
- `corepack npm --workspace workspai run contracts:check`
- `corepack npm --workspace workspai run check:workspace-intelligence-runtime`
- `corepack npm --workspace workspai run check:workspace-intelligence-adversarial`
- `corepack npm --workspace workspai run docs:validate`
- `corepack npm test`
- Real workspace smoke tests across `my-new-wsp`, `my-works`, `my-workspace`,
  and `my-workspoly`

**Upgrade:**

```bash
npm install -g workspai@0.44.0
npx wspai --help
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.44.0/packages/cli/releases/RELEASE_NOTES_v0.44.0.md)

---

## Previous Release: v0.43.1 (July 9, 2026)

### Workspai Debug Alias, Doctor Repair, and Workspace Intelligence Chain Alignment

This patch release tightens the Workspai monorepo package surface after the
initial `workspai`/`wspai` publish, and hardens the Doctor and Workspace
Intelligence chain before the first stable Workspai CLI release.

**What's New:**

- **Workspai-native debug environment**
  - Added `WORKSPAI_DEBUG_ARGS=1` for CLI argument and bridge diagnostics.
  - Preserved the legacy `RAPIDKIT_NPM_DEBUG_ARGS=1` fallback for existing local
    debugging workflows.

- **Release consistency**
  - Keeps the private monorepo version, `workspai` package version, and `wspai`
    alias package version aligned on `0.43.1`.
  - Keeps the `wspai` package dependency pinned to the matching `workspai`
    version.

- **Doctor and repair artifact integrity**
  - `doctor project --fix` now writes project-scope fix evidence under the
    project `.workspai/reports` directory instead of overwriting workspace-level
    Doctor fix evidence.
  - Doctor fix/apply flows now return failing exit codes when a fix attempt
    remains blocked or unresolved, including local-profile runs.
  - Python dependency sync repair is guarded by default and emits deterministic
    guidance unless explicit dependency-install opt-in is provided.

- **Workspace Intelligence chain validation**
  - Verified the full workspace chain across minimal and polyglot test
    workspaces: sync, contract verify, model, context, agent sync, graph, diff,
    impact, verify, trace, explain, run, share, export, and feedback history.
  - Confirmed `wspai` delegates to the canonical `workspai` CLI command surface.
  - Updated workspace E2E workflows to locate managed workspaces under
    `~/.workspai/workspaces` while retaining legacy RapidKit fallbacks.
  - Improved Workspace Run diagnostics so Python wrapper failures such as
    `No module named pytest` are classified as setup failures instead of
    `unknown`.

**Breaking changes:** None.

**Verification:**

- `corepack npm --workspace workspai run typecheck`
- `corepack npm --workspace workspai run lint`
- `corepack npm --workspace workspai run format:check`
- `corepack npm --workspace workspai run build`
- `corepack npm --workspace workspai run smoke:enterprise-package`
- `corepack npm --workspace wspai run smoke`
- `corepack npm --workspace workspai run test -- src/__tests__/index.test.ts src/__tests__/package-publish-contract.test.ts`
- `corepack npm --workspace workspai run test`
- `corepack npm --workspace workspai run test -- src/__tests__/doctor.test.ts`
- `corepack npm --workspace workspai run test -- src/__tests__/doctor-canary-matrix.test.ts`
- `corepack npm --workspace workspai run test -- src/__tests__/workspace-run.test.ts`

**Upgrade:**

```bash
npm install -g workspai@0.43.1
npx wspai --help
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.43.1/packages/cli/releases/RELEASE_NOTES_v0.43.1.md)

---

## Previous Release: v0.43.0 (July 7, 2026)

### Workspai Monorepo and Short Alias Package

This release publishes Workspai from the new monorepo package layout and adds
the short `wspai` npm alias package for `npx wspai ...` workflows.

**What's New:**

- **Canonical Workspai CLI package**
  - `workspai` remains the primary npm package and command surface.
  - The CLI package now lives under `packages/cli` in the Workspai monorepo.

- **Short npm alias**
  - `wspai` is a tiny npm package that delegates to the matching `workspai`
    version.
  - Users can run either `npx workspai ...` or `npx wspai ...`.

- **Release safety**
  - Release scripts and the manual GitHub workflow now verify that `workspai`
    and `wspai` versions stay aligned before publishing.
  - The unavailable `wai` alias path was removed to avoid command-name
    ambiguity.

**Breaking changes:** None.

**Verification:**

- `corepack npm --workspace workspai test -- src/__tests__/package-publish-contract.test.ts`
- `corepack npm run smoke:alias-package`
- `node scripts/enterprise-package-smoke.mjs`
- `corepack npm publish --dry-run --access public --workspace wspai`

**Upgrade:**

```bash
npm install -g workspai@0.43.0
npx wspai --help
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.43.0.md)

---

## Previous Release: v0.42.0 (July 6, 2026)

### Optional Python Engine and Profile Compatibility

This minor release for Workspai CLI separates Workspace Intelligence from the workspace-local
Python engine. Teams can now create governed workspaces first, model/adopt/import
projects, and install the local Python engine only when a RapidKit
module-enabled kit actually needs it.

**What's New:**

- **Optional Python engine for Python-aware profiles**
  - `create workspace --skip-python-engine` keeps `python-only`, `polyglot`, and
    `enterprise` workspaces available for Workspace Intelligence without
    installing `rapidkit-core` immediately.
  - Skipped workspaces record explicit `python_core.status = skipped` metadata
    in workspace manifests, markers, and toolchain evidence.
  - Local launchers now explain the skip state and point users to npm-owned
    workspace commands until the Python engine is intentionally installed.

- **Python-free workspace integrity**
  - `minimal`, `java-only`, `node-only`, `go-only`, and `dotnet-only` workspaces
    no longer create root-level `pyproject.toml`, `poetry.toml`,
    `.python-version`, or `.venv` artifacts.
  - Empty skipped workspaces and arbitrary adopted/imported Python projects keep
    the Python engine skipped unless a RapidKit module-enabled kit is present.

- **Module-enabled kit gate**
  - RapidKit module commands are guaranteed only for RapidKit-owned
    module-enabled kits: `fastapi.standard`, `fastapi.ddd`, and
    `nestjs.standard`.
  - Adopted/imported projects can still be modeled, governed, verified, and
    surfaced in Workspace Intelligence even when module mutation is disabled.

- **Profile/runtime compatibility**
  - `create project`, `import`, `adopt`, and `bootstrap` compliance now share a
    consistent profile compatibility policy.
  - Default mode warns and recommends profile realignment; strict mode blocks
    mismatched runtime additions before registration.
  - Broader language/runtime signals such as Rust, C, and C++ are counted in the
    workspace runtime mix even when RapidKit does not own a native scaffold.

**Breaking changes:** None.

**Verification:**

- `npm exec -- vitest run src/__tests__/e2e.test.ts src/__tests__/create-internal.test.ts src/__tests__/workspace-python-engine-install-gate.test.ts`
- `npm run typecheck -- --pretty false`
- `npm run lint`
- `npm run build`
- `npm exec -- vitest run`

**Upgrade:**

```bash
npm install -g workspai@0.42.0
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.42.0.md)

---

## Previous Release: v0.41.5 (July 4, 2026)

### Workspace Creation Location and Governance Gate Fixes

This patch release tightens workspace creation, Doctor workspace discovery, and
Workspace Verify exit-code behavior for Workspai, CI, and CLI users.

**What's New:**

- **Workspace creation location integrity**
  - `create workspace` now respects an explicitly selected target parent
    (`Current directory`, `--here`, or `--output <parent-dir>`) when checking
    duplicate workspace names.
  - A workspace with the same name in the managed home no longer blocks creating
    another workspace in a different explicit parent directory.
  - Creating into an already-existing target path is still blocked.

- **Doctor empty workspace handling**
  - `doctor workspace` no longer treats an empty workspace shell as a project
    just because the workspace root contains toolchain files such as
    `pyproject.toml` or `poetry.toml`.
  - Empty workspace shells now report zero discovered projects and a workspace
    discovery warning instead of misleading project health.

- **Workspace Verify exit codes**
  - Default-mode `needs-attention` verification now reports a passing gate with
    exit code `0`.
  - Strict mode still fails non-ready verification as expected.

**Breaking changes:** None.

**Verification:**

- `npm exec -- vitest run src/__tests__/workspace-create-location.test.ts`
- `npm run typecheck -- --pretty false`
- `npm run build`

**Upgrade:**

```bash
npm install -g rapidkit@0.41.5
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.41.5.md)

---

## Previous Release: v0.41.4 (July 2, 2026)

### Cross-Artifact Studio Remediation Plan

This patch release adds a workspace-level repair contract for Workspai Studio and
agent consumers. Instead of scraping individual governance cards, npm can now emit
one ordered remediation plan across Bootstrap, Doctor, Analyze, Readiness, Pipeline,
Workspace Run, and Workspace Verify evidence.

**What's New:**

- **`workspace remediation-plan`**
  - New command: `rapidkit workspace remediation-plan [--json] [--write] [--ci] [--include-paths]`
  - Scans `.rapidkit/reports/` and builds a Studio-ready action list with risk,
    approval state, verify commands, and deterministic file operations where safe.
  - `--ci` produces stricter verify-oriented command plans where supported.

- **`artifact-remediation-plan.v1`**
  - New schema at `contracts/artifact-remediation-plan.v1.json`
  - Persists to `.rapidkit/reports/artifact-remediation-plan-last-run.json`
  - Bridges Doctor-specific plans with cross-card governance repair for dashboard
    and Studio handoff consumers.

- **Published contract surface**
  - Added to `runtime-command-surface.v1`, `extension-cli-compatibility.v1`,
    `agent-customization-pack.v1`, workspace model evidence refs, and agent-sync
    catalog entries.
  - Operational skills now direct agents to read the artifact remediation plan
    before per-card improvisation.

**Breaking changes:** None.

**Verification:**

- `npm run typecheck`
- `npm run validate:contracts`
- `npm test`
- `npm run smoke:enterprise-package`
- `npm run prepack`

**Upgrade:**

```bash
npm install -g rapidkit@0.41.4
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.41.4.md)

---

## Previous Release: v0.41.3 (July 2, 2026)

### Enterprise Doctor Evidence and Studio Remediation Contracts

This patch release hardens RapidKit's npm source-of-truth layer for Workspai
Studio, enterprise workspace governance, and agent-facing evidence. Doctor now
emits deeper multi-language, multi-framework project signals; repair planning is
structured as an ordered remediation contract; and Workspace Intelligence
artifacts carry fact-level freshness metadata so humans and agents know which
facts are durable, derived, evidence-backed, live, or verification-gated.

**What's New:**

- **Enterprise Doctor evidence**
  - `doctor workspace`, `doctor workspace --fix`, `doctor project`, and
    `doctor project --fix` now inspect broader project surfaces: dependency
    contracts, env/config baselines, tests, quality tooling, security tooling,
    container/deployment files, migrations, health probes, and runtime
    entrypoints.
  - Doctor output is more reliable across frontend, backend, and polyglot
    workspaces, with canary coverage for multi-stack scenarios.

- **Studio-ready remediation**
  - New `doctor-remediation-plan.v1` contract describes ordered safe and guarded
    repair steps, file hints, verification commands, rollback metadata, and
    repair capability state.
  - Doctor repair capabilities now favor the smallest safe edit first while
    keeping higher-risk steps review-gated for Workspai Studio.

- **Fact freshness**
  - New `fact-freshness.v1` contract extends freshness from artifact-level
    metadata down to the facts that agents actually reason over.
  - Workspace context, model, history, verify, and agent-sync outputs now expose
    the newer freshness and remediation evidence in structured form.

- **Enterprise CLI gates**
  - CLI routing and release gates are hardened around npm-vs-Python RapidKit
    command ownership, package smoke, manual release workflows, and Studio-safe
    repair command execution.

**Breaking changes:** None.

**Verification:**

- `npm run typecheck`
- `npm run validate:contracts`
- `npm test`
- `npm run smoke:enterprise-package`
- `npm run prepack`

**Upgrade:**

```bash
npm install -g rapidkit@0.41.3
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.41.3.md)

---

## Previous Release: v0.41.2 (June 28, 2026)

### Workspace Intelligence Contract and Publish Smoke Hardening

This patch release tightens the npm source-of-truth layer for Workspai,
enterprise CI, and agent-facing workspace operations. It expands the published
Workspace Intelligence command surface, adds structured incident handoff
metadata for Studio consumers, hardens package smoke against noisy npm output
and read-only npm caches, and clarifies RapidKit's category positioning in the
README.

**What's New:**

- **Workspace Intelligence command surface**
  - `runtime-command-surface.v1` now advertises `workspace why` and
    `workspace trace` as Workspace Intelligence subcommands alongside
    `workspace explain`.
  - Contract tests now assert `explain`, `why`, and `trace` stay published for
    IDE/CI capability detection.

- **Studio incident handoff**
  - `studio-blocker-handoff.v1` now includes an additive `incidentSummary`
    object for phase, primary action, verification requirement, and audit state.

- **Enterprise package smoke**
  - `enterprise-package-smoke` now uses an isolated writable npm cache instead
    of inheriting a possibly read-only parent `npm_config_cache`.
  - The smoke parser now tolerates npm lifecycle noise before `npm pack --json`
    output.

- **Workspace Intelligence docs and positioning**
  - README positioning now leads with **Open-Source Workspace Intelligence for
    Software Systems** and clarifies that RapidKit is not another AI coding
    assistant, agent framework, or context engine.
  - The mental model now makes Workspace Intelligence framework-agnostic:
    RapidKit can govern created, imported, and adopted projects across frontend,
    backend, and polyglot stacks.
  - Contract docs now list the newer Workspace Intelligence schemas and fix the
    `.rapidkit/AGENT-GROUNDING.md` artifact path.

- **Graph impact quality**
  - Workspace impact centrality handling no longer relies on non-null
    assertions when building transitive impact and hotspot summaries.

**Breaking changes:** None.

**Verification:**

- `npm run lint`
- `npm run typecheck`
- `npm run format:check`
- `npm run validate:docs`
- `npm run check:generated-contracts`
- `npm run check:shared-contracts`
- `npm test` (1573 passed, 8 skipped)
- `npm run smoke:enterprise-package`
- `npm run prepack`

**Upgrade:**

```bash
npm install -g rapidkit@0.41.2
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.41.2.md)

---

## Previous Release: v0.41.1 (June 28, 2026)

### Enterprise Package Smoke and Runner Hardening

This patch release hardens the npm CLI for enterprise extension hosts, CI, and
publish gates: package runners no longer depend on a perfect PATH, piped CLI
output is safe before process exit, workspace-root init uses the same npm-aware
preflight as project lifecycle commands, and npm package smoke now blocks
publishing on broken artifacts.

**What's New:**

- **Publish gates**
  - `prepack` now builds dist, prepares packaged embeddings, verifies CLI command
    ownership, and runs enterprise package smoke before `npm pack` / publish.
  - CI and manual release workflows run `smoke:enterprise-package`.

- **Package runner hardening**
  - npm/npx/pnpm/yarn subprocesses resolve through a command-safe invocation
    contract (`npm_execpath`, well-known npm CLI paths, or `corepack npm`).
  - Nested `npx --package` environment pins are stripped before child package
    runners execute.
  - `COREPACK_HOME` is made writable for package-runner subprocesses.

- **Pipe-safe CLI output**
  - Piped stdout/stderr is written synchronously for CLI entrypoint execution so
    `--version --json`, workspace policy, cache, and lifecycle command output are
    not lost on fast exits.

- **Workspace Intelligence graph**
  - `workspace-dependency-graph.v1` now carries richer operational profile,
    coverage, topology, and diagnostics data for Workspai enterprise graph
    surfaces.

- **Scaffold/runtime stability**
  - Frontend create commands and Node runtime package-manager detection use the
    same package-runner contract.
  - Workspace fleet init preflight accepts npm runners resolved outside PATH,
    matching project-level lifecycle execution.

**Breaking changes:** None.

**Verification:**

- `./node_modules/.bin/tsc --noEmit`
- `./node_modules/.bin/vitest run` (1573 passed, 8 skipped)
- `node scripts/enterprise-package-smoke.mjs`
- `node scripts/prepack-enterprise.mjs`

**Upgrade:**

```bash
npm install -g rapidkit@0.41.1
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.41.1.md)

---

## Previous Release: v0.41.0 (June 23, 2026)

### Phase 4 Workspace Intelligence Closure

This minor release completes the operational intelligence loop: human-readable
blocker narratives, agent feedback, MCP read bridge, operational skills, structured
doctor-fix evidence, and extended verify + fleet-run gates — all versioned for
Workspai, CI, and AI agents.

**What's New:**

- **Explain / Why / Trace**
  - `workspace explain`, `workspace why`, and `workspace trace --from <diff>` with
    `workspace-explain.v1` artifact.

- **MCP serve**
  - Read-mostly stdio JSON-RPC: `workspace mcp serve`.

- **Agent feedback & skills**
  - `workspace feedback record` → history ring buffer.
  - Operational skills via `workspace agent-sync --write` (no separate generator).

- **Doctor fix result**
  - Structured `fixResult` on `doctor workspace --fix --json`
    (`rapidkit-doctor-fix-result-v1`).

- **Verify & fleet extensions**
  - Verify init/start fleet evidence + optional doctor-fix step.
  - Resolution hints on blocking steps.
  - `workspace run` custom stages, `--reuse-passed`, stage dependencies.

- **Contracts**
  - Nine new/updated Phase 4 schemas; extension CLI compatibility matrix expanded.

**Breaking changes:** None.

**Upgrade:**

```bash
npm install -g rapidkit@0.41.0
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.41.0.md)

---

## Previous Release: v0.40.1 (June 23, 2026)

### Workspace Intelligence-First CLI Help

Reframes root CLI help around Workspace Intelligence positioning while preserving
the full command reference.

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.40.1.md)

---

## Previous Release: v0.40.0 (June 23, 2026)

### Agent Customization Pack (Enterprise Agent Output)

This minor release promotes RapidKit agent grounding from scattered files into a
versioned **Agent Customization Pack** that VS Code, Copilot, Cursor, Claude,
Codex, CI, and future MCP consumers can read consistently.

**What's New:**

- **Versioned pack contract**
  - `contracts/agent-customization-pack.v1.json` defines presets, targets,
    required reports, drift rules, and the standard answer contract.

- **Enterprise `workspace agent-sync`**
  - Writes `.rapidkit/reports/agent-customization-pack.json` with output
    inventory, capability matrix, and drift state.
  - `--preset minimal|enterprise`, `--target vscode|copilot,cursor,...`,
    `--dry-run --json`, `--strict --json`.

- **VS Code-native surfaces**
  - Copilot instructions, scoped instruction files, reusable prompts, portable
    skill pack, and specialized agents (`workspai-advisor`, `workspai-repair`,
    `workspai-release`, `workspai-project-onboarder`).

- **Optional hooks (experimental)**
  - `--experimental-hooks` generates advisory
    `.vscode/rapidkit-agent-hooks.json` (disabled by default).

- **MCP-ready design**
  - `.rapidkit/reports/rapidkit-mcp-design.json` plus skill resource
    `resources/mcp-tools.md` (read-mostly, approval-gated writes).

- **CI drift guard**
  - `npm run check:agent-customization-drift` fails when generated
    customization files are out of sync with git.

**Standard answer contract:** Scope → Evidence → Diagnosis → Fix Plan → Run →
Verify → Assumptions.

**Breaking changes:** None. Existing `agent-sync --write` remains
backward-compatible; new flags are opt-in except the pack report, which is
additive.

**Verification:**

- `npx vitest run src/__tests__/workspace-agent-sync.test.ts`
- `npx vitest run src/__tests__/contracts/`
- `npm run check:shared-contracts`

**Upgrade:**

```bash
npm install -g rapidkit@0.40.0
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.40.0.md)

---

## Previous Release: v0.39.0 (June 22, 2026)

### Graph-Aware Workspace Intelligence Engine

This minor release makes the workspace dependency graph a first-class,
deterministic part of the workspace model, and routes impact, verification,
freshness, risk, and a new watch/daemon mode through that single graph.

The engine is language- and framework-agnostic: it works the same for projects
created with a RapidKit kit or imported/adopted from an existing repository, and
across Python, Node, Go, Java, .NET, and observed runtimes such as PHP, Ruby,
and Rust.

**What's New:**

- **First-class dependency graph**
  - Added `contracts/workspace-intelligence/workspace-dependency-graph.v1.json`,
    embedded deterministically in `workspace-model.v1`.
  - Multi-source, provenance-tracked edge inference: `package-dep`
    (`package.json`, `pyproject.toml` path deps, `go.mod` replace), contract
    `dependsOn` and event publish/subscribe, `code-import` (JS/TS), and `manual`
    overrides.

- **Graph-aware impact and verify**
  - `workspace impact` reports a transitive blast radius (`distance`/`path`/`via`)
    plus centrality-weighted critical-path hotspots.
  - `workspace verify` gates the whole affected subgraph and surfaces graph
    integrity issues (cycles, dangling edges, orphans).

- **Graph command surface**
  - `workspace graph` with `emit`, `explain <project>`, `dot`, and `mermaid`.

- **Performance**
  - Model + graph cache keyed by a structural `inputsHash`
    (`workspace-model-cache.v1`).
  - `workspace model --incremental` for graph-aware incremental rebuilds.

- **Governance and freshness**
  - Transitive `fresh | stale | unknown` freshness verdict in `workspace verify`.
  - A definitive verify `gate` in `--json`; `--strict` also fails on
    `needs-attention` and `stale` freshness.
  - Structured `policyMode` + `policyViolations[]` in the verify output.

- **Watch / daemon mode**
  - `workspace watch` keeps the model + graph in memory and streams
    `workspace-watch-event.v1` change events via fast incremental rebuilds.

- **History**
  - Bounded health/impact history at
    `.rapidkit/reports/workspace-intelligence-history.json`.

**Language and framework coverage:**

- The Workspace Intelligence consumer layer (model, graph traversal, impact,
  verify, freshness, centrality, integrity, watch, history, gate, and policy) is
  language- and framework-agnostic for created, imported, and adopted projects.
- Automatic `code-import` edge inference is JS/TS-only and degrades gracefully;
  other runtimes derive inter-project edges from manifests, the workspace
  contract, and manual overrides.

**Breaking changes:** None. Schema additions are additive and the new
subcommands/flags are opt-in.

**Verification:**

- `npx vitest run` (full suite: 1517 passed, 11 skipped, 0 failures)
- `npx tsc --noEmit`
- `npm run check:shared-contracts`
- `npm run test:drift`

**Upgrade:**

```bash
npm install -g rapidkit@0.39.0
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.39.0.md)

---

## Previous Release: v0.38.0 (June 21, 2026)

### Create Planner Capability Contract and Agent-Ready Scaffold Guardrails

This minor release introduces the Create Planner capability contract: a shared
source of truth for deciding which stacks RapidKit can scaffold natively, which
external ecosystems should flow through create-then-adopt, and which projects
should enter Workspace Intelligence through adopt-only governance.

The goal is to prevent AI and IDE surfaces from guessing the wrong native stack
while keeping RapidKit open to polyglot, external, and existing-project
workflows.

**What's New:**

- **Create Planner capability lanes**
  - Added `native-create`, `external-create-adopt`, and `adopt-only` lanes.
  - Native create covers RapidKit-owned backend and frontend scaffold contracts.
  - External create-adopt is now modeled for planned ecosystems such as
    WordPress, Laravel, Symfony, and Rails.
  - Adopt-only covers runtimes such as PHP, Ruby, Rust, Elixir, Clojure, Scala,
    and Kotlin when RapidKit should govern rather than scaffold.

- **Generated contract artifact**
  - Added `contracts/create-planner-capabilities.v1.json`.
  - Added the create planner summary to
    `contracts/runtime-command-surface.v1.json`.
  - Extended generated contract checks and parity checks so CI, docs, VS Code,
    and AI surfaces consume the same planner contract.

- **CLI guardrails**
  - `rapidkit create project` now blocks unsupported native-create attempts
    before delegation to the underlying scaffolder.
  - WordPress, Laravel, generic PHP, and similar unsupported native-create
    requests are routed to explicit external/adopt guidance instead of falling
    through to the wrong RapidKit kit.

- **Workspace Intelligence propagation**
  - Workspace model and workspace context project summaries now include
    `createCapability`.
  - Agents and IDEs can inspect whether a project belongs to native create,
    planned external create-adopt, or adopt-only governance.

- **Documentation and release contract**
  - Added create planner documentation under `docs/`.
  - Updated the contract catalog and contract README with the new artifact.
  - Mirrored the contract for downstream VS Code and monorepo consumers.

**Verification:**

- `./node_modules/.bin/vitest run src/__tests__/create-planner-capabilities.test.ts src/__tests__/handle-create-flags.test.ts src/__tests__/contracts/generated-contracts.test.ts src/__tests__/contracts/npm-contracts-parity.test.ts src/__tests__/workspace-model.test.ts src/__tests__/workspace-context.test.ts`
- `./node_modules/.bin/tsc --noEmit`
- `./node_modules/.bin/prettier --check src/utils/create-planner-capabilities.ts src/contracts/create-planner-capabilities-contract.ts src/contracts/runtime-command-surface-contract.ts src/workspace-model.ts src/workspace-context.ts src/__tests__/create-planner-capabilities.test.ts src/__tests__/handle-create-flags.test.ts src/__tests__/contracts/generated-contracts.test.ts src/__tests__/contracts/npm-contracts-parity.test.ts src/__tests__/workspace-model.test.ts src/__tests__/workspace-context.test.ts docs/create-planner-capabilities.md docs/contracts/README.md docs/contracts/ARTIFACT_CATALOG.md`

**Upgrade:**

```bash
npm install -g rapidkit@0.38.0
```

[Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.38.0.md)

---

## Earlier Release: v0.37.1 (June 19, 2026)

### Workspace Intelligence Verification and npm README Hardening

This patch release tightens the Workspace Intelligence evidence gate and improves
the npm package presentation surface. It keeps the current feature set stable
while making `workspace verify`, agent context packs, and npm README assets more
reliable for enterprise workflows.

**What's Fixed and Improved:**

- 🧠 **Workspace verify evidence correctness**
  - Project-scoped verification now requires `workspace-run-last.json` evidence
    to match the affected project by name, relative path, or project path.
  - Evidence from another project no longer satisfies a required project gate.

- ⏱️ **Freshness-aware release gates**
  - `workspace verify` now treats evidence generated before the current impact
    report as stale and blocking.
  - Prevents old passing test/build reports from being reused for newer impact
    decisions.

- 🤖 **Agent and IDE alignment**
  - Workspace agent context packs now include `workspace verify --json` as a
    safe command so agents can evaluate the official evidence gate before
    release or apply recommendations.

- 📦 **npm README and package surface**
  - Replaced the npm README Mermaid diagram with a raw GitHub image URL for npm
    rendering compatibility.
  - Preserved the Mermaid source in internal docs for GitHub readers.
  - Published the full `docs/` folder in the npm package so README-linked docs
    and assets are included.
  - Updated npm package metadata to align with the Workspace Intelligence
    positioning.

- ✅ **Regression coverage**
  - Added tests for project-specific evidence matching, stale evidence blocking,
    agent safe commands, README image asset publishing, and README-linked docs
    packaging.
  - Hardened CLI process integration tests to avoid leaking Vitest environment
    variables into child CLI executions.

**Verification:**

- `node node_modules/vitest/vitest.mjs run src/__tests__/workspace-context.test.ts src/__tests__/workspace-verify.test.ts src/__tests__/workspace-intelligence.test.ts src/__tests__/workspace-intelligence-cli-chain.test.ts src/__tests__/contracts src/__tests__/package-publish-contract.test.ts`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js src --ext .ts`
- `node scripts/check-markdown-links.mjs`
- `node scripts/docs-drift-guard.mjs`
- `node node_modules/tsup/dist/cli-default.js`
- `node scripts/verify-package-cli.mjs`
- `node scripts/smoke-readme-commands.mjs`

**Upgrade:**

```bash
npm install -g rapidkit@0.37.1
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.37.1.md)

---

## Previous Release: v0.37.0 (June 17, 2026)

### CLI Observability, Governance, and Workspace Management

This release introduces comprehensive CLI observability infrastructure, governance artifacts, workspace agent synchronization, and enhanced UI components. It provides the foundation for enterprise-grade workspace management with structured logging, contract-based governance, and improved user interaction patterns.

**Major Additions:**

- 📊 **CLI Observability**
  - New observability module (`src/observability/`) for structured logging and progress tracking.
  - Standardized log event capture with `cli-log-event-contract`.
  - Progress indicators and runtime context tracking.
  - CLI log event schema contract (`contracts/cli-log-event.v1.json`).

- 🎨 **CLI UI Components**
  - New UI module (`src/cli-ui/`) with brand, theme, and interactive components.
  - Enhanced kit picker with improved choices and formatting.
  - Centralized messages and prompts for consistent UX.
  - Brand and version information management.

- 🏛️ **Workspace Governance & Registry**
  - Workspace registry summarization and project enumeration.
  - Governance report metadata extraction and tracking.
  - Managed agent identification and lifecycle markers.
  - New governance contracts:
    - `contracts/workspace-registry.v1.json`
    - `contracts/release-readiness.v1.json`
    - `contracts/analyze-last-run.v1.json`
    - `contracts/doctor-project-evidence.v1.json`
    - `contracts/doctor-workspace-evidence.v1.json`
    - `contracts/workspace-run-last.v1.json`

- 🤖 **Workspace Agent Sync**
  - `workspace-agent-sync` command for managed agent synchronization.
  - Workspace creation location resolver for intelligent placement.
  - Workspace onboarding utilities and workflows.
  - Enhanced workspace run evidence collection.

- 📚 **Documentation & Examples**
  - `docs/contracts/ARTIFACT_CATALOG.md` with complete artifact schemas.
  - `docs/examples/ci-agent-grounding.yml` for CI/CD integration.
  - Enhanced workflow and command reference documentation.

- ✅ **Test Coverage**
  - 10+ new test files covering observability, governance, contracts, and workspace features.
  - Comprehensive integration tests for registry and agent sync workflows.
  - Contract schema validation tests.

**Improvements:**

- Enhanced type safety across AI commands and workspace utilities.
- Improved structured logging throughout the CLI.
- Better governance signal integration in workspace intelligence.
- More intelligent workspace creation location selection.
- Consistent UI/UX with brand and theme management.

**Code Quality:**

- Zero TypeScript compilation errors.
- Full test suite passes with enhanced coverage.
- All quality checks pass (typecheck, lint, format, test, size-check).

**Upgrade:**

```bash
npm install -g rapidkit@0.37.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.37.0.md)

---

## Previous Release: v0.36.0 (June 16, 2026)

### Adoption, Frontend Scaffold, and Workspace Intelligence

This release adds in-place project adoption, official `create frontend` generators, and workspace intelligence commands (`model`, `context`, `snapshot`, `verify`, `diff`, `impact`) so teams can govern polyglot workspaces from the CLI alone.

**What's New:**

- 🔗 **`rapidkit adopt`**
  - Link existing local projects into a workspace without moving source files.
  - Adoption metadata at `.rapidkit/adopt.json` and `.rapidkit/adopt-readiness.json`.

- 🎨 **`rapidkit create frontend`**
  - Official generators for Next.js, Remix, Vite variants, Nuxt, Angular, Astro, and SvelteKit.
  - Non-interactive flags for extension and CI scaffold flows.

- 🧠 **Workspace intelligence**
  - `workspace model`, `context`, `snapshot`, `verify`, `diff`, and `impact` with JSON contracts.
  - Registry/contract sync includes adopted and imported external projects.

- 🩺 **Doctor and detection**
  - Frontend framework probes and richer project-scoped evidence.
  - Improved Node framework detection before generic fallbacks.

- 🏗️ **Enterprise / polyglot**
  - Expanded infra stack catalog, lifecycle probes, and runtime executor coverage.

**Upgrade:**

```bash
npm install -g rapidkit@0.35.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.35.0.md)

---

## Previous Release: v0.34.0 (June 14, 2026)

### CLI Governance Pipeline and Enterprise Release Gates

This minor release completes the npm-wrapper governance loop so teams can run bootstrap → sync → doctor → analyze → readiness → autopilot entirely from the CLI, without depending on the VS Code extension for verify evidence.

**What's New:**

- 🔗 **`rapidkit pipeline`**
  - One command runs sync, doctor, analyze, readiness, and autopilot audit.
  - Writes `.rapidkit/reports/pipeline-last-run.json` with stage verdicts and exit codes.
  - Flags: `--json`, `--strict`, `--skip-verify`, `--skip-analyze`, `--skip-autopilot`.

- 🩺 **Doctor CI gates**
  - `--strict`: exit `1` on errors or warnings.
  - `--ci`: exit `1` on errors, exit `2` on warnings.

- 🚦 **Readiness improvements**
  - New **analyze** gate reads `analyze-last-run.json`.
  - Verify gate falls back to CLI `workspace contract verify` when extension artifacts are absent.
  - `--skip-verify` for pipelines that verify elsewhere.

- 🚀 **Bootstrap and sync**
  - Post-success bootstrap auto-syncs registry + contract.
  - `--compliance-only` with `--json` for compliance-only CI (skips init).
  - `workspace sync --json` for machine-readable registry sync output.

- 🤖 **Autopilot**
  - Adds analyze stage between doctor and readiness.
  - Uses doctor `--ci` / `--strict` based on mode.

**Upgrade:**

```bash
npm install -g rapidkit@0.34.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.34.0.md)

---

## Previous Release: v0.33.2 (June 12, 2026)

### Windows Workspace Launcher and Core Resolver Hardening

This patch makes global, `npx`, and workspace-local command flows behave consistently when RapidKit Core is installed inside a workspace, via pipx/user-local locations, or behind a generated workspace launcher.

**What's Fixed:**

- 🪟 **Windows launcher shadowing**
  - Generated `rapidkit.cmd` launchers now forward to a non-local npm wrapper when the workspace virtualenv is missing.
  - Forwarded calls set `RAPIDKIT_LOCAL_LAUNCHER_BYPASS=1` so the npm wrapper cannot recurse back into the same local launcher.

- 🧭 **Workspace-local Core discovery**
  - The npm bridge now detects workspace Core installs from both default `.venv` paths and `.rapidkit-workspace` `metadata.python.venvPath`.
  - Workspace Python version metadata is honored from the marker when available.

- 🐍 **User-local / pipx fallback**
  - The bridge now scans deterministic user-local Core launcher paths even when pipx/Python script directories are not on `PATH`.
  - Generated launchers fall back to user-local Core executables after checking the npm wrapper path.

- ✅ **Regression coverage**
  - Added Windows launcher, POSIX launcher, user-local Core, workspace marker, and multi-OS resolver coverage.
  - The Windows bridge E2E workflow now runs the focused resolver regression suite before native smoke tests.

**Upgrade:**

```bash
npm install -g rapidkit@0.33.2
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.33.2.md)

---

## Previous Release: v0.33.1 (June 10, 2026)

### Core Bridge Forwarding Fix for Module Lifecycle and `--dry-run`

This patch fixes npm-to-core command routing so module maintenance and dry-run previews reach Python core reliably, while workspace create/import flows stay on the npm wrapper.

**What's Fixed:**

- 🔁 **Module lifecycle forwarding**
  - `rollback`, `uninstall`, `upgrade`, `diff`, and `checkpoint` now forward to core even when `--dry-run` is present.
  - Prevents silent no-op behavior from the Workspai dashboard and terminal maintenance flows.

- 🧭 **Workspace vs core boundary**
  - Bare workspace names like `my-workspace --dry-run` no longer mis-route to Python core.
  - `create workspace`, `create project`, and npm-owned generator flows remain on the wrapper.

- 🐍 **Python context delegation**
  - In-project delegation now covers `pip`, `poetry`, `venv`, `pipx`, and `python` engines — not `pip` alone.

**Upgrade:**

```bash
npm install -g rapidkit@0.33.1
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.33.1.md)

---

## Previous Release: v0.33.0 (June 10, 2026)

### Workspace Infra Sidecar, Module Layout Contract, and Foundation Ensure

This minor release adds contract-driven local dev infrastructure for polyglot workspaces, canonical module layout verification, and a foundation ensure command for workspace governance files.

**What's New:**

- 🐳 **Infra sidecar (`rapidkit infra`)**
  - `plan` discovers Postgres, Redis, Mailpit, MinIO, and related services from modules, `.env.example`, workspace contract env, and overrides.
  - `up|down|status` manage a generated stack at `.rapidkit/infra/docker-compose.yml` without touching the workspace's main compose file.
  - Emits `.rapidkit/reports/infra-plan.json` and connection env previews aligned with project defaults.

- 📐 **Module layout contract**
  - Added `contracts/module-layout.v1.json` and doctor workspace module-path audits.
  - `workspace contract verify --strict --module-paths` checks canonical `src/modules/free/` placement.

- 🧱 **Workspace foundation ensure**
  - `npx rapidkit workspace foundation ensure` reconciles workspace.json, policies, toolchain lock, and foundation artifacts.

- 🪺 **NestJS kit alignment**
  - NestJS standard templates now use the canonical module root and TS path mapping expected by Core modules.

**Upgrade:**

```bash
npm install -g rapidkit@0.33.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.33.0.md)

---

## Previous Release: v0.32.2 (June 8, 2026)

### Multi-OS Workspace Init and Deterministic Package Release Hardening

This patch closes first-use reliability gaps across Linux, macOS, and Windows. It improves Python bridge selection when the default interpreter is incomplete, keeps mixed-runtime workspace initialization moving when an optional runtime is missing, and makes package/release scripts deterministic without Unix-only shell assumptions.

**What's New:**

- 🧩 **Mixed-runtime workspace init reliability**
  - `workspace run init` now continues across remaining projects when an extended-runtime project, such as `.NET`, cannot initialize because its SDK is missing.
  - FastAPI and NestJS projects in the same workspace are no longer skipped just because another runtime needs setup.
  - Added regression coverage for mixed workspace initialization.

- 🐍 **Python bridge fallback hardening**
  - The bridge now tries explicit Python overrides, local core virtual environments, versioned Python commands, and platform defaults before failing.
  - If one Python command exists but cannot create a virtual environment, RapidKit falls through to the next valid interpreter.
  - Release scripts now probe real `venv` support before selecting Python.

- 📦 **Cross-platform release scripts**
  - Replaced Unix-only npm scripts with Node wrappers for drift guard, scenario matrix execution, and distribution size reporting.
  - `npm pack --json` now remains parseable when Husky is disabled.
  - `prepack` validates the committed embeddings artifact offline instead of depending on `npx` downloads during release.

- 🔷 **ASP.NET scaffold stability**
  - Generated ASP.NET projects now suppress missing XML documentation warnings while keeping other warnings as errors.
  - The generated `dev` launcher now uses stable `dotnet run` behavior across Linux, macOS, and Windows.

**Upgrade:**

```bash
npm install -g rapidkit@0.32.2
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.32.2.md)

---

## Previous Release: v0.32.1 (June 8, 2026)

### Runtime Command Surface Parity and Windows Go Launcher Hardening

This patch closes a product-surface drift gap between the npm CLI and companion tooling by adding a shared runtime command contract. It also hardens generated Go workspace launchers on Windows so users can run project lifecycle commands without requiring GNU Make.

**What's New:**

- 🧭 **Runtime command surface contract**
  - Added a shared contract for lifecycle commands, module mutation commands, global commands, scaffold kits, runtime tiers, and module marketplace boundaries.
  - Added regression coverage so command-surface drift is caught before release.
  - Extended parity sync tooling to verify both import stack parity and runtime command surface parity.

- 🪟 **Windows Go launcher hardening**
  - Generated Go/Fiber and Go/Gin `rapidkit.cmd` launchers now use native Go commands for dev, build, test, format, and docs flows.
  - Windows users no longer need GNU Make just to run generated Go workspace commands.
  - Added generator coverage to lock this behavior.

**Upgrade:**

```bash
npm install -g rapidkit@0.32.1
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.32.1.md)

---

## Previous Release: v0.32.0 (June 7, 2026)

### 🧪 Runtime Acceptance Matrix, Release Evidence, and Audit Hardening

This release strengthens RapidKit npm as the workspace-level verification surface. It adds local runtime acceptance evidence for workspace/project commands, makes release reports survive temporary workspace cleanup, and tightens the security workflow around npm audit findings.

**What's New:**

- 🧪 **Runtime acceptance matrix**
  - Added local acceptance coverage for workspace and project command flows across FastAPI, FastAPI DDD, NestJS, Go/Fiber, Go/Gin, Spring Boot, ASP.NET Core, and observed runtimes.
  - Keeps the expensive matrix out of GitHub Actions by default while preserving it as explicit local release evidence.
  - Documents the release rule for using the matrix before publishing multi-runtime CLI changes.

- 🧾 **Stable release evidence paths**
  - Runtime matrix reports now default to a stable system temp report directory.
  - Reports are no longer removed when the temporary generated workspace is cleaned up.
  - `--report <file>` still supports explicit repository or artifact evidence paths.

- 🔒 **Security and dependency hardening**
  - The security workflow now fails on moderate-or-higher `npm audit` findings.
  - Refreshed vulnerable transitive dependency locks, including the Vitest toolchain.
  - Verified the release with a clean audit and full local validation.

**Upgrade:**

```bash
npm install -g rapidkit@0.32.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.32.0.md)

---

## Previous Release: v0.31.0 (June 2, 2026)

### 🧭 Workspace Contract Registry, Portable Archives, and CLI Ownership Hardening

This release turns the npm CLI into a stronger workspace handoff and governance surface. It adds portable archive flows, a canonical workspace contract registry, and safer command ownership so npm-owned commands stay in the wrapper across global, npx, and Windows resolution scenarios.

**What's New:**

- 🗂️ **Portable workspace archive flow**
  - Added deterministic workspace archive export, inspect, verify, doctor, and hydrate support.
  - Archive hydration is path-contained and hardened against unsafe destination writes.
  - Archive metadata is aligned with Workspai extension import/export and remote import workflows.

- 🧩 **Workspace Contract Registry**
  - Added a contract-backed model for workspace services, ports, dependencies, events, and ownership metadata.
  - Added graph and verification utilities for inspecting topology before sharing, packaging, or release.
  - Contract validation now helps catch port conflicts and malformed service metadata earlier.

- 🪟 **CLI ownership and Windows/global install hardening**
  - npm-owned commands now remain in the npm wrapper instead of falling through to the Python Core bridge.
  - Added package resolution checks for install/publish confidence, including Windows `rapidkit.exe` collision scenarios.
  - Strengthened package publish contract coverage for CLI entrypoints and wrapper-owned commands.

**Upgrade:**

```bash
npm install -g rapidkit@0.31.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.31.0.md)

---

## Latest Release: v0.30.0 (May 30, 2026)

### 🔍 Workspace Analysis, AI Embeddings Packaging, and CI Evidence Readiness

This release introduces a new wrapper-owned `rapidkit analyze` command, improved AI embeddings packaging for npm release artifacts, and better CLI/docs alignment for enterprise automation.

**What's New:**

- 🚀 **Workspace analysis command**
  - Added `npx rapidkit analyze [--workspace <path>] [--json] [--strict] [--output <file>]` for workspace health findings and automated report generation.
  - Supports strict CI gating and structured JSON evidence writing to `.rapidkit/reports/`.

- 📦 **Embeddings packaging improvements**
  - Added `prepack` hook to regenerate `data/modules-embeddings.json` before `npm pack` / `npm publish`.
  - Added `npm run generate-embeddings` for real OpenAI module embedding generation and `npm run test:prepare-embeddings` for deterministic mock embeddings during local testing.

- 🧠 **AI command and docs alignment**
  - Updated CLI help, README docs, and command ownership matrix for the new `analyze` and AI embeddings workflows.

**Upgrade:**

```bash
npm install -g rapidkit@0.30.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.30.0.md)

---

## Latest Release: v0.29.1 (May 26, 2026)

### 🛡️ Backend Import Rollback and CLI Test Stability Patch

This patch hardens backend project import rollback behavior and stabilizes CLI integration tests that execute the generated distribution entrypoint.

**What's New:**

- 🧱 **Safer backend project import**
  - Failed local project copies and git imports now clean up partially prepared destination directories.
  - Workspace-boundary checks now use path-relative semantics for safer behavior across operating systems.

- 🧪 **Stable CLI integration test builds**
  - Added a shared locked `dist/index.js` build helper for process-level CLI tests.
  - Reduced parallel test rebuild races by centralizing distribution build setup.

- 🔒 **CI and CLI execution hardening**
  - Added a dedicated CI guard for backend import rollback coverage.
  - Direct CLI execution now detects generated and source entrypoints more reliably.
  - CLI subprocess output now uses blocking stdout/stderr to avoid lost output in short-lived command runs.
  - Refreshed vulnerable transitive dependency locks and cleared npm audit findings before publish.

**Upgrade:**

```bash
npm install -g rapidkit@0.29.1
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.29.1.md)

---

## Previous Release: v0.29.0 (May 26, 2026)

### 🧪 Workspace Snapshot Support and Docs Cleanup

This release adds workspace snapshot support and updates repository metadata/documentation references to the new `rapidkitlabs` organization.

**What's New:**

- 🗂️ **Workspace snapshot support**
  - Added snapshot commands for capturing, inspecting, listing, and restoring workspace state.
  - Supports both metadata-only and full snapshot modes, plus optional project inclusion.

- 🧾 **Snapshot commands:**
  - `npx rapidkit snapshot create <name> [--include-projects] [--reason <text>] [--json]`
  - `npx rapidkit snapshot list [--json]`
  - `npx rapidkit snapshot inspect <name> [--json]`
  - `npx rapidkit snapshot restore <name> [--dry-run] [--force] [--json]`

- 🧾 **Docs and release metadata cleanup**
  - Updated GitHub repository links and references from `getrapidkit` to `rapidkitlabs` across README and docs.
  - Synced release note references and docs links in package metadata.

- ✅ **Maintenance and stability**
  - Added regression coverage for workspace snapshot behavior.

**Upgrade:**

```bash
npm install -g rapidkit@0.29.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.29.0.md)

---

## Previous Release: v0.28.0 (May 22, 2026)

### 🤖 Autopilot Release Commander — Enterprise Orchestration and Stable Gate Verdicts

This release adds `autopilot release` as a top-level wrapper command to run a full, deterministic release readiness flow using existing stable command contracts.

**What's New:**

- 🤖 **New release commander flow**
  - Added command:
    - `npx rapidkit autopilot release --mode <audit|enforce|safe-fix> --json --output <path>`
  - Stages orchestrate `doctor workspace`, `readiness`, remediation planning/apply, and `workspace run test/build`.

- 🧱 **Enterprise fail-closed behavior**
  - Enforce mode blocks on warnings and failures with deterministic blocker reasons.
  - Execution-level command crashes are classified separately and return exit code `3`.

- 🔁 **Safe-fix post-apply revalidation**
  - In `safe-fix`, successful remediation apply now triggers post-apply `doctor` and `readiness` re-checks.
  - Final verdict reflects post-apply gate status, not pre-fix assumptions.

- 🧾 **Stable JSON contract and artifacts**
  - Report schema pinned to `autopilot-release-v1`.
  - Deterministic report writing via `--output`.
  - Additional stage artifacts for workspace test/build runs are emitted under `.rapidkit/reports/`.

- ✅ **Regression coverage expansion**
  - Added contract-level tests for enforce warning blockers.
  - Added execution crash -> exit code `3` mapping test.
  - Added safe-fix revalidation call-path test coverage.

**Upgrade:**

```bash
npm install -g rapidkit@0.28.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.28.0.md)

---

## Previous Release: v0.27.6 (May 19, 2026)

### 🛡️ v0.27.6 — Stabilization Hardening, Unified Config Security, and Doctor Remediation Plan/Apply (Patch)

This patch focuses on enterprise-grade stabilization and operational predictability. It unifies config handling for AI settings, introduces centralized timeout policy helpers, removes duplicated workspace discovery logic, and ships structured doctor remediation planning with non-interactive execution mode.

**What's New:**

- 🛠️ **Doctor remediation planning and non-interactive apply**
  - Added plan-only mode for safe previews:
    - `npx rapidkit doctor workspace --plan`
    - `npx rapidkit doctor project --plan`
  - Added non-interactive remediation apply mode:
    - `npx rapidkit doctor workspace --apply`
    - `npx rapidkit doctor project --apply`
  - Added conflict guard for invalid flag combinations (`--plan` with `--fix`/`--apply`).

- 🔐 **Unified config security hardening**
  - Unified AI/user config model usage under `.rapidkitrc.json`.
  - Added legacy compatibility fallback from older AI config path to avoid user disruption.
  - Hardened config file permissions for secret-bearing config writes on Unix-like systems.

- 🧭 **Shared workspace project discovery**
  - Introduced a common discovery utility reused by `workspace run` and `workspace share`.
  - Reduces behavior drift risk and keeps workspace scanning rules consistent.

- ⏱️ **Centralized timeout policy**
  - Added shared timeout helpers for probe/network/bridge command paths.
  - Replaced scattered literals with policy-driven defaults to improve operational consistency.

- ✅ **Reliability and test hardening**
  - Fixed doctor fix-flow compile regression around Go toolchain availability checks.
  - Added dedicated doctor tests for `--plan` and `--apply`.
  - Full test suite validated green before release metadata finalization.

**Upgrade:**

```bash
npm install -g rapidkit@0.27.6
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.27.6.md)

---

## Previous Release: v0.27.5 (May 15, 2026)

### ⚙️ v0.27.5 — Version-Aware Global Core Reuse, Optional Workspace .venv Advisory, and Workspace Run Progress Visibility (Patch)

This patch focuses on stabilization and operator clarity. It hardens global RapidKit Core reuse decisions with compatibility checks, refines doctor messaging for global-only installations, and adds live progress output for `workspace run init`.

**What's New:**

- ✅ **Version-aware global Core reuse**
  - Global `rapidkit-core` reuse is now guarded by compatibility checks against required constraints.
  - Missing/unsupported constraint states now provide actionable fallback warnings.

- 🩺 **Optional workspace `.venv` advisory in doctor**
  - If Core is available globally but not in workspace `.venv`, doctor remains `ok` and now shows optional guidance to run:
    - `npx rapidkit workspace run init`

- ⏳ **Live progress for `workspace run init`**
  - Non-JSON runs now show start banner, per-project start lines, and completion lines with percentage and duration.
  - Removes long silent periods during dependency/bootstrap operations.

- 🧪 **Regression coverage expansion**
  - Added doctor test coverage for global-only Core + optional workspace `.venv` advisory behavior.
  - Existing workspace-run and doctor suites remain green.

**Upgrade:**

```bash
npm install -g rapidkit@0.27.5
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.27.5.md)

---

## Previous Release: v0.27.4 (May 11, 2026)

### 🧭 v0.27.4 — Import Command, Shared Parity Contract Gate, Evidence Schema Hardening, and Strict Doctor Scope Boundaries (Patch)

This patch introduces workspace import flows in the npm wrapper, hardens shared npm/extension import-stack parity gates, strengthens doctor/readiness schema compatibility behavior, and enforces strict doctor scope boundaries for deterministic behavior.

**What's New:**

- 🧭 **Strict project scope behavior**
  - `doctor project` no longer falls back to workspace-root backend markers when run from non-project paths inside a workspace.
  - Project mode now requires a real project directory boundary and returns explicit guidance when scope is invalid.

- 🏗️ **Stricter workspace architecture validation**
  - `doctor workspace` now validates workspace-root structure more strictly before execution.
  - Marker-only paths that do not satisfy RapidKit workspace architecture are rejected.

- 🧪 **New regression guarantees**
  - Added tests to prevent project-mode misclassification against workspace root.
  - Added tests to prevent workspace-mode execution on invalid marker-only roots.

- 📥 **New workspace import command**
  - Added: `npx rapidkit import <path|git-url> [--workspace <path>] [--name <project-name>] [--git] [--json]`
  - Supports local-folder copy and git clone imports.
  - Adds rollback-safe behavior when post-import workspace sync fails.
  - Adds deterministic JSON output including workspace resolution and suggested shell navigation.

- 🔒 **Shared parity contract gate hardening**
  - Added strict schema pinning for shared parity snapshot (`backend-import-stack-parity-v1`).
  - Added bidirectional key-set checks for framework/runtime parity mapping.
  - Added resilient snapshot path resolution with optional override:
    - `RAPIDKIT_BACKEND_IMPORT_PARITY_SNAPSHOT`
  - Added CI gate to run `npm run test:parity-contract` in npm pipeline.

- 🧾 **Doctor evidence compatibility hardening**
  - Introduced explicit doctor evidence schema compatibility checks.
  - Unknown/incompatible schema versions are now treated as invalid evidence (safe fallback).
  - Legacy evidence without schema tags remains supported.

- 🧠 **Canonical backend metadata alignment**
  - Doctor JSON outputs now include canonical backend identity fields:
    - `frameworkKey`
    - `importStack`
  - Runtime/framework normalization was consolidated through shared backend contract utilities.

**Upgrade:**

```bash
npm install -g rapidkit@0.27.4
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.27.4.md)

---

## Previous Release: v0.27.3 (May 9, 2026)

### 🎯 v0.27.3 — Doctor Project Scope, Workspace Run Orchestration, and OSS Docs Cleanup (Patch)

This patch adds project-scoped doctor diagnostics, introduces enterprise-grade workspace stage orchestration in the npm wrapper, hardens workspace-root command semantics, and cleans OSS-facing docs from internal enterprise-path references.

**What's New:**

- 🔍 **New canonical `doctor project` scope**
  - Added `npx rapidkit doctor project` as first-class scope.
  - Supports nested-directory resolution to nearest parent project.
  - Supports JSON output and scoped `--fix` flows.

- 🧾 **Doctor contract + explainability metadata expanded**
  - JSON/evidence outputs now expose deterministic metadata for automation:
    - `contract`
    - `scoreBreakdown`
    - `summary.scopeProvenance`
    - `driftDelta`

- 🚀 **Workspace run orchestration implemented and covered**
  - Added workspace stage runner and registry contracts for polyglot fleets:
    - `workspace run <init|test|build|start>`
    - affected-only selection (`--affected`)
    - blast-radius expansion (`--blast-radius`)
    - parallel execution (`--parallel`, `--max-workers`)
    - machine output (`--json`)
    - gate control (`--strict`, `--no-gates`)

- 🧭 **Root init aliases unified**
  - At workspace root, these now follow one mirrored full-init flow:
    - `npx rapidkit init`
    - `npx rapidkit workspace init`
    - `npx rapidkit workspace run init`

- 📚 **OSS docs cleanup**
  - Removed internal enterprise-path links from OSS README/docs index.
  - Removed duplicate enterprise governance runbook file from `docs/` in npm package repo.

**Upgrade:**

```bash
npm install -g rapidkit@0.27.3
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.27.3.md)

---

## Previous Release: v0.27.2 (May 4, 2026)

### 🩺 v0.27.2 — Smart Doctor Classification, Advisory Alignment, and Readiness Docs (Patch)

This patch upgrades doctor intelligence for realistic multi-runtime analysis, improves advisory signal consistency, and aligns release-facing docs with current CLI command ownership.

**What's New:**

- 🧠 **Signal-based framework detection in `doctor workspace`**
  - Replaced static Node assumptions with manifest/signal classification.
  - Prevents frontend stacks (for example Next.js) from being misreported as backend stacks (for example NestJS).

- 📊 **AI-friendly doctor metadata in JSON output**
  - Added project profile fields in `doctor workspace --json`:
    - `runtimeFamily`
    - `projectKind`
    - `supportTier`
    - `frameworkConfidence`

- ⚖️ **Advisory-warning summary behavior aligned**
  - Environment/security advisory context is now surfaced consistently in doctor summaries without forcing unrelated auto-fix execution.

- 🧾 **Release docs synchronized with CLI ownership reality**
  - README now explicitly documents `rapidkit readiness` as a CLI-level command.
  - `doctor workspace --fix` behavior is clarified for advisory-only scenarios.

- 🧪 **Regression coverage extended for doctor classification**
  - Added/updated tests to lock in Next.js detection and prevent NestJS mislabel regressions.

**Upgrade:**

```bash
npm install -g rapidkit@0.27.2
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.27.2.md)

---

## Previous Release: v0.27.1 (May 3, 2026)

### 🤖 v0.27.1 — AI Install Flow, Contract Sync, and Coverage Policy Hardening (Patch)

This patch closed AI recommendation UX gaps, aligned module identity parsing to formal contracts, and broadened coverage accounting for critical CLI paths.

- ✅ AI recommend install execution flow (no placeholder dead-end)
- 🔒 `slug`-first module identity parsing for contract safety
- 🎯 Case-insensitive keyword normalization for recommendation quality
- 🧪 Coverage policy expansion for core CLI surfaces

**Upgrade:**

```bash
npm install -g rapidkit@0.27.1
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.27.1.md)

---

## Previous Release: v0.27.0 (April 27, 2026)

### 🧩 v0.27.0 — Workspace Share CLI Option Parsing Fix (Patch)

This patch fixes `workspace share` option parsing so exported bundles can reliably use explicit output and evidence flags.

**What's New:**

- ✅ **`workspace share --output` now parses correctly**
  - Fixed Commander action-handler binding to ensure command options are read from the proper command context.
  - Prevents `unknown option '--output'` style failures in real-world `npx` usage.

- 🧰 **Workspace share flags are now consistently honored**
  - `--output <file>` writes bundle to the requested path.
  - `--include-paths` includes absolute workspace/project paths when explicitly requested.
  - `--no-doctor` reliably excludes doctor evidence from the exported bundle.

- 🧪 **CLI help/contract alignment maintained**
  - Updated command/help coverage so the workspace share surface stays stable across wrapper entry paths.

**Upgrade:**

```bash
npm install -g rapidkit@0.27.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.27.0.md)

---

## Previous Release: v0.26.0 (April 24, 2026)

### ☕ v0.26.0 — Spring Boot Generator, Java Runtime Adapter, and Release Hardening (Minor)

This release adds first-class Java/Spring support to RapidKit, including a new Spring Boot generator, a dedicated Java runtime adapter, stronger Windows/workspace preflight behavior, and broader automated coverage across the CLI.

**What's New:**

- ☕ **New `springboot.standard` generator**
  - Generates Spring Boot projects with launcher scripts, Docker assets, CI workflow scaffolding, and production-oriented defaults.
  - Adds generated health/management configuration and Spring-oriented bootstrap assets.

- 🧰 **New Java runtime adapter**
  - Supports `init`, `dev`, `test`, `build`, `start`, prereq checks, and cache preparation.
  - Detects Maven vs Gradle projects and prefers checked-in wrappers when available.

- 🛡️ **Java/Spring hardening**
  - Validates installed Java against project `pom.xml` requirements, including nested Java projects inside workspace roots.
  - Repairs missing wrapper execute bits on Unix and falls back to `sh` when needed.
  - Hardens generated Spring CI so Windows wrapper bootstrap no longer relies on fragile ambient behavior.

- 🧪 **Coverage and validation expansion**
  - Full suite: `986 passed | 11 skipped`.
  - `src/runtime-adapters/java.ts` raised to `85.66%` statements / `86.73%` lines.
  - `src/utils/platform-capabilities.ts` is now fully covered at `100%` across all metrics.

- 📦 **Reliable bundle analysis for this CLI**
  - Replaced the browser-oriented `npm run analyze` flow with a native `dist/` analyzer for Node CLI artifacts.

**Upgrade:**

```bash
npm install -g rapidkit@0.26.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.26.0.md)

---

## v0.25.7 (April 19, 2026)

### 🐹 v0.25.7 — Go Generator Template Consolidation (Patch)

This patch refactors the Go kit scaffolding internals to remove duplicated template blocks across `gofiber.standard` and `gogin.standard`, while keeping generated project behavior unchanged.

**What's New:**

- ♻️ **Shared Go generator template module**
  - Added `src/generators/go-kit-common.ts` for common builder logic.
  - Moved shared template construction for `Makefile`, `rapidkit` (shell launcher), and `rapidkit.cmd` (Windows launcher).

- 🧱 **Cleaner Go kit generators**
  - `src/generators/gofiber-standard.ts` and `src/generators/gogin-standard.ts` now focus on kit-specific variables and call shared builders.
  - Reduced code duplication and lowered maintenance cost for future Go kit changes.

- 🔒 **Pinned bootstrap tooling versions**
  - Generated launchers and make targets now use pinned tool installs for reproducibility:
    - `github.com/air-verse/air@v1.52.3`
    - `github.com/swaggo/swag/cmd/swag@v1.16.3`

- 🧹 **Simpler generated `go.mod` files**
  - Removed oversized indirect dependency blocks from default templates and kept direct dependency declarations.

**Upgrade:**

```bash
npm install -g rapidkit@0.25.7
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.7.md)

---

## v0.25.6 (April 19, 2026)

### 🔒⚡ v0.25.6 — Security Patch, Lazy Imports & Coverage (Patch)

Addresses a security advisory in devDependencies, reduces the cold-start bundle size by 51% through lazy imports, fixes an incorrect `fs-extra` import, and expands unit test coverage for error branches in the workspace creation pipeline.

**What's New:**

- 🔒 **0 vulnerabilities** (was 10: 1 critical, 7 high, 2 moderate)
  Resolved via `npm audit fix` on transitive devDependencies (`basic-ftp`, `rollup`, `flatted`, `minimatch`, `picomatch`, `vite`, `serialize-javascript`, `yaml`, `brace-expansion`). No production API changes.

- ⚡ **`dist/index.js` 258 KB → 126 KB (-51%)** via lazy imports
  Five heavy modules (`create`, `demo-kit`, `gofiber-standard`, `gogin-standard`, `doctor`) are now loaded on first use. Lightweight commands like `--version` / `--help` no longer parse all creation/doctor code at startup.

- 🚀 **Startup time 366 ms → 317 ms**

- 🐛 **Fixed `import fsExtra from 'fs-extra'`** — corrected from `import * as fsExtra` to a proper default import, avoiding subtle method-resolution issues at runtime.

- 🧪 **7 new unit tests** covering previously uncovered branches in `registerWorkspaceAtPath` and `createDemoWorkspace` (git init fail/success, poetry venv fallback, pipx install path, install throw, registry import silent fail, demo workspace git fail).

**Upgrade:**

```bash
npm install -g rapidkit@0.25.6
```

---

## v0.25.5 (April 18, 2026)

### 🪟 v0.25.5 — Windows Doctor Shadow Detection (Patch)

Prevents a Windows-specific edge case where a workspace-local `rapidkit.cmd` launcher shadows the global CLI during `rapidkit doctor --workspace`, causing unexpected behaviour.

**What's New:**

- 🪟 **Windows doctor shadow detection**
  When running `doctor --workspace` (or `doctor --scope workspace`) on Windows, the CLI now checks for a local `rapidkit.cmd` / `rapidkit.exe` in the workspace tree.
  If found, it prints a clear yellow warning and routes the doctor workflow through the npm-wrapper path directly — bypassing the ambiguous binary resolution.

- 🧪 **Extended test coverage** for the new detection logic in `phase3-commands.test.ts`

**Upgrade:**

```bash
npm install -g rapidkit@0.25.5
```

---

## v0.25.4 (April 16, 2026)

### ⚡ v0.25.4 — Update Check Caching (Patch)

Eliminates the blocking `npm view rapidkit version` network call on every CLI invocation by caching the result to disk.

**What's New:**

- ⚡ **4-hour disk cache for update checks**
  - Result is stored in `~/.rapidkit/cache/update-check.json`.
  - Subsequent invocations within 4 hours skip the network call entirely.
  - Cache is version-keyed: automatically invalidated when the installed CLI version changes.

- 🔒 **Silent failure guarantee preserved**
  - Cache write failures never block the CLI (same as before).
  - Network errors still fail silently.

**Upgrade:**

```bash
npm install -g rapidkit@0.25.4
```

---

## v0.25.3 (March 22, 2026)

### 🩺 v0.25.3 — Doctor Workspace Caching, Evidence, and Safer Auto-Fix (Patch)

This patch upgrades `rapidkit doctor workspace` performance and reliability with project-scan caching, machine-readable evidence output, post-fix verification, and safer Go auto-fix behavior when the Go toolchain is missing.

**What's New:**

- ⚡ **Workspace doctor caching + faster repeat checks**
  - Reuses cached workspace project scans when signatures are unchanged.
  - Emits cache metadata in JSON output for traceability.

- 🧾 **Evidence output for each doctor run**
  - Writes and refreshes run evidence at `.rapidkit/reports/doctor-last-run.json`.
  - Includes health summary, system checks, project findings, and cache context.

- 🧠 **Safer and clearer `doctor workspace --fix` flow**
  - URL-based fixes are recorded as manual guidance (not executed as shell commands).
  - `go mod tidy` fixes are skipped when Go is unavailable, with explicit install-and-rerun hints.
  - Post-fix verification runs automatically and refreshes evidence.

- 📚 **Doctor UX and docs alignment**
  - Clarified `doctor` (system check) vs `doctor workspace` (full workspace health) across CLI messaging and README.

**Upgrade:**

```bash
npm install -g rapidkit@0.25.3
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.3.md)

---

## Previous Release: v0.25.2 (February 27, 2026)

### 🧠 v0.25.2 — Smart Init Orchestration, Clearer Go UX, and Delegation Boundary Hardening (Patch)

This patch makes `rapidkit init` significantly more resilient across Python/Node/Go projects by enforcing wrapper-owned orchestration with runtime-aware fallbacks, then closes delegation edge-cases that caused noisy/misleading Go command failures.

**What's New:**

- 🧭 **Explicit command ownership matrix for wrapper vs core**
  - `init` is now an explicitly wrapper-orchestrated project command to keep policy + fallback behavior consistent.
  - Added contract doc: `docs/contracts/COMMAND_OWNERSHIP_MATRIX.md`.

- 🚀 **Smart multi-runtime `init` behavior**
  - Runtime inference improved via project metadata + file heuristics (`go.mod`, `package.json`, `pyproject.toml`, `requirements.txt`).
  - Python init now enforces project-local `.venv` usage and has pip-based fallback install paths.
  - Node init now attempts package-manager fallbacks when primary install path fails.

- 🛡️ **Delegation boundary hardening**
  - Go/Node lifecycle commands (`dev/start/build/test`) remain on wrapper/runtime adapter path where needed.
  - Prevents misrouting of flags (e.g., `dev --port`) into unintended local-launcher/Makefile paths.

- 🗣️ **Go missing-toolchain UX fix**
  - `rapidkit init` and lifecycle commands now emit clear actionable error messages when Go is missing, instead of silent/noisy failure patterns.

**Upgrade:**

```bash
npm install -g rapidkit@0.25.2
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.2.md)

---

## Previous Release: v0.25.1 (February 27, 2026)

### 🛠️ v0.25.1 — Poetry Fallback Stabilization, Multi-Platform Doctor Hardening, and Windows Workspace Launcher Coverage (Patch)

This patch release finalizes the new Poetry-missing fallback behavior, hardens cross-platform doctor/tool detection, and closes the remaining legacy Windows workspace launcher gap.

**What's New:**

- 🐍 **Poetry fallback stabilization in create flow**
  - If `installMethod=poetry` is selected but Poetry is unavailable, workspace creation now reliably auto-falls back to `venv` without blocking install prompts.
  - Behavior is applied consistently across interactive create and registration paths.

- 🌍 **Cross-platform detection hardening**
  - `doctor` now checks `python -m poetry` and `python -m pipx` across Python candidates when binaries are missing.
  - Tool path probing now relies on centralized platform-capability helpers rather than fragmented ad-hoc path assumptions.

- 🪟 **Legacy workspace launcher parity on Windows**
  - Workspace creation now emits both `rapidkit` and `rapidkit.cmd` wrappers so local workspace commands have native Windows entry points.

- 🧪 **Test contract alignment**
  - Updated create-internal Poetry tests to match intentional fallback semantics while preserving pipx behavior guarantees.
  - Full test suite remains green after alignment.

**Upgrade:**

```bash
npm install -g rapidkit@0.25.1
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.1.md)

---

## Latest Release: v0.25.0 (February 26, 2026)

### 🧭 v0.25.0 — Help Surface Unification, Workspace Policy/List Contract Completion, and Reliability Hardening (Minor)

This minor release unifies the root help UX across entry modes, completes workspace command contract coverage (`workspace list`, policy set/show) across docs/tests/help text, and hardens runtime/workspace reliability for production workflows.

**What's New:**

- 🧱 **Workspace command contract completion**
  - Standardized/expanded workspace command references (including `workspace list`) across:
    - root help output
    - README/docs command examples
    - docs drift guard expectations
    - CLI integration and contract test suites

- 🧪 **Phase-3 contract and process coverage expansion**
  - Extended process-level integration coverage for workspace policy operations and list flows.
  - Strengthened command contract tests for lifecycle/policy behavior and help consistency.
  - Added deterministic dist-refresh handling in CLI entry tests when build artifacts are missing/stale.

- ⚙️ **Runtime/workspace hardening updates**
  - Improved bridge/runtime execution reliability and adapter-path handling in wrapper-core integration.
  - Hardened workspace registry behavior (normalization/dedupe/pruning paths) and reduced noisy debug output.
  - Updated create/doctor/runtime flows to better align with workspace-first operations.

- 📚 **Governance and docs alignment**
  - Professionalized governance and setup docs to match current command contracts and release expectations.
  - CI/docs workflow alignment updates in:
    - `.github/workflows/ci.yml`
    - `.github/workflows/e2e-smoke.yml`

**Upgrade:**

```bash
npm install -g rapidkit@0.25.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.0.md)

---

## Latest Release: v0.24.2 (February 25, 2026)

### 🧱 v0.24.2 — Workspace Docs Governance, Runtime Warm-Setup Coverage, and CI Ownership Hardening (Patch)

This patch finalizes workspace-based architecture documentation and adds automated docs governance checks to keep command contracts, workflow ownership, and examples publish-safe for open-source release.

**What's New:**

- 📚 **Workspace architecture docs refresh**
  - Updated maintainer/user docs for canonical workspace lifecycle:
    - `docs/SETUP.md`
    - `docs/doctor-command.md`
    - `docs/README.md`
    - `docs/OPEN_SOURCE_USER_SCENARIOS.md`
  - Canonical doctor usage standardized to `rapidkit doctor workspace`.

- ✅ **Automated docs governance gates**
  - Added local markdown link validation:
    - `scripts/check-markdown-links.mjs`
  - Added docs drift guard for command/workflow contract presence in README:
    - `scripts/docs-drift-guard.mjs`
  - Added README command smoke script against built CLI:
    - `scripts/smoke-readme-commands.mjs`
  - Wired docs checks into npm scripts and CI Linux lane:
    - `package.json` (`check:markdown-links`, `check:docs-drift`, `smoke:readme`, `validate:docs`)
    - `.github/workflows/ci.yml`

- 🧪 **Workspace E2E ownership and focus clarity**
  - Expanded lifecycle/chaos coverage in:
    - `.github/workflows/workspace-e2e-matrix.yml`
  - Narrowed bridge-only regression smoke scope to avoid overlap:
    - `.github/workflows/e2e-smoke.yml`

- ⚙️ **Runtime/setup contract alignment**
  - Added setup cache warm hooks for Node/Go adapters and setup-time warm dependency behavior.
  - Standardized setup help/usage surface and docs with `--warm-deps`.
  - Normalized legacy doctor hints to canonical workspace command wording.

**Upgrade:**

```bash
npm install -g rapidkit@0.24.2
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.24.2.md)

---

## Latest Release: v0.24.1 (February 25, 2026)

### 🧩 v0.24.1 — Setup Contract Fixes, Cross-OS CI Stability, and Workspace Flow Alignment (Patch)

This patch release resolves setup/runtime contract regressions, hardens cross-OS matrix reliability, and aligns create/setup behavior with local E2E expectations.

**What's New:**

- ✅ **Setup command contract consistency**
  - `rapidkit setup <runtime>` now runs without requiring `RAPIDKIT_ENABLE_RUNTIME_ADAPTERS=1`.
  - Restores expected S-03 workspace E2E behavior for setup flows.

- 🪟🍎 **CI matrix reliability for optional Rollup binaries**
  - Added macOS arm64 optional Rollup install workaround in matrix workflow:
    - `.github/workflows/workspace-e2e-matrix.yml`
  - Complements existing Windows optional dependency workaround to prevent matrix install failures.

- 🧭 **Create/setup behavior alignment**
  - `create` prompt defaults now respect configured values (`pythonVersion`, `defaultInstallMethod`) in profile-first flows.
  - Python runtime adapter prereq check now gracefully falls back to legacy `doctor` when needed.

- 🧪 **Test and workspace hygiene updates**
  - Updated command/runtime/create tests for the current setup and profile behavior.
  - Added `.rapidkit/` to git ignore for local generated artifacts.

**Upgrade:**

```bash
npm install -g rapidkit@0.24.1
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.24.1.md)

---

## Latest Release: v0.24.0 (February 25, 2026)

### 🧭 v0.24.0 — Windows Bridge E2E, Mirror Lifecycle Hardening, and Runtime Adapter Stability (Minor)

This minor release improves cross-OS confidence (especially Windows), introduces a production-ready mirror lifecycle foundation, and hardens runtime adapter behavior for workspace bootstrap and project operations.

**What's New:**

- 🪟 **Windows-native CI validation**
  - Added dedicated Windows bridge workflow to validate real bridge + workspace lifecycle in native PowerShell:
    - `.github/workflows/windows-bridge-e2e.yml`
  - Added/updated workspace matrix coverage file:
    - `.github/workflows/workspace-e2e-matrix.yml`

- 🪞 **Mirror lifecycle foundation + governance docs**
  - Added mirror lifecycle engine:
    - `src/utils/mirror.ts`
  - Added enterprise/open-source operational docs and templates:
    - `docs/ENTERPRISE_GOVERNANCE_RUNBOOK.md`
    - `docs/OPEN_SOURCE_USER_SCENARIOS.md`
    - `docs/mirror-config.enterprise.example.json`
    - `docs/governance-policy.enterprise.example.json`
    - `docs/policies.workspace.example.yml`
  - Added docs example validator:
    - `scripts/validate-doc-examples.mjs`

- 🧪 **Expanded reliability test surface**
  - Added focused mirror and scenario tests:
    - `src/__tests__/mirror-lifecycle.unit.test.ts`
    - `src/__tests__/mirror-evidence-export.integration.test.ts`
    - `src/__tests__/mirror-sigstore-branches.test.ts`
    - `src/__tests__/user-level-scenarios.integration.test.ts`

- ⚙️ **Runtime adapter and bridge hardening**
  - Improved adapter environment/caching behavior for Python, Node, and Go runtimes.
  - Stabilized Python bridge execution environment handling in runtime adapter integration path.

- 📚 **UX/docs alignment and cleanup**
  - Continued alignment between CLI help, README, and command behavior.
  - Removed obsolete phase-specific docs from active documentation set.

**Upgrade:**

```bash
npm install -g rapidkit@0.24.0
```

[📖 Full Release Notes](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.24.0.md)

---

## Previous Releases

| Version                                                                                                 | Date         | Highlights                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| [v0.25.3](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.3.md) | Mar 22, 2026 | Doctor workspace caching/evidence, safer go fix gating, post-fix verification                     |
| [v0.25.2](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.2.md) | Feb 27, 2026 | Smart init orchestration, wrapper/core ownership matrix, Go UX + delegation hardening             |
| [v0.25.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.1.md) | Feb 27, 2026 | Poetry fallback stabilization, cross-platform doctor hardening, Windows workspace launcher parity |
| [v0.25.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.25.0.md) | Feb 26, 2026 | Help surface unification, workspace policy/list contract completion, reliability hardening        |
| [v0.24.2](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.24.2.md) | Feb 25, 2026 | Workspace docs governance, docs drift/link/smoke gates, CI ownership hardening                    |
| [v0.24.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.24.1.md) | Feb 25, 2026 | Setup contract fixes, cross-OS matrix reliability, workspace flow alignment                       |
| [v0.24.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.24.0.md) | Feb 25, 2026 | Windows-native bridge E2E, mirror lifecycle hardening, runtime adapter stability                  |
| [v0.23.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.23.1.md) | Feb 22, 2026 | Audit stabilization, minimatch override, Windows CI path fix                                      |
| [v0.23.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.23.0.md) | Feb 22, 2026 | Workspace architecture phases 1→4, runtime/command contracts, npm global install hotfix           |
| [v0.22.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.22.0.md) | Feb 21, 2026 | Go/Fiber + Go/Gin kits, Go command parity, Swagger DX hardening                                   |
| [v0.21.2](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.21.2.md) | Feb 20, 2026 | Release flow modernization, npm-only policy, security/doc alignment                               |
| [v0.21.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.21.1.md) | Feb 18, 2026 | Context-aware init, create workspace mode, doctor workspace scan fix                              |
| [v0.20.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.20.0.md) | Feb 14, 2026 | FastAPI DDD Kit, Domain-Driven Design template, offline support                                   |
| [v0.19.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.19.1.md) | Feb 12, 2026 | Dependency refresh, lockfile sync, Python template compatibility                                  |
| [v0.19.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.19.0.md) | Feb 10, 2026 | AI module recommender, semantic search, config commands                                           |
| [v0.18.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.18.1.md) | Feb 9, 2026  | Windows CI path normalization fix                                                                 |
| [v0.18.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.18.0.md) | Feb 9, 2026  | Contract sync, modules catalog API, Python bridge reliability                                     |
| [v0.17.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.17.0.md) | Feb 6, 2026  | Enhanced doctor command, workspace health monitoring, auto-fix                                    |
| [v0.16.5](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.16.5.md) | Feb 5, 2026  | Configuration file support, doctor command, diagnostics                                           |
| [v0.16.4](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.16.4.md) | Feb 2, 2026  | Documentation quality, test stability, code polish                                                |
| [v0.16.3](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.16.3.md) | Feb 1, 2026  | Template fixes, Python Core 0.2.2 compatibility, test updates                                     |
| [v0.16.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.16.0.md) | Feb 1, 2026  | Workspace registry, unified signatures, cross-tool integration                                    |
| [v0.15.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.15.1.md) | Jan 31, 2026 | Bridge stability, command fallback, improved test coverage                                        |
| [v0.15.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.15.0.md) | Jan 30, 2026 | Core integration, workspace UX, Scenario C fix, tests & CI                                        |
| [v0.14.2](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.14.2.md) | Jan 23, 2026 | Documentation & cleanup                                                                           |
| [v0.14.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.14.1.md) | Dec 31, 2025 | Poetry virtualenv detection fix                                                                   |
| [v0.14.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.14.0.md) | Dec 31, 2025 | Major dependency updates                                                                          |
| [v0.13.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.13.1.md) | Dec 25, 2025 | Type safety & test coverage                                                                       |
| [v0.13.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.13.0.md) | Dec 22, 2025 | NestJS test coverage boost                                                                        |
| [v0.12.9](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.9.md) | Dec 22, 2025 | Unified npx commands                                                                              |
| [v0.12.8](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.8.md) | Dec 13, 2025 | Windows spawn fix                                                                                 |
| [v0.12.7](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.7.md) | Dec 13, 2025 | Windows support                                                                                   |
| [v0.12.6](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.6.md) | Dec 12, 2025 | Quality & security infrastructure                                                                 |
| [v0.12.5](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.5.md) | Dec 6, 2025  | CI/CD cross-platform fixes                                                                        |
| [v0.12.4](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.4.md) | Dec 6, 2025  | Shell activation UX                                                                               |
| [v0.12.3](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.3.md) | Dec 4, 2025  | Smart CLI delegation                                                                              |
| [v0.12.2](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.2.md) | Dec 4, 2025  | Auto-activate in init command                                                                     |
| [v0.12.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.1.md) | Dec 3, 2025  | NestJS port fix                                                                                   |
| [v0.12.0](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.12.0.md) | Dec 3, 2025  | NestJS support                                                                                    |
| [v0.11.3](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.11.3.md) | Dec 3, 2025  | Bug fixes                                                                                         |
| [v0.11.2](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.11.2.md) | Dec 3, 2025  | Improvements                                                                                      |
| [v0.11.1](https://github.com/chistiq/workspai/blob/main/packages/cli/releases/RELEASE_NOTES_v0.11.1.md) | Nov 28, 2025 | Features                                                                                          |
| [v0.11.0](CHANGELOG.md#0110---2025-11-14)                                                               | Nov 14, 2025 | Major release                                                                                     |

For complete changelog, see [CHANGELOG.md](CHANGELOG.md).
