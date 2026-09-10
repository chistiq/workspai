# Changelog

## Unreleased

- Opened G7 as an unauthorized local product-surface continuation: frozen CLI
  JSON/exit contracts, public export-map lock, support/limitations matrix and
  honest package-status ledger. Registry stays on G5; G6 remote admission stays
  planned; G8 cannot begin. Standalone-stable, SBOM/provenance and retrieval
  benchmarks remain planned.

- Wired G6 Linux/macOS/Windows platform-evidence capture and a matrix combiner
  that can retain same-commit runner reports without authorizing G7. Platform
  reports must keep registry G5, native acceleration prohibited, and the
  package-infrastructure prerequisite. The `g6-cross-platform-admission`
  checkpoint stays planned until those reports exist.
- Official G4 python, go, java, dotnet, rust and unsupported fixtures now have
  incremental/full generation-digest equivalence for single-file add, edit and
  delete. Language-import providers re-observe added source files; package-json
  stays reused, and an added Ruby file does not wake language-imports.
- Content-state locators are NFC-normalized across Merkle assembly, inventory,
  Git porcelain and skip-reread matching, so macOS NFD and Linux NFC occupy one
  tree slot. NFC-colliding filenames in one directory are omitted fail-closed.
  Official node rename of a TypeScript file matches a clean full rebuild.
- Official repository providers now re-observe added locators by detection
  against the new paths only, so a new file cannot inherit a stale
  whole-inventory batch. Single-file add and delete on the G4 node fixture
  match a clean full rebuild while unrelated providers such as package-json
  stay reused.
- Official repository providers now have incremental/full generation-digest
  equivalence on the G4 language fixtures, including a single-file node edit
  that still matches a clean rebuild. Similarity, vector, knn and embedding
  cannot be query strategies or canonical shard-reuse reasons; exact digest
  equality remains the only reuse identity.
- Merkle comparison no longer invents a content cause when identity is
  unchanged, so size/mtime/git-status observations cannot look like edits.
  Trusted Git skip-reread, absent and untrusted journals, and a different
  checkout root of the same tree produce the same generation digest as a full
  rebuild. An interrupted publication that left a generation directory without
  advancing the pointer keeps the previous generation current until retry.
- Incremental shard reuse now stamps ontology, proof-policy, redaction,
  composition-policy and per-provider manifest digests, so content-unchanged
  semantic drift rejects shards and recomputes instead of reusing stale facts.
  ChangeSet causes name ontology, proof-policy, redaction, schema or provider
  instead of blaming content for semantic rejection.
- Merkle comparison now enumerates file changes only under unequal directory
  branches, so an equal sibling digest is skip authority. Query-cache keys reject
  the `latest` generation alias even when a digest is present.
- File-leaf Merkle identity now includes input kind and scan-profile digest, so
  scan-profile-only changes surface as `renewed` instead of disappearing behind
  an equal content-only root. Executed GraphDelta can fill graph/fact identities
  from a generation diff when a prior canonical graph is supplied, and the
  optional query-cache store can apply planned invalidations without failing the
  build.
- Honest incremental execution accounting now reports files actually hashed and
  inputs parsed this run, plus Merkle/leaf/shard/byte totals, instead of copying
  changed-input counts. Trusted journal renames delete the prior locator so the
  executed change set can emit `rename-candidate`.
- Wired the optional query-result cache store into `queryGraph` so the engine
  owns key creation and reuse, cache hits preserve historical cost, and miss,
  corrupt or unavailable stores fall back to live execution without changing
  the semantic result.
- Added Git/change-journal skip-reread planning so trusted porcelain status can
  avoid content rereads while untrusted journals stay conservative and Git never
  becomes Merkle reuse authority.
- Added `planQueryCacheInvalidation`, `diffGraphGenerations` and a per-stage
  input processing ledger, plus content-membership rejection for reused shards.

- Recorded local G6 stage closure with incremental and overlay checkpoints
  complete and remote cross-platform admission deferred to final workflow evidence.
- Added proposed-change overlay contracts plus `buildGraphChangeOverlay`,
  `evaluateGraphChangeOverlayStaleness` and advisory `compareChangeOverlays`
  with explicit non-canonical release claims and no merge-conflict authority.
- Added `planIncrementalGraphBuild` to orchestrate content comparison, shard
  reuse planning and honest GraphDelta emission without fabricating fact ids.
- Added `planShardReuseAndInvalidation` for exact-digest shard reuse with
  semantic dependency gates and downstream provider/projection/index invalidation.
- Added `compareContentStateManifests` to walk unequal Merkle branches, emit
  added/edited/deleted/rename-candidate inputs and report compared/skipped branch
  accounting with fail-closed scope and budget handling.
- Opened G6 with versioned ChangeSet, GraphDelta and ContentStateManifest
  contracts plus minimal G6 fixtures for incremental execution accounting and
  portable content-state reuse.
- Added `g6-stage-plan.v1.json` with incremental contract checkpoints while the
  independent package registry remains on sealed G5 local source.

- Opened G5 with versioned projection profile/result contracts, standard
  projection families and bounded `projectGraph` execution that preserves
  canonical generation identity.
- Added generic graph slice request/result contracts plus deterministic
  intent-driven `createGraphSlice` selection with explicit truncation.
- Added `buildWorkspaceGraph` to compose workspace graphs from immutable project
  generations without re-extracting repositories.
- Added workspace onboarding port types for optional central CLI handoff without
  runtime coupling.
- Refactored G4 repository preview views to delegate to the shared projection
  engine instead of maintaining parallel filtering logic.
