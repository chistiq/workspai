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

# Attempt safe fixes (interactive)
npx workspai doctor workspace --fix

# Attempt safe fixes for current project only
npx workspai doctor project --fix

# JSON output with audit-ready breakdown + probes
npx workspai doctor project --json

# Release-grade policy profile
npx workspai doctor workspace --profile enterprise-strict --json
```

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
force; unresolved findings move to a targeted upgrade and verification plan.

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
| `local-environment`   | Seed local env files without overwriting operator-owned values                        |
| `source-hygiene`      | Apply safe project-scoped hygiene files such as `.dockerignore` or `.gitignore` rules |
| `command-contract`    | Add missing test, quality, audit, or runtime command contracts                        |
| `runtime-governance`  | Run RapidKit/workspace initializers that may touch multiple project surfaces          |
| `manual-review`       | Surface guidance that requires a human decision                                       |
| `generic-execution`   | Last-resort shell remediation when no typed operation exists                          |

`dependsOn` lets Workspai avoid false loops: for example, a missing test script repair can depend on
the project dependency baseline step, so Studio can run or ask for approval in the same order Doctor
would use.

Workspai should use this contract to offer two clear actions for a blocked card:

1. Run the exact diagnostic or remediation command when the safest path is command execution.
2. Apply the approved file edit when Doctor exposes a typed, project-scoped operation.

After either path, Studio should run the step `verifyCommand` when present, then refresh the card
with `refreshCommands` before claiming the issue is resolved.

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

Local environment seeding is also typed. When `.env.example` exists and `.env` is missing, Doctor
emits a safe `file-copy` operation instead of an opaque shell copy command. The target is never
overwritten.

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
      - run: npx workspai doctor
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
- Without `--strict` or `--ci`, doctor reports findings but exits `0` (backward compatible).

## Workspace fix behavior

- Reuses cached project scans when valid; refreshes `.workspai/reports/doctor-last-run.json`.
- `--fix` runs interactive remediation; `--plan` prints remediation plan only; `--apply` applies non-interactively.
- `--plan` cannot be combined with `--fix` or `--apply`.
- JSON fix/apply output includes the same `doctor-remediation-plan-v2` contract used by Studio.
- Advisory warnings do not automatically become shell fix commands.
- Go `go mod tidy` fixes are skipped when the Go toolchain is unavailable.

## Workspace JSON fields (AI/automation)

`npx workspai doctor workspace --json` includes per-project metadata: `framework`, `frameworkKey`, `importStack`, `runtimeFamily`, `projectKind`, `supportTier`, `frameworkConfidence`, `probes`, and `repairCapabilities`.

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

Legacy evidence without `schemaVersion` is still accepted. Unknown versions are treated as invalid evidence. `readiness` and `workspace share` share the same validation path.

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
