# Workspai Doctor Command

Use `doctor` to find setup and dependency problems before they interrupt
development or block a release. It can check the computer, an entire workspace,
or one project, and reports what is wrong and which fixes are available.

**Related:** [workspace-operations.md](./workspace-operations.md) · [commands-reference.md](./commands-reference.md) · [Documentation index](./README.md)

## Command Modes

### 1) System Check

```bash
npx workspai doctor
```

Checks host prerequisites:

- Python
- Poetry (optional)
- pipx (optional)
- RapidKit Core availability
- Go (optional)

### 2) Workspace Check

```bash
cd my-workspace
npx workspai doctor workspace
```

Checks:

- all system checks
- workspace marker resolution
- project discovery and per-project health
- dependency, environment, test, quality, security, deployment, and coverage readiness per project
- runtime-native evidence without treating missing scanners as a clean result

> Compatibility note: `npx workspai doctor --workspace` still works, but `doctor workspace` is the canonical form.

### 3) Project Check (Canonical)

```bash
cd my-workspace/my-project
npx workspai doctor project
```

Checks:

- all system checks
- nearest project resolution (current folder or parent with project markers)
- project-specific framework/runtime health
- dependency/env readiness for the selected project
- enterprise probes (config contract, migration surface, runtime health surface)
- score explainability breakdown for audit trails
- normalized dependency-audit and test-coverage evidence for CI, IDEs, and agents
- graph-aware root, impact-candidate, proof-path, and verification-target context

> Compatibility note: `npx workspai doctor --project` also works.

### 4) Capability truth and validation

```bash
# Complete runtime/domain matrix
npx workspai doctor capabilities --json

# Ask what Doctor can prove for one runtime or framework
npx workspai doctor capabilities --runtime node --json
npx workspai doctor capabilities --framework "Spring Boot" --json

# Exercise every registered adapter against the versioned disease corpus
npx workspai doctor capabilities --validate --json

# Persist both governed artifacts in a workspace
npx workspai doctor capabilities --validate --write --workspace . --json
```

Runtime and framework filters narrow only the command response. With `--write`, Doctor persists the
complete capability registry, never a filtered subset, so downstream consumers cannot mistake a
query result for canonical capability truth. Conflicting runtime/framework ownership fails closed
to the unknown adapter and records the conflict as an explicit limitation.

The capability matrix never turns absence into success. Each adapter declares all six diagnostic
domains as `native`, `portable`, `observable`, or `unsupported`, plus its limitations, platforms,
repair modes, runtime aliases, and framework ownership. An unknown runtime resolves to the
fail-closed fallback adapter: unsupported or unobserved evidence stays unknown and cannot produce a
healthy security claim.

`--validate` runs the same versioned disease classes through every registered runtime adapter. Its
precision and recall describe that deterministic synthetic corpus only. Real tool execution,
runtime-native fixtures, and Linux/macOS/Windows acceptance remain separate gates; the report says
so explicitly instead of presenting synthetic coverage as production accuracy.

With `--write`, consumers can read:

- `.workspai/reports/doctor-capabilities.json`
- `.workspai/reports/doctor-validation-last-run.json`

Contracts:

- `contracts/workspace-intelligence/doctor-capabilities.v1.json`
- `contracts/workspace-intelligence/doctor-validation.v1.json`

## Typical Usage

```bash
# Pre-flight on a contributor machine
npx workspai doctor

# Full check inside a workspace
npx workspai doctor workspace

# Focus only on current project
npx workspai doctor project

# Machine-readable output
npx workspai doctor workspace --json

# Compact agent/CI projection; full evidence is still written
npx workspai doctor workspace --fresh --json=summary

# Attempt safe fixes (interactive)
npx workspai doctor workspace --fix

# Attempt safe fixes for current project only
npx workspai doctor project --fix

# JSON output with audit-ready breakdown + probes
npx workspai doctor project --json

# Release-grade policy profile
npx workspai doctor workspace --profile enterprise-strict --json
```

