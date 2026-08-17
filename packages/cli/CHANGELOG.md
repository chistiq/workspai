# Changelog

All notable changes to Workspai CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.59.1] - 2026-08-17

### Changed

- Made contract delivery consumer-aware before publication: contract-affecting
  commits regenerate and synchronize local mirrors, pre-push requires generated
  CLI outputs to be committed, and consumer mirror drift cannot delay a
  backward-compatible npm delivery.
- Kept consumer release policy independent from CLI schema ownership, so an
  extension can require capabilities from an already published CLI without
  forcing a redundant CLI release.

### Fixed

- Stabilized the Windows coverage lane by bounding filesystem-heavy test
  concurrency, using platform-aware transaction budgets, making temporary
  workspace cleanup retry-safe, and allowing registry-lock acquisition to
  outlive its stale-lock recovery threshold.  

## [0.59.0] - 2026-08-17

### Added

- Added a portable canonical-first project entry manifest, adapters for major
  coding-agent hosts, and machine-readable bootstrap/verification receipts that
  fail closed on broken workspace binding, schema, integrity, Model/Graph
  freshness, live input, or active Goal evidence.

### Changed

- Reworked root help around the complete `Understand → Impact → Act → Verify`
  path, outcome-first commands for new users, readable wrapping for long
  examples, and an ownership-grouped command map generated from the same
  runtime inventory consumed by `commands --json`.
- Made managed project grounding route agents through canonical Workspai
  evidence before broad source discovery while preserving authored instruction
  files, symbolic links, and explicit degraded-mode semantics.
- Made `generic` Workspace Intelligence publish one provider-neutral context
  plus every supported host entry surface, and promoted the mandatory Workspai
  gate ahead of authored repository guidance without replacing authored text.
- Distinguished logical workspace identity, project-local `.workspai` paths,
  portable `workspace:` URIs, and runtime-private absolute path resolution in
  every project entry contract and host adapter.

- Enforced ASCII English across authored source, tests, fixtures,
  documentation, release material, and filenames with full-repository and
  staged-content guards; language-neutral Unicode symbols remain supported.
- Kept valid user-defined engineering objectives executable even when the local
  deterministic classifier does not recognize their language or domain. Goal
  categories now tune retrieval and exact verification instead of acting as an
  allowlist; custom outcomes retain the original objective, governed scope,
  evidence bindings, approval, repair, rollback, and attempt policy.
- Extended model-proposal repair to source files in exactly one canonically
  registered linked project while retaining CLI-owned checkpoint, validation,
  verification, and rollback semantics.
- Enforced each Goal Pack's immutable `maxAttempts` policy in CLI verification
  using the durable verified-goal attempt record, so a restarted IDE or agent
  cannot reset the governed execution budget.
- Serialized Goal-bound proposal creation and verification, retained the
  bounded transaction history, and sealed every successful source transition
  with post-repair Model, Graph, stable Graph-input, checkpoint, and closure
  hashes so concurrent retries and unrelated source drift fail closed.
- Published explicit Goal source-transition and durable-attempt capability
  invariants so IDEs can reject older runtimes before a mutation begins instead
  of relying on package-version inference.

### Fixed

- Aligned `workspace verify --json` envelope exit codes with the evaluated gate
  and process exit code, so strict-mode consumers never receive `exitCode: 0`
  for a blocked verification artifact.
- Made Goal retrieval objective-first and relevance-ranked through the canonical
  Graph query engine, with bounded category fallback that cannot fill the agent
  evidence budget before the user's actual request is evaluated.
- Corrected general Goal completion language so Workspace Verify proves safety
  and evidence freshness without being presented as machine proof of an
  arbitrary semantic outcome, and recognized named-project phrasing such as
  `Prepare gRPC for release` as release readiness.
- Prevented Goal plans that still need evidence or confirmation from replacing
  an existing active objective; only `ready-to-plan` entries may become active.
- Deduplicated protected-path decision reasons so consumers receive one stable,
  actionable explanation instead of repeated canonical-evidence errors.
- Kept unchanged live source bindings valid across evidence-only Graph reruns by
  comparing the stable Graph input fingerprint rather than volatile artifact
  timestamps.
- Preserved stale or invalid selected Goals as present in agent bootstrap
  receipts and emitted an exact evidence-refresh command instead of reporting
  the Goal as absent or leaving the agent without a recovery path.
- Made each bootstrap receipt bind its `requiredReadOrder` to the resolved host
  (or `all` during a complete host audit) instead of routing every consumer
  back through the provider-neutral `generic` bootstrap step.

### Security

- Kept linked-project repair fail-closed for absolute, unregistered, sibling,
  parent, and symbolic-link boundaries; portable execution paths remain durable
  CLI identity and must be projected project-relative by consumers.
- Prevented agent entry manifests and bootstrap receipts from emitting
  machine-local absolute paths; contract and integrity validation now happens
  before an agent may claim complete architecture or verification.
- Classified the explicit workspace resolver's absolute paths as runtime-only,
  non-portable data that agents must not persist, disclose, or copy into shared
  output.

## [0.58.0] - 2026-08-16

### Added

- Added the governed `goal <intent>` front door with immutable Goal Packs,
  consumer handoffs, deterministic retrieval anchors, measurement-capability
  preflight, and an agent-discoverable active-goal lifecycle index.
- Added explicit Goal lifecycle controls for status, list, activate, cancel,
  deterministic verification preparation, and CLI-owned verification; repair
  proposals may bind to an active Goal without widening its project scope.
- Unified all successful Goal lifecycle JSON responses behind the published
  `workspai.goal-lifecycle-result.v1` contract and made lifecycle failures use
  operation-specific machine-readable error codes.

### Changed

- Made Goal integrity semantics explicit: structural Model hashes and canonical
  JSON Graph/Goal hashes are distinct from the stable Goal identity fingerprint.
- Hardened Goal lifecycle recovery and state invariants: successful
  prepare/verify flows retain one selected objective, verified completion clears
  it, stale goals remain listable/cancellable, and malformed or duplicate index
  entries fail closed.
- Added strict option exclusivity, empty-scope and empty-retrieval blocking,
  broader local-path/secret rejection, shell-safe generated commands, and
  permanent real-repository Goal qualification scenarios.
- Sealed canonical Model/Graph freshness after CLI-managed agent grounding so
  a completed Intelligence chain cannot invalidate itself before Goal, Graph,
  IDE, or agent consumers read it.
- Made real-world qualification snapshot-first and added cumulative
  workspace-scoped Goal assertions without retaining raw output or local paths.

## [0.57.0] - 2026-08-15

### Changed

- Reworked Doctor's human output around an authoritative verdict and separate
  blocking, advisory, unknown, contradiction, and not-applicable accounting;
  the legacy percentage is now explicitly a diagnostic pass rate rather than a
  workspace health claim.
- Added independent project archetype classification so libraries, SDKs,
  plugins, monorepos, and cross-language platforms do not receive service-only
  migration, health-endpoint, environment, or boot-entrypoint warnings.
- Made Doctor's default terminal output summary-first, portable-path safe, and
  remediation-plan first; `--verbose` retains full probe and lifecycle detail.
- Made source-structure extraction resolve local imports against the complete
  bounded fingerprint inventory while retaining a smaller extraction sample,
  reducing false unresolved edges in large repositories without unbounded
  graph growth.
- Made multi-term graph retrieval require meaningful term coverage before a
  generic service/API intent boost can qualify a result.
- Added versioned `workspai.adopt-effects.v1` preview data so adoption consumers
  can show project metadata, repository-control reconciliation, and downstream
  workspace intelligence operations before writing.
- Added reproducible isolated and cumulative real-world qualification harnesses
  for polyglot repositories and the read-mostly enterprise command surface.
- Made qualification reports publication-safe by default: machine-specific
  roots are mandatory runtime inputs, project identifiers are anonymized, raw
  command output and invocation paths are omitted, and a fail-closed guard
  rejects local paths before a report can be written.
- Made nested runtime composition first-class across adoption, Doctor, project
  metadata, and command capabilities; composite repositories now state when
  lifecycle coverage belongs only to the primary runtime adapter.
- Added bounded JSON receipts for full `workspace graph emit` and
  `workspace contract graph` exports when `--output` is supplied, preventing
  large graph artifacts from flooding agent, IDE, or CI stdout buffers.

### Fixed

- Fixed `doctor workspace` and `doctor --workspace` failing to resolve the
  canonical workspace when invoked from an adopted or linked project.
- Fixed managed project grounding recreating an intentionally deleted tracked
  `AGENTS.md` file.
- Fixed re-adopt dry runs reporting that workspace commands could not resolve
  even when the existing project binding was valid.
- Fixed strict Workspace Intelligence summaries reporting zero blocking reasons
  without identifying that strict policy had gated advisory or incomplete
  evidence.
- Fixed local import relations targeting source files outside the extraction
  sample producing missing target entities.
- Fixed adoption following or replacing authored `AGENTS.md` symbolic links;
  repository symlinks are preserved while portable project grounding remains
  available under `.workspai`.
- Fixed empty manifest identifiers producing schema-invalid Knowledge Graph
  entity labels; providers now reject empty identifiers and the graph state
  enforces non-empty labels and aliases as a final invariant.
- Fixed snapshot create, list, inspect, and restore failures emitting human
  prose under `--json`; failures now use the shared versioned operation-error
  envelope for CI, IDE, and agent consumers.
- Updated the transitive development-toolchain `nanoid` dependency to the
  patched release so both production and full npm audits report zero known
  vulnerabilities.
- Fixed canonical Git containment checks across macOS physical-path aliases and
  Windows cross-drive workspace paths so managed grounding preserves authored
  tracked deletion without misclassifying unrelated repositories.
- Restored the complete cross-platform native dependency lock and added
  install/pre-push validation derived from Rolldown, Rollup, and esbuild
  metadata, preventing platform-pruned locks from reaching build or test
  startup.

## [0.56.0] - 2026-08-11

### Added

- Added a universal Doctor diagnosis boundary with stable finding identities,
  causal groups, confidence, proof bindings, repair disposition, explicit
  unknowns, contradictions, and six-domain completeness.
- Added versioned Doctor capability, validation, diagnosis, summary, and receipt
  contracts for CLI, IDE, CI, and agent consumers.
- Added a 17-adapter, 44-framework capability registry and a deterministic
  170-case validation corpus with explicit platform and limitation metadata.
- Added `doctor capabilities` filters, validation, and governed artifact output,
  plus bounded `--json=summary` and cache-bypassing `--fresh` Doctor modes.
- Added a live-input fingerprint to every persisted Knowledge Graph. Git
  worktrees use a bounded `git-worktree-v2` signature and other sources use a
  content-Merkle fallback, so read queries reuse persisted graphs only while
  their model, proofs, project scopes, and source contents still match.
- Added `--refresh-graph` as an explicit bypass for persisted graph retrieval,
  plus project-scoped Graph search and benchmark execution.
- Added proof-backed C/C++ language, CMake/Bazel package, runtime-unit, and
  lifecycle-stage graph coverage, including CMake and Meson fleet plans.
- Added Protocol Buffers service/message identity variants and cross-language
  protocol bindings without collapsing distinct definitions that share an FQN.
- Added bounded agent search projections with explicit omission budgets for
  entities, relations, proofs, aliases, attributes, and proof references.

### Changed

- Made Readiness, Verify, remediation planning, and Repair consume the canonical
  Doctor diagnosis rather than independently interpreting legacy issue strings.
- Made not-applicable checks non-inflating and stale or unobserved providers
  explicit unknowns instead of implied success.
- Kept multi-project remediation actions attached to their diagnosis finding and
  causal key through planning and transaction closure.
- Bound missing verification evidence to the exact step `sourceCommand` and
  `sourceArtifact` so consumers refresh the correct producer.
- Made re-adoption refresh Workspai-managed runtime, framework, kit, registry,
  and workspace-contract metadata instead of retaining stale detection state.
- Made broad architecture queries intent-aware and project scope
  relation-aware, so shared APIs, schemas, owners, pipelines, and language
  bridges remain discoverable without leaking unrelated project facts.
- Made `workspace run` discover polyglot runtime units and support dry planning
  with `--plan` plus runtime selection with `--runtime <runtime>`.
- Made graph benchmarks resolve portable `external/<project>/...` proof paths
  through the workspace contract for linked projects.
- Made pre-commit staged and read-only, and consolidated pre-push validation so
  full tests, builds, contracts, and conformance gates do not run repeatedly.

### Fixed

- Fixed generic `run-analyze` guidance being attached to missing project
  init/test/build/start evidence owned by `workspace run`.
- Fixed unrelated causal findings leaking into a selected repair transaction or
  preventing truthful target closure.
- Fixed advisory dependency subjects and not-applicable probes being counted as
  blocking vulnerabilities or warnings.
- Fixed fresh Doctor runs reusing stale project scan state beyond the governed
  cache boundary.
- Fixed backward-compatible CLI releases automatically raising the extension
  compatibility floor and creating artificial cross-repository drift.
- Fixed root CMake/Meson C/C++ repositories being downgraded to `unknown` or a
  secondary binding runtime when nested Python or Node manifests were present.
- Fixed C++ headers being classified as C in C++-primary repositories and fixed
  empty generated graph labels that violated the graph contract.
- Fixed scoped search excluding workspace-level shared entities connected to
  the selected project and fixed same-FQN Protobuf definitions being merged
  into ambiguous identities.
- Fixed Analyze, Doctor, Workspace Run, and graph benchmarking treating linked
  external projects as absent or resolving their portable artifacts beneath
  the central workspace directory.
- Fixed re-adopt terminal output showing `Stack: unknown` when the detected
  runtime/framework supplied a truthful display label.
- Fixed Git-backed graph fingerprints falling back to content hashing when
  macOS `/var` aliases or Windows workspace junctions made the logical scope
  path differ from Git's physical worktree path.

### Verification

- The complete restricted-environment suite produced 2,413 passes and 8
  explicit skips. Seven loopback-listener cases were environment-blocked; all
  three owning suites passed 60/60 when rerun with loopback access.
- 234 focused adoption, lifecycle, model, graph, query, consumer, and contract
  tests passed across 10 files.
- The 170-case Doctor validation corpus passed across all 17 runtime adapters.
- Type checking, linting, formatting, contract synchronization, contract
  parity, and documentation validation passed.
- A nine-project polyglot fixture exercised the complete Workspace Intelligence
  chain and a typed, approval-bound Repair plan.
- A real linked gRPC repository produced 4,692 entities, 5,287 relations, and
  7,332 proofs with 100% proof coverage, zero conflicts, zero unknowns, and a
  non-truncated 10,439-file live-input fingerprint. Its bounded benchmark read
  all 1,062 proof artifacts and reduced the estimated query payload from
  2,644,948 to 4,665 tokens (99.82%; results vary by workspace and query).

## [0.55.1] - 2026-08-08

### Changed

- Added typed decision causes for missing executables, unsupported adapters,
  failed preconditions, risk approval, policy exceptions, and source repairs so
  IDE and agent consumers can present the next safe action without parsing prose.
- Made multi-project Doctor repairs publish workspace scope unless one exact
  project is selected, preventing follow-up work from being routed to an
  arbitrary project.
- Added explicit release verdict, evidence freshness, and blocking posture to
  Workspace Explain reports.

### Fixed

- Fixed `needs-attention` Explain evidence with zero blocking reasons being
  rendered as a release blocker by downstream consumers.
- Fixed repair transactions exposing only a human-readable decision reason,
  which forced extensions and agents to guess whether a missing tool, policy
  exception, source repair, or approval was required.
- Fixed a Doctor transaction spanning multiple projects being advertised as
  project-scoped without an exact project identity.

### Verification

- Focused Explain, repair capability, and Repair Engine contract tests passed.
- Type checking, contract synchronization, CLI/extension contract parity, and
  package validation passed.

## [0.55.0] - 2026-08-07

### Changed

- Made approval bind to the complete semantics of every selected causal action
  and refresh the exact card producer before checkpoint or mutation.
- Made Python dependency materialization select Poetry, uv, or a project-local
  `.venv` from the declared project surface instead of assuming one manager.
- Replaced the unused big-library size preset with the file-only size plugin,
  preserving the bundle budget without its browser-time dependency chain.

### Fixed

- Fixed missing Python launchers leaking a raw `--version exited with code
undefined` failure instead of the actionable `PYTHON_NOT_FOUND` diagnostic.
- Fixed `workspace repair capabilities --project <name>` inspecting the
  workspace root instead of the selected managed or externally linked project.
- Fixed the final agent report index being published before Explain and the
  canonical run receipt existed, which could expose stale `exists: false`
  entries immediately after a completed Workspace Intelligence run.

### Verification

- Full CLI tests passed across 215 test files with 2,328 passing tests and 8
  explicit skips; type checking, documentation gates, contract synchronization,
  package validation, bundle limits and zero-vulnerability npm audit passed.

## [0.54.0] - 2026-08-07

### Added

- Added typed `dependency-materialization` repair transactions for projects
  whose declared dependencies exist but installed dependency state is missing.
- Added Doctor repair capabilities that carry project scope, package-manager
  invocation, risk, approval, transaction kind, and canonical verification
  requirements to downstream consumers.
- Added explicit repair adapters and executable preconditions for npm, pnpm,
  Yarn, Bun, Poetry, uv, pip, Go, Cargo, Composer, Bundler, Mix, Deno, dotnet,
  Maven, Gradle, Leiningen, and sbt project surfaces.
- Added target-aware transaction receipts with separate target status,
  workspace status, and remaining target-action identifiers.

### Changed

- Made Doctor remediation planning prioritize blocking findings and exclude
  unrelated advisory actions from the selected repair transaction.
- Made dependency materialization complete reconcile, audit, declared tests,
  declared build, and strict Workspace Intelligence verification without
  requiring a causal manifest or lockfile mutation.
- Made canonical verification evaluate transaction closure against the selected
  target while retaining unrelated workspace blockers as workspace evidence.
- Made unavailable conditional tooling fail closed with an explicit decision
  instead of falling through to shell or model inference.
- Kept new v1 verification receipt fields optional for backward-compatible
  loading while requiring the current engine to write them on new executions.

### Fixed

- Fixed a successful dependency install being rejected because no source file
  needed to change.
- Fixed advisory coverage or quality actions blocking a Doctor security or
  dependency-materialization transaction.
- Fixed a repaired project being rolled back or left blocked solely because a
  different project still failed the workspace-wide gate.
- Fixed Maven and Gradle executable normalization on Windows and executable
  basename handling across platforms.
- Fixed multi-runtime repair planning depending on npm-specific assumptions or
  first-project selection.

### Verification

- Full CLI tests passed across 215 test files with 2,317 passing tests and 8
  explicit skips; type checking and focused repair-engine suites passed.
- Contract synchronization, shared-contract parity, and CLI/extension contract
  parity passed.
- A real NestJS workspace repair installed 849 packages, completed a clean
  audit, passed 6 Jest suites and 10 tests, passed the production build, and
  closed the selected target while truthfully retaining an unrelated workspace
  blocker.

## [0.53.0] - 2026-08-06

### Added

- Added the CLI-owned `workspace repair` engine with durable `capabilities`,
  `plan`, `propose`, `approve`, `execute`, `resume`, `status`, `list`, `decide`,
  `rollback`, and `cancel` actions.
- Added published repair-capabilities, Studio card-repair, proposal, and
  transaction contracts for CLI, IDE, CI, and agent consumers.
- Added immutable plan hashes, executable/source preconditions, explicit
  approval, bounded file checkpoints, durable stage events, owner locking, and
  strict canonical verification.
- Added guarded model proposals for bounded complete-file writes and deletes
  plus structured audit, test, and build invocations.
- Added package-manager-aware repair adapters for Node, Python, Go, Rust,
  Composer, Bundler, Elixir, Deno, .NET, Maven, and Gradle project surfaces.
- Added multi-adapter project planning and a runtime acceptance matrix that
  distinguishes full, conditional, and unsupported repair paths.

### Changed

- Made the CLI the only authority that may execute, reconcile, verify, close,
  or roll back a workspace repair transaction.
- Made dependency-manifest proposals inherit reconcile, audit, declared test,
  declared build, and strict Workspace Intelligence verification stages.
- Made required executable resolution part of both planning and immediate
  pre-execution validation, expiring stale approvals instead of starting a
  partial transaction.
- Made RapidKit Core optional in Doctor unless the current workspace actually
  requires the Python-backed engine.
- Aligned runtime command contracts, artifact catalogs, Doctor documentation,
  Workspace Run documentation, and consumer compatibility inventories with the
  executable CLI surface.

### Fixed

- Fixed Studio consumers needing to recreate repair execution rules or infer
  completion from a source edit alone.
- Fixed concurrent repair writers and unsafe lock stealing by introducing a
  workspace owner lock with live-process checks.
- Fixed rollback restoring over externally changed files or unverified backups;
  conflicts now produce an explicit decision instead.
- Fixed path, symbolic-link, Git-internal, evidence-artifact, dependency-tree,
  secret-file, and stale-source proposal escape paths.
- Fixed multi-runtime stage identifier collisions and cross-ecosystem Doctor
  actions triggering an unrelated adapter.
- Fixed Doctor missing a workspace-local RapidKit Core installation when run
  from a nested project.
- Fixed transient Windows `EPERM`/contention failures and stale or malformed
  canonical artifact lock handling.

### Verification

- Full CLI tests, coverage, type checking, formatting, linting, production
  build, contract generation, shared-contract parity, runtime acceptance, and
  CLI/extension integration passed.
- Package metrics reported 81% coverage, zero ESLint errors, and zero known
  dependency vulnerabilities.

## [0.52.3] - 2026-08-03

### Changed