- Added `runStandaloneGraph` for project-first dual-scope orchestration with
  fail-closed workspace handoff when no onboarding adapter is injected.
- Added workspace graph publication through `writeWorkspaceGraphGeneration` and
  admitted workspace inspect modes in the standalone CLI argument surface.
- Added versioned derived projection profiles for community, flow, review-risk and
  architecture summaries with explicit algorithm/seed/limitation descriptors.
- Routed dual-scope `inspect` modes through `runStandaloneGraph` with honest
  partial/handoff-unavailable results when no workspace onboarding adapter exists.
- Added `createNodeWorkspaceArtifactStore` with workspace publication validation,
  separate writer locks and CLI wiring to the admitted workspace root only.
- Recorded local G5 stage closure with all source checkpoints complete and remote
  cross-platform admission deferred to final workflow evidence.
- Sealed G5 local source completion with `check-g5-stage.mjs`, registry update and
  stage-plan status `local-source-complete`.

- Admitted the signed G3 proof-carrying query candidate after the same-commit
  Linux, macOS and Windows matrix and aggregate CI gate passed.
- Opened G4 with a host-neutral, bounded and offline `buildRepoGraph` candidate
  while keeping Node filesystem access behind the explicit adapter subpath.
- Added deterministic repository topology, package manifest, ECMAScript and
  cross-language import providers with explicit unsupported and unknown zones.
- Added evidence-backed API contract, runtime/container, CI workflow and test
  surface discovery without executing repository-controlled code.
- Added bounded literal-route evidence for Node, Python, Go, Java and .NET plus
  explicit abstention for computed routes and unsupported source languages.
- Added a schema-governed structural extractor profile and real Node, Python,
  Go, Java, .NET, Rust and unsupported-language repository fixtures.
- Added safe repository-local Git HEAD evidence without reading Git config,
  following worktree indirection or invoking Git.
- Added bounded source, structural and evidence preview views that preserve the
  canonical generation and keep generalized projections blocked until G5.
- Added a deterministic review-context slice with independent item and byte
  budgets, source generation/query provenance and explicit truncation.
- Added the standalone `workspai-graph` repository-preview executable with
  inspect, quality, query and provider inventory surfaces.
- Added explicit project-local publication with immutable content-addressed
  generations, writer exclusion, integrity verification and pointer-last commit.
- Made the portable generation pointer self-resolving with project-relative
  immutable artifact paths bound to their content digests.
- Added installed-tarball CLI coverage proving default read-only behavior,
  bundled worker resolution and explicit portable publication.
- Resolved executable identity through real filesystem paths so macOS `/var`
  aliases, Windows case-insensitive paths and installed symlink entrypoints start
  the packed CLI reliably.
- Fail-closed CLI entrypoint detection now rejects invalid module URLs instead of
  throwing during packed or cross-platform invocation checks.
- Kept central CLI integration and native acceleration blocked behind their
  remaining later-stage evidence.

- Admitted the signed G2 deterministic composition candidate after retained
  Linux, macOS and Windows evidence passed the same-commit repository gate.
- Added versioned proof policies, proof-carrying paths and cross-layer binding
  profiles with explicit completeness and unknown-boundary reporting.
- Added deterministic dependency, ownership, impact, entry-point, path, cycle,
  contract-topology, architecture-conformance and operational-risk queries.
- Added fixed query budgets, deterministic pagination, bounded pending work,
  proof thresholds and fail-closed canonical-generation topology checks.
- Added immutable generation and semantic cache dependencies covering planner,
  result, projection, index, extension, scope, redaction and authorization state.
- Added result-level provenance, disputes, freshness, cost, truncation,
  analytical limitations and abstention for mixed semantic consequences.
- Replaced the completed composition evidence lane with a same-commit G3 query
  admission matrix for Linux, macOS and Windows.

- Admitted the signed G1 contract foundation after retained Linux, macOS and
  Windows evidence passed the same-commit repository gate.
- Added the G2 deterministic TypeScript reference composer with injected
  clock, digest, cancellation, scheduler and worker ports.
- Added evidence aggregation, proof-state evaluation, global identity and fact
  collision handling, functional-relation conflict preservation, canonical
  generation identity and Graph Quality output.
- Kept rejected and unresolved claims outside traversable graph edges and made
  cancellation fail closed without a partial graph result.
- Added an explicit Node worker adapter, a real event-loop responsiveness gate
  and packed-consumer execution coverage without coupling the root API to Node.
- Added fail-closed worker-output accounting so omitted, duplicated, unknown or
  mutated admitted facts cannot cross the worker trust boundary.
- Added seeded ordering, evidence-amplification and majority-conflict properties
  proving that input volume and provider order cannot manufacture authority.
- Isolated stale, unknown, inferred and below-policy facts before proof
  aggregation so weak evidence cannot poison or inflate a healthy edge.
- Replaced the completed foundation evidence lane with a same-commit G2
  composition matrix whose aggregate admission is required by the repository
  gate on Linux, macOS and Windows.
- Bound pull-request admission separately to the signed source commit and the
  tested merge commit, and reject mixed runs, events, digests or runner
  identities across the platform matrix.
- Consolidated architecture, governance and contributor documentation in the
  canonical Workspai documentation portfolio. The public package retains only
  root consumer metadata plus an offline installed-tarball and leak gate.
- Added unpublished `@workspai/graph` contract-design scaffold.
- Locked one-way WIS/Shared → Facts/Evidence → Graph → Model truth direction.
- Added package boundaries, draft provider manifest, conformance seed,
  architecture guards, contributor documentation and legacy migration inventory.
