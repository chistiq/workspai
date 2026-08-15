# Workspace Run — Polyglot Fleet Orchestration

`workspace run` executes CI-safe stages (`init`, `test`, `build`, `start`) across discovered projects in a workspace. Command syntax is in [commands-reference.md](./commands-reference.md).

## Quick start

```bash
npx workspai workspace run test --parallel
npx workspai workspace run build --plan --json
npx workspai workspace run test --runtime cpp --scope project:native-core --json
npx workspai workspace run test --affected --since HEAD~1
npx workspai workspace run test --affected --blast-radius
npx workspai workspace run build --json --max-workers 8
```

`--blast-radius` resolves the canonical or legacy workspace contract first, then
`.workspai/workspace-dependency-graph.json`, and finally the legacy
`.rapidkit/workspace-dependency-graph.json` fallback. It expands direct
`dependsOn` and publish/consume event relationships.

## Runtime support

`workspace run` does not infer support from a hard-coded framework list. It
reads the effective project capability map produced by the runtime adapters and
project metadata. First-class and extended Node.js, Python, Go, Java, .NET, PHP,
and Rust projects can expose governed lifecycle stages. Existing polyglot
repositories also publish bounded runtime units discovered from npm, Python,
Go, Cargo, Maven, Gradle, NuGet, CMake, and Meson manifests. CMake and Meson
provide explicit native init, test, and build plans; Workspai does not treat
discovery as permission to execute them.

Use `--plan` to return the selected runtime units and commands without running
them. Use `--runtime <runtime>` to limit a polyglot project to one runtime
family. Vendored trees, build outputs, fixtures, and nested test fixture package
manifests are excluded from lifecycle discovery so orchestration does not turn
sample inputs into install targets.

Planning and `init` do not require Doctor or release-readiness evidence. Real
`test`, `build`, and `start` runs enforce the `doctor-workspace` and `readiness`
gates by default. A failed gate prevents project commands from starting and is
recorded as `gates.blocked` in the result. `--strict` converts a failing or
warning gate into a non-zero process exit; without it, the structured gate
result remains available without turning advisory policy into a process error.

The authoritative scaffold/import/lifecycle tiers are in
[contracts/RUNTIME_SUPPORT_MATRIX.md](./contracts/RUNTIME_SUPPORT_MATRIX.md).
Inspect one project's effective surface with
`npx workspai project commands --json` before orchestration.

## Enterprise configuration

Override stage commands per project via `.workspai/context.json`:

```json
{
  "runtime": "php",
  "framework": "Laravel",
  "commands": {
    "test": "php artisan test --parallel=4",
    "build": "php artisan config:cache && php artisan route:cache",
    "lint": "php bin/phpstan analyse --level=8"
  },
  "environment": "dev"
}
```

Enterprise features include command overrides, multi-framework projects, error categorization (setup vs test vs runtime), preflight validation, health checks, custom stages (via `.workspai/context.json` `commands`), stage dependencies (from framework registry), environment variants, result caching (`--reuse-passed`), and composite steps.

### Custom stages

Declare extra fleet stages in `.workspai/context.json`:

```json
{
  "commands": {
    "lint": "php bin/phpstan analyse --level=8"
  }
}
```

Run them with `npx workspai workspace run lint --scope project:<name>`.

### Stage dependencies and caching

Framework registry entries may declare `dependencies` (for example `start` depends on `build`). When `.workspai/reports/workspace-run-last.json` exists, projects skip until dependency stages show `passed`.

Use `--reuse-passed` to skip projects that already passed the requested stage in the cached report:

```bash
npx workspai workspace run test --reuse-passed --json
```

## JSON reporting

```bash
npx workspai workspace run test --json > test-results.json
cat test-results.json | jq '.projects[] | {path, status, errorCategory}'
```

`errorCategory` values: `setup`, `test-failure`, `runtime`, `dependency`, `timeout`.
For failures, `reason` and `errorMessage` select the most specific terminal
failure signal instead of an earlier readiness warning.
`failureDiagnostic.outputExcerpt` is a bounded head-and-tail excerpt, preserving
both command context and the final root cause without copying the full log.
Consumers should render these fields rather than reconstructing a diagnosis
from arbitrary stdout lines.

The canonical report is `.workspai/reports/workspace-run-last.json`. Workspace
verification binds a finding to its exact producer through `sourceCommand` and
`sourceArtifact`; consumers should run the cited producer and read that artifact
instead of guessing which command can refresh the evidence.

## Command semantics

Workspai has two workspace-level execution surfaces and three equivalent full-init aliases at workspace root:

| Command                                                            | Intent                                             | Scope             |
| ------------------------------------------------------------------ | -------------------------------------------------- | ----------------- |
| `init`, `workspace init`, `workspace run init` (at workspace root) | Mirrored full-init (workspace deps + project init) | Workspace + fleet |
| `workspace run <test\|build\|start>`                               | Fleet stage execution                              | Selected projects |
| `init`, `test`, `build`, `start`, `dev` (inside project dir)       | Project primitive                                  | Single project    |

At workspace root, `npx workspai init`, `npx workspai workspace init`, and `npx workspai workspace run init` are equivalent aliases.

Inside a project directory, `npx workspai init` remains project-scoped.

`dev` is excluded from `workspace run` — it is a long-running local process, not a CI batch stage.

## See also

- [Documentation index](./README.md)
- [commands-reference.md](./commands-reference.md)
- [contracts/RUNTIME_SUPPORT_MATRIX.md](./contracts/RUNTIME_SUPPORT_MATRIX.md)