- Made Governance Pipeline Doctor stages snapshot their exact policy profile
  and project-level blockers before later stages can refresh shared evidence.
- Made workspace Readiness evaluate every runtime represented by registered
  projects instead of reducing a polyglot workspace root to an unknown runtime.
- Made artifact remediation plans derive ordered project-scoped producers from
  missing or stale Workspace Verify evidence and run them without recursively
  re-entering blocked aggregate gates.
- Made aggregate readiness, verification, and pipeline actions declare their
  non-invasive upstream remediation dependencies.
- Made long-lived `workspace run start` stages use bounded startup verification:
  configured framework health checks when available and a finite liveness smoke
  otherwise, followed by deterministic process cleanup.
- Refreshed the release toolchain dependency graph to patched `brace-expansion`,
  `fast-uri`, `ip-address`, and `postcss` releases.

### Fixed

- Fixed Pipeline evidence collapsing actionable Doctor failures into the
  generic `doctor workspace gate failed` message.
- Fixed Workspace Verify remediation plans that only reran the aggregate gate
  instead of producing missing `init`, `test`, `build`, or `start` evidence for
  the affected project.
- Fixed runtime pin blockers that lacked explicit `setup` and ordered
  `bootstrap` remediation actions.
- Fixed aggregate gate reruns being presented before their contract-owned root
  actions had been addressed.
- Fixed service start verification waiting for a permanent process until the
  generic stage timeout instead of producing bounded, reusable evidence.
- Fixed exact root overrides retaining vulnerable transitive releases after a
  normal `npm audit fix` transaction.

### Verification

- Full CLI suite completed across 214 test files; 207 files passed in the
  restricted run, and the 3 local-HTTP files blocked by sandbox socket policy
  passed 60/60 when rerun with loopback access. Four files remain explicitly
  skipped.
- TypeScript, focused Pipeline/Readiness/Workspace Run/remediation tests,
  contract synchronization, CLI/extension contract parity, and production
  build passed.
- `npm audit --audit-level=high` reports zero known vulnerabilities.
- The updated CLI was exercised against a real multi-project workspace: the
  Pipeline persisted the `release` Doctor profile, ten project-level Doctor
  blockers, and the separate Python toolchain readiness blocker.

## [0.52.2] - 2026-08-02

### Changed

- Made npm dependency remediation compare exact candidate versions with the
  installed versions recorded in the project lockfile before advertising a
  repair path.
- Made repeated npm audit records converge on one stable, sorted remediation
  candidate while preserving the most conservative breaking-change risk.
- Made unresolved direct and transitive advisories retain structured owner,
  constraint, replacement, exception, and upstream-wait resolution evidence.
- Made supported non-Node audit findings use the same guarded resolution model
  while preserving each runtime's native manifest, lock/baseline, and scanner.

### Fixed

- Fixed downgrade-only or already-installed npm candidates being exposed to
  Studio as actionable dependency repairs.
- Fixed one logical npm repair candidate appearing multiple times when both a
  direct package and a transitive advisory reported the same resolution.
- Fixed invalid dependency candidates causing repeated Resume attempts even
  though no compatible source repair could close the Doctor blocker.
- Fixed Doctor treating “no direct automatic fix” as “no compatible source
  path” before guarded compatibility discovery and transaction verification.

### Verification

- Dependency-audit tests cover downgrade-only, already-installed, duplicated,
  transitive-owner, safe-range, multi-ecosystem, compatible, mixed,
  breaking-only, unavailable, and clean outcomes.
- Version alignment, release-document validation, type checking, formatting,
  and focused Doctor dependency tests passed.

## [0.52.1] - 2026-08-02

### Changed

- Made Doctor distinguish compatible dependency repairs from breaking-only,
  mixed, unavailable, and unknown remediation paths.
- Made dependency repair intent a freshly derived policy on every Doctor run,
  preventing cached scans from retaining an obsolete automatic action.
- Made remediation plans preserve non-executable dependency decisions as
  explicit `manual-review` steps with project scope, risk, transaction, and
  verification context.
- Extended project and workspace Doctor evidence contracts with normalized
  remediation disposition and candidate details for CLI, IDE, CI, and agent
  consumers.

### Fixed

- Fixed npm audit payloads with boolean `fixAvailable` values being ignored or
  misclassified.
- Fixed breaking-only dependency paths being exposed as safe automatic fixes.
- Fixed review-required Doctor capabilities being hidden from remediation
  plans when no executable safe command existed.
- Fixed stale derived repair intent taking precedence over the current Doctor
  capability classification.

### Verification

- Full CLI suite: 2,257 tests passed across 210 test files, with 8 explicit
  skips and no failures.
- Doctor dependency-audit, surface-probe, remediation-plan, canary, and schema
  suites cover compatible, mixed, breaking-only, unavailable, cached, and
  manual-review outcomes.
- Contract synchronization, shared-contract parity, and parity snapshots
  passed.

## [0.52.0] - 2026-07-31

### Added

- Added durable Verified Engineering Goals with `workspace goal
plan|status|verify` for `release-readiness`, `dependency-security`, and
  `test-coverage` outcomes.
- Added workspace- and project-scoped goal contracts that preserve success
  criteria, safety constraints, baseline measurements, progress, evidence,
  next actions, and a governed final verdict.
- Added bounded multi-ecosystem dependency baselines with manifest and lockfile
  hashes, Node dependency-range snapshots, path validation, and explicit
  controls for breaking or forced changes.
- Added the public
  `workspai.doctor-dependency-repair-transaction.v1` contract with required
  reconcile, audit, test, build, and canonical verification stages.
- Added project-aware dependency repair transactions to Doctor evidence,
  remediation plans, and Studio blocker handoff contracts.
- Added contract-validated Discord release announcements, a shared release
  document parser, a release-product catalog, and a GitHub Actions workflow
  that can safely create or update one announcement per published release.

### Changed

- Made dependency repair completion require manifest/lockfile consistency,
  clean focused audit evidence, declared tests, declared build, and canonical
  Workspace Intelligence verification.
- Made Verified Goal verification reuse the canonical intelligence chain and
  publish `.workspai/reports/verified-goal-last-run.json` as part of the
  governed artifact set.
- Made remediation plans retain the affected project, ecosystem, commands,
  ordered transaction, and verification requirements instead of reducing a
  dependency blocker to generic evidence refreshes.
- Extended runtime command, published-contract, extension-compatibility,
  artifact, and Workspace Intelligence chain contracts with Verified Goal and
  dependency-transaction capabilities.
- Made GitHub release notes and Discord announcements consume the same
  versioned release document and validated announcement metadata.
- Kept the full official-generator matrix independent from npm publishing while
  retaining the focused primary generator smoke as the required release gate.
- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.52.0`, and
  aligned the alias dependency on `workspai@0.52.0`.

### Fixed

- Fixed dependency repair flows that could treat a manifest-only edit as a
  completed source repair and run full workspace verification before the
  lockfile and installed dependency tree were reconciled.
- Fixed Doctor remediation output that omitted actionable, project-scoped
  transaction state for dependency-security blockers.
- Fixed canonical report-path and schema literals for Verified Goal status by
  deriving them from the Workspace Intelligence artifact registry.
- Fixed producer-binding guards so every canonical artifact path and schema is
  represented exactly once in the runtime registry.
- Fixed action-scoped Help so `workspace goal ... --target` describes a test
  coverage percentage instead of inheriting an unrelated target description.

### Verification

- Full CLI suite: 2,248 tests passed across 209 test files, with 8 explicit
  skips and no failures.
- Verified-goal tests cover all goal kinds, workspace/project scope, coverage
  targets, dependency safety baselines, breaking-change policy, persisted
  status, resumption, and canonical chain integration.
- Doctor and remediation tests cover transaction creation, project identity,
  stage order, contract parity, and Studio handoff.
- Workspace Intelligence runtime conformance passed 11 stages with 16 governed
  artifacts; all 12 adversarial groups passed.
- TypeScript, ESLint, format, Markdown links, documentation drift/examples,
  GitHub release-note and Discord announcement validation, package size,
  alias smoke, generated/mirrored contracts, and CLI/extension parity passed.
- `npm audit --audit-level=moderate` reported zero vulnerabilities.

## [0.51.0] - 2026-07-28

### Added

- Added explicit Knowledge Graph provider applicability so current runs
  distinguish `passed`, `partial`, `skipped`, and `failed` providers without
  presenting non-applicable sources as discovered evidence.
- Added deterministic stopword filtering and inverse-document-frequency
  weighting to bounded graph search while preserving exact identity, label,
  alias, proof, and stable-order guarantees.
- Added logical interface reconciliation for duplicated contract copies while
  retaining separate source-file entities and proofs.
- Added nested runtime-candidate discovery for adopted polyglot monorepos.
- Added a contract-driven official-generator smoke matrix with per-generator
  artifact, metadata, registry, build, and Doctor validation.
- Added a profile-aware, lifecycle-synchronized workspace `README.md` and a
  concise terminal receipt for workspace creation.

### Changed

- Made graph quality count applicable-but-empty providers, bounded scans,
  unresolved source relations, and binding gaps as explicit unknowns.
- Made workspace creation and lifecycle sync source the displayed
  `Understand → Change → Evidence → Gate → Ground → Distribute → Explain`
  sequence directly from the versioned chain contract.
- Made workspace README synchronization preserve user-authored content and
  update only the Workspai-managed section.
- Made Doctor preserve Electron as `desktop` and VS Code extensions as
  `extension` instead of applying unrelated frontend gates.
- Made newly generated typed Doctor repairs use the `workspai:` namespace while
  retaining legacy-token parsing for durable-session compatibility.
- Synchronized canonical FastAPI and NestJS template changes from RapidKit
  Core.
- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.51.0`, and
  aligned the alias dependency on `workspai@0.51.0`.

### Fixed

- Fixed graph quality reports that could show complete provider execution while
  applicable Kubernetes, CODEOWNERS, CI, infrastructure, or decision sources
  produced no evidence.
- Fixed natural-language graph queries where common words could outrank rare,
  relevant project terms.
- Fixed repeated logical API/service results consuming a disproportionate
  share of bounded retrieval results.
- Fixed profile changes that updated workspace registry identity without
  synchronizing the canonical workspace contract profile.
- Fixed Electron Doctor output that reported a Vite frontend and warned about
  missing `dev`/`build` scripts despite valid Electron Forge
  `start`/`package`/`make` commands.
- Fixed repeated Doctor Quick Fix commands in human and machine-readable
  outputs.
- Removed duplicated, runtime-specific post-create guidance that obscured the
  Workspace Intelligence result.

### Verification

- Graph suites cover provider applicability, unknown accounting, identity
  reconciliation, natural-language ranking, nested runtime discovery,
  profile synchronization, and model/hash binding.
- Creation and Doctor suites cover the managed README, compact receipt,
  lifecycle refresh, desktop/extension taxonomy, repair compatibility, and
  deduplicated fixes.
- A real 10-project polyglot workspace exercised Model, Graph search/evidence,
  project and workspace Doctor, sync, and the strict intelligence chain.
- TypeScript, lint, format, documentation, contract, package, and full CLI
  suites remain release gates.

## [0.50.0] - 2026-07-27

### Added

- Added first-class project entry contracts and a validated, gitignored
  `.workspai/workspace-link.local.json` so workspace-aware commands can resolve
  the canonical workspace from an adopted, imported, or created project.
- Added portable project grounding and
  `.workspai/reports/project-context-agent.json` with bounded identity,
  commands, topology, related projects, APIs, deployment/test surfaces,
  blockers, proof paths, and Model/Graph freshness.
- Added graph-aware Doctor diagnosis with project roots, structural paths,
  impact candidates, proofs, verification targets, and explicit evidence
  freshness/availability states.
- Added versioned ingestion plan/result contracts for local paths, Git
  repositories, project archives, and workspace archives.
- Added Backend, Frontend, Desktop, and Extension kit categories plus
  Rust/Axum, Tauri, Electron Forge, VS Code Extension, and Laravel creation
  flows.
- Added `project coverage --run --target <percent> --strict --json` and a
  versioned project test-coverage artifact contract.
- Added explicit workspace archive capability, manifest, and operation-result
  contracts for verify, doctor, import, and hydration flows.

### Changed

- Made successful workspace/project creation, adoption, import, connection, and
  registry sync refresh the canonical Model, model-bound Knowledge Graph,
  project lenses, report index, grounding, and supported agent surfaces.
- Made official ecosystem generators request their latest stable channel while
  recording resolved generator/runtime evidence and enforcing host
  compatibility.
- Made current-folder workspace registration foundation-only; non-Python
  project creation no longer installs the optional Python engine or Poetry.
- Deepened Doctor runtime-native dependency, security, test, quality,
  deployment, migration, and health probes across supported project families.
- Strengthened the Model/Graph artifact-set lock, structural hash binding,
  rollback behavior, project topology, facts, proofs, and incremental
  invalidation boundaries.
- Simplified root CLI Help around the product lifecycle, canonical
  Model-to-Graph architecture, and command discovery while keeping detailed
  command help and `commands --json`.
- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.50.0`, and
  aligned the alias dependency on `workspai@0.50.0`.

### Fixed

- Fixed project-local workflows that previously required users or agents to
  discover and change into the workspace root manually.
- Prevented machine-local absolute workspace paths from leaking into portable
  grounding, project context, commits, or agent evidence.
- Fixed lifecycle gaps where a newly created, adopted, or imported project
  could be registered without refreshing downstream intelligence consumers.
- Fixed nested workspace creation so a child workspace cannot be accidentally
  created inside the active workspace boundary.
- Fixed non-Python creation paths that incorrectly initialized Poetry or
  installed RapidKit Core while only establishing a Workspai foundation.
- Fixed ambiguous create/import/adopt routing with explicit ingestion
  classification and deterministic project/workspace ownership decisions.
- Fixed Help noise that repeated global setup, observability, project, and
  quickstart sections under unrelated subcommands.
- Isolated enterprise prepack creation and registry smoke tests from the
  publisher's real home and Workspai registry.

### Verification

- Full CLI suite: 2,218 tests passed across 205 test files, with 8 explicit
  skips and no failures.
- Project-entry, graph-aware Doctor, ingestion, archive, categorized-kit,
  latest-stable generator, project-coverage, project-grounding, and
  Model/Graph atomicity suites cover the new public boundaries.
- TypeScript, ESLint, format, documentation, package, generated/mirrored
  contracts, runtime conformance, and cross-platform invariants remain in the
  release validation path.

## [0.49.0] - 2026-07-25

### Added

- Added the public `workspace-graph-stream.v1` contract for transport-neutral,
  revision-safe graph snapshots, deltas, progress, quality, invalidation,
  resynchronization, lifecycle, heartbeat, and error events.
- Added `workspace watch --graph-stream --json` so IDEs and other long-running
  consumers can hydrate once and receive bounded Knowledge Graph changes
  without repeatedly loading the complete graph.
- Added graph-stream capability and contract discovery to the runtime command
  inventory, published contract catalog, extension compatibility contract, and
  artifact documentation.
- Added a repository-wide brand contract that protects canonical Chistiq,
  Workspai, repository, documentation, support, and contribution references.
- Added a release-note generator and validation gate for publishing the exact
  versioned release document as the GitHub Release body.

### Changed

- Moved Workspai repository ownership, issue, discussion, contribution, image,
  and release links from RapidKit Labs to Chistiq while preserving the
  Workspai product and npm package identities.
- Simplified existing-project onboarding: `workspai adopt .` now creates or
  reuses a minimal default workspace and prints the exact workspace shell step
  and canonical intelligence command to run next.
- Made `generic` the vendor-neutral agent example while retaining the supported
  agent-specific output selectors.
- Reworked root, CLI, alias, scenario, workspace-operation, Doctor, CI, and
  runner documentation around plain-language user paths and canonical
  `.workspai` evidence.
- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.49.0`, and
  aligned the alias dependency on `workspai@0.49.0`.

### Fixed

- Fixed GitHub Release links so every release points to its tag-bound document
  under `packages/cli/releases` instead of a nonexistent repository-root path.
- Hardened release validation to reject relative, noncanonical, mismatched-tag,
  and missing-current-version release-note links before publishing.
- Fixed workspace-watch integration so each emitted event can expose its
  authoritative in-memory model to the graph-stream publisher without
  introducing a second model source of truth.
- Fixed onboarding examples that implied users must manually create a workspace
  before adopting an existing project.
- Fixed Windows and cross-platform test assumptions in frontend creation,
  offline scaffold, networking, and phase-three CLI coverage.

### Verification

- Full CLI suite: 2,088 tests passed across 194 test files, with 8 explicit
  skips and no failures.
- Graph-stream schema and publisher tests cover initial snapshots, hash-linked
  deltas, revision continuity, proof timestamp stability, and resync events.
- Release-note tests cover canonical GitHub body generation and fail-closed
  aggregate-link validation.
- Published and mirrored command/contract inventories include the graph-stream
  surface for CLI, CI, IDE, and extension consumers.

## [0.48.0] - 2026-07-22

### Added

- Added a governed Workspace Intelligence evaluation workflow with
  `workspace eval init`, `record`, `status`, `report`, and `compare` for
  measuring retrieval payloads and model-usage observations without making
  unsupported universal token-saving claims.
- Added portable Knowledge Graph exports for JSON-LD, GraphML, and GEXF, plus
  typed entity, evidence, path, search, benchmark, and change-overlay surfaces.
- Added versioned evaluation, evaluation-comparison, and model-usage-event
  contracts and registered their artifacts for CLI, CI, IDE, MCP, and agent
  consumers.
- Added a documentation content contract and stronger drift guards covering
  Graph commands, Evaluation artifacts, runtime selectors, source-of-truth
  boundaries, examples, and README command smoke tests.

### Changed

- Expanded the machine-readable Workspace Intelligence architecture and
  runtime command-surface contracts so Graph and Evaluation capabilities are
  discoverable from the same contract inventory used by the CLI.
- Clarified that the Workspace Model is the system source of truth, while the
  evidence-backed Knowledge Graph is a deterministic, model-bound derived
  representation with multiple portable projections.
- Reworked the root and CLI READMEs around user goals, the canonical lifecycle,
  generated evidence, consumer paths, and verifiable claim boundaries.
- Expanded the `wspai` alias README with installation guidance, delegation
  semantics, canonical state behavior, and direct documentation links.
- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.48.0`, and
  aligned the alias dependency on `workspai@0.48.0`.

### Fixed

- Fixed CLI validation for the documented Graph options:
  - `workspace graph search --limit`
  - `workspace graph overlay --from`
- Fixed architecture-contract drift that omitted current Graph query/export
  commands and the complete Evaluation capability and artifact inventory.
- Removed stale documentation language that described the current graph as a
  dependency-only or JavaScript/TypeScript-only view.
- Made `--skip-install` a host-toolchain-free scaffold boundary for Java, Go,
  and .NET generators, preventing Maven/Java process trees from stalling
  Windows coverage jobs after installation was explicitly skipped.
- Made workspace-registry transactions retain one immutable canonical, legacy,
  and candidate path snapshot while waiting for the lock, preventing concurrent
  Windows workers from losing registrations when HOME or APPDATA changes.
- Made demo-kit fixtures use atomically unique temporary directories and kept
  structure-only NestJS tests out of unrelated Git setup, preventing Windows
  coverage workers from deleting or delaying one another's generated files;
  the 28-file integration case now has an explicit bounded Windows-safe budget.

### Verification

- Full CLI suite: 2,076 tests passed across 191 test files, with 8 explicit
  skips and no failures.
- TypeScript, ESLint, documentation links/examples/drift guards, README command
  smoke, generated contracts, shared-contract parity, and `git diff --check`
  passed.
- A real isolated workspace exercised Model and Graph generation, bounded
  search, JSON-LD/GraphML/GEXF exports, Evaluation init/status/report, and the
  complete strict Workspace Intelligence runner.

## [0.47.0] - 2026-07-21

### Added

- Added the versioned, evidence-backed Workspace Knowledge Graph as an atomic
  derivative of the canonical Workspace Model.
- Added bounded `workspace graph search`, typed entity/evidence/path queries,
  portable graph emission, change/PR overlays, and reproducible retrieval
  payload benchmarks.
- Added versioned contracts for Knowledge Graph, change overlay, bounded search,
  and token-efficiency results.
- Added MCP graph search/evidence/path tools and graph discovery through agent
  context, report indexes, customization packs, runtime command discovery, and
  workspace contract graph output.
- Added a user-focused graph guide, benchmark methodology, AI/IDE/MCP scenario,
  plain-language glossary, and contract catalog discovery guidance.

### Changed

- Made `workspace-knowledge-graph.json` a required Model-stage artifact in the
  unified Workspace Intelligence runner and bound it to the exact model hash.
- Expanded graph facts and proofs across source, packages, APIs, events,
  containers, Kubernetes, Terraform, CI, documentation, ADRs, tests, ownership,
  and service contracts.
- Changed agent guidance to prefer `AGENTS.md` and `INDEX.json`, then bounded
  graph retrieval and proof traversal, before loading complete model/graph
  artifacts.
- Expanded published contract, runtime surface, architecture, artifact producer,
  and documentation drift checks for the new graph surfaces.
- Rewrote optional AI module-recommender documentation to distinguish it from
  deterministic Workspace Intelligence and remove unqualified score, cost, and
  production-readiness claims.
- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.47.0`, and
  aligned the `wspai` dependency on `workspai@0.47.0`.

### Fixed

- Canonicalized Python/Core bridge project metadata from legacy `.rapidkit`
  locations into `.workspai` without overwriting existing canonical files.
- Fixed artifact, contract, command, and documentation gaps for graph consumers
  across CLI, CI, IDE, MCP, and agent surfaces.
