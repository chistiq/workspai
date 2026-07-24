# Workspai CLI v0.46.0

Released July 18, 2026.

## Contract-backed unified Workspace Intelligence runner

Workspai now provides `workspace intelligence run` as the unified, governed
execution surface for the mandatory Workspace Intelligence lifecycle. The
runner follows the canonical stage order and emits a versioned report that is
validated semantically as well as structurally, so CI systems, IDEs, portals,
and agents consume the same execution evidence.

The governed lifecycle covers sync, model, contract verification, doctor,
analyze, readiness, snapshot, diff, impact, verify, context, agent sync, watch,
explain, trace, and remediation planning. Every executed stage reports its
status, command, duration, artifacts, and failure evidence without hiding
blocking outcomes behind a successful aggregate result.

## Enterprise lifecycle integrity

- Added the `workspai-workspace-intelligence-run-v1` report contract and linked
  it through the runtime registry, published catalog, artifact registry, and
  producer-command inventory.
- Added transactional rollback for create, adopt, import, register, and mirror
  operations so partial failures do not leave misleading workspace state.
- Hardened project metadata path safety, registry consistency, archive flows,
  and mirror lifecycle behavior.
- Added real frontend project execution coverage and strengthened Node, Go,
  Java, and .NET generator/runtime adapter behavior.
- Hardened Python-engine discovery and metadata propagation. Python 3.10 remains
  the minimum supported version; newer installed interpreters can be detected,
  while explicit version pins remain available for reproducible CI.
- Hardened lifecycle journals for Windows filesystems that reject durability
  sync calls after successful writes, while retaining atomic replacement and
  fail-closed handling for all other I/O errors.
- Repaired the npm dependency topology so `npm sbom --sbom-format cyclonedx`
  produces a valid CycloneDX document without invalid `minimatch` or `chokidar`
  nodes.
- Preserved the 80% aggregate metrics coverage target and made test, lint, and
  security collection fail closed on execution or parse errors.
- Expanded the release suite to 2,042 passing tests with focused coverage for
  Workspace Intelligence execution and evidence, semantic contracts, Doctor
  remediation, lifecycle rollback, archives, runtime adapters, platform
  boundaries, and previously under-covered utilities.
- Verified 81.66% statement, 71.27% branch, 91.95% function, and 82.38% line
  coverage. The `workspace-run.ts` orchestration surface now reaches 81.07%
  statements and 82.30% lines.
- Added a machine-readable Vitest report to `test:coverage` and made `metrics`
  consume that exact successful run. This removes the duplicate enterprise
  suite execution and fragile console-summary parsing; a larger subprocess
  budget remains for standalone metrics compatibility.
- Excluded type-only declarations and compatibility-only re-export barrels from
  executable coverage calculations while preserving compile-time checks and
  explicit compatibility export tests.
- Hardened cross-platform execution and test fixtures for Python venv/Poetry/pip
  orchestration, Windows-layout interpreter metadata, PowerShell Doctor
  remediation guards, Go Makefile routing, npm runner path resolution and
  case-insensitive environment keys, and POSIX-only file mode guarantees.

## Documentation and contract alignment

CLI help, README material, command references, workspace operations, CI
workflows, agent-grounding guidance, artifact catalogs, runtime support
matrices, and generated shared contracts now describe the same mandatory
Workspace Intelligence lifecycle. Configuration examples no longer impose an
accidental Python version pin when automatic interpreter selection is desired.

## Verification

- Monorepo checks, CLI contracts, generated/shared contract drift, and docs
  validation are included in the release gates.
- Unified runner contract and CLI-chain tests cover ordering, report semantics,
  artifacts, blocking failures, and agent-oriented JSON output.
- Lifecycle transaction, frontend execution, Python-engine state, workspace
  registry, archive, mirror, and package-publish suites cover the surrounding
  operational paths.
- The final release gate passed 2,042 tests with 8 explicit skips, 82% aggregate
  metrics coverage, zero ESLint errors or warnings, and zero npm audit
  vulnerabilities.

## Upgrade

```bash
npm install -g workspai@0.46.0
workspai --version
workspai workspace intelligence run --for-agent generic --json
```

There are no breaking changes in this release.