`--json` remains the complete backward-compatible payload. `--json=summary` returns a bounded
projection with the verdict, affected projects, explicit count categories, freshness, and artifact
locations. It never replaces or weakens the full Doctor evidence. `--fresh` bypasses the project
scan cache; the default cache also expires after five minutes (configurable with
`WORKSPAI_DOCTOR_CACHE_MAX_AGE_SECONDS`) so live security state cannot be reused indefinitely.

Every project or workspace run also writes
`.workspai/reports/doctor-receipt-last-run.json`. The receipt is a small governed handoff for IDEs,
CI, and agents: it distinguishes blocking causes, advisory findings, unknowns, dependency advisory
subjects, vulnerability findings, not-applicable checks, and the next safe action. The complete
probe and diagnosis evidence remains in `doctor-last-run.json` or `doctor-project-last-run.json`.

## One verdict, backed by every probe

Doctor calculates one verdict from the host and every project probe:

- **Passed** means no blocking probe failed.
- **Needs attention** means the current profile found advisory work.
- **Blocked** means at least one error-level probe failed.

The score and verdict use the same counts. A failed security, coverage, or
runtime probe cannot be hidden behind a high percentage or a healthy host. New
evidence includes the host/project score components and per-project probe
summary; semantic validation rejects contradictory artifacts before they are
written. Older v1 evidence remains readable so existing workspaces and IDEs do
not break during migration.

## Universal diagnosis core

Doctor normalizes every runtime-specific observation through one internal diagnosis boundary
before CLI, Studio, CI, or an agent consumes it. This boundary is intentionally kept inside the
CLI until its contracts stabilize; it does not depend on Commander, terminal rendering, or the
VS Code extension.

Project and workspace evidence publish the result under `project.diagnosis`:

- a stable causal key and typed finding status for every non-passing observation;
- confidence and diagnosis state (`confirmed`, `candidate`, or `unknown`) rather than fabricated
  certainty;
- proof bindings for the originating probe, affected dependency, structured command, and repair
  targets;
- repair disposition (`automatic`, `approval-required`, `manual`, or `unavailable`);
- causal groups that let Repair close one disease family without mixing unrelated guidance;
- explicit unknowns and contradictions when providers disagree or evidence is stale;
- diagnosis completeness and repair-coverage counts that cannot silently score empty/unsupported
  evidence as healthy.

Completeness is measured across six canonical diagnostic domains—runtime, dependency, security,
configuration, test, and quality. Every domain is explicitly `clean`, `findings`,
`not-applicable`, `not-run`, or `stale`. An explicit `not-applicable` observation is retained as
evidence but does not become a warning or inflate passing counts. A provider that did not run, or
evidence that is no longer fresh, increases unknowns and prevents a 100% completeness claim.
Readiness and Workspace Verify consume this canonical diagnosis instead of independently
recounting legacy issue strings.

The same diagnosis contract is used for Node, Python, Go, JVM, Rust, .NET, PHP, Ruby, Elixir,
Clojure, Deno, Bun, Scala, Kotlin, C, C++, and unknown/custom projects. Runtime adapters gather
different evidence; the diagnosis, causality, safety, and verification vocabulary stays the same.
Composite projects publish every detected family under `project.runtimeFamilies`; Doctor keeps a
primary runtime for compatibility and explicitly warns when secondary runtimes need their own
project boundary or custom adapter instead of silently claiming full coverage. Every unevaluated
secondary runtime is also published as a diagnosis unknown and proportionally lowers diagnosis
completeness; a primary-only polyglot scan can never report 100%.

Workspace project boundaries come from the canonical workspace contract/registry when available.
A nested solution, test project, or manifest inside a registered project is treated as evidence for
that project—not silently promoted into another workspace project. Unregistered monorepos remain
discoverable, while an explicitly registered nested project remains an independent boundary.

Contract: `contracts/workspace-intelligence/doctor-diagnosis.v1.json`.

The internal ownership boundaries are deliberately narrow:

| Boundary            | Owns                                                                            | Must not own                                    |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Runtime sensors     | Observable runtime, manifest, tool, source, and audit facts                     | Verdicts or speculative causality               |
| Universal diagnosis | Causal reconciliation, confidence, proof binding, unknowns, and contradictions  | File mutation or terminal/UI rendering          |
| Doctor policy       | Blocking/advisory projection, health score, and profile-specific gate semantics | Re-running sensors or inventing repairs         |
| Remediation planner | Typed operations bound to `diagnosisFindingId` and `causalKey`                  | Reclassifying the disease                       |
| Repair engine       | Approval, checkpoint, execution, validation, canonical verify, and rollback     | Silently weakening Doctor policy                |
| Consumers           | Rendering and user/model interaction                                            | Recomputing or overriding diagnosis and verdict |