- Updated `brace-expansion` to the patched release required by the high-severity
  npm audit advisory.
- Updated `fast-uri` to `3.1.4` to resolve its high-severity host-confusion
  advisory; the final online npm audit reports zero vulnerabilities.
- Removed misleading documentation that treated future package extraction as
  missing product capability; Graph, MCP, shared contracts, and SDK-facing
  surfaces remain available through the current CLI.

### Verification

- Full CLI suite: 2,062 tests passed with 8 explicit skips.
- Workspace Intelligence runtime conformance passed all 11 ordered stages and
  required artifacts.
- Documentation links, examples, drift guard, README command smoke, and live
  CLI command-surface parity passed.

## [0.46.0] - 2026-07-18

### Added

- Added the contract-backed `workspace intelligence run` command as the unified
  execution surface for the mandatory Workspace Intelligence lifecycle.
- Added the versioned `workspai-workspace-intelligence-run-v1` report contract,
  runtime registry integration, artifact producer ownership, and semantic
  validation of ordered stage evidence.
- Added transactional workspace lifecycle utilities with rollback coverage for
  create, adopt, import, register, and mirrored project operations.
- Added first-class frontend project execution coverage and hardened generators
  for Node, Go, Java, and .NET project families.

### Changed

- Hardened the canonical intelligence sequence across sync, model, contract
  verify, doctor, analyze, readiness, snapshot, diff, impact, verify, context,
  agent sync, watch, explain, trace, and remediation planning.
- Made the unified runner report each required stage with deterministic status,
  command, timing, artifact, and failure evidence suitable for CI and agents.
- Expanded CLI documentation, command help, runtime contracts, artifact
  catalogs, CI examples, and agent-grounding guidance around the same mandatory
  lifecycle source of truth.
- Hardened Python-engine discovery and workspace metadata propagation while
  preserving Python 3.10 as the minimum supported version and allowing newer
  installed interpreters to be detected.
- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.46.0`, and
  aligned the `wspai` dependency on `workspai@0.46.0`.
- Expanded the release-gated suite to 2,042 passing tests, with targeted
  coverage for Workspace Intelligence runner ordering and evidence, semantic
  contract boundaries, Doctor remediation, workspace lifecycle recovery,
  runtime adapters, archives, platform behavior, and low-coverage utilities.
- Raised the verified CLI coverage to 81.66% statements, 71.27% branches,
  91.95% functions, and 82.38% lines; `workspace-run.ts` now reaches 81.07%
  statements and 82.30% lines.

### Fixed

- Fixed lifecycle partial-write gaps by rolling back newly created metadata,
  registry entries, mirrors, and project files when an operation fails.
- Fixed project metadata path validation and registry/mirror consistency across
  create, adopt, import, archive, and restore workflows.
- Fixed platform capability probes and runtime adapter behavior for Python, Go,
  Java, and .NET environments.
- Fixed documentation and config-example drift, including removal of an
  accidental Python-version pin from the canonical and legacy examples.
- Fixed Windows lifecycle journal writes so GitHub-hosted filesystems may reject
  `fsync` with `EPERM`, `EINVAL`, or `ENOSYS` without discarding an otherwise
  atomic workspace transaction; concurrent journal initialization is now
  recovery-safe.
- Fixed macOS path assertions to compare canonical real paths and corrected the
  Windows-layout Doctor fixture to model `pip --format=json` stdout accurately.
- Fixed the npm dependency tree used by CycloneDX SBOM generation by removing an
  unsafe global `minimatch` override and resolving the Nunjucks/Tsup `chokidar`
  peer versions without invalid packages.
- Hardened metrics collection so test, lint, and audit execution or parse
  failures fail closed instead of being reported as zero errors or
  vulnerabilities; the existing 80% aggregate coverage target remains enforced.
- Fixed metrics collection for the expanded enterprise suite by publishing a
  machine-readable Vitest report during `test:coverage` and consuming that same
  result in `metrics`, eliminating the duplicate full-suite run and fragile
  console-summary parsing. A larger subprocess budget remains for standalone
  metrics compatibility.
- Removed type-only declarations and compatibility-only re-export barrels from
  the executable coverage denominator while retaining TypeScript enforcement
  and explicit public-export contract tests.
- Fixed cross-platform test and runtime drift across Python venv orchestration,
  Windows-layout pip metadata, PowerShell Doctor remediation parsing, Go
  Makefile selection, npm environment-key casing, package-runner path flavor,
  and POSIX-only file-mode assertions.
- Made Python project orchestration dependency-injectable so venv, Poetry, and
  pip fallback tests use deterministic platform-native fixtures without leaking
  host tools or Unix shell scripts into macOS and Windows jobs.

### Verification

- `corepack npm run check`
- `corepack npm --workspace workspai run contracts:check`
- `corepack npm --workspace workspai run docs:validate`
- `corepack npm --workspace workspai run test`
- Unified runner contract, CLI-chain, lifecycle transaction, frontend execution,
  Python-engine state, and package-publish contract suites.
- 2,042 tests passed with 8 explicitly skipped; aggregate coverage passed the
  80% release threshold at 82% in the metrics gate.

## [0.45.0] - 2026-07-15

### Added

- Added the versioned `workspai-cli-runtime-command-inventory-v1` contract,
  generated directly from the live Commander tree and published through
  `commands --json`.
- Added command-surface verification that fails on registered/declared drift
  across top-level, scoped, manual workspace, and Core-backed commands.
- Added producer-command ownership to artifact contract descriptors, including
  supplemental governance, recovery, infra, and Workspace Intelligence
  artifacts.
- Added machine-readable command documentation for canonical argv, stdin input
  contracts, output media modes, and process exit semantics.
- Added complete workspace action discovery to `workspace --help`.

### Changed

- Expanded the runtime command surface and published contract catalog with
  command documentation, npm ownership, artifact schemas, and producer links.
- Included the runtime inventory in generated shared contracts and enterprise
  prepack verification.
- Documented the required stdin contract for `workspace feedback record` and
  the raw renderer behavior of graph DOT/Mermaid output.
- Registered `workspace feedback record --json` as a producer of the governed
  Workspace Intelligence history artifact.
- Completed the Workspace Intelligence subcommand classification with contract,
  graph, watch, feedback, and MCP capabilities for downstream consumers.
- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.45.0`, and
  aligned the `wspai` dependency on `workspai@0.45.0`.

### Fixed

- Fixed `pipeline --strict` semantics so warning-only pipelines remain advisory
  by default and become process-blocking only in strict mode; failed stages
  remain blocking in every mode.
- Hardened concurrent dist-test build locking so waiting processes re-check
  freshness only after the active builder releases the lock.
- Kept live command inventory generation deterministic across test and package
  builds.

## [0.44.0] - 2026-07-14

### Added

- Added Workspace Intelligence architecture and chain contracts to make the
  model → snapshot → diff → impact → verify → context → agent-sync flow
  explicit and runtime-verifiable.
- Added generated contract coverage for runtime command discovery, CLI operation
  results, published contract catalogs, command capabilities, and version
  discovery.
- Added runtime conformance and adversarial validation scripts for Workspace
  Intelligence command/artifact alignment.
- Added archive capability, manifest, and operation result contracts for ZIP64,
  streaming workspace archives, hydrate, inspect, verify, doctor, and failure
  envelopes.
- Added `readiness --workspace <path>` for release-readiness checks outside the
  workspace current working directory.

### Changed

- Bumped the monorepo root, `workspai`, and `wspai` packages to `0.44.0`, and
  aligned the `wspai` dependency on `workspai@0.44.0`.
- Expanded operational JSON schemas for autopilot, doctor, infra, product,
  workspace list/sync/watch/cache, and Workspace Intelligence artifacts.
- Hardened workspace snapshot, archive, contract verify, graph freshness,
  workspace history, explain, MCP, and agent-grounding outputs.
- Updated CLI and docs so Workspace Intelligence evidence flags are documented
  consistently for model, snapshot, diff, impact, verify, graph, and context
  workflows.
- Updated npm release workflow behavior so reruns can tolerate already-published
  versions.

### Fixed

- Fixed `pipeline --no-agent-sync` so it no longer writes agent-grounding
  artifacts when the flag is passed through the CLI.
- Fixed Workspace Intelligence option validation so `workspace impact` and
  `workspace verify` accept `--include-paths`, `--include-evidence`, and
  `--scan-depth <count>`.
- Fixed the artifact catalog mapping for `autopilot-release.v1.json`.
- Fixed release-readiness workspace targeting parity with `analyze --workspace`
  and workspace-level command flows.
- Fixed Windows artifact writes so `EPERM` from filesystem `fsync` does not
  fail workspace init, contract sync, or Workspace Intelligence evidence writes
  after the artifact payload has been written.
- Increased timeout headroom for slower CLI process and HTTP retry integration
  tests under full-suite load.

### Verification

- `corepack npm run check`
- `corepack npm --workspace workspai run contracts:check`
- `corepack npm --workspace workspai run check:workspace-intelligence-runtime`
- `corepack npm --workspace workspai run check:workspace-intelligence-adversarial`
- `corepack npm --workspace workspai run docs:validate`
- `corepack npm test`
- Real workspace smoke tests across `my-new-wsp`, `my-works`, `my-workspace`,
  and `my-workspoly`.

## [0.43.1] - 2026-07-09

### Added

- Added `WORKSPAI_DEBUG_ARGS=1` as the Workspai-native debug environment flag
  for CLI argument and bridge diagnostics.
- Added Workspace Intelligence chain validation coverage across minimal and
  polyglot test workspaces, including sync, contract verify, model, context,
  agent sync, graph, diff, impact, verify, trace, explain, run, share, export,
  and feedback history.
- Added E2E workflow coverage for the managed Workspai workspace home at
  `~/.workspai/workspaces`, with legacy RapidKit workspace fallbacks retained.

### Changed

- Kept `RAPIDKIT_NPM_DEBUG_ARGS=1` as a legacy fallback so existing local
  debugging workflows continue to work.
- Aligned the private monorepo, `workspai`, and `wspai` package versions on
  `0.43.1`.
- Updated the `wspai` alias package dependency to require the matching
  `workspai@0.43.1` version.
- Guarded Python dependency sync repair by default so Doctor emits deterministic
  guidance unless explicit dependency-install opt-in is provided.

### Fixed

- Fixed project-scope Doctor fix evidence so project repairs write to the
  project `.workspai/reports` directory instead of overwriting workspace-level
  Doctor fix artifacts.
- Fixed Doctor fix/apply exit-code behavior so unresolved repairs fail
  deterministically, including local-profile flows.
- Fixed Workspace Run diagnostics so Python wrapper failures such as
  `No module named pytest` are classified as setup failures instead of
  `unknown`.

### Verification

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

## [0.43.0] - 2026-07-07

### Added

- Added the `wspai` npm alias package so users can run the canonical Workspai
  CLI through `npx wspai ...`.
- Added monorepo release guards that keep `wspai` and `workspai` versions aligned
  before dry-run and production publishing.

### Changed

- Promoted the Workspai npm package as the canonical CLI surface while keeping
  RapidKit Core as the Python engine bridge.
- Reorganized the npm CLI into the `packages/cli` workspace package for the new
  Workspai monorepo layout.
- Updated publish, smoke, and documentation surfaces for the `workspai` package
  plus the short `wspai` alias package.

### Fixed

- Removed the unavailable `wai` alias path and standardized the short npm alias
  on the available `wspai` package name.

### Verification

- `corepack npm --workspace workspai test -- src/__tests__/package-publish-contract.test.ts`
- `corepack npm run smoke:alias-package`
- `node scripts/enterprise-package-smoke.mjs`
- `corepack npm publish --dry-run --access public --workspace wspai`

## [0.42.0] - 2026-07-06

### Added

- Added optional Python engine creation for Python-aware workspaces via
  `create workspace --skip-python-engine`, with explicit skipped-engine metadata
  in workspace manifests, workspace markers, toolchain evidence, and local
  launcher guidance.
- Added shared workspace profile compatibility checks across `create project`,
  `import`, `adopt`, and `bootstrap` compliance so runtime/profile drift is
  reported consistently.
- Added broader runtime detection for profile compatibility decisions, including
  non-native scaffold ecosystems such as Rust, C, and C++.

### Changed

- Decoupled Workspace Intelligence foundation files from the workspace-local
  Python engine. `minimal`, `java-only`, `node-only`, `go-only`, and
  `dotnet-only` workspaces no longer create Python engine artifacts at the
  workspace root.
- Narrowed RapidKit module mutation to the RapidKit-owned module-enabled kits:
  `fastapi.standard`, `fastapi.ddd`, and `nestjs.standard`.
- Preserved adopt/import governance for arbitrary projects while disabling
  module mutation unless project metadata identifies a supported RapidKit kit.
- Updated command reference and CLI help guidance around skipped Python engines,
  profile realignment, and module-enabled kit guarantees.

### Fixed

- Fixed Python-free and skipped-engine workspaces creating misleading
  `pyproject.toml` / `poetry.toml` stubs in the workspace root.
- Fixed skipped-engine launcher messaging so users are directed to npm-owned
  workspace commands and the intentional engine-install path.

### Verification

- `npm exec -- vitest run src/__tests__/e2e.test.ts src/__tests__/create-internal.test.ts src/__tests__/workspace-python-engine-install-gate.test.ts`
- `npm run typecheck -- --pretty false`
- `npm run lint`
- `npm run build`
- `npm exec -- vitest run`

## [0.41.5] - 2026-07-04

### Changed

- Documented `create workspace <name> [--here|--output <parent-dir>]` in the
  command reference so custom workspace parents are visible in the CLI contract.

### Fixed

- Fixed `create workspace` duplicate-name checks so an explicitly selected
  target parent (`Current directory`, `--here`, or `--output <parent-dir>`) is
  not blocked by a same-name workspace in the managed home. Creating into an
  already-existing target path is still blocked.
- Fixed `doctor workspace` so an empty workspace shell is not misclassified as a
  project because of root-level toolchain files.
- Fixed default-mode Workspace Verify gate exit codes so `needs-attention`
  passes with exit code `0`, while strict mode continues to fail non-ready
  verification.

### Verification

- `npm exec -- vitest run src/__tests__/workspace-create-location.test.ts`
- `npm run typecheck -- --pretty false`
- `npm run build`

## [0.41.4] - 2026-07-02

### Added

- Added `workspace remediation-plan [--json] [--write] [--ci] [--include-paths]` to build a
  cross-artifact Studio repair plan from blocked governance reports in
  `.rapidkit/reports/`.
- Added `artifact-remediation-plan.v1` (`contracts/artifact-remediation-plan.v1.json`) with
  ordered safe/guarded/invasive actions, file operations, verify commands, rollback
  metadata, and approval state for Bootstrap, Doctor, Analyze, Readiness, Pipeline,
  Workspace Run, and Workspace Verify cards.
- Published the new command on `runtime-command-surface.v1`, extension CLI compatibility,
  agent customization pack, workspace model evidence refs, and agent-sync catalog entries.

### Changed

- Updated operational skills and README guidance so agents read
  `artifact-remediation-plan-last-run.json` before inventing per-card repair logic.
- Documented the artifact catalog entry and commands reference for the remediation-plan
  handoff path.

### Verification

- `npm run typecheck`
- `npm run validate:contracts`
- `npm test`
- `npm run smoke:enterprise-package`
- `npm run prepack`

## [0.41.3] - 2026-07-02

### Added

- Added `doctor-remediation-plan.v1` as the Studio-ready repair contract for
  ordered safe/guarded remediation steps, verification commands, file hints,
  rollback metadata, and policy-aware repair capability state.
- Added `fact-freshness.v1` and fact-level freshness metadata across Workspace
  Intelligence artifacts so agents can distinguish durable facts, derived facts,
  evidence-backed facts, live facts, and facts that require verification before
  use.
- Added multi-stack doctor canary coverage for frontend, backend, and polyglot
  project surfaces.

### Changed

- Deepened `doctor workspace`, `doctor workspace --fix`, `doctor project`, and
  `doctor project --fix` with broader language/framework/runtime probes for
  dependency contracts, environment/config baselines, tests, quality tooling,
  security tooling, containers, deployment surfaces, migrations, health probes,
  and runtime entrypoints.
- Hardened doctor repair planning so Workspai Studio can present the smallest
  safe repair first, preserve guarded steps for review, and verify from the
  correct workspace/project scope.
- Extended Workspace Intelligence model, context, history, verify, and agent
  sync outputs to carry the newer doctor, remediation, and freshness evidence
  without forcing consumers to infer it from display text.
- Hardened CLI routing and enterprise gates around npm-vs-Python RapidKit
  command ownership, package smoke, and manual release workflow validation.

### Fixed

- Fixed stale or misleading doctor/project evidence paths in mixed workspace
  and project scopes.
- Fixed doctor status normalization around warning/error severities so TypeScript
  and downstream JSON consumers agree on status values.
- Fixed repair command safety gaps where Studio-facing consumers needed a
  deterministic repair action instead of shell-chained command text.

### Verification

- `npm run typecheck`
- `npm run validate:contracts`
- `npm test`
- `npm run smoke:enterprise-package`
- `npm run prepack`

## [0.41.2] - 2026-06-28

### Added

- Added `workspace why` and `workspace trace` to the published Workspace
  Intelligence subcommand surface in `runtime-command-surface.v1`.
- Added additive `incidentSummary` metadata to
  `studio-blocker-handoff.v1` for Workspai Studio incident flows.
- Added README category positioning for Open-Source Workspace Intelligence and
  a framework-agnostic mental model for created, imported, and adopted projects.

### Changed

- Hardened `enterprise-package-smoke` to use an isolated writable npm cache and
  tolerate npm lifecycle output before `npm pack --json` payloads.
- Updated contract documentation to list current Workspace Intelligence schemas
  and the canonical `.rapidkit/AGENT-GROUNDING.md` artifact path.
- Removed non-null assertions from Workspace Impact centrality/hotspot handling.

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm run format:check`
- `npm run validate:docs`
- `npm run check:generated-contracts`
- `npm run check:shared-contracts`
- `npm test` (1573 passed, 8 skipped)
- `npm run smoke:enterprise-package`
- `npm run prepack`

## [0.41.1] - 2026-06-28

### Added

- Added enterprise npm package smoke and prepack gates:
  `scripts/enterprise-package-smoke.mjs`, `scripts/prepack-enterprise.mjs`,
  `npm run smoke:enterprise-package`, and `prepack` validation before
  `npm pack` / publish.
- Added pipe-safe CLI coverage for `--version --json` so release gates can
  validate machine-readable output through stdout pipes.
- Added a command-safe package-runner invocation contract for npm-family
  subprocesses (`npm`, `npx`, `pnpm`, `yarn`), including `npm_execpath`,
  well-known npm CLI locations, and `corepack npm` fallback.
- Added richer `workspace-dependency-graph.v1` operational profile, topology
  stats, coverage, and diagnostics fields for Workspai graph consumers.

### Changed

- Hardened frontend scaffold execution, Node runtime package-manager detection,
  and workspace fleet init preflight to use the shared package-runner contract
  instead of raw PATH-only `npm` / `npx` lookup.
- Made CLI entrypoint stdout/stderr pipe-safe before fast process exits, fixing
  empty-output behavior in spawned integration commands.
- Updated package metadata/files policy so publish artifacts include enterprise
  smoke/prepack scripts and critical runtime assets.
- Synced FastAPI common environment examples from the core kit source.

### Fixed

- Fixed workspace-root `rapidkit init` failing child Node project init when npm
  was available through npm/corepack resolution but not discoverable by a raw
  `which npm` preflight.
- Fixed nested npx execution inheriting parent `npm_config_package` pins that
  could force inner generators to resolve the wrong package.
- Fixed stale CLI test builds by tracking runner and platform-capability source
  files in the dist build helper.

### Verification

- `./node_modules/.bin/tsc --noEmit`
- `./node_modules/.bin/vitest run` (1573 passed, 8 skipped)
- `node scripts/enterprise-package-smoke.mjs`
- `node scripts/prepack-enterprise.mjs`

## [0.41.0] - 2026-06-23

### Added

- Added **Phase 4 operational intelligence** CLI surfaces: `workspace explain`,
  `workspace why` (alias), `workspace trace --from <diff>`, `workspace feedback
