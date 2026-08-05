# Workspai Runtime Acceptance Matrix

Last updated: 2026-06-05

This document defines the executable acceptance gate for Workspai workspace
and project orchestration. It complements
[RUNTIME_SUPPORT_MATRIX.md](RUNTIME_SUPPORT_MATRIX.md): the support matrix says
what Workspai promises; this acceptance matrix verifies the promise with a real
workspace.

## Command

```bash
npm run test:runtime-matrix
```

For a stricter prepared-machine run where the supported Go, Java, .NET,
Python/RapidKit Core, Node, Rust, and PHP/Composer toolchains are healthy and
dependency registries are reachable (or already cached):

```bash
npm run test:runtime-matrix:full
```

The script can also be invoked directly:

```bash
node scripts/runtime-acceptance-matrix.mjs --report ./runtime-acceptance-report.json
```

## Modes

| Mode     | Purpose                                                                 | External runtime requirement |
| -------- | ----------------------------------------------------------------------- | ---------------------------- |
| default  | Scaffold, import, contract, doctor, archive, and actionable diagnostics | no                           |
| `--full` | Supported lifecycle commands pass; unsupported commands reject cleanly  | yes                          |

Default mode is intentionally network-safe. It creates a minimal workspace,
uses `--skip-install` for scaffolded projects, and accepts missing-runtime
lifecycle failures only when the CLI prints actionable diagnostics such as
`Reason`, `Command`, and `Hint`.

## Coverage

The matrix verifies:

- npm-owned global entrypoints: `--version`, `-v`, and `commands --json`.
- delegated Core catalog surfaces in default/full modes: `version`, `list`,
  `info`, `frameworks`, `modules`, and `license`. The normal
  `workspai --version` path remains wrapper-owned.
- `create workspace` with a Python-free minimal profile.
- `create project` for npm-backed Go Fiber, Go Gin, Spring Boot, and ASP.NET
  Core Clean Web API kits.
- `create project` for core-backed FastAPI and NestJS kits through the current
  bridge/fallback path.
- `import` for observed runtime projects without first-class kits, including
  Laravel/PHP, Rails/Ruby, Axum/Rust, and generic unknown backends.
- `workspace sync`, `workspace policy show/set`.
- Snapshot safety flows: create/list/inspect/restore dry-run.
- Project safety flows: archive list, archive dry-run, and delete dry-run.
- `workspace contract init/inspect/verify/graph`.
- `doctor workspace` and `doctor project`.
- `project commands --json` capability reporting for every generated/imported
  project.
- Project lifecycle `init`, `help`, `test`, `build`, `lint`, and `format` in
  default and full modes. The project capability map is authoritative:
  supported commands run, unsupported commands must reject cleanly, and
  missing runtime/tooling must produce actionable setup diagnostics in default
  mode.
- `workspace run init/test/build`, including default-mode actionable setup
  failures and full-mode hard pass requirements.
- Rejection of unsupported fleet stages such as `workspace run dev`.
- Portable archive export, inspect, strict verify, doctor, and hydrate preview.

## Report Contract

Each run writes a JSON report with:

- `kind: rapidkit.runtime.acceptance.matrix`
- runtime preflight availability
- per-scenario command, cwd, exit code, duration, status, and output tails
- final summary and exit code

By default, reports are written under the system temp report directory and are
not deleted with the temporary workspace. Use `--report <file>` when you need a
stable release-evidence path inside the repository or an artifact directory.

## Release Rule

This gate is intentionally **manual/local-only for now**. Do not add it to
regular GitHub Actions until it has a dedicated scheduled/manual workflow with
runtime caches and explicit cost controls.

For npm releases:

1. Run `npm run test:runtime-matrix` locally before publishing a release
   candidate.
2. Run `npm run test:runtime-matrix:full` on at least one prepared release
   machine with all extended toolchains used by the matrix installed, a healthy
   RapidKit Core environment, and dependency registry access or warm caches.
3. Any newly added first-class or extended runtime must add at least one matrix
   scenario before release.