This keeps Doctor internal today without turning `doctor.ts` into a public dependency boundary. A
future package extraction can move the diagnosis contract and engine without changing the evidence
or remediation protocol consumed by the CLI, Studio, CI, and agents.

The extraction seam is enforced in source and tests. `adapter-contract.ts`,
`capability-registry.ts`, `diagnosis-engine.ts`, and `validation-corpus.ts` are pure core modules:
they cannot import Commander, terminal styling, workspace discovery, or extension/UI code.
`capabilities-command.ts` is the CLI adapter that owns workspace resolution, artifact persistence,
and human rendering. A future `@workspai/doctor` package can therefore take the pure core without
moving command UX or creating a second source of truth.

## Graph-aware diagnosis

When the project belongs to a workspace with a current model and Knowledge
Graph, Doctor enriches every warning or failure with evidence-backed structural
context:

- the package, file, service, deployment, or other graph entity nearest to the
  finding;
- reachable APIs, services, infrastructure, owners, and other affected
  candidates;
- connected test suites or CI pipelines that can verify the repair;
- the exact proof path and source artifacts supporting each connection;
- explicit unknowns when the graph cannot prove an effect or verification path.

Runtime-native dependency audits preserve the affected package names,
versions, advisory identifiers, and available severity/directness metadata.
Doctor uses those subjects to select the corresponding package or module
entity in the current project's graph neighborhood. If an audit names a
dependency that the graph cannot resolve, the diagnosis reports it under
`unresolvedSubjects`; it does not silently attach the finding to an unrelated
package.

This data is available under `project.graphDiagnosis` in project and workspace
Doctor JSON evidence. Doctor rejects stale, invalid, or model-unbound graph
evidence instead of presenting it as current.

Graph enrichment is deliberately bounded per finding and restricted to the selected project's
graph neighborhood. Doctor publishes a small set of affected candidates, verification targets,
source artifacts, and shortest proof paths; consumers can query the canonical graph for deeper
exploration. This prevents unrelated projects and repeated graph payloads from consuming an
agent's context budget.

Graph reachability is deliberately described as a **structural impact
candidate**, not runtime causality. It narrows investigation and gives Studio a
proof-carrying starting point; final verification still comes from the
runtime-owned checks.

## Multi-runtime dependency evidence

Doctor selects the audit adapter from the detected runtime and lockfile:

| Ecosystem                            | Runtime-native evidence                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| npm                                  | npm, pnpm, Yarn Classic/Berry, Bun, or Deno audit                  |
| Python                               | `pip-audit` through the project virtual environment when available |
| Go                                   | `govulncheck`                                                      |
| Rust                                 | `cargo audit`                                                      |
| PHP                                  | `composer audit`                                                   |
| Ruby                                 | `bundler-audit`                                                    |
| .NET                                 | vulnerable transitive package report                               |
| Elixir                               | `mix hex.audit`                                                    |
| Java, Scala, Kotlin, Clojure, C, C++ | project/organization-owned scanner contract                        |

Every result records the exact executable, arguments, ecosystem, severity
counts, and limitations. A missing tool, timeout, registry failure,
unparseable response, or unsupported zero-configuration workflow is explicit
evidence—not a zero-vulnerability result. Compatible automatic fixes never use
force.

When a declared dependency tree has not been installed, Doctor emits a typed
`dependency-materialization` capability instead of only a human shell hint. The capability
records the runtime-native executable, project scope, observable installed-tree state, and
required validation stages. An unchanged manifest or lockfile is valid in this case: successful
installation plus declared test/build checks and canonical verification are the completion proof.

