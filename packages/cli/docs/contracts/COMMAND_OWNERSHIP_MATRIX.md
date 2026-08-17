# Command Ownership Matrix

This document defines which layer owns command execution in Workspai CLI (`workspai`) versus RapidKit Core (`rapidkit-core`) to prevent runtime conflicts.

## Goals

- Keep project bootstrapping reliable across Python / Node / Go projects.
- Avoid conflicting behavior between wrapper and core CLIs.
- Make delegation behavior explicit and testable.

## Ownership Rules

### 1) Wrapper-owned commands (never forward to core)

These commands are implemented and orchestrated by Workspai CLI:

- `readiness`
- `autopilot`
- `pipeline`
- `doctor`
- `import`
- `adopt`
- `snapshot`
- `workspace`
- `bootstrap`
- `setup`
- `cache`
- `mirror`
- `ai`
- `analyze`
- `config`
- `product`
- `infra`
- `commands`
- `create`
- `goal`
- `agent`
- `project`
- `shell activate`

Reason: workspace-level policy, registry, and platform orchestration live in npm wrapper.

### 1.1) Wrapper-owned scoped commands

These nested Commander commands are implemented and orchestrated by Workspai CLI:

- `ai generate-embeddings`
- `ai info`
- `ai recommend`
- `ai update-embeddings`
- `config ai`
- `config remove-api-key`
- `config set-api-key`
- `config show`
- `infra down`
- `infra plan`
- `infra status`
- `infra up`
- `product manifest`
- `product manifest create`
- `product plan`
- `agent bootstrap`
- `project agent-entry`
- `project commands`
- `project coverage`
- `project archives`
- `project archive`
- `project restore`
- `project delete`
- `project workspace`
- `snapshot create`
- `snapshot inspect`
- `snapshot list`
- `snapshot restore`

Reason: these routes are registered directly in the npm wrapper's live
Commander tree. Their completeness is verified against `commands --json` and
the generated runtime command surface during tests and prepack.

`project detect` remains Core-owned because it is the stable machine-readable
contract used by wrappers to detect Python RapidKit projects.

`commands --scope project` is also wrapper-owned. It reports the effective
project command capability matrix for the currently selected project without
delegating to Core.

### 2) Wrapper-orchestrated project commands

These commands are handled by npm wrapper first (runtime-aware + fallback-aware)
when the project capability matrix marks them as runtime-supported:

- `init`
- `dev`
- `start`
- `build`
- `test`
- `lint`
- `format`
- `help`

Reason: generated projects can be Python, Node/NestJS, Go/Fiber, Go/Gin, or
Spring Boot. Runtime commands must run through the selected project's adapter,
not through a hard-coded global assumption.

### 3) Core module/template commands

These commands are supported only when the selected project is Core-backed
and has module/template support:

- `add`
- `modules`
- `upgrade`
- `diff`
- `merge`
- `reconcile`
- `rollback`
- `uninstall`
- `checkpoint`
- `snapshot`
- `optimize`

Dispatch policy:

- FastAPI / NestJS Core-backed project → supported and delegated to Core.
- Go / Spring Boot / ASP.NET Core npm-owned project → blocked with a capability explanation.
- Unknown project → blocked until project metadata is present.

### 4) Global engine/catalog commands

These commands are not project-specific even when run inside a project:

- `create`
- `list`
- `info`
- `frameworks`
- `license`

`create` remains npm-owned so the wrapper can orchestrate multi-language
workspace/project generation. The other commands may delegate to Core as engine
catalog operations.

## Dynamic Project Capability Model

A pure-core or pure-wrapper model causes regressions in mixed-language workspaces. Hybrid ownership keeps Python compatibility while letting npm wrapper enforce workspace policy and resilient cross-platform fallback behavior.

The npm wrapper resolves project capabilities from `.workspai/project.json`,
`.workspai/context.json`, legacy `.rapidkit/*` metadata, and framework/runtime markers. Users and tools can
inspect the effective command surface with:

- `workspai project commands`
- `workspai project commands --json`
- `workspai commands --scope project --json`

This capability model is the canonical bridge between npm-owned kits and
Core-backed kits. Adding a future language or framework should update the
project metadata and runtime detector first, then the capability matrix follows
without widening the Core/global command surface.

## Guard Rails

- `shouldForwardToCore()` must return `false` for wrapper-owned and wrapper-orchestrated project commands.
- `project commands` and `commands --scope project` must never forward to Core.
- Core module/template commands must be blocked for npm-owned projects that set `module_support: false`.
- Tests must assert forwarding boundary rules.
- Changes to ownership should update this file and tests together.