record`, and read-mostly `workspace mcp serve` (stdio JSON-RPC over workspace
  evidence).
- Added versioned contracts under `contracts/workspace-intelligence/`:
  `workspace-explain.v1`, `workspace-contract-verify.v1`,
  `blocker-resolution.v1`, `doctor-fix-result.v1`, `studio-blocker-handoff.v1`,
  `agent-action-outcome.v1`, `workspace-skills-index.v1`, and
  `workspace-operational-skill.v1`.
- Added operational skills generation via `workspace agent-sync --write`
  (`.rapidkit/skills/*.md`, `workspace-skills-index.json`) — no separate
  `skills generate` command; see `docs/contracts/NAMING_AND_COEXISTENCE.md`.
- Added structured **doctor fix result** output (`fixResult`) for
  `doctor workspace --fix --json` and contract
  `rapidkit-doctor-fix-result-v1`.
- Added `workspace contract verify` evidence artifact and reader alignment for
  IDE/CI consumers.
- Added blocker **resolution hints** on `workspace verify` when steps fail or
  evidence is missing.
- Added `src/contracts/published-contract-versions.ts` and expanded
  `extension-cli-compatibility.v1.json` schema matrix for Workspai extension
  parity.

### Changed

- Extended `workspace verify` plan: per-project **init** and **start** fleet
  evidence when declared in `fleetStages`; optional **doctor-fix** step reads
  `fixResult` from `doctor-last-run.json`.
- Extended `workspace run` enterprise controls: **custom stages** from
  `.rapidkit/context.json` `commands`, **stage dependencies** from framework
  registry, and **`--reuse-passed`** to skip projects already passing in
  `workspace-run-last.json`.
- Refactored framework registry with `resolveFrameworkRegistryEntry()` for
  dependency and stage resolution reuse.
- Updated `docs/contracts/ARTIFACT_CATALOG.md`, `docs/workspace-run.md`, and
  runtime/extension CLI compatibility contracts.

### Notes

- `workspace graph explain <project>` remains the graph-topology slice;
  `workspace explain project:<name>` is the unified narrative surface.
- MCP serve is read-mostly; write/fix tools stay approval-gated per MCP design
  artifact.

### Verification

- `npm run build`
- `npx vitest run` (1550+ tests)
- `npm run validate:contracts`

## [0.40.1] - 2026-06-23

### Changed

- Rewrote root CLI help (`npx rapidkit`, `--help`, `-h`, `help`) to lead with
  **Workspace Intelligence** positioning: lifecycle (Create → Model → Context →
  Impact → Verify), curated command groups, agent grounding, and mental model.
- Kept the full flat command reference, workspace profiles, options, project
  commands, and flag clarifications — no commands removed from help output.
- Updated README **Start here**: split **Install** (global) from **CLI help**
  (`npx rapidkit --help` without implying global install).

### Verification

- `npx vitest run src/__tests__/index.test.ts -t "Version and Help"`

## [0.40.0] - 2026-06-23

### Added

- Added the versioned **Agent Customization Pack** contract
  (`contracts/agent-customization-pack.v1.json`,
  `src/contracts/agent-customization-pack-contract.ts`) with preset/target
  matrices, standard answer contract, drift rules, and output kinds (`hook`,
  `mcp-design`).
- Upgraded `workspace agent-sync` from grounding sync to full pack generation:
  writes `.rapidkit/reports/agent-customization-pack.json` on every successful
  sync.
- Added `--preset minimal|enterprise`, `--target` (including `vscode` alias),
  `--dry-run --json`, and `--strict --json` to `workspace agent-sync`.
- Added enterprise VS Code/Copilot surfaces: workspace/evidence instructions,
  diagnose/repair/release/project-onboard/adopt prompts, the
  `rapidkit-workspace-intelligence` skill (with artifact/command/scope/runtime
  resources + `mcp-tools.md`), and specialized `workspai-*` custom agents.
- Added optional advisory VS Code agent hooks behind `--experimental-hooks`
  (`.vscode/rapidkit-agent-hooks.json`, disabled by default).
- Added read-mostly MCP-ready design artifact
  (`.rapidkit/reports/rapidkit-mcp-design.json`).
- Added `scripts/check-agent-customization-drift.mjs` and
  `npm run check:agent-customization-drift` for CI drift detection on generated
  agent customization files.

### Changed

- Extended `workspace agent-sync` strict validation for required report
  presence/staleness, path containment, pack inventory, answer contract, and
  English-only generated instruction surfaces.
- Updated `docs/examples/ci-agent-grounding.yml`, `docs/ci-workflows.md`,
  `docs/commands-reference.md`, artifact catalog, and README for enterprise pack
  workflows.
- Synced `agent-customization-pack.v1.json` to Workspai contract
  mirrors via shared-contract scripts.

### Notes

- Standard agent answer contract: **Scope → Evidence → Diagnosis → Fix Plan →
  Run → Verify → Assumptions** (with display vs execute command distinction).
- Hooks are advisory and disabled by default; MCP design is read-mostly until
  write tools have explicit approval boundaries.

### Verification

- `npx vitest run src/__tests__/workspace-agent-sync.test.ts`
- `npx vitest run src/__tests__/contracts/`
- `npx tsc --noEmit`
- `npm run check:shared-contracts`
- `npm run check:agent-customization-drift -- --workspace <workspace-root>` (in
  git worktrees)

## [0.39.0] - 2026-06-22

### Added

- Added a first-class, deterministic dependency graph to the workspace model
  (`contracts/workspace-intelligence/workspace-dependency-graph.v1.json`),
  embedded in `workspace-model.v1` with stable hashing.
- Added a multi-source, language-agnostic edge-inference engine: `package-dep`
  edges from `package.json` (JS/TS), `pyproject.toml` path dependencies
  (Python), and `go.mod` replace directives (Go); `contract dependsOn` and
  event publish/subscribe edges from the workspace contract (all runtimes);
  `code-import` edges for JS/TS; and `manual` override edges. Every edge carries
  provenance (`source`/`confidence`/`evidence`).
- Added a shared graph-traversal utility (forward/reverse dependencies,
  transitive closure, blast radius, cycle detection) reused by impact and
  verify.
- Added graph-aware impact: transitive blast radius with `distance`, `path`, and
  `via` per affected project, plus centrality-weighted critical-path hotspots
  (`fanIn`/`fanOut`/`reach`/`betweenness`).
- Added graph-aware verify: the verdict now gates the entire affected subgraph
  (changed projects plus transitive dependents) and surfaces graph integrity
  issues (cycles, dangling edges, orphans).
- Added `rapidkit workspace graph` with `emit`, `explain <project>`, `dot`, and
  `mermaid` subactions for inspecting and visualizing the dependency graph.
- Added a workspace model + graph cache keyed by a structural `inputsHash`
  (`workspace-model-cache.v1`) and `rapidkit workspace model --incremental` for
  graph-aware incremental rebuilds that reuse unchanged project models and
  re-infer only incident edges.
- Added graph-aware transitive freshness with an explicit `fresh | stale |
unknown` verdict in `workspace verify`, chaining each project's content hash
  through its dependencies.
- Added a definitive verify gate (`evaluateWorkspaceVerifyGate`) surfaced as a
  `gate` object in `workspace verify --json`; `--strict` additionally fails on
  `needs-attention` and `stale` freshness.
- Added structured `policyMode` + `policyViolations[]` to `workspace verify`
  output so IDEs and CI can render policy/contract blockers directly.
- Added a bounded health/impact history
  (`.rapidkit/reports/workspace-intelligence-history.json`,
  `workspace-intelligence-history.v1`) with retention.
- Added `rapidkit workspace watch` daemon mode that keeps the model + graph in
  memory and streams `workspace-watch-event.v1` change events
  (`ready`/`changed`/`unchanged`/`error`) via fast incremental rebuilds.
- Added a deterministic large-monorepo performance benchmark
  (`npm run benchmark:intelligence`).

### Changed

- Registered `graph` and `watch` in `WORKSPACE_SUBCOMMANDS` and the generated
  `runtime-command-surface.v1` contract so IDE/CI surfaces detect them from the
  contract.
- Extended the `workspace-impact.v1` and `workspace-verify.v1` schemas additively
  (transitive blast radius, hotspots, affected subgraph, graph integrity,
  freshness, policy violations); existing consumers remain compatible.
- Updated the README, contracts artifact catalog, and Workspace Intelligence
  enterprise roadmap to document the graph-aware engine.

### Notes

- The entire Workspace Intelligence consumer layer (model, graph traversal,
  impact, verify, freshness, centrality, integrity, watch, history, gate, and
  policy) is language- and framework-agnostic and behaves identically for
  created, imported, and adopted projects. Automatic `code-import` edge
  inference is JS/TS-only and degrades gracefully; other runtimes derive
  inter-project edges from manifests, the workspace contract, and manual
  overrides.

### Verification

- `npx vitest run` (full suite: 1517 passed, 11 skipped, 0 failures)
- `npx tsc --noEmit`
- `npm run check:shared-contracts`
- `npm run test:drift`

## [0.38.0] - 2026-06-21

### Added

- Added the Create Planner capability contract at
  `contracts/create-planner-capabilities.v1.json`.
- Added `native-create`, `external-create-adopt`, and `adopt-only` capability
  lanes for scaffold planning.
- Added planned external create-adopt modeling for WordPress, Laravel, Symfony,
  and Rails.
- Added adopt-only runtime modeling for PHP, Ruby, Rust, Elixir, Clojure,
  Scala, and Kotlin.
- Added create planner documentation under `docs/create-planner-capabilities.md`.
- Added generated-contract and parity coverage for the create planner contract.
- Added `createCapability` to workspace model and workspace context project
  summaries.

### Changed

- Extended `contracts/runtime-command-surface.v1.json` with a create planner
  summary so downstream IDE and AI surfaces can consume the same capability
  lanes.
- Updated contract generation and parity sync scripts to include
  `create-planner-capabilities.v1.json`.
- Updated contract documentation and the artifact catalog with the new create
  planner artifact.

### Fixed

- `rapidkit create project` now blocks unsupported native-create attempts before
  delegating to the underlying scaffolder.
- WordPress, Laravel, generic PHP, and other unsupported native-create requests
  no longer fall through to an incorrect RapidKit native kit.

### Verification

- `./node_modules/.bin/vitest run src/__tests__/create-planner-capabilities.test.ts src/__tests__/handle-create-flags.test.ts src/__tests__/contracts/generated-contracts.test.ts src/__tests__/contracts/npm-contracts-parity.test.ts src/__tests__/workspace-model.test.ts src/__tests__/workspace-context.test.ts`
- `./node_modules/.bin/tsc --noEmit`
- `./node_modules/.bin/prettier --check src/utils/create-planner-capabilities.ts src/contracts/create-planner-capabilities-contract.ts src/contracts/runtime-command-surface-contract.ts src/workspace-model.ts src/workspace-context.ts src/__tests__/create-planner-capabilities.test.ts src/__tests__/handle-create-flags.test.ts src/__tests__/contracts/generated-contracts.test.ts src/__tests__/contracts/npm-contracts-parity.test.ts src/__tests__/workspace-model.test.ts src/__tests__/workspace-context.test.ts docs/create-planner-capabilities.md docs/contracts/README.md docs/contracts/ARTIFACT_CATALOG.md`

## [0.37.1] - 2026-06-19

### Changed

- Updated npm package metadata to align with the Open-Source Workspace Intelligence positioning.
- Published the full `docs/` directory in the npm package so README-linked documentation and image assets are included.
- Replaced the npm README Mermaid diagram with a raw GitHub image URL and moved the Mermaid source into internal documentation.
- Added `workspace verify --json` to workspace agent context safe commands so agents and IDE surfaces can evaluate the official evidence gate.
- Documented freshness rules for `workspace verify` evidence in workspace operations docs.

### Fixed

- `workspace verify` now requires project-scoped `workspace-run-last.json` evidence to match the affected project by project name, relative path, or project path.
- `workspace verify` now blocks stale evidence generated before the current impact report.
- Project evidence from another project can no longer satisfy a required affected-project verification step.
- CLI process integration tests now strip Vitest environment variables from child CLI executions.

### Verification

- `node node_modules/vitest/vitest.mjs run src/__tests__/workspace-context.test.ts src/__tests__/workspace-verify.test.ts src/__tests__/workspace-intelligence.test.ts src/__tests__/workspace-intelligence-cli-chain.test.ts src/__tests__/contracts src/__tests__/package-publish-contract.test.ts`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js src --ext .ts`
- `node scripts/check-markdown-links.mjs`
- `node scripts/docs-drift-guard.mjs`
- `node node_modules/tsup/dist/cli-default.js`
- `node scripts/verify-package-cli.mjs`
- `node scripts/smoke-readme-commands.mjs`

## [0.37.0] - 2026-06-17

### Added

- **CLI Observability & Logging Infrastructure**
  - New `src/observability/` module for structured CLI logging and progress tracking.
  - `cli-log-event.ts` — Standardized log event capture and formatting.
  - `cli-log-format.ts` — Consistent CLI output formatting.
  - `cli-progress.ts` — Progress indicators for long-running operations.
  - `cli-run-context.ts` — Runtime context tracking for observability.
  - `src/contracts/cli-log-event-contract.ts` — Log event schema contract.
  - New contract schema `contracts/cli-log-event.v1.json`.

- **CLI UI Components & Theme**
  - New `src/cli-ui/` module for unified user interface.
  - `brand.ts` — Brand and version information.
  - `kit-picker-choices.ts` — Kit selection UI with enhanced choices.
  - `messages.ts` — Centralized CLI messages and prompts.
  - `prompts.ts` — Interactive prompt utilities.
  - `spinner.ts` — Loading spinners and progress indicators.
  - `theme.ts` — Color and formatting themes.

- **Workspace Registry & Governance**
  - `src/utils/workspace-registry-summary.ts` — Registry project enumeration and summarization.
  - `src/utils/governance-report-metadata.ts` — Governance artifact metadata extraction.
  - `src/utils/managed-agent-markers.ts` — Managed agent identification and tracking.
  - New contract schemas:
    - `contracts/workspace-registry.v1.json` — Registry structure and validation.
    - `contracts/release-readiness.v1.json` — Release readiness criteria.
    - `contracts/analyze-last-run.v1.json` — Analyze command evidence schema.
    - `contracts/doctor-project-evidence.v1.json` — Project health evidence.
    - `contracts/doctor-workspace-evidence.v1.json` — Workspace health evidence.
    - `contracts/workspace-run-last.v1.json` — Workspace run execution evidence.

- **Workspace Management & Agent Sync**
  - `src/workspace-agent-sync.ts` — Workspace synchronization with managed agents.
  - `src/utils/workspace-create-location.ts` — Workspace creation location resolver.
  - `src/utils/workspace-onboarding.ts` — Workspace onboarding utilities.
  - `src/utils/workspace-run-evidence.ts` — Workspace run evidence collection and reporting.

- **Documentation & Examples**
  - `docs/contracts/ARTIFACT_CATALOG.md` — Complete artifact schema catalog.
  - `docs/examples/ci-agent-grounding.yml` — CI/CD agent integration examples.
  - New comprehensive test coverage for governance, contracts, and workspace features.

- **Test Coverage**
  - `src/__tests__/cli-observability.test.ts` — CLI logging and observability tests.
  - `src/__tests__/cli-prompts.test.ts` — Interactive prompt tests.
  - `src/__tests__/contracts/governance-artifact-schemas.test.ts` — Governance schema validation.
  - `src/__tests__/contracts/release-readiness-schema.test.ts` — Release readiness validation.
  - `src/__tests__/governance-report-metadata.test.ts` — Governance metadata handling.
  - `src/__tests__/kit-picker-choices.test.ts` — Kit picker UI tests.
  - `src/__tests__/workspace-agent-sync.test.ts` — Agent sync functionality.
  - `src/__tests__/workspace-create-location.test.ts` — Workspace location resolution.
  - `src/__tests__/workspace-create-registry.integration.test.ts` — Registry integration.
  - `src/__tests__/workspace-registry-summary.test.ts` — Registry summarization.
  - `src/__tests__/workspace-run-evidence.test.ts` — Evidence collection and reporting.

### Changed

- Enhanced `src/commands/ai.ts` with improved type safety and module selection.
- Enhanced `src/commands/config.ts` with governance and lifecycle support.
- Updated `src/ai/embeddings-manager.ts` with better module recommendations.
- Improved `src/analyze.ts` with enhanced readiness checks.
- Enhanced `src/autopilot-release.ts` with governance-aware release candidate evaluation.
- Improved `src/create.ts` with location awareness and registry integration.
- Updated `src/doctor.ts` with comprehensive workspace and project evidence.
- Enhanced `src/index.ts` with observability context initialization.
- Improved `src/logger.ts` with structured logging integration.
- Updated `src/pipeline.ts` with governance gates.
- Enhanced `src/readiness.ts` with release-readiness evaluation.
- Improved `src/workspace-context.ts` with extended context information.
- Enhanced `src/workspace-intelligence.ts` with governance signals.
- Updated `src/workspace-run.ts` with evidence collection and reporting.
- Improved `src/workspace-verify.ts` with enhanced verification.
- Updated `src/workspace.ts` with registry and onboarding integration.
- Enhanced `vitest.config.ts` with improved test configuration.
- Updated `src/utils/workspace-contract.ts` with additional validation.
- Updated `src/utils/workspace-foundation.ts` with extended utilities.

- Documentation improvements:
  - Enhanced `docs/ci-workflows.md` with agent integration examples.
  - Updated `docs/commands-reference.md` with new commands and flags.
  - Enhanced `docs/contracts/README.md` with catalog references.

- Package updates:
  - Updated dependencies and dev dependencies.
  - Updated npm lock file.

### Fixed

- Fixed TypeScript compilation errors in `src/commands/ai.ts`: added type assertion for `selectedModules` from prompt result (type unknown → string[]).
- Fixed unused variable warnings in `src/utils/workspace-registry-summary.ts`: removed unused `registrySummaryPath` and `legacyWorkspaceJsonPath` variables.
- Fixed unused function warning in `src/workspace-run.ts`: removed unused `writeJsonFile` async function.

### Verification

- `npm run quality` passes with zero TypeScript compilation errors.
- Full test suite passes with new coverage for observability, governance, and workspace features.
- Contract schema validation passes for all governance artifacts.
- Integration tests validate workspace registry, agent sync, and evidence collection workflows.

## [0.36.0] - 2026-06-16

### Added

- Autopilot release now writes both `.rapidkit/reports/autopilot-release-last-run.json` and alias `.rapidkit/reports/autopilot-release.json` for dashboard and `--output` parity.
- Autopilot reports include `enterpriseControls` and `artifacts.aliasEvidencePath`.
- Workspace run reports include `enterpriseControls.evidencePath` for `.rapidkit/reports/workspace-run-last.json`.
- Workspace manifest records `profile_requested` and `bootstrap_note` when create/bootstrap falls back to a Python-free profile.
- Exported `buildWorkspaceManifest()` for contract-stable workspace metadata generation.
- Mirror sync/verify/rotate JSON reports include `mirror: { configExists, lockExists, artifactsCount }` inventory metadata.

### Changed

- Analyze treats zero-project workspaces as `warn` (not `fail`) for `workspace.projects.missing` across all profiles; verdict stays `needs-attention` instead of `blocked`.
- Analyze `nextActions` for registered empty workspaces prioritize create/import project over create-workspace CTAs.
- Workspace impact softens bootstrap-only git/validation noise to low risk for any profile with zero registered projects.
- `buildWorkspaceImpact` forwards `gitObservation` and skips invalid git path reads when `fromPath` is `git`.
- Readiness env gate uses workspace-scoped Python wording when no projects are registered.
- Workspace run `--strict` exit codes: skipped gates no longer fail the run; enforced `warn`/`fail` gates still block under strict mode.

### Fixed

- Empty workspace `workspace run --strict` with gates disabled returns exit code `0` instead of `1`.
- Workspace intelligence `validation.changed` risk mapping no longer compares against impossible `critical` severity on info/warning-only diffs.

### Verification

- `npm test -- src/__tests__/analyze.test.ts src/__tests__/autopilot-release.test.ts src/__tests__/readiness.test.ts src/__tests__/workspace-intelligence.test.ts src/__tests__/workspace-run.test.ts src/__tests__/workspace-manifest-bootstrap.test.ts src/__tests__/phase3-commands.test.ts`
- `npm run quality`

## [0.35.0] - 2026-06-16

### Added

- Added `rapidkit adopt [path]` for in-place project adoption into a workspace without moving or copying source files.
- Added adoption metadata at `.rapidkit/adopt.json` and `.rapidkit/adopt-readiness.json`.
- Added `rapidkit create frontend <id> <name>` with official generators for Next.js, Remix, Vite (React/Vue/Svelte/Solid/Vanilla), Nuxt, Angular, Astro, and SvelteKit.
- Added frontend generator smoke workflow (`smoke:frontend-generators`) and CI coverage for official scaffold commands.
- Added workspace intelligence surfaces: `workspace model`, `workspace context`, `workspace snapshot`, `workspace verify`, `workspace diff`, and `workspace impact`.
- Added workspace intelligence JSON contracts under `contracts/workspace-intelligence/`.
- Added frontend framework detection contracts and doctor frontend signals (Next.js, React, Vite, Vue, Angular, SvelteKit, Nuxt, Astro, Remix, Solid).
- Added stack-aware suggested default names for interactive `create project`.
- Added node lifecycle script resolution, runtime executors, and lifecycle probes for enterprise/polyglot workspaces.
- Added enterprise lifecycle contract helpers and expanded infra stack catalog/contract coverage.
- Added generated shared-contracts pipeline (`generate:contracts`, `validate:contracts`).
- Added Git observation helpers for workspace intelligence snapshots.
- Expanded runtime command surface and import-stack parity snapshots for frontend kits and adoption flows.

### Changed

- Workspace contract and model discovery now include adopted external projects from the workspace registry.
- Node project detection prefers concrete frontend framework signals before falling back to generic Node.
- Doctor project evidence is richer (frontend probes, project kind, lifecycle signals, vulnerability summaries).
- Project command capabilities matrix reflects frontend vs backend module support accurately.
- Import readiness and module-support flows align with adopted/imported project metadata.
- NestJS kit templates use canonical `src/modules/free/` layout and updated Docker/tsconfig paths.
- README and command ownership matrix document adopt, create frontend, and workspace intelligence workflows.

### Fixed

- Runtime acceptance matrix no longer runs global CLI scenarios from the npm repo root (avoids Vite project false positives).
- Workspace acceptance matrix creates workspaces under an isolated run directory with `--output .` and unique names.
- Init-scenario integration tests isolate `HOME` so default workspace slot resolution stays deterministic.
- Hardened analyze/readiness handling for workspace shell roots that are not analyzable projects.

### Security

- Bumped transitive `js-yaml` to address moderate DoS advisory (GHSA-h67p-54hq-rp68).

### Verification

- Validated with `npm run validate`, `npm run validate:contracts`, `npm run security`, and `npm run test:runtime-matrix:full`.

## [0.34.0] - 2026-06-14

### Added

- Added wrapper-owned `rapidkit pipeline` command to orchestrate sync → doctor → analyze → readiness → autopilot and write `.rapidkit/reports/pipeline-last-run.json`.
- Added `contracts/pipeline-last-run.v1.json` schema for pipeline evidence.
- Added `doctor workspace|project --strict` and `--ci` exit-code gates for CI pipelines.
- Added readiness **analyze** gate consuming `analyze-last-run.json`.
- Added CLI-native verify fallback via inline `workspace contract verify` with evidence at `workspace-contract-verify-last-run.json`.
- Added `--skip-verify` on `readiness` and `pipeline` for environments without extension verify artifacts.
- Added `workspace sync --json` machine-readable output for CI.
- Added shared `findWorkspaceRootUp()` in `src/utils/workspace-root.ts`.
- Added analyze stage to `autopilot release` and `skipPipelineStages` when invoked from pipeline.
- Added regression coverage for doctor gate exit codes, readiness verify/analyze gates, and pipeline ownership.

### Changed

- Bootstrap now auto-syncs workspace registry and contract after successful init.
- `bootstrap --json --compliance-only` skips init for compliance-only CI gates; default `bootstrap --json` runs init after compliance checks.
- Readiness verify gate accepts extension verify-pack artifacts **or** CLI contract verification.
- Updated CLI help, README, and command ownership matrix for the governance loop.

### Fixed

- Doctor JSON/project modes now return CI gate exit codes consistently via `computeDoctorGateExitCode()`.
- Autopilot doctor stage respects `--ci` / `--strict` subprocess exit codes from the npm wrapper.

### Verification

- Validated with `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test` (1224 tests).

## [0.33.2] - 2026-06-12

### Added

- Added cross-platform regression coverage for workspace-local Core runner discovery, marker-based virtualenv paths, user-local/pipx Core installs, and generated launcher recursion guards.
- Added a focused Windows bridge resolver regression step to the native `windows-latest` E2E workflow.

### Changed

- Hardened generated workspace launchers so missing local virtualenvs fall back to a non-local npm wrapper before deterministic user-local Core executables.
- Updated Python Core runner resolution to honor `.rapidkit-workspace` `metadata.python.venvPath` for non-standard workspace-local engine installs.
- Updated user-local Core discovery to scan pipx/Python script locations even when those locations are not on `PATH`.

### Fixed

- Fixed Windows `npx --package rapidkit rapidkit ...` flows being shadowed by a workspace-local `rapidkit.cmd` that could not locate Core.
- Fixed launcher recursion by marking forwarded calls with `RAPIDKIT_LOCAL_LAUNCHER_BYPASS` so the npm wrapper does not delegate back to the same local launcher.
- Fixed an interactive npm-owned generator regression test that could hit git initialization and timeout during coverage runs.

### Verification

- Validated with `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `npm run test:coverage`.
- Validated focused bridge coverage with platform, launcher, workspace runner, Python bridge, and create fallback regression tests.

## [0.33.1] - 2026-06-10

### Added

- Added `coreForwarding` bridge helpers with explicit rules for wrapper-shared CLI flags and Python core context engines.
- Added regression coverage for module lifecycle `--dry-run` forwarding and bare workspace name boundaries.

### Fixed

- Fixed npm bridge mis-routing when `--dry-run` prevented core module lifecycle commands (`rollback`, `uninstall`, `upgrade`, `diff`, `checkpoint`) from reaching Python core.
- Fixed bare workspace names such as `my-workspace --dry-run` being forwarded to core instead of staying on the npm wrapper.
- Extended in-project Python core delegation from `pip` only to `poetry`, `venv`, `pipx`, and `python` install backends.

### Changed

- Refactored `shouldForwardToCore()` to recognize core-owned commands before wrapper-shared flag short-circuit.

### Verification

- Validated with `npm run build` and targeted forwarding tests in `coreForwarding.test.ts` and `phase3-commands.test.ts`.

## [0.33.0] - 2026-06-10

### Added

- Added wrapper-owned `rapidkit infra plan|up|down|status` for contract-driven local infrastructure sidecars (PostgreSQL, Redis, Mailpit, MinIO, and related services) via `.rapidkit/infra/docker-compose.yml`.
- Added `contracts/infra-stack.v1.json` plus discovery from installed modules, project `.env.example`, workspace contract env, and `.rapidkit/infra/overrides.json`.
- Added infra plan artifacts under `.rapidkit/reports/infra-plan.json` and connection env previews under `.rapidkit/infra/.env.example`.
- Added `npx rapidkit workspace foundation ensure` to reconcile workspace.json, policies, toolchain, and related foundation files.
- Added canonical module layout contract (`contracts/module-layout.v1.json`) with doctor workspace module-path audit and `--module-paths` support on `workspace contract verify --strict`.
- Added regression coverage for infra planning/commands, module layout parity, workspace foundation, and CLI help snapshots.

### Changed

- Updated workspace contract discovery to export project scanning helpers used by infra and layout tooling.
- Updated NestJS kit templates to use the canonical `src/modules/free/` module root and aligned TypeScript path mapping.
- Updated CLI help, README, and command ownership matrix to document `infra` and foundation ensure.
- Published `contracts/` in the npm package tarball so bundled contract resolution works outside the repo root.

### Fixed

- Fixed infra contract loading to resolve from the installed package instead of `process.cwd()`.
- Fixed infra compose generation for empty plans and aligned Postgres container env/healthchecks with workspace `.env.example` defaults.
- Improved Docker Compose invocation with compose v2/v1 fallback, normalized `-f` paths, and actionable errors for disk/full-daemon failures.

### Verification

- Validated with `npm run build`, infra unit/command tests, ownership matrix drift guard, and SaaS workspace sidecar smoke (`infra plan`, `infra up`, `infra status --strict`).

## [0.32.2] - 2026-06-08

### Added

- Added Node-based wrappers for drift guard, local scenario matrix execution, package size reporting, and Husky preparation so release and validation scripts behave consistently across operating systems.
- Added regression coverage for mixed-runtime workspace initialization when an extended runtime is missing from the user's machine.
- Added an offline embeddings artifact validation script for deterministic package preparation.

### Changed

- Hardened Python bridge interpreter selection to prefer explicit overrides, local core virtual environments, versioned Python binaries, and platform defaults before failing.
- Updated release and e2e shell scripts to select only Python interpreters with working `venv` support.
- Updated `workspace run init` to continue initializing remaining projects when a project fails because an optional runtime SDK is unavailable.
- Updated packaging docs to describe validation of the committed embeddings artifact instead of regenerating it during `prepack`.
- Updated generated ASP.NET project launchers so `dev` uses stable `dotnet run` behavior instead of `dotnet watch`.

### Fixed

- Fixed mixed workspaces where a missing `.NET`, Java, or other extended runtime could prevent first-class FastAPI or NestJS projects from initializing.
- Fixed package release flows where Husky output could pollute `npm pack --json` output.
- Fixed release scripts that depended on Unix-only environment assignment or filesystem commands.
- Fixed bridge fallback behavior when `python3` exists but cannot create a virtual environment.
- Fixed generated ASP.NET builds failing on missing XML documentation comments by suppressing `CS1591` while keeping other warnings as errors.

### Verification

- Validated with `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `npm run test:runtime-matrix`.
- Validated release and docs gates with `npm run validate:docs`, `npm run check:contracts`, `npm run test:parity-contract`, `npm run verify:package-cli`, and `npm pack --ignore-scripts --dry-run --json --silent`.
- Validated local first-use scenarios with `npm run test:scenarios`.

## [0.32.1] - 2026-06-08

### Added

- Added the shared runtime command surface contract to keep `rapidkit-npm` and the Workspai VS Code extension aligned on lifecycle commands, module mutation support, scaffold kits, and runtime support tiers.
- Added contract regression coverage for runtime command surface parity and module marketplace boundaries.

### Changed

- Updated parity contract sync tooling so import-stack parity and runtime command surface parity are checked together.
- Hardened generated Go/Fiber and Go/Gin Windows launchers to use native Go commands instead of requiring GNU Make.

### Fixed

- Fixed Windows Go project launcher behavior for users without GNU Make installed.
- Fixed a tooling drift gap where npm and extension command surfaces could evolve without a shared tested contract.

### Verification

- Validated with `npm run typecheck`.
- Validated with `npm run lint`.
- Validated runtime command surface coverage with `vitest` contract and Go generator tests.

## [0.32.0] - 2026-06-07

### Added

- Added the runtime acceptance matrix script as local release evidence for workspace and project commands across FastAPI, NestJS, Go/Fiber, Go/Gin, Spring Boot, ASP.NET Core, and observed runtimes.
- Added runtime acceptance matrix documentation covering report persistence, release rules, and local-only execution expectations.

### Changed

- Updated runtime acceptance reports to write under a stable system temp report directory by default so evidence survives temporary workspace cleanup.
- Hardened the security workflow so `npm audit --audit-level=moderate` fails the workflow instead of continuing after audit findings.
- Refreshed vulnerable transitive dependency locks, including the Vitest toolchain, to clear npm audit findings before publish.

### Verification

- Validated with `npm run validate`.
- Validated package publishing with `npm publish --dry-run --access public`.
- Validated security posture with `npm audit --audit-level=moderate`.

## [0.31.0] - 2026-06-02

### Added

- Added portable workspace archive handoff flows for exporting, inspecting, verifying, doctoring, and hydrating workspace archives.
- Added Workspace Contract Registry support for canonical workspace topology, services, ports, dependencies, events, and ownership metadata.
- Added deterministic contract graph and verification utilities so workspace topology can be inspected before sharing or release.
- Added package CLI resolution checks to catch Windows/global install collisions where the Python Core executable could be resolved before the npm wrapper.

### Changed

- Hardened npm-owned command routing so wrapper-level commands stay inside the npm CLI instead of falling through to the Python bridge.
- Updated workspace archive behavior for stronger multi-OS path handling and safer archive portability.
- Improved workspace handoff alignment with Workspai extension import/export and remote import workflows.
- Strengthened package publish contract coverage around CLI entrypoints and wrapper ownership.

### Fixed

- Fixed archive hydrate path containment so archives cannot write outside the requested destination.
- Fixed workspace archive and contract validation edge cases that could accept malformed or unsafe paths.
- Fixed npm command ownership regressions affecting users who run `npx rapidkit ...` or globally installed `rapidkit` on Windows.

### Verification

- Recommended release checks: `npm run typecheck`, `npm run test`, `npm run build`, `npm run verify:package-cli`, and `npm audit --audit-level=moderate`.

## [0.30.0] - 2026-05-30

### Added

- Added `rapidkit analyze [--workspace <path>] [--json] [--strict] [--output <file>]` for workspace analysis and CI-ready evidence export.
- Added `npm run generate-embeddings` for real OpenAI module embedding generation.
- Added `npm run test:prepare-embeddings` for deterministic mock module embedding generation.

### Changed

- Added `prepack` hook to regenerate `data/modules-embeddings.json` before packaging.
- Updated package content and docs to support embedding-based AI recommendation workflows.

### Fixed

- Fixed `rapidkit analyze` workspace path validation and strict mode CLI behavior.
- Fixed deterministic AI module catalog tests and bridge mocking for stable CI coverage.

## [0.29.1] - 2026-05-26

### Changed

- Hardened CLI process test builds with a shared locked `dist/index.js` build helper to avoid parallel rebuild races across integration suites.
- Updated direct CLI bootstrap detection to support generated `dist/index.js` and source-entry execution paths consistently.
- Updated CI with a dedicated backend project import rollback guard.

### Fixed

- Fixed workspace project import cleanup so failed local copies and git clones remove partially prepared destination directories.
- Fixed workspace import source boundary checks to use `path.relative` semantics for safer cross-platform path handling.
- Fixed CLI subprocess output reliability by forcing stdout/stderr into blocking mode during direct CLI execution.
- Refreshed transitive dependency locks to clear npm audit findings for `basic-ftp`, `brace-expansion`, `fast-uri`, `ip-address`, `postcss`, and `ws`.

## [0.29.0] - 2026-05-26

### Added

- Added workspace snapshot support with manifest-based workspace and project snapshot schema.
- Added workspace snapshot regression coverage and integration tests.

### Changed

- Updated repository metadata and documentation references from `getrapidkit` to `rapidkitlabs`.

### Fixed

- Fixed release note and docs references following the workspace snapshot support update.

## [0.28.0] - 2026-05-22

### Added

- Added new release orchestration command:
  - `npx rapidkit autopilot release --mode <audit|safe-fix|enforce> [--json] [--output <file>] [--since <ref>] [--parallel] [--max-workers <n>]`
- Added dedicated autopilot report contract and artifact output:
  - `.rapidkit/reports/autopilot-release-last-run.json`
- Added dedicated regression coverage for autopilot release orchestration:
  - `src/__tests__/autopilot-release.test.ts`

### Changed

- Updated npm-only top-level command ownership and help surface to include `autopilot` as a wrapper-owned command.
- Updated README command docs and ownership matrix to include `autopilot release` behavior and usage.
- Hardened `autopilot release` enforce policy with deterministic blocker reasons for warning-grade gate results.
- Hardened `autopilot release --mode safe-fix` to re-run doctor/readiness after apply and derive final verdict from post-apply gate status.
- Hardened command execution classification in `autopilot release` to map process-level crashes to explicit execution-error exit code `3`.

### Fixed

- Expanded autopilot regression coverage with a lightweight end-to-end enforce flow test over a real workspace fixture and warned stage gate behavior.

## [0.27.6] - 2026-05-19

### Added

- Added shared workspace project discovery utility to unify scan behavior across `workspace run` and `workspace share`.
- Added centralized timeout policy helpers for probe/network/bridge paths:
  - `src/utils/command-timeouts.ts`
- Added doctor remediation planning and non-interactive apply flows:
  - `npx rapidkit doctor workspace --plan`
  - `npx rapidkit doctor workspace --apply`
  - `npx rapidkit doctor project --plan`
  - `npx rapidkit doctor project --apply`
- Added dedicated doctor regression coverage for `--plan` and `--apply` modes.

### Changed

- Unified AI/user config schema usage through `.rapidkitrc.json` with legacy fallback compatibility for older AI config path.
- Hardened user config file permissions for sensitive key material on Unix-like systems.
- Updated update-checker and Python bridge paths to use centralized timeout policy instead of scattered literals.
- Updated README doctor command surface and behavior docs to include remediation planning and non-interactive apply guidance.

### Fixed

- Fixed doctor fix execution scope regression (`goToolchainAvailable` resolution) causing compile failure in fix flows.
- Removed duplicated workspace discovery implementations that could drift behavior between command surfaces.

## [0.27.5] - 2026-05-15

### Added

- Added live non-JSON progress output for `workspace run <stage>` execution, including per-project start/completion visibility with completion percentage and per-project duration.
- Added doctor regression coverage for global-only RapidKit Core installations where workspace `.venv` is missing, ensuring optional advisory messaging remains stable.

### Changed

- Updated global RapidKit Core reuse behavior in create/bootstrap flows to be version-aware and constraint-compatible before skip/reuse decisions.
- Updated doctor guidance text for global-only RapidKit Core setups to recommend workspace-level bootstrap via:
  - `npx rapidkit workspace run init`

### Fixed

- Reduced operator ambiguity during long `workspace run init` executions by surfacing real-time terminal progress instead of end-only summary output.

## [0.27.4] - 2026-05-11

### Added

- Added new shared contract parity tests to keep npm import-stack mapping aligned with the shared snapshot contract:
  - `src/__tests__/contracts/import-stack-parity.snapshot.test.ts`
- Added backend framework contract utility and coverage to normalize framework/runtime detection and canonical stack mapping:
  - `src/utils/backend-framework-contract.ts`
  - `src/__tests__/backend-framework-contract.test.ts`
- Added new workspace import command support for bringing local folders or git repositories into a workspace:
  - `rapidkit import <path|git-url> [--workspace <path>] [--name <project-name>] [--git] [--json]`
  - `src/import-project.ts`
  - `src/imported-projects-registry.ts`
  - `src/__tests__/import-project.test.ts`
- Added regression coverage for strict doctor scope semantics:
  - guards against workspace-root misclassification in project mode.
  - guards against invalid workspace marker-only structures in workspace mode.

### Changed

- Hardened parity contract validation with strict schema pinning and bidirectional key-set checks to fail fast on contract drift.
- Updated CI to enforce shared import-stack parity via dedicated parity test gate (`npm run test:parity-contract`).
- Updated doctor/readiness/workspace-share evidence compatibility handling to safely reject unknown schema versions while preserving legacy evidence compatibility.
- Expanded doctor JSON metadata with canonical framework identity for automation:
  - `frameworkKey`
  - `importStack`
- Improved workspace project detection and stage command framework normalization for better runtime/framework command routing consistency.
- Hardened doctor scope resolution boundaries to avoid confusing parent fallback behavior:
  - `doctor project` now resolves only real project scope inside a workspace and no longer treats workspace-root backend markers as project target.
  - `doctor workspace` now enforces stricter workspace-root architecture validation before execution.
- Improved project-scope failure messaging so users get deterministic guidance when running `doctor project` outside a valid project directory.

### Fixed

- Fixed import rollback flow to remove imported files and registry entries when post-import workspace sync fails.
- Fixed explicit workspace import behavior to fail deterministically for invalid workspace paths (no silent fallback).
- Fixed potential path brittleness in parity tests by adding resilient shared snapshot resolution and optional env override support.

## [0.27.3] - 2026-05-09

### Added

- Added canonical `doctor project` scope support in CLI and docs (`npx rapidkit doctor project`).
- Added project-scoped doctor evidence contract fields and scoring metadata for automation consumers:
  - `contract`
  - `scoreBreakdown`
  - `summary.scopeProvenance`
  - `driftDelta`
- Added deterministic project probes and adapter-contract coverage in doctor tests, including nested-directory project resolution scenarios.
- Added enterprise-grade workspace stage orchestrator implementation and coverage:
  - `src/workspace-run.ts`
  - `src/framework-registry.ts`
  - `src/__tests__/workspace-run.test.ts`

### Changed

- Updated root init semantics so workspace-root aliases share one full-init orchestration flow:
  - `npx rapidkit init`
  - `npx rapidkit workspace init`
  - `npx rapidkit workspace run init`
- Updated workspace command surface to include `workspace run <init|test|build|start>` options for affected-only execution, blast-radius expansion, JSON output, parallel execution, and gate controls.
- Updated docs to be OSS-focused by removing enterprise-only runbook links from open-source README indices.

### Fixed

- Enforced workspace-root-only behavior for workspace management actions (for professional/strict operation semantics).
- Fixed init argument target parsing to ignore flags and resolve only explicit path targets.
- Fixed phase-3 integration timeout flake for workspace-root init wrapper scenario by aligning test timeout with full-init pre-step behavior.
- Removed duplicate enterprise governance runbook from npm OSS docs path (`docs/ENTERPRISE_GOVERNANCE_RUNBOOK.md`).

## [0.27.2] - 2026-05-04

### Added

- Enriched `doctor workspace` JSON output with AI/automation profile fields:
  - `runtimeFamily`
  - `projectKind`
  - `supportTier`
  - `frameworkConfidence`
- Expanded framework/runtime detection coverage in `doctor workspace` across Node, Python, Go, Java, PHP, Ruby, and .NET marker sets.

### Changed

- Upgraded Node framework classification from static assumptions to signal-based detection (for example, `Next.js`, `Nuxt`, `NestJS`, `Express`, `Fastify`, `Koa`, `React`, `Vue`, `Angular`, `SvelteKit`).
- Added framework profile rendering in human-readable doctor output (`runtime`, `kind`, `support`, `confidence`).
- Updated doctor workspace project-scan cache signature with schema versioning and broader manifest markers to prevent stale framework classification reuse.
- Updated README command docs to explicitly include `rapidkit readiness` at CLI level and clarify `doctor workspace --fix` advisory behavior.

### Fixed

- Fixed frontend misclassification in `doctor workspace` where Next.js projects could be reported as NestJS.
- Fixed advisory warning visibility alignment so environment/security advisory context is represented consistently in doctor summary outputs.
- Removed unrelated extension guidance drift line from `releases/RELEASE_NOTES_v0.27.1.md`.

## [0.27.1] - 2026-05-03

### Added

- Added executable install flow in `rapidkit ai recommend`: when users confirm selected modules, the CLI now runs `rapidkit add module ...` through the core bridge instead of stopping at a placeholder message.
- Added command-scope drift guard coverage between npm ownership contract and implementation:
  - `src/__tests__/contracts/ownership-matrix.test.ts` ensures wrapper-owned command list stays in sync with `docs/contracts/COMMAND_OWNERSHIP_MATRIX.md`.
- Added AI smoke tests for user-facing reliability:
  - `src/__tests__/commands/ai.command.test.ts`
  - `src/__tests__/ai/embeddings-manager.test.ts`

### Changed

- Updated module catalog parsing to contract-first identity resolution for `ModulesListResponseV1`:
  - Canonical module ID now prefers `slug` before fallback fields (`name`, `id`, `module_id`).
- Improved module search quality by making keyword matching truly case-insensitive.
- Updated coverage policy to include previously excluded high-impact CLI paths (`src/index.ts`, `src/commands/**`, `src/ai/embeddings-manager.ts`) in aggregate coverage accounting.
- Synchronized extension command-scope guidance with npm ownership updates by adding `npx rapidkit readiness` to AI context hints.

### Fixed

- Removed AI recommend UX dead-end where users were prompted to install modules but received a “not implemented” message.
- Resolved contract drift risk where missing `slug` support could generate invalid quick-install targets in mixed registry payloads.
- Aligned embeddings prompt messaging with mock-mode behavior so key/no-key guidance is consistent with runtime behavior.

## [0.27.0] - 2026-04-27

### Fixed

- Fixed Commander action handler binding for `rapidkit workspace share` so options are resolved from command context and no longer misparsed in `npx` flows.
- Restored reliable support for `workspace share` flags:
  - `--output <file>`
  - `--include-paths`
  - `--no-doctor`

## [0.26.0] - 2026-04-24

### Added

- Added the new `springboot.standard` generator with Spring Boot project scaffolding, Docker/dev launcher assets, GitHub Actions CI, and generated operational defaults.
- Added a Java runtime adapter for `init`, `dev`, `test`, `build`, `start`, prerequisite checks, and cache warmup flows.
- Added full regression coverage for the Spring generator, Java runtime adapter, and platform capability helpers.

### Changed

- Raised bundle-analysis reliability for this Node CLI by replacing the browser-oriented `analyze` flow with a native `dist/` analyzer that reports raw and gzip sizes for generated bundles.
- Increased project-wide automated coverage to 986 passing tests with stronger Java/Spring and cross-platform branch coverage.

### Fixed

- Hardened Java wrapper execution on Unix by repairing missing executable bits and falling back to `sh` when direct wrapper execution is not possible.
- Enforced Java version preflight checks against `pom.xml` requirements, including nested Java projects discovered from workspace roots.
- Hardened generated Spring CI so wrapper bootstrap is OS-aware and no longer depends on brittle ambient behavior on Windows.
- Closed multiple Windows/pathing gaps through full coverage of `src/utils/platform-capabilities.ts`.

## [0.25.7] - 2026-04-19

### Changed

- Extracted shared Go generator helpers into `src/generators/go-kit-common.ts` and rewired both `gofiber.standard` and `gogin.standard` generators to use common template builders for `Makefile`, `rapidkit`, and `rapidkit.cmd`.
- Centralized shared defaults and utilities for Go kit generation (`DEFAULT_GO_VERSION`, `toPascalCase`, `writeGeneratorFile`) to reduce duplicated logic.

### Fixed

- Pinned generated Go tool installation targets for reproducible bootstrap flows:
  - `github.com/air-verse/air@v1.52.3`
  - `github.com/swaggo/swag/cmd/swag@v1.16.3`
- Simplified generated `go.mod` templates for both Go kits by removing large indirect dependency blocks and retaining direct requirements.

## [0.25.6] - 2026-04-19

### Added

- 7 new unit tests in `src/__tests__/register-workspace.test.ts` and `src/__tests__/create-internal.test.ts` covering previously uncovered branches in `registerWorkspaceAtPath` and `createDemoWorkspace`: git init failure warn, git commit success path, poetry probe → venv fallback, pipx install path, install throw → `spinner.fail` + rethrow, registry import silent fail, demo workspace git fail warn.

### Fixed

- `import fsExtra from 'fs-extra'` — corrected from `import * as fsExtra` to a proper default import in `src/index.ts`.
- Resolved 10 security vulnerabilities (1 critical `basic-ftp`, 7 high, 2 moderate) in devDependencies via `npm audit fix`.

### Performance

- `dist/index.js` reduced from 258 KB to 126 KB (-51%) by converting five static module imports (`create`, `demo-kit`, `gofiber-standard`, `gogin-standard`, `doctor`) to inline lazy `await import()` calls at their respective call sites.
- Cold-start time reduced from 366 ms to 317 ms on reference hardware.

### Added

- `detectWindowsDoctorWorkspaceShadow()` — detects when a workspace-local `rapidkit.cmd` / `rapidkit.exe` launcher on Windows would shadow the global CLI during `doctor --workspace` runs; prints a yellow warning and falls back to the npm-wrapper doctor workflow to avoid ambiguous binary resolution.

### Fixed

- Formatter whitespace alignment in multi-line string concatenations and ternary expressions (`src/index.ts`)

## [0.25.4] - 2026-04-16

### Added

- ⚡ **Update check caching** — `checkForUpdates()` now caches the npm registry result to `~/.rapidkit/cache/update-check.json` with a 4-hour TTL. Subsequent CLI invocations within the TTL window skip the `npm view rapidkit version` network call entirely, eliminating up to 3 seconds of blocking startup time on slow or offline networks.
- 🔒 Cache is automatically invalidated when the installed CLI version changes (version-keyed), so upgrade notifications are never missed.

## [0.25.3] - 2026-03-22

### Added

- 🩺 Added workspace doctor project-scan cache with signature invalidation and reuse metadata (`.rapidkit/reports/doctor-workspace-cache.json`).
- 🧾 Added doctor evidence export on each workspace run (`.rapidkit/reports/doctor-last-run.json`) with system/project summary and cache context.
- ✅ Added regression coverage for workspace scan caching/evidence generation and Go toolchain-missing auto-fix gating.

### Changed

- ⚡ Parallelized system tool checks in workspace doctor path to reduce runtime for repeat diagnostics.
- 🛠️ Updated `doctor workspace --fix` to run post-fix verification and refresh evidence automatically.
- 📚 Clarified command ownership and doctor scope messaging (`doctor` vs `doctor workspace`) in CLI help and README.

### Fixed

- 🧠 Fixed fix-command parsing for project-scoped commands so `go mod tidy` detection is reliable in auto-fix flow.
- 🐹 Fixed Go auto-fix behavior to skip `go mod tidy` when Go toolchain is unavailable, with explicit guidance instead of failed shell execution.

## [0.25.2] - 2026-02-27

### Added

- 🧭 Added explicit command ownership contract for wrapper/core boundaries:
  - Wrapper-orchestrated project command set now explicitly includes `init`.
  - Added ownership reference doc: `docs/contracts/COMMAND_OWNERSHIP_MATRIX.md`.
- 🧪 Added forwarding-boundary assertions to prevent `init` delegation regressions.

### Changed

- 🚀 Upgraded `init` orchestration to runtime-aware smart behavior:
  - Detects runtime by project markers and file heuristics (`go.mod`, `package.json`, `pyproject.toml`/`requirements.txt`).
  - Keeps `init` on npm wrapper path to apply policy context + fallback logic consistently.
- 🐍 Python `init` now enforces project-local `.venv` binding and falls back to direct `pip` installation paths when primary flow cannot complete.
- 🌐 Node `init` now has resilient package-manager fallback attempts (`npm` → `pnpm` → `yarn`) based on tool availability.
- 🛡️ Lifecycle delegation for Go/Node projects is kept on wrapper/runtime adapter path to avoid local launcher argument drift (`dev --port` misrouting).

### Fixed

- 🧩 Fixed scenario where `rapidkit init` could succeed without creating project-local `.venv` in Python projects due to cached/global Poetry env binding.
- 🧱 Fixed Go lifecycle command forwarding issue that could pass unsupported args to `make` via local launcher delegation.
- 🗣️ Fixed silent `rapidkit init` behavior for Go projects without Go installed by surfacing clear user-facing error messaging.

## [0.25.1] - 2026-02-27

### Added

- 🪟 Added Windows workspace launcher generation (`rapidkit.cmd`) for legacy workspace-local CLI wrappers.
- 🧭 Added cross-platform local-bin path candidates utility for Python tool discovery:
  - `src/utils/platform-capabilities.ts`

### Changed

- 🐍 Updated Poetry-missing behavior in workspace creation to auto-fallback to `venv` without blocking on Poetry installation prompts.
- 🌍 Hardened cross-platform tool/path detection in doctor checks:
  - Poetry detection now probes `python -m poetry` across Python candidates.
  - pipx detection now probes `python -m pipx` when `pipx` binary is unavailable.
  - RapidKit binary discovery now uses centralized platform capability helpers.
- 🧪 Updated internal create-flow tests to reflect Poetry→venv fallback behavior while keeping pipx flow expectations intact.

### Fixed

- ⛔ Fixed blocking UX where selecting Poetry could trigger install-prompt expectations/tests even when fallback-to-venv path should proceed non-interactively.
- 🧹 Removed hardcoded Unix-only Python path assumptions in runtime Python discovery for create flow.
- 🧱 Closed legacy cross-platform gap for workspace-local launcher availability on Windows.

## [0.25.0] - 2026-02-26

### Added

- 🧱 Extended workspace command contract coverage for `workspace list` and policy command surfaces across docs/help/tests.
- 🧪 Expanded process-level Phase-3 integration coverage for workspace list/policy and lifecycle contract scenarios.
- 🧰 Added deterministic dist artifact refresh behavior for CLI entry process tests when `dist/index.js` is missing/stale.
- 🧭 Added platform capability utility surface:
  - `src/utils/platform-capabilities.ts`

### Changed

- 🖥️ Unified root help UX so `rapidkit`, `rapidkit --help`, and `rapidkit help` render aligned output.
- 📚 Refreshed release-facing and governance docs for current workspace command model:
  - `README.md`
  - `docs/README.md`
  - `docs/SETUP.md`
  - `docs/doctor-command.md`
  - `docs/OPEN_SOURCE_USER_SCENARIOS.md`
  - `docs/ENTERPRISE_GOVERNANCE_RUNBOOK.md`
  - `docs/config-file-guide.md`
  - `docs/policies.workspace.example.yml`
- ⚙️ Updated runtime adapter and bridge paths (`python`, `node`, `go`) for stronger workspace-aware execution behavior.
- 🔁 Updated CI/e2e workflow alignment for release and docs governance expectations:
  - `.github/workflows/ci.yml`
  - `.github/workflows/e2e-smoke.yml`

### Fixed

- 🧩 Reduced test instability caused by absent build artifacts in process-invoked CLI tests.
- 🧹 Reduced noisy workspace/debug output and improved workspace registry hygiene paths.

## [0.24.2] - 2026-02-25

### Added

- 🧰 Added docs governance scripts:
  - `scripts/check-markdown-links.mjs`
  - `scripts/docs-drift-guard.mjs`
  - `scripts/smoke-readme-commands.mjs`
- ✅ Added docs validation npm pipeline:
  - `check:markdown-links`, `check:docs-drift`, `smoke:readme`, `validate:docs`.

### Changed

- 📚 Refreshed workspace-based docs and canonical command contracts:
  - `docs/SETUP.md`
  - `docs/doctor-command.md`
  - `docs/README.md`
  - `docs/OPEN_SOURCE_USER_SCENARIOS.md`
- 🩺 Standardized workspace doctor references to `rapidkit doctor workspace`.
- 🧪 Expanded workspace matrix lifecycle/chaos E2E coverage and narrowed bridge-only smoke workflow scope.
- ⚙️ Improved runtime setup flow with optional warm dependency behavior (`--warm-deps`) and adapter cache warm hooks.

### Fixed

- 🧭 Reduced docs/CI drift risk by enforcing command/workflow ownership presence checks in README.
- 🪟🍎 Improved cross-workflow CI ownership clarity to avoid duplicated regression surface.

## [0.24.1] - 2026-02-25

### Fixed

- 🧩 Restored setup command contract so `rapidkit setup <python|node|go>` no longer depends on `RAPIDKIT_ENABLE_RUNTIME_ADAPTERS=1`.
- 🍎 Added macOS arm64 Rollup optional dependency workaround in CI matrix to avoid install-time module resolution failures.

### Changed

- 🧭 Updated create prompt defaults to honor configured workspace defaults (`pythonVersion`, `defaultInstallMethod`) in profile-first flows.
- 🐍 Python runtime adapter prereq checks now fall back to legacy `doctor` when `doctor check` is unavailable/non-zero.
- 🧪 Aligned create/setup/runtime contract tests with current wrapper behavior.
- 🧹 Ignored local `.rapidkit/` generated artifacts to keep commits clean.

## [0.24.0] - 2026-02-25

### Added

- 🪟 Added Windows-native bridge + workspace lifecycle CI workflow:
  - `.github/workflows/windows-bridge-e2e.yml`
- 🧪 Added/updated cross-OS workspace matrix workflow:
  - `.github/workflows/workspace-e2e-matrix.yml`
- 🪞 Added mirror lifecycle engine with integrity, attestation, evidence, and policy hooks:
  - `src/utils/mirror.ts`
- 📚 Added operational/public docs for governance and user scenarios:
  - `docs/ENTERPRISE_GOVERNANCE_RUNBOOK.md`
  - `docs/OPEN_SOURCE_USER_SCENARIOS.md`
  - `docs/mirror-config.enterprise.example.json`
  - `docs/governance-policy.enterprise.example.json`
  - `docs/policies.workspace.example.yml`
- 🧰 Added docs example schema/shape validator:
  - `scripts/validate-doc-examples.mjs`
- ✅ Added new mirror and scenario test suites:
  - `src/__tests__/mirror-lifecycle.unit.test.ts`
  - `src/__tests__/mirror-evidence-export.integration.test.ts`
  - `src/__tests__/mirror-sigstore-branches.test.ts`
  - `src/__tests__/user-level-scenarios.integration.test.ts`

### Changed

- ⚙️ Hardened runtime adapter behavior across Python/Node/Go paths (cache/env and workspace-aware execution behavior).
- 🧠 Improved Python bridge execution integration path (`pythonRapidkitExec` and adapter wiring).
- 🧾 Expanded docs and developer guides for setup, doctor, optimization, and utility references.

### Fixed

- 🧩 Continued help/UX and docs consistency updates around command surfaces and runtime adapter expectations.

### Removed

- 🗑️ Removed obsolete phase handoff/conformance docs:
  - `docs/BLUEPRINT_CONFORMANCE_PHASE4.md`
  - `docs/RELEASE_HANDOFF_PHASE4.md`

### Testing

- ✅ Extended regression coverage for index/runtime adapters/python bridge/update checker paths.
- ✅ Added dedicated Windows bridge first-run checklist for CI triage and failure signatures:
  - `docs/WINDOWS_BRIDGE_FIRST_RUN_CHECKLIST.md`

## [0.23.1] - 2026-02-22

### Fixed

- 🧹 Removed deprecated `node-domexception` install warning by upgrading `openai` SDK to `^6.22.0` (no transitive `formdata-node` chain).
- 🧯 Recovered dependency drift introduced by `npm audit fix --force` by restoring a compatible lint toolchain (`eslint@9` + `@typescript-eslint@8`) and removing unused `c8`.
- 🪟 Fixed Windows CI test flakiness by making workspace foundation file path assertions cross-platform (`/` and `\\`).

### Security

- ✅ Verified runtime dependency surface with `npm audit --omit=dev` reports zero vulnerabilities.
- ✅ Added npm override for `minimatch@^10.2.1` to mitigate high-severity ReDoS findings in dev dependency graphs.

## [0.23.0] - 2026-02-22

### Added

- 🧱 Added workspace foundation artifacts during create/register flows:
  - `.rapidkit/workspace.json`
  - `.rapidkit/toolchain.lock`
  - `.rapidkit/policies.yml`
  - `.rapidkit/cache-config.yml`
- 🔌 Added runtime adapter layer with first-class adapters for Python, Node, and Go.
- 🧪 Added Phase 3 command test suites:
  - unit contract coverage for `bootstrap`, `setup`, `cache`
  - integration coverage for adapter-enabled mode
  - process-level CLI integration coverage for `setup`, `cache`, and `bootstrap`

### Changed

- 🧭 Added npm-level command contract handlers for `bootstrap`, `setup`, and `cache`.
- 🧠 Updated command forwarding boundaries so `bootstrap/setup/cache` stay wrapper-local and are not forwarded to core.
- ⚙️ Extended runtime-aware command dispatch (`init/dev/test/build/start`) with feature-flagged adapter routing (`RAPIDKIT_ENABLE_RUNTIME_ADAPTERS=1`).
- 🗂️ Extracted runtime detection helpers into `src/utils/runtime-detection.ts` for shared project-type detection (`isGoProject`, `isNodeProject`, `isPythonProject`).

### Fixed

- 🩹 Fixed npm global install failure by including `scripts/enforce-package-manager.cjs` in published package files so `preinstall` no longer fails with `MODULE_NOT_FOUND`.

### Testing

- ✅ Added deterministic dist-refresh logic in process-level CLI tests to prevent stale-build false failures.
- ✅ Verified Phase 3 test matrix passes end-to-end (unit + integration + process-level + typecheck).
- ✅ Added non-regression integration coverage for the three `rapidkit init` scenarios (normal folder, workspace root, project folder).
- ✅ Added Phase 4 CI hardening gate for runtime-adapter contracts and `init` scenario non-regression suites.

## [0.22.0] - 2026-02-21

### Added

- 🐹 Added first-class Go kits in npm CLI: `gofiber.standard` and `gogin.standard`.
- 🧭 Added Go kit support in interactive `create project` kit selection flow.

### Changed

- 🔁 Standardized generated Go project commands (`init`, `dev`, `docs`, `test`, `build`, `start`) for parity with RapidKit DX.
- 🛠️ Hardened Go Makefile/tooling flow by using explicit GOPATH binaries for `air` and `swag`, including docs generation in dev loop.
- 🩺 Enhanced `doctor` command with Go toolchain checks and Go project health detection/reporting.
- 📚 Updated README with Go/Fiber and Go/Gin usage and clarified module support scope.

### Fixed

- ✅ Fixed wrapper test/runtime instability by avoiding CLI auto-delegation during Vitest execution.
- 🧪 Fixed timezone-sensitive date assertion in edge-case tests.

## [0.21.2] - 2026-02-20

### Added

- 📦 Added npm release shortcut scripts:
  - `npm run release:dry`
  - `npm run release:patch`
  - `npm run release:minor`
  - `npm run release:major`
- 📘 Added explicit package manager policy doc: `docs/PACKAGE_MANAGER_POLICY.md`.

### Changed

- 🔧 Modernized `scripts/release.sh` to remove hardcoded versions and support:
  - semantic bump args (`patch|minor|major|x.y.z`)
  - `--no-publish`, `--yes`, and `--allow-dirty`
  - dynamic tag/release handling (`v<package.json version>`)
- 🧰 Standardized repo contributor workflow to npm-only:
  - updated contributor docs and setup docs
  - updated E2E scripts to use npm paths

### Fixed

- 🛡️ Enforced npm-only installs via `preinstall` guard (`scripts/enforce-package-manager.cjs`).
- 📄 Aligned `docs/SECURITY.md` supported-version policy with the current `0.x` release line.
- ✅ `release:dry` now supports local preflight checks on dirty working trees via `--allow-dirty` while keeping publish flow strict.
- 🩺 Doctor workspace scan now ignores common build artifact directories (`dist*`, `build*`) to avoid false-positive project detection.

## [0.21.1] - 2026-02-18

### Added

- ✨ Added `create workspace` command mode in npm wrapper:
  - `npx rapidkit create workspace` (interactive naming)
  - `npx rapidkit create workspace <name>` (direct named creation)
- 🧠 Added context-aware `init` orchestration in wrapper:
  - In plain folder: auto-creates default workspace (`my-workspace`, with numeric fallback)
  - In workspace root: installs workspace dependencies and then initializes detected child projects
  - In project inside workspace: initializes only that project

### Changed

- 🔄 Unified workspace creation UX between legacy and new command paths.
- 🗂️ Updated README quick-start and command docs for:
  - Fastest onboarding via `npx rapidkit init`
  - Legacy + explicit workspace creation flows
  - Interactive prompt behavior for `create workspace`

### Fixed

- 🩺 Doctor workspace scan now avoids counting workspace-root `.rapidkit` as a project unless project markers exist.
- ✅ Added doctor test coverage for workspace root filtering behavior.

## [0.21.0] - 2026-02-16

### Added

- ⚡ **Performance Optimizations** (Phase 1)
  - 🚀 Dynamic imports for heavy dependencies (OpenAI ~30-40KB, Inquirer ~25-30KB)
  - 📊 Performance benchmarking script (`npm run bench`)
  - 📦 Bundle size monitoring with 200KB limit (`npm run size-check`)
  - 📈 Visual bundle analyzer (`npm run analyze`)
  - 🎯 Code splitting enabled (7 chunks)
  - 🌲 Aggressive tree shaking configuration
  - ⚡ **50-60% faster startup** for common commands (--help, --version, list)
  - 💾 Bundle size: **27.8 KB** compressed (106.62 KB raw)

- 📚 **Documentation Organization**
  - ✅ Separated public docs from internal development docs
  - 📖 Updated docs index with proper categorization
  - 🎯 Clear distinction between user and developer documentation

- 🛠️ **New Scripts**
  - `analyze` - Visual bundle analysis with vite-bundle-visualizer
  - `size-check` - Automated bundle size validation
  - `bench` - Performance benchmarking for CLI commands
  - `quality` - Comprehensive quality check (typecheck + lint + format + test + size)

### Changed

- 🔧 **Optimized Files**
  - `src/ai/openai-client.ts` - Lazy load OpenAI
  - `src/ai/embeddings-manager.ts` - Lazy load Inquirer
  - `src/commands/ai.ts` - Dynamic Inquirer import
  - `src/commands/config.ts` - Dynamic Inquirer import
  - `tsup.config.ts` - Enhanced with splitting and aggressive tree shaking

- 📁 **Documentation Structure**
  - Moved internal planning and tracking docs to separate folder
  - Updated `docs/README.md` with complete file listing
  - Better organization for open source community

### Technical

- 📦 Added devDependencies: `@size-limit/preset-big-lib@^12.0.0`, `vite-bundle-visualizer@^1.2.1`
- 🎯 Bundle target: Node 20
- 🔄 Code splitting: 7 chunks generated
- 📊 Performance metrics tracked (avg 510ms startup)
- 🚀 Dynamic imports save ~40KB on initial load

### Fixed

- 🐛 Fixed tsup.config.ts syntax error (duplicate closing brace)

## [0.20.0] - 2026-02-14

### Added

- 📦 **FastAPI DDD Kit** - Domain-Driven Design template with clean architecture
  - 🏗️ Complete DDD structure (Domain, Application, Infrastructure layers)
  - 🎯 39 production-ready template files
  - 🔄 Synced from Python Core (`fastapi.ddd` kit)
  - 📚 Full offline fallback support (236KB compressed)
  - ✨ Same quality as `fastapi.standard` with advanced patterns

### Changed

- 🔧 Updated `sync-kits.sh` to include all 3 kits (fastapi-standard, fastapi-ddd, nestjs-standard)
- 🗺️ Enhanced `demo-kit.ts` mapping for proper kit name resolution
- ⚡ Improved kit generation logic in `index.ts` and `workspace.ts`
- 🛠️ Updated FastAPI standard CLI template with enhanced commands

### Technical

- 📊 Total npm package size: ~512KB (all 3 kits included)
- 🎁 Complete offline experience with full kit templates
- 🔄 Seamless fallback when Python Core unavailable

## [0.19.1] - 2026-02-12

### Changed

- ⬆️ Upgraded `inquirer` from `^9.2.23` to `^13.2.2` to modernize prompt stack and reduce dependency noise.
- 🔄 Refreshed lockfiles (`package-lock.json`, `yarn.lock`) to align transitive dependency graph with the upgrade.
- 🧩 Updated generated demo Poetry template in `src/create.ts` from `python = "^3.10.14"` to `python = "^3.10"` for wider Python 3.10 patch compatibility.

### Security

- ✅ Verified `npm audit --audit-level=high` reports zero known vulnerabilities after dependency update.

### Testing

- ✅ Verified `npm test` passes after the upgrade (no regressions observed).

## [0.19.0] - 2026-02-10

### Added

- 🤖 **AI Module Recommender** - Intelligent module suggestions using OpenAI embeddings
  - 🧠 Semantic search for modules (understands intent, not just keywords)
  - 🔄 **Dynamic module fetching from Python Core** (`rapidkit modules list --json`)
  - 📦 27+ production-ready modules cataloged (auth, database, payment, communication, infrastructure)
  - 🤖 **Auto-generate embeddings** - Automatic setup on first use with interactive prompts
  - ✅ **Mock mode** - Test without API key using deterministic embeddings
  - 🎯 Cosine similarity algorithm for accurate recommendations (92%+ match scores)
  - 🔗 Dependency detection and installation order calculation
  - 💰 Ultra-cheap: ~$0.0002 per query (practically free after $0.50 setup)
  - ⚡ 5-minute cache for optimal performance (~50ms per query)
  - 🛡️ Graceful fallback to 11 hardcoded modules if Python Core unavailable
- 🛠️ **New CLI Commands**:
  - `rapidkit ai recommend [query]` - Get module recommendations with match scores and reasons
  - `rapidkit ai recommend [query] -n <N>` - Get top N recommendations (default: 5)
  - `rapidkit ai recommend [query] --json` - JSON output for scripting
  - `rapidkit ai generate-embeddings` - Generate embeddings (one-time setup)
  - `rapidkit ai generate-embeddings --force` - Force regenerate embeddings
  - `rapidkit ai update-embeddings` - Update embeddings with latest modules
  - `rapidkit ai info` - Show AI features, pricing, and getting started guide
  - `rapidkit config set-api-key` - Configure OpenAI API key (interactive or --key option)
  - `rapidkit config show` - View current configuration (masked key)
  - `rapidkit config remove-api-key` - Remove stored API key
  - `rapidkit config ai enable|disable` - Toggle AI features
- 📦 **New Dependencies**:
  - openai@^4.80.0 - Official OpenAI SDK for embeddings
  - inquirer@9.2.23 - Interactive prompts for auto-setup
  - ora@8.0.1 - Elegant terminal spinners for generation progress
- 📚 **Documentation**:
  - [docs/AI_FEATURES.md](docs/AI_FEATURES.md) - Complete AI features guide with troubleshooting
  - [docs/AI_QUICKSTART.md](docs/AI_QUICKSTART.md) - Get started in 60 seconds
  - [docs/AI_EXAMPLES.md](docs/AI_EXAMPLES.md) - Real-world use cases (SaaS, E-commerce, Healthcare, Gaming)
  - [docs/AI_DYNAMIC_INTEGRATION.md](docs/AI_DYNAMIC_INTEGRATION.md) - Dynamic integration architecture
  - Updated README with comprehensive AI section
- 🔒 **Security**:
  - API keys stored in ~/.rapidkit/config.json (600 permissions, owner only)
  - Environment variable support (OPENAI_API_KEY)
  - Embeddings file (data/modules-embeddings.json) added to .gitignore
  - No local paths or personal information in distributed package (verified)
- ✅ **Testing**:
  - 76 AI tests (100% passing)
  - 90% overall coverage, 76% AI module coverage
  - Mock mode tests (no API key needed)
  - Integration tests for auto-generation flow

### Changed

- 🔄 **Dynamic Module Catalog** - AI now fetches module list from Python Core in real-time
  - Automatically syncs with Python Core module registry
  - Single source of truth (Python Core)
  - No duplicate data maintenance
  - Always up-to-date recommendations
  - Falls back to 11 core modules if Python unavailable
- 🎨 **Enhanced User Experience**:
  - Interactive prompts for missing embeddings (3 options: generate/manual/cancel)
  - Cost estimation before generation (~$0.50 for 27 modules)
  - Progress indicators for long operations
  - Better error messages (401 invalid key, 429 quota exceeded, connection errors)
  - Mock mode automatically activates when no API key configured

### Technical

- New module: `src/config/user-config.ts` - User configuration management (API key, AI toggle)
- New module: `src/ai/module-catalog.ts` - Dynamic module catalog with Python Core integration
- New module: `src/ai/openai-client.ts` - OpenAI API wrapper with mock mode support
- New module: `src/ai/recommender.ts` - AI recommendation engine with cosine similarity
- New module: `src/ai/embeddings-manager.ts` - Auto-generation and management of embeddings
- New script: `scripts/generate-mock-embeddings.ts` - Generate deterministic mock embeddings for testing
- AI uses text-embedding-3-small model (1536 dimensions, $0.02/1M tokens)
- Build size: 58.57 KB (ESM bundle)
- 5-minute cache TTL for module list
- Automatic fallback to hardcoded catalog (11 modules)

### Fixed

- 🐛 **AI Module Name Format** - Fixed critical module ID format mismatch
  - Module IDs now preserve underscores (ai_assistant, auth_core, db_postgres) matching Python Core format
  - Previously converted underscores to dashes (ai-assistant), breaking module lookups
  - Updated to JSON Schema v1 API: `rapidkit modules list --json-schema 1`
  - Added JSON extraction to handle emoji output from Python Core
  - Fixed command routing: AI and config commands now handled by npm CLI (not forwarded to Python Core)
  - Externalized openai package (prevents bundling 10MB SDK)
  - **Impact:** AI recommendations now correctly match Python Core module registry

## [0.18.1] - 2026-02-09

### Fixed

- 🐛 Fixed cross-platform path normalization test for Windows CI
  - Updated path test to use regex pattern accepting both Unix (/) and Windows (\\) path separators
  - Resolves Windows CI failure in create-helpers.test.ts

## [0.18.0] - 2026-02-09

### Added

- 🔗 **Contract Sync Infrastructure** - Added contract schema synchronization between Core and NPM package
  - Added `sync:contracts` and `check:contracts` npm scripts
  - Integrated contract validation into CI workflow and pre-commit hooks
  - Automatically checks Core ↔ NPM contracts when Core schema is available
  - Gracefully skips when Core schema is not found (supports standalone usage)
- 📊 **Modules Catalog Support** - Added `getModulesCatalog()` API to fetch modules list from Core
  - Supports JSON schema v1 with filters (category, tag, detailed)
  - 30-minute TTL caching for better performance
  - Backward compatible with legacy `modules list --json` format
- 🎯 **Commands JSON API** - Core bridge now prefers `rapidkit commands --json` for faster command discovery
  - Falls back to `--help` parsing if JSON API unavailable
  - Improved bootstrapped command set with `commands` included

### Improved

- 🔧 **Python Bridge Robustness** - Major enhancements to Core installation and error handling
  - **Multi-venv Support**: Each Core package spec gets isolated venv (`venv-<hash>` pattern)
  - **Smart Legacy Migration**: Automatically reuses legacy venv for unpinned specs
  - **Retry Logic**: 2 retries with exponential backoff for pip operations (configurable via env vars)
  - **Better Error Messages**: Granular error codes (VENV_CREATE_FAILED, PIP_BOOTSTRAP_FAILED, etc.)
  - **Timeout Protection**: Configurable timeouts for venv creation (60s) and pip operations (120s)
  - **Enhanced Validation**: Validates rapidkit-core installation before reusing cached venvs
- 👀 **Doctor Command** - Enhanced to display multiple RapidKit Core installations
  - Shows all found installations (Global pipx, pyenv, system, workspace .venv)
  - Displays version number for each installation path
  - Color-coded version display with arrow format (`-> v0.3.0`)
- 🧪 **Test Coverage** - Enhanced drift guard tests with contract validation
  - Tests `version --json`, `commands --json`, and `project detect --json` schemas
  - Validates JSON payloads against contract schema definitions
  - Ensures schema_version compatibility across Core APIs
- 📦 **Demo Kit** - Added missing template context variables
  - Added `node_version` (default: '20.0.0')
  - Added `database_type` (default: 'postgresql')
  - Added `include_caching` (default: false)
  - Better error logging for template rendering failures

### Fixed

- 🐛 **NestJS Template** - Fixed nunjucks ternary operator syntax in docker-compose.yml
  - Fixed nested ternary without parentheses causing parser error
  - Changed from `{{ 'pnpm' if ... else package_manager if ... else 'npm' }}`
  - Changed to `{{ ('pnpm' if ... else (package_manager if ... else 'npm')) }}`
  - Resolves "expected variable end" error at Line 12, Column 74
- 🗑️ **Template Cleanup** - Removed redundant `.env.example.j2` template from NestJS standard kit
- 🔄 **Bootstrap Commands** - Added `commands` to BOOTSTRAP_CORE_COMMANDS_SET for cold-start support

### Environment Variables

New environment variables for Python bridge configuration:

- `RAPIDKIT_BRIDGE_PIP_RETRY`: Retry count for pip operations (default: 2)
- `RAPIDKIT_BRIDGE_PIP_RETRY_DELAY_MS`: Base delay for exponential backoff (default: 800ms)
- `RAPIDKIT_BRIDGE_PIP_TIMEOUT_MS`: Timeout for pip operations (default: 120000ms)
- `RAPIDKIT_CORE_PYTHON_PACKAGE_ID`: Additional identifier for venv isolation

## [0.17.0] - 2026-02-06

### Added

- 🩺 **Enhanced Doctor Command** - Major upgrade to `rapidkit doctor --workspace` with comprehensive health monitoring
  - **Framework Detection**: Automatically identifies FastAPI 🐍 or NestJS 🦅 projects
  - **Health Score System**: Visual percentage-based scoring with pass/warn/error breakdown (📊 80%)
  - **Project Statistics**: Module count from registry.json, file counts, and project size
  - **Last Modified Tracking**: Git-based last modification timestamps (🕒 "today", "2 days ago")
  - **Test Detection**: Identifies presence of test directories
  - **Docker Support Check**: Validates Dockerfile existence
  - **Code Quality Tools**: Checks for ESLint (NestJS) or Ruff (FastAPI) configuration
  - **Security Scanning**: npm audit integration for Node.js vulnerabilities
  - **Actionable Fix Commands**: Project-specific commands to resolve issues (🔧 Quick Fix)
  - **JSON Output Mode**: Machine-readable format for CI/CD (`--json` flag)
  - **Auto-Fix Capability**: Interactive fix application with confirmation (`--fix` flag)
  - **Version Compatibility Warnings**: Alerts on Core/CLI version mismatches
  - **Module Health Checks**: Validates Python `__init__.py` files in modules
  - **Environment File Validation**: Detects missing `.env` files with copy suggestions
  - **Improved Dependency Detection**: Better verification for both Node.js and Python projects
  - **Multi-Project Type Support**: Handles mixed FastAPI + NestJS workspaces seamlessly

### Improved

- ⚙️ **RapidKit Core Priority**: Workspace venv now checked before global installation
  - Ensures isolated workspace environments are prioritized
  - Displays appropriate context ("Installed in workspace virtualenv" vs "Installed at /path")
- 🎯 **Project Health Display**: Enhanced visual output with comprehensive status indicators
  - Framework icons (🐍 FastAPI / 🦅 NestJS)
  - Kit information display (e.g., "FastAPI (fastapi.standard)")
  - Organized status lines with color coding (✅ green, ⚠️ yellow, ❌ red)
  - Compact additional checks display (Tests • Docker • ESLint/Ruff)
  - Project statistics and modification times
- 🐛 **Bug Fixes**
  - Fixed fs-extra ESM import compatibility (changed from namespace to default import)
  - Fixed command execution in auto-fix (now uses shell mode for proper command resolution)
  - Improved project detection with deep recursive scan fallback (max depth 3)
  - Better handling of Node.js vs Python project-specific checks

### Documentation

- 📚 Added comprehensive `DOCTOR_ENHANCEMENTS.md` guide
- 📖 Updated README with detailed doctor command usage examples
- 🎯 Added use case examples for development workflow and CI/CD integration

## [0.16.5] - 2026-02-05

### Added

- ⚙️ **Configuration System** - New `rapidkit.config.js` file support for workspace and project defaults
  - Workspace settings: `defaultAuthor`, `pythonVersion`, `installMethod`
  - Project settings: `defaultKit`, `addDefaultModules`, `skipGit`, `skipInstall`
  - Priority: CLI args > rapidkit.config.js > .rapidkitrc.json > defaults
  - Auto-discovery: searches current directory and parent directories
  - Supports .js, .mjs, and .cjs formats
- 🩺 **Doctor Command** - New `rapidkit doctor` command for system diagnostics
  - Checks Python installation and version
  - Validates pip, pipx, and Poetry installation
  - Verifies RapidKit Core installation
  - Provides troubleshooting recommendations
  - Generates detailed JSON report

### Improved

- 📚 **Documentation** - Added comprehensive guides
  - Configuration file usage guide (`docs/config-file-guide.md`)
  - Doctor command documentation (`docs/doctor-command.md`)
  - Configuration example file (`rapidkit.config.example.js`)
- 🔧 **CLI Experience** - Enhanced help text and command structure
  - Improved README with configuration examples
  - Better error messages for config loading

## [0.16.4] - 2026-02-02

### Changed

- 📝 **Documentation Quality** - Standardized documentation language and format
  - Workspace comparison guide reviewed and polished
  - Development runbooks enhanced for clarity and consistency
  - All user-facing documentation now consistently formatted and reviewed

### Improved

- 🧪 **Test Stability** - Enhanced test robustness for workspace registration and marker functionality
  - Updated tests to account for Python discovery side-effects in Poetry workflows
  - Improved assertions to be more flexible and resilient to implementation changes
- 🔍 **Code Quality** - Maintained test coverage above 80% threshold
  - Added workspace-marker tests with real temporary directories for realistic behavior
  - Reduced brittle test assertions that depend on exact call sequences
- 📊 **Build & Quality** - All metrics validated
  - Bundle size: 116 KB
  - Test coverage: 80%+ (passing)
  - ESLint: 0 errors, minimal warnings
  - All 488+ tests passing

## [0.16.3] - 2026-02-01

### Fixed

- 🔧 **Template Compatibility** - Added `generate_secret` Nunjucks filter to match Python Core's Jinja2 filter
  - Fixes NestJS template rendering errors for secret generation
  - Uses crypto.randomBytes for cryptographically secure secrets
- 🧪 **Test Suite Updates** - Updated tests for Python Core 0.2.2+ compatibility
  - Skipped .rapidkit folder tests (Core 0.2.2+ uses global CLI instead of project-local files)
  - Fixed docker-compose.yml.j2 nested ternary syntax for Nunjucks
  - Renamed env.example.j2 to .env.example.j2 for correct output path
  - All 488 tests passing (11 skipped)

## [0.16.0] - 2026-02-01

### Added

- 📋 **Workspace Registry** - Shared workspace registry at `~/.rapidkit/workspaces.json` enables cross-tool workspace discovery
  - `registerWorkspace()` function automatically registers workspaces in shared registry
  - `workspace list` command to view all registered workspaces (npm-only, no Python dependency)
  - VS Code Extension can discover npm-created workspaces
  - npm package can discover Extension-created workspaces

### Changed

- 🏷️ **Unified Workspace Signature** - Changed workspace marker signature from `RAPIDKIT_VSCODE_WORKSPACE` to `RAPIDKIT_WORKSPACE`
  - Improves cross-tool compatibility between npm package and VS Code Extension
  - Backward compatible: Both signatures are recognized
  - Workspace markers now clearly identify creator: `createdBy: 'rapidkit-npm'`

- 🔍 **Command Routing** - `workspace` command now handled by npm package only (not forwarded to Python Core)
  - Enables workspace management without Python dependency
  - Faster execution for workspace listing

### Documentation

- 📝 Added comprehensive workspace registry documentation to README
- 📝 Documented workspace marker format and cross-tool compatibility
- 📝 Added examples for `workspace list` command

## [0.15.1] - 2026-01-31

### Added

- 🧪 **Bridge tests:** Added comprehensive unit tests for Python bridge internals, including command discovery, system Python detection, and bootstrap command handling.
- 🧩 **Bootstrap command coverage:** Explicit tests for core bootstrap command sets to prevent regressions during cold start and help-command failures.

### Changed

- 🧠 **Command discovery logic:** Improved `getCoreTopLevelCommands()` fallback behavior to ensure a stable, non-empty command set when `--help` probing fails.
- ⚙️ **CI smoke workflow:** Updated e2e smoke workflow to stay aligned with the refined bridge and command discovery behavior.

### Fixed

- 🛠️ **Bridge edge cases:** Fixed scenarios where command discovery could return inconsistent or partial results due to help-command failures or cached state.
- 🧪 **Test stability:** Reduced brittle assertions in bridge tests to make them resilient to internal implementation changes.

### Notes

- This patch release focuses on stability, test coverage, and safer command discovery behavior in the npm ↔ Python Core bridge layer.

## [0.15.0] - 2026-01-30

### Added

- 🔧 **CLI wrapper flags:** `--create-workspace` and `--no-workspace` are now handled by the npm wrapper for `create project` flows. Wrapper processes workspace creation UX before invoking the Python engine and filters wrapper-only flags so they are not forwarded to the core CLI.
- 🧩 **`registerWorkspaceAtPath()` helper:** Register an existing directory as a RapidKit workspace. Creates `.rapidkit-workspace`, `.gitignore`, workspace launcher (`rapidkit`, `rapidkit.cmd`), `README.md` and installs RapidKit engine (Poetry/venv/pipx).
- 🧪 **Tests:** Unit tests and e2e smoke tests for workspace registration and Scenario C regression tests added to prevent regressions.
- ⚙️ **CI workflow:** `.github/workflows/e2e-smoke.yml` added to run focused e2e smoke and Scenario C regression tests on PRs.

### Changed

- 🐍 **Poetry behavior:** `installWithPoetry()` now configures `poetry config virtualenvs.in-project true` to ensure in-project `.venv` is created by default (parity with VS Code extension behavior).
- 🧭 **Create UX:** Creating a project outside a workspace prompts the user by default (unless `--yes` or wrapper flags specify otherwise).

### Fixed

- 🛠️ **Scenario C:** Improved Python core detection heuristics in the bridge to avoid bootstrapping a bridge venv when the system Python already has `rapidkit-core` installed. This prevents unnecessary environment changes and confusing UX.

### Documentation

- 📝 Updated README and docs to document new flags and the create-project outside-workspace UX.

### Notes

- This release stabilizes CLI-to-core interactions and UX around workspace creation to align npm wrapper behavior with the VS Code extension.

## [0.14.1] - 2025-12-31

### Fixed

- 🐛 **Poetry virtualenv detection** - Support Poetry virtualenvs outside project directory
  - rapidkit now detects Poetry virtualenv via `poetry env info --path`
  - No longer requires `.venv` in project directory
  - Works with Poetry's default cache location (`~/.cache/pypoetry/virtualenvs/`)
  - Eliminates need for `poetry config virtualenvs.in-project true`
- 🔧 **Shell script improvements** - Updated `.rapidkit/rapidkit.j2` to auto-detect Poetry venv
- 💬 **Better feedback** - Shows virtualenv location when using Poetry cache

## [0.14.0] - 2025-12-31

### Changed

- ⬆️ **Node.js requirement** - Updated to >=20.19.6 (LTS Iron)
  - Better compatibility with latest Node.js LTS
  - Improved performance and security
- ⬆️ **Python dependencies** - Updated to latest stable versions
  - Python: ^3.10.14 for broader compatibility
  - FastAPI: 0.128.0
  - Uvicorn: 0.40.0
  - Pydantic: 2.12.5
  - pydantic-settings: 2.12.0
- ⬆️ **Python dev tools** - Updated to latest versions
  - pytest: 9.0.2
  - black: 25.12.0
  - ruff: 0.14.10
  - mypy: 1.19.1
  - isort: 7.0.0
  - httpx: 0.28.1 (synced across all templates)
- ⬆️ **NestJS dependencies** - Updated to latest stable versions
  - @nestjs/common, @nestjs/core, @nestjs/platform-express: 11.1.10
  - Jest: 30.2.0
  - TypeScript: 5.9.3
  - All related dev dependencies updated

### Fixed

- 🐛 **Consistency** - Synced httpx version to 0.28.1 across all templates
  - Fixed version mismatch between create.ts and template files

## [0.13.0] - 2025-12-22

### Added

- 🧪 **NestJS test suite** — 13 new tests for NestJS project generation
  - Tests for project structure, config, tsconfig, .env.example
  - Tests for package manager variants (npm, yarn, pnpm)
  - Mocked execa for fast, reliable package manager tests

### Improved

- 📈 **Test coverage boost** — demo-kit.ts coverage: 75% → 90%+
  - Total tests: 431 → 444
  - Overall coverage: 93.5% → 95.35%
- 📝 **Documentation fixes** — Updated dates and minor corrections

## [0.12.9] - 2025-12-22

### Improved

- 📝 **Unified CLI commands** - All documentation and success messages now use `npx rapidkit` consistently
  - Same command works everywhere: `npx rapidkit <name> --template <type>`
  - No more confusion between `rapidkit create` and `npx rapidkit`
- 💡 **Helpful tip after project creation** - Added tip: "Install globally (npm i -g rapidkit) to use without npx"
  - Helps first-time users understand their options
- 📚 **Documentation updates** - Simplified README with clearer command examples
  - Updated all template READMEs to use `npx rapidkit` commands

## [0.12.8] - 2025-12-13

### Fixed

- 🐛 **Windows spawn EINVAL error** - Fixed `spawn EINVAL` error when running `rapidkit init` on Windows
  - Added `shell: true` option for spawning `.cmd` files on Windows
  - Windows requires command interpreter to execute batch files

### Improved

- 📝 **Python not found message** - Better error message when Python is not installed
  - Shows multiple installation options (Microsoft Store, python.org, winget, chocolatey)
  - Clear instructions to restart terminal after installation

## [0.12.7] - 2025-12-13

### Added

- 🪟 **Windows Support** - Full Windows compatibility for `rapidkit` commands
  - Added `rapidkit.cmd` Windows batch wrapper for FastAPI projects
  - Added `rapidkit.cmd` Windows batch wrapper for NestJS projects
  - Global CLI now auto-detects `.cmd` files on Windows
  - `rapidkit init/dev/test/...` now works natively on Windows (no `.\` prefix needed)

### Fixed

- 🐛 **Windows CLI Delegation** - Fixed "rapidkit is not recognized" error on Windows
  - `findLocalLauncherUpSync()` now checks `.cmd` files first on Windows
  - `delegateToLocalCLI()` now checks `.cmd` files first on Windows
  - Early pip engine detection updated for Windows compatibility

## [0.12.6] - 2025-12-12

### Added

- ✅ **Quality metrics system** — Comprehensive metrics tracking for bundle size, test coverage, ESLint warnings, and security vulnerabilities
  - New `scripts/metrics.ts` for automated metrics collection
  - Metrics validation against defined targets (bundle < 500KB, coverage > 80%, 0 errors)
  - New `npm run metrics` command for on-demand quality checks
  - Complete documentation in `docs/METRICS.md`
- ✅ **Enhanced pre-commit hooks** — Stricter quality gates before commits
  - Added type checking (`npm run typecheck`)
  - Added format validation (`npm run format:check`)
  - Added test execution (`npm test`)
  - Clear progress messages for each validation step
- ✅ **Commit message validation** — New `.husky/commit-msg` hook
  - Enforces [Conventional Commits](https://www.conventionalcommits.org/) format
  - Provides helpful error messages with examples
  - Supports all standard types (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert)
- ✅ **Security automation** — GitHub Actions workflows for continuous security monitoring
  - Daily security audits via `.github/workflows/security.yml`
  - npm audit with artifact uploads for historical tracking
  - Dependency update checks with `npm-check-updates`
- ✅ **Quality automation** — GitHub Actions workflow for metrics tracking
  - Automated metrics collection on every PR and push
  - Bundle size validation (fails if > 500KB)
  - Coverage upload to Codecov
  - Quality gates for CI/CD pipeline

### Improved

- 🎯 **ESLint configuration** — Smarter linting with context-aware rules
  - Reduced warnings from 61 to 1 by allowing `any` in test files
  - Added override rules for test files (`**/__tests__/**/*.ts`, `**/*.test.ts`)
  - Improved ignore patterns to include `coverage/`
  - Only production code subject to strict `any` warnings
- 📚 **npm scripts** — New quality and security commands
  - `npm run quality` — Run all quality checks (validate + security + metrics)
  - `npm run security:fix` — Auto-fix security vulnerabilities
  - `npm run metrics` — Collect and validate metrics

### Documentation

- 📖 **METRICS.md** — Complete guide to quality metrics
  - Defined targets for all metrics
  - Instructions for manual and automated collection
  - Troubleshooting and best practices
  - CI/CD integration documentation
- 📊 **QUALITY_IMPROVEMENTS.md** — Implementation summary
  - Detailed breakdown of all improvements
  - Current metrics status
  - Usage examples and next steps

### Fixed

- 🧹 **Code quality** — Cleaner codebase with reduced linter warnings
  - 60 ESLint warnings eliminated in test files
  - Only 1 warning remaining in production code

## [0.12.5] - 2025-12-06

### Fixed

- 🛠️ **CI/CD cross-platform compatibility** — Fixed GitHub Actions workflow for all platforms
  - Added platform-specific rollup binary installation (darwin-arm64, win32-x64-msvc)
  - Works around npm optional dependency bug on macOS and Windows
  - Explicit bash shell for cross-platform script compatibility
- 🛠️ **Node.js 20 only** — Removed Node.js 18 from test matrix (vitest 4.0.15+ requires Node 19+)

## [0.12.4] - 2025-12-06

### Added

- ✅ **Friendly activation UX** — `rapidkit shell activate` now prints a prominent green header with a clear one-line instruction followed by the eval-able activation snippet
- ✅ **Unit tests for shell activation** — Added comprehensive tests validating output formatting and behavior

### Fixed

- 🛠️ **Shell-activate robustness** — Now gracefully handles missing or unparseable `context.json` by falling back to `.venv` or `.rapidkit/activate`
- 🛠️ **ESLint violations** — Fixed no-inner-declarations, no-constant-condition, no-useless-escape, unused variable warnings
- 🛠️ **Code quality** — All 431 tests passing, 0 lint errors, 61 warnings only

### Changed

- 📝 **Improved documentation** — Updated README and release notes with v0.12.4 details

## [0.12.3] - 2025-12-04

### Changed

- 🎯 **Smart CLI Delegation** - Global `rapidkit` command now auto-detects project context
  - Running `rapidkit init/dev/test/...` inside a project automatically delegates to local `./rapidkit`
  - No more confusion between global npm command and local project commands
  - Users can now run `rapidkit init` anywhere without `./` prefix or `source .rapidkit/activate`
  - Workflow: `npx rapidkit my-api --template fastapi && cd my-api && rapidkit init && rapidkit dev`

## [0.12.2] - 2025-12-04

### Changed

- ⚡ **Simplified Workflow** - `rapidkit init` now auto-activates environment
  - No longer need to run `source .rapidkit/activate` manually
  - `rapidkit init` sources activate script internally before installing dependencies
  - Streamlined developer experience: just `cd project && rapidkit init && rapidkit dev`
- 📝 **Updated Documentation** - Removed `source .rapidkit/activate` from all docs
  - README.md updated with simplified workflow
  - All docs/ files updated
  - Success messages show simplified 2-step workflow

### Fixed

- 🐛 **Environment Activation** - Fixed Poetry/npm not found errors when running `rapidkit init`
  - `rapidkit init` now properly sets up PATH before running package manager

## [0.12.1] - 2025-12-03

### Fixed

- 🐛 **NestJS Output Messages** - Fixed port display in CLI output (was showing 3000, now correctly shows 8000)

## [0.12.0] - 2025-12-03

### Added

- 🆕 **Two Modes of Operation**
  - **Direct Project Mode** (`--template`) - Create standalone FastAPI/NestJS projects
  - **Workspace Mode** (default) - Create workspace for multiple projects
- 🆕 **NestJS Template** - Full NestJS project support with TypeScript
  - Swagger/OpenAPI documentation at `/docs`
  - Example CRUD module
  - Testing setup with Jest
  - ESLint + Prettier configuration
- 🆕 **Makefile Support** - Alternative commands for FastAPI projects
  - `make dev`, `make test`, `make lint`, etc.
- 🆕 **Default Port 8000** - Both FastAPI and NestJS now use port 8000

### Changed

- 📝 **Updated CLI** - `npx rapidkit` now supports both modes
  - `npx rapidkit my-api --template fastapi` → Direct project
  - `npx rapidkit my-workspace` → Workspace mode
- 🔧 **Improved Project CLI**
  - Better error messages with actionable hints
  - `--reload-dir src` for FastAPI dev server
  - Port/host configuration via `--port` and `--host` flags
- 📝 **Updated Documentation** - All docs reflect new workflow

### Fixed

- 🐛 **Python Detection** - Smart fallback chain for finding Python
- 🐛 **NestJS Port** - Changed default from 3000 to 8000 for consistency

## [0.11.3] - 2025-12-03

### Added

- 🆕 **Local RapidKit Commands** - Demo projects now support `rapidkit` CLI commands
  - Added `.rapidkit/` folder with local launcher and CLI handler
  - `rapidkit init` - Install dependencies via poetry
  - `rapidkit dev` - Start development server with hot reload
  - `rapidkit start` - Start production server
  - `rapidkit test` - Run tests
  - `rapidkit help` - Show available commands
- ✅ **New Tests** - 6 new tests for `.rapidkit/` folder generation (431 total)
  - Test `.rapidkit/` folder structure generation
  - Test executable permissions on Unix systems
  - Test `project.json` content validation
  - Test `cli.py` command handlers
  - Test rapidkit launcher script content

### Changed

- 📝 **Updated Documentation** - All documentation uses `rapidkit` commands
  - README.md updated to use `rapidkit init` and `rapidkit dev`
  - Demo workspace structure shows `.rapidkit/` folder
  - README.md.j2 template updated with rapidkit commands
  - Success messages show rapidkit commands with emoji descriptions
- 🎯 **Improved UX** - Better user experience for demo projects
  - Commands aligned with full RapidKit CLI syntax
  - Consistent command interface across demo and full modes

### Fixed

- 🐛 **Template String Escaping** - Fixed bash variable syntax in embedded scripts
  - Properly escaped `${1:-}` in JavaScript template literals

## [0.11.2] - 2025-06-22

### Changed

- 📝 **CLI Command Documentation** - Updated command references throughout
  - Changed `rapidkit run dev` → `rapidkit dev` (simplified)
  - Changed `poetry install` → `rapidkit init` (preferred method)
  - Updated README templates and success messages
- 🌐 **Documentation URLs** - Changed `rapidkit.dev` → `getrapidkit.com`
- 🏥 **FastAPI Health Router** - Enhanced health.py template
  - Added `/health/modules` endpoint to catalog module health routes
  - Integrated with health registry for dynamic module discovery
  - Router now includes prefix and tags directly

### Fixed

- 🐛 **FastAPI Templates** - Fixed router mount duplication
  - Removed redundant prefix/tags from api_router.include_router()
  - Router configuration now managed at router definition level

## [0.11.1] - 2025-11-14

### Added

- ✅ **Enhanced Test Coverage** - Increased from 72.69% to 74.63% (426 tests)
  - 37 new CLI integration tests for index.ts
  - 6 new decorator tests for performance monitoring
  - 3 new error handling tests for demo workspace creation
  - Test coverage for version, help, dry-run, debug modes
  - Edge case testing for invalid inputs, special characters
  - Git failure and error recovery testing

### Changed

- 🔧 **TypeScript Configuration** - Enabled experimental decorators
  - Added `experimentalDecorators` for performance decorator support
  - Added `emitDecoratorMetadata` for enhanced decorator functionality

### Fixed

- 🐛 **Test Suite** - Fixed async/await syntax error in create-helpers.test.ts
  - Path operation tests now properly handle async imports
- 🐛 **Performance Utilities** - Achieved 100% test coverage
  - All decorator edge cases covered
  - Error handling in decorated methods validated
  - Context preservation (this binding) tested
- 🐛 **Code Quality** - Fixed ESLint errors and formatting issues
  - Removed unused imports across 5 test files
  - Fixed code formatting with Prettier (5 files)
  - Added format check to pre-push validation hook
  - Ensured CI compliance for all code quality checks

### Testing

- **Total Tests**: 426 (up from 393)
- **Coverage**: 74.63% overall
  - config.ts: 100%
  - errors.ts: 100%
  - logger.ts: 100%
  - update-checker.ts: 100%
  - performance.ts: 100% (improved from 79%)
  - cache.ts: 96.7%
  - validation.ts: 96%
  - demo-kit.ts: 94.82%
  - create.ts: 91.06% (improved from 90.07%)

## [0.11.0] - 2025-11-14

### Fixed

- 🐛 **Version Display** - Fixed version command showing incorrect hardcoded version
  - Now reads version dynamically from package.json
  - Ensures --version always shows correct installed version
  - package.json automatically copied to dist during build

## [0.10.0] - 2025-11-08

### Changed

- ⚡ **Bundle Optimization** - Migrated from TypeScript compiler to tsup
  - 80% bundle size reduction (208KB → 40KB)
  - Production build now minified and tree-shaked
  - Removed source maps from production builds
  - Single bundled file for faster installation
  - Optimized for Node.js 18+ with modern features
- 🔄 **Versioning Strategy** - Switched from beta to 0.x.x versioning
  - Indicates pre-stable development phase
  - Will release 1.0.0 when RapidKit Python is published on PyPI

### Developer Experience

- 🛠️ **Build System** - Added tsup configuration for optimized builds
- 📦 **Bundle Size** - Automated bundle size monitoring in build process
- 🚀 **Performance** - Faster CLI startup time with optimized bundle

## [1.0.0-beta.9] - 2025-11-07

### Added

- ✅ **E2E Integration Tests** - Comprehensive end-to-end testing suite
  - Demo workspace creation tests
  - Invalid input validation tests
  - Dry-run mode verification
  - Version and help command tests
- ✅ **CI/CD Pipeline** - GitHub Actions workflow
  - Multi-platform testing (Ubuntu, macOS, Windows)
  - Multiple Node.js versions (18, 20)
  - Automated linting, type-checking, and testing
  - Security audit integration
  - Bundle size monitoring
  - Code coverage upload to Codecov
- ✅ **Enhanced Error System**
  - `NetworkError` - Network-related failures with troubleshooting steps
  - `FileSystemError` - File operation errors with detailed guidance
  - Improved `InstallationError` with actionable troubleshooting
  - Better `RapidKitNotAvailableError` with clear alternatives
- ✅ **New NPM Scripts**
  - `npm run test:e2e` - Run end-to-end tests
  - `npm run security` - Security audit with moderate severity threshold
  - `npm run bundle-size` - Check compiled bundle size

### Changed

- 🔧 **Improved Error Messages** - All errors now include detailed troubleshooting steps
- 🔧 **Better Error Details** - Installation errors show common solutions
- 🔧 **Enhanced UX** - Clearer error feedback for users

### Fixed

- 🐛 **Error Stack Traces** - Proper stack trace capture in all custom error classes
- 🐛 **Error Message Formatting** - Consistent formatting across all error types

## [1.0.0-beta.8] - 2025-11-01

### Changed

- 🎯 **Simplified CLI command** - Changed bin name from `create-rapidkit` to `rapidkit`
  - Now use `npx rapidkit` instead of `npx create-rapidkit`
  - More intuitive and aligned with package name
- ✨ **Updated command name** in CLI from `create-rapidkit` to `rapidkit`
- 📝 **Updated welcome messages** to use "RapidKit" branding
- 🔧 **Updated internal references** - All comments and documentation updated
- 🐛 **Fixed VS Code extension integration** - CLI wrapper now uses correct command name

### Fixed

- Reserved package names validation updated to reflect new bin name

## [1.0.0-beta.7] - 2025-10-31

### Fixed

- Fixed package name in demo workspace generator script (changed from `create-rapidkit` to `rapidkit`)
- Fixed help text examples to use correct package name `rapidkit` instead of `create-rapidkit`

## [1.0.0-beta.6] - 2025-10-31

### Added

- **Code Quality Tools**
  - ESLint with TypeScript support (latest @typescript-eslint v8.21.0)
  - Prettier for consistent code formatting
  - Husky v9 for Git hooks
  - Lint-staged for pre-commit validation
  - Pre-commit hooks that auto-fix and format code
- **Performance Utilities**
  - Two-layer cache system (memory + disk) with 24-hour TTL
  - Performance monitoring with metrics tracking
  - `getCachedOrFetch` helper for easy caching integration
  - `measure` helper for performance tracking
  - `measurePerformance` decorator for methods
- **New NPM Scripts**
  - `npm run lint` - Check code with ESLint
  - `npm run lint:fix` - Auto-fix linting errors
  - `npm run format` - Format code with Prettier
  - `npm run format:check` - Check formatting
  - `npm run typecheck` - Type checking without build
  - `npm run validate` - Complete validation pipeline

### Changed

- **Documentation** - All documentation converted to English
  - Reorganized documentation into `docs/` folder
  - `docs/DEVELOPMENT.md` - Development guide
  - `docs/SETUP.md` - Quick setup and commands
  - `docs/OPTIMIZATION_GUIDE.md` - Optimization suggestions
  - `docs/UTILITIES.md` - Cache and performance utilities
  - `docs/README.md` - Documentation index
- **Type Safety Improvements**
  - Replaced `any` types with proper TypeScript types
  - Better type inference in cache and performance utilities
  - Stricter ESLint rules for unused variables
- **Code Quality**
  - All TypeScript files formatted with Prettier
  - Zero linting errors and warnings
  - All 26 tests passing
  - Better error handling with proper type guards

### Fixed

- TypeScript 5.9.3 compatibility (updated @typescript-eslint packages)
- Unused variable warnings fixed with proper naming conventions
- Cache type inference issues resolved

### Security

- Security audit of dependencies performed
- 7 moderate vulnerabilities identified (in dev dependencies only)

## [1.0.0-beta.5] - 2025-10-23

### Added

- **Custom error classes** with detailed error codes and messages
  - `RapidKitError` base class with `code` and `details` properties
  - Specific errors: `PythonNotFoundError`, `PoetryNotFoundError`, `PipxNotFoundError`, etc.
- **Comprehensive input validation** for project names
  - NPM package name validation
  - Python naming convention validation
  - Reserved name checking
  - Length validation (2-214 characters)
- **Configuration file support** (`~/.rapidkitrc.json`)
  - Set default values for all options
  - Per-user customization
  - Environment variable support
- **Debug mode** (`--debug` flag)
  - Verbose logging for troubleshooting
  - Shows config loading, path resolution, and installation details
- **Dry-run mode** (`--dry-run` flag)
  - Preview what would be created without actually creating it
  - Shows file structure, configuration, and next steps
- **Update checker**
  - Automatically checks for newer versions on npm
  - Non-intrusive notification with update instructions
- **Graceful interrupt handling**
  - SIGINT/SIGTERM handlers for clean shutdown
  - Automatic cleanup of partial installations on Ctrl+C
- **Improved progress reporting**
  - Step-by-step progress with clear states
  - Better spinner messages
  - Detailed success/error messages
- **Testing framework**
  - Vitest with 26 tests covering core functionality
  - Test coverage reporting
  - Tests for validation, errors, and config
- **Template versioning**
  - `kit.json` metadata for each template
  - Version tracking and compatibility information

### Changed

- **Removed hardcoded paths** - No personal data in source code
  - Test mode now uses `RAPIDKIT_DEV_PATH` environment variable
  - Falls back to config file `testRapidKitPath`
  - Clear error messages if path not configured
- **Better error handling** throughout codebase
  - All errors extend `RapidKitError` base class
  - Consistent error messages with helpful details
  - Machine-readable error codes
- **Improved CLI help and usage**
  - More descriptive option descriptions
  - Better examples in README
  - Comprehensive development guide

### Fixed

- TypeScript strict mode compliance
- Unused variable warnings
- Missing type definitions

### Security

- Removed hardcoded file paths that could leak developer information
- Environment variable support for sensitive configuration
- User config file excluded from git

## [1.0.0-beta.4] - 2025-10-05

### Added

- Demo mode with bundled templates
- Multiple install methods (Poetry, venv, pipx)
- Test mode for local RapidKit installation

### Fixed

- Poetry package-mode configuration
- Cross-platform path handling

## [1.0.0-beta.3] - 2025-09-20

### Added

- Initial beta release
- Basic project creation
- README generation

## Configuration Examples

### User Configuration (~/.rapidkitrc.json)

```json
{
  "defaultKit": "fastapi.standard",
  "defaultInstallMethod": "poetry",
  "pythonVersion": "3.11",
  "author": "Your Name",
  "license": "MIT",
  "skipGit": false
}
```

### Environment Variables

```bash
export RAPIDKIT_DEV_PATH=/path/to/local/rapidkit
```

## Migration Guide

### From beta.4 to beta.5

No breaking changes. All existing commands work the same way.

New optional features:

- Add `--debug` for verbose logging
- Add `--dry-run` to preview changes
- Create `~/.rapidkitrc.json` for custom defaults
- Set `RAPIDKIT_DEV_PATH` for test mode (replaces hardcoded path)

## Deprecations

None in this release.

## Roadmap

### v1.0.0 (Stable Release) - Coming Soon

- [ ] RapidKit Python package on PyPI
- [ ] Full installation mode without --test-mode
- [x] NestJS template support ✅
- [ ] Interactive config wizard
- [ ] Auto-update functionality

### v1.1.0

- [ ] Plugin system for custom templates
- [ ] Cloud deployment integrations
- [ ] CI/CD template generation
- [ ] Multi-language support

### v2.0.0

- [ ] Complete rewrite with enhanced architecture
- [ ] GraphQL support
- [ ] Microservices orchestration
- [ ] Kubernetes deployment templates