When a scanner has no direct automatic fix—or advertises a downgrade—Doctor
does not conclude that the project has no compatible repair. It emits guarded
`resolutionCandidates` for the affected direct or transitive dependency. Each
candidate preserves the owning packages, current and vulnerable ranges when
known, advisory identifiers, and the admissible next strategies: direct or
owner upgrade, constraint/override investigation, replacement, time-bounded
exception, or upstream wait. These are investigation inputs, not mutation
permission. A repair is complete only after manifest/lock reconciliation,
focused audit, declared tests, declared build, and canonical Workspace
Intelligence verification all pass.

## Coverage goals that Doctor can verify

Generate a normalized baseline from the current project:

```bash
npx workspai project coverage --run --target 80 --strict --json
```

Workspai detects the runtime-owned runner, reads machine-readable coverage, and
normalizes lines, branches, functions, statements, low-coverage files, source
hash, and the requested target. It understands Istanbul/LCOV, coverage.py,
Go coverprofiles, JaCoCo/Cobertura/Clover, scoverage, SimpleCov, and LLVM
coverage. Runtime plans cover Node/Bun/Deno, Python, Go, JVM, .NET, Rust, PHP,
Ruby, Elixir, Clojure, Scala, Kotlin, C, and C++; if a project-owned runner does
not emit one of those portable formats, the result is explicitly `unavailable`
with setup guidance rather than an invented percentage.

Doctor consumes the resulting
`.workspai/reports/project-test-coverage-last-run.json`. If it is missing,
below target, unavailable, or failed, the probe tells Studio what evidence to
generate or which low-coverage source paths need source-aware tests. The repair
contract explicitly forbids lowering the target, excluding difficult files,
skipping tests, or removing assertions to manufacture a pass.

When the project belongs to a workspace, Workspai also writes:

```text
<workspace>/.workspai/reports/project-test-coverage-last-run.json
<workspace>/.workspai/reports/projects/<slug>--<hash>/project-test-coverage-last-run.json
```

The same namespaced layout is used for project Doctor evidence, preventing
same-name projects from overwriting each other.

## Enterprise Fix Pipeline

Doctor supports policy profiles so the same evidence can be interpreted correctly in local,
CI, release, and enterprise gates:

| Profile             | Use when                          | Warning behavior                                          |
| ------------------- | --------------------------------- | --------------------------------------------------------- |
| `local`             | Developer diagnostics             | Report warnings, do not block                             |
| `ci`                | CI feedback loop                  | Exit `2` on warnings, `1` on errors                       |
| `release`           | Release readiness gate            | Exit `1` on warnings or errors                            |
| `enterprise-strict` | Enterprise/studio repair workflow | Exit `1`; every warning needs evidence or repair guidance |

`--strict` maps to the `release` profile and `--ci` maps to the `ci` profile for backward
compatibility. JSON evidence includes `policyProfile` so Workspai and CI can explain why a
card is advisory locally but blocking for release.

Doctor also attaches a **freshness contract** to evidence so tools do not treat live state as
durable structure:

| Freshness category | Meaning                                       | Default TTL |
| ------------------ | --------------------------------------------- | ----------- |
| `structure`        | Durable project/workspace shape and markers   | 7 days      |
| `verification`     | Test, script, lint, quality, and probe checks | 24 hours    |
| `state`            | Live dependency/security state                | 5 minutes   |

Each probe can include `freshness`, and each JSON artifact includes `evidenceFreshness`.
Workspai and CI should refresh stale or `verifyBeforeUse` evidence before claiming a project is
ready, repaired, or release-safe.

Doctor probes also include an **issue taxonomy** and **repair intent** for Studio-driven repair:

| Field               | Purpose                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `issueClass`        | Stable category such as `security`, `test`, `container`, or `dependency`                                      |
| `operationalImpact` | Product impact such as `ci-risk`, `release-risk`, or `security-risk`                                          |
| `repairIntent.mode` | Studio action mode: `edit-file`, `run-command`, `review-required`, `verify-before-fix`, or `refresh-evidence` |

This lets Workspai distinguish "show guidance" from "apply an approved file edit", "run a command",
or "refresh stale/live evidence first".

When `--fix` is enabled, Doctor now runs a staged treatment pipeline:

1. Fix policy engine assigns risk for each fix step (`safe`, `guarded`, `invasive`).
2. Transaction snapshots are created for guarded/invasive steps and project-scoped file edits.
3. Repair capabilities from probes can promote safe, typed fixes into the plan.
4. Dependency orchestrator executes known dependency commands via structured adapters.
5. Post-fix verification re-runs project diagnostics.
6. Retry policy re-attempts transient network failures once before failing.

If a guarded/invasive step or file edit fails, Doctor attempts rollback from snapshot and records
the failure. Newly-created files are tracked and removed during rollback if the fix cannot finish.

`--plan --json`, `--fix --json`, and `--apply --json` include a remediation plan with
`schemaVersion: doctor-remediation-plan-v2`. This plan is the Studio handoff contract: every step
has a stable `id`, `phase`, `order`, `dependsOn`, `issueId`, `issueClass`, `operationalImpact`,
`repairIntent`, affected `files`, typed `operation` when Doctor can edit safely, a human-readable
`preview`, deterministic `diffPreview`, `verifyCommand`, `refreshCommands`, rollback strategy, and
`studioStatus`.

The same plan is persisted to:

```text
.workspai/reports/doctor-remediation-plan-last-run.json
```

After `--fix` or `--apply`, Doctor also persists the execution result:

```text
.workspai/reports/doctor-fix-result-last-run.json
```

and appends a `kind: doctor-fix` entry to
`.workspai/reports/workspace-intelligence-history.json`. This gives Workspai a closed repair loop:
plan -> approved command/edit -> execution result -> refreshed evidence -> history.

For `doctor project` inside a workspace, the canonical governance copy stays under the workspace
`.workspai/reports/` directory and Doctor mirrors the project evidence, remediation plan, and fix
result into the scoped project's `.workspai/reports/` directory. Project-local tools can inspect the
same repair evidence without guessing the workspace root.

The remediation plan is intentionally ordered for Studio execution:

| Phase                 | Purpose                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| `dependency-baseline` | Restore package/runtime dependency baselines before other fixes                       |
| `local-environment`   | Repair declared configuration contracts without inventing local secrets               |
| `source-hygiene`      | Apply safe project-scoped hygiene files such as `.dockerignore` or `.gitignore` rules |
| `command-contract`    | Add missing test, quality, audit, or runtime command contracts                        |
| `runtime-governance`  | Run RapidKit/workspace initializers that may touch multiple project surfaces          |
| `manual-review`       | Surface guidance that requires a human decision                                       |
| `generic-execution`   | Review-only legacy guidance when no typed operation or invocation exists              |

`dependsOn` lets Workspai avoid false loops: for example, a missing test script repair can depend on
the project dependency baseline step, so Studio can run or ask for approval in the same order Doctor
would use.

Workspai should use this contract to offer two clear actions for a blocked card:

1. Run the exact diagnostic or remediation command when the safest path is command execution.
2. Apply the approved file edit when Doctor exposes a typed, project-scoped operation.

After either path, Studio should run the step `verifyCommand` when present, then refresh the card
with `refreshCommands` before claiming the issue is resolved.

Dependency repairs have an additional closure contract. Editing a manifest is
only the start of the transaction; the consumer must complete these stages in
order:

```text
reconcile manifest and lockfile -> audit -> declared tests -> declared build
-> canonical Workspace Intelligence verification
```

Doctor exposes this requirement as
`workspai.doctor-dependency-repair-transaction.v1`. Studio and other consumers
must not mark a dependency card fixed while the installed tree or lockfile is
stale, the focused audit is still blocked, or declared build/test validation
has not completed. The portable schema is
[`doctor-dependency-repair-transaction.v1.json`](../contracts/workspace-intelligence/doctor-dependency-repair-transaction.v1.json).

In `enterprise-strict`, guarded and invasive fixes are exposed as `review-required` even when they
are executable. That keeps Studio honest: it can preview and propose the change, but the operator
must approve before Doctor mutates project files or runs a dependency command.

The Doctor test suite includes a multi-stack remediation canary matrix for Node/Next.js,
Python/Poetry, Go, Rust, PHP/Composer, Ruby/Bundler, and .NET. The canary validates both
`doctor project --plan --json` and workspace-level dashboard aggregation so new runtime support
cannot silently regress the Studio handoff contract.

Repair-capable probes include a `repairCapability` object in JSON/evidence output. This is the
contract IDEs and Workspai use to distinguish an explanatory warning from an approved repair path:

```json
{
  "id": "frontend-script-test",
  "status": "warn",
  "repairCapability": {
    "issueId": "frontend-script-test",
    "fixKind": "package-json-script",
    "canAutoFix": true,
    "canEditFiles": true,
    "requiresApproval": true,
    "files": ["package.json"],
    "operation": {
      "type": "package-json-script",
      "path": "package.json",
      "scriptName": "test",
      "scriptValue": "npm run lint"
    },
    "verifyCommand": "npx workspai doctor project --json"
  }
}
```

For example, a frontend project with `lint` or `build` but no `test` script can receive a guarded
`package.json` repair. `doctor workspace --fix --json` applies the package script update through
Doctor's structured executor instead of falling back to an opaque shell command. Structured
operations include file create/append/copy, package script creation, JSON pointer edits, env key
additions, and Makefile target additions.

File hygiene repairs use the same contract. A Dockerfile without `.dockerignore` can produce a
safe `file-create` operation, and a `.gitignore` missing env-file rules can produce a safe
`file-append` operation. Workspai can render those operations as reviewable file edits before the
operator approves the fix.

`.env.example`, a config schema, or environment documentation is the portable configuration
contract. Doctor does **not** create `.env` implicitly: that file can contain operator-owned secrets
and its absence is not a health defect when a portable contract exists. A product-specific typed
operation may still create a non-secret local file when its own contract explicitly requires it and
the user approves the change.

For Node projects without a security audit script, Doctor can emit a guarded
`package-json-script` operation for `scripts.audit="npm audit --audit-level=moderate"`, giving CI,
Studio, and humans the same deterministic security check.

For projects with dependency manifests but no deterministic baseline, Doctor emits guarded
`dependency-sync` repairs when the runtime has a safe native command:

- Node: `npm install`, `pnpm install`, `yarn install`, or `bun install`
- Go: `go mod tidy`
- Rust: `cargo fetch`
- PHP: `composer install`
- Ruby: `bundle install`
- .NET: `dotnet restore`
- Python: `poetry lock` or `uv lock` when the project metadata identifies the tool

When the runtime does not expose a safe deterministic repair path, Doctor keeps the issue as
review-required guidance instead of guessing.

Doctor can also create **runtime command contracts** for missing test, quality, and security
surfaces. For Node, safe contracts are written as `package.json` scripts when a deterministic
fallback exists. For backend runtimes such as Go, Python, Rust, PHP, Ruby, .NET, and Java, Doctor
uses guarded `Makefile` target repairs (`test`, `quality`, `security`) so Studio can preview and
apply the file edit without executing an unprovisioned toolchain immediately.

## Enterprise Surface Probes

Doctor also emits language-agnostic product-readiness probes for every detected project. These
probes do not replace runtime-specific checks; they add a common enterprise baseline that Workspai,
CI, and agents can reason about consistently across frontend and backend stacks:

| Surface     | Probe examples                                                                     |
| ----------- | ---------------------------------------------------------------------------------- |
| Dependency  | Runtime manifest plus deterministic lock/baseline (`package-lock`, `go.sum`, etc.) |
| Environment | `.env.example`, config schema, or environment documentation                        |
| Container   | Dockerfile / compose presence and `.dockerignore` hygiene                          |
| Deployment  | Kubernetes/Helm/Kustomize surface plus readiness probes and resource controls      |
| Security    | Vulnerability evidence, `.gitignore` hygiene, audit-script guidance                |
| Tests       | Runtime/framework test scripts, configs, directories, or test files                |
| Formatting  | Node formatter command surface for CI parity                                       |

These probes are intentionally evidence-first. Missing optional surfaces are surfaced as warnings
or manual repair capabilities, while deterministic repairs are promoted into `--fix` only when the
change is safe enough for Doctor to apply with approval and post-fix verification.

Workspace scans are bounded and cache-safe. Doctor fingerprints manifests plus relevant source,
test, and module trees, includes content hashes for small files, writes cache artifacts atomically,
and limits project concurrency (four workers by default; configurable with
`RAPIDKIT_DOCTOR_SCAN_CONCURRENCY`). Dependency trees and build outputs are represented by bounded
materialization sensors rather than recursively traversed. Repair/plan/apply always bypass scan
cache, and Java warm-up uses workspace-local Maven/Gradle cache paths so its postcondition is both
portable and observable. Dependency-audit cache keys hash the complete governed manifest/lockfile
inputs and use a bounded in-memory cache, so same-size lockfile changes cannot reuse stale security
evidence.

Runtime-native probes add a second layer on top of the generic surface checks:

| Runtime family    | Native signals sampled by Doctor                                                 |
| ----------------- | -------------------------------------------------------------------------------- |
| Node/Bun/Deno     | Jest/Vitest/native tests, ESLint/Prettier/Biome, package-manager audit           |
| Python            | pytest/tox/nox, Ruff/Black/Mypy, pip-audit/Safety/Bandit                         |
| Go                | `*_test.go`, golangci-lint, govulncheck/gosec                                    |
| Java/Kotlin/Scala | Maven/Gradle/sbt tests, Checkstyle/Spotless/Detekt/Scalafmt, declared JVM audit  |
| .NET              | test projects, `.editorconfig`, NuGet audit                                      |
| Rust              | Cargo tests, rustfmt/clippy, cargo-audit                                         |
| PHP/Ruby          | PHPUnit/Pest/PHPStan and RSpec/Minitest/RuboCop/Bundler-audit                    |
| Elixir/Clojure    | ExUnit/Credo/Hex and clojure.test/Kaocha/clj-kondo                               |
| C/C++             | CTest/native test markers, clang tooling, declared SBOM or vulnerability scanner |

## CI Example

```yaml
name: Health Check
on: [push]

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.19.0'
      - run: npm ci
      - run: npx workspai doctor workspace --ci --json
```

## Exit Codes

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| `0`  | Passed; local-profile warnings remain advisory                     |
| `1`  | Errors, or warnings under `release`/`enterprise-strict`/`--strict` |
| `2`  | Warning-only result under the `ci` profile or `--ci`               |

## Enterprise Probe Extensions

Doctor supports project-local custom probes via JSON contract files:

- `.workspai/doctor.probes.json`
- `doctor.probes.json`

Schema:

```json
{
  "probes": [
    {
      "id": "db-schema-contract",
      "label": "Database schema contract",
      "severity": "error",
      "anyOfPaths": ["prisma/schema.prisma", "migrations"],
      "allOfPaths": ["README.md"],
      "recommendation": "Define deterministic schema + migration baseline."
    }
  ]
}
```

Each probe is evaluated during `doctor project` and emitted in:

- human output (`Probe checks`)
- JSON output (`project.probes`)
- evidence (`doctor-project-last-run.json`)

## Adapter Plugin Contract

Doctor also supports runtime adapter checks via JSON contracts:

- `.workspai/doctor.adapters.json`
- `doctor.adapters.json`

Schema:

```json
{
  "checks": [
    {
      "id": "boot-probe-contract",
      "label": "Boot probe contract",
      "severity": "error",
      "runtimes": ["node", "python"],
      "anyOfPaths": ["src/main.ts", "app/main.py"],
      "allOfPaths": ["README.md"],
      "recommendation": "Expose deterministic bootstrap path and document runtime startup.",
      "passReason": "Bootstrap contract markers detected.",
      "failReason": "Bootstrap contract markers are missing."
    }
  ]
}
```

This enables enterprise teams to extend Doctor checks without patching core CLI logic.

## Score Explainability

Both workspace/project JSON outputs include `scoreBreakdown` with:

- `id` and `label`
- normalized `status` (`ok`, `warn`, `error`)
- `scope` (`host-system`, `project-scoped`)
- `policyRuleId` (deterministic rule that selected status/severity)
- deterministic `reason`

Workspace scope additionally appends aggregate policy rules (`workspace-aggregate`), such as:

- discovery gate
- system error gate
- blocking issue gate
- advisory warning gate

This allows CI and governance pipelines to audit why a score was produced.

## Contract Metadata (Enterprise)

Both JSON output and evidence files include a `contract` object:

- `version`: current doctor evidence contract version
- `scoringPolicyVersion`: current deterministic scoring policy version
- `generatedBy`: emitting surface (`workspai`)
- `deterministicScoreBreakdown`: explicit deterministic score policy flag
- `scopeModel`: how scope semantics are encoded

Use these fields for strict consumers in CI/CD and extension adapters to prevent schema drift.

## Drift Delta and Scope Provenance

Workspace/project outputs now include:

- `summary.scopeProvenance`: scoped vs aggregated vs mixed coverage summary
- `driftDelta`: change report compared with previous evidence (new/resolved issues, score delta, system status changes)

These fields are designed for release gates and extension timeline cards that must show progression, not only snapshots.

## Workspace scope CI exit codes

- `npx workspai doctor workspace --strict` exits `1` when health score reports errors **or** warnings.
- `npx workspai doctor workspace --ci` exits `1` on errors and `2` on warnings only (errors take precedence).
- Without `--strict` or `--ci`, the local profile exits `1` for errors and `0`
  for passed or warning-only results. Warnings remain advisory; errors never
  become a successful local result.

## Workspace fix behavior

- Reuses cached project scans only when their inputs and Doctor scoring/safety
  policy still match; stale policy signatures force a rescan. Cached payloads
  are re-sanitized before they can become current evidence.
- `--fix` runs interactive remediation; `--plan` prints remediation plan only; `--apply` applies non-interactively.
- `--plan` cannot be combined with `--fix` or `--apply`.
- JSON fix/apply output includes the same `doctor-remediation-plan-v2` contract used by Studio.
- Advisory warnings do not automatically become shell fix commands. URLs stay
  in issue guidance and recommendations; Doctor never exposes a documentation
  URL as an executable `fixCommand` or repair action.
- Go `go mod tidy` fixes are skipped when the Go toolchain is unavailable.

## Workspace JSON fields (AI/automation)

`npx workspai doctor workspace --json` includes per-project metadata: `framework`, `frameworkKey`, `importStack`, `runtimeFamily`, `runtimeFamilies`, `projectKind`, `supportTier`, `frameworkConfidence`, `probes`, and `repairCapabilities`. Passing probes never retain an executable repair capability; only non-passing evidence can enter remediation planning.

## Project scope behavior

- Resolves current or nearest parent project from nested directories.
- Supports Workspai, legacy RapidKit, and non-Workspai projects when project metadata is missing.
- Evidence: `.workspai/reports/doctor-project-last-run.json`.
- `--fix`, `--plan`, and `--apply` apply only project-scoped fixes.

## Project JSON fields (AI/automation)

`npx workspai doctor project --json` includes `scope`, `contract`, `project`, `summary.scopeProvenance`, `driftDelta`, and `scoreBreakdown`. The `project` payload includes probe-level `repairCapability` entries and a flattened `repairCapabilities` list when deterministic repairs are available.

## Evidence schema compatibility

- Workspace evidence: `doctor-workspace-evidence-v1`
- Project evidence: `doctor-project-evidence-v1`
- Workspace scan cache: `doctor-workspace-cache-v2`

Recognizable legacy evidence without `schemaVersion` remains readable only when it exposes an
actual workspace/project Doctor shape. Arbitrary JSON objects, unknown versions, contradictory
score accounting, malformed typed repairs, and semantically invalid canonical diagnosis are
treated as missing or invalid evidence. Readiness and Workspace Verify enforce the same fail-closed
semantic boundary.

Typed file repairs resolve existing ancestors through the filesystem before mutation. A lexical
path under the project is rejected if a symbolic link escapes the governed project/workspace
boundary. The checkpointed `package-json-script` target is the exact file that is edited; JSON
pointer prototype segments and hidden multiline env/append values are rejected before execution.

## Related Workspace Commands

```bash
npx workspai bootstrap [--profile <profile>]
npx workspai setup <python|node|go|java|dotnet|rust|php> [--warm-deps]
npx workspai workspace list
npx workspai cache <status|clear|prune|repair>
npx workspai mirror <status|sync|verify|rotate>
```

Use `doctor workspace` before and after major workspace operations to detect drift early.
Use `doctor project` before changing a single service to keep project-scope evidence deterministic.
