# Creating Workspaces and Projects

Use this guide when you want to start a new software system or add a new
application to an existing one. Workspai creates the files, records where the
project belongs, and makes it visible to the same checks and tools as the rest
of the workspace.

The sections below explain project locations, supported starters, interactive
commands, automation, and the most useful options.

For a compact list of command syntax, see
[commands-reference.md](./commands-reference.md).

## The two things you can create

A **workspace** is the shared home for related projects, rules, and saved
Workspai reports.

A **project** is an application or service, such as a FastAPI API, Go service,
Spring Boot service, .NET API, or frontend application.

The canonical commands are:

```bash
npx workspai create workspace <name>
npx workspai create project <kit> <name>
```

Use the canonical commands in scripts and documentation. The older
`workspai <name> --template <kit>` form is supported for compatibility, but it
does not have exactly the same behavior.

## Quick decision table

| What you want                                                   | Command                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Choose interactively                                            | `npx workspai create`                                                       |
| Create a managed workspace                                      | `npx workspai create workspace platform --yes`                              |
| Create a workspace under the current directory                  | `npx workspai create workspace platform --here --yes`                       |
| Create a project and use the current/default workspace behavior | `npx workspai create project gofiber.standard api`                          |
| Turn the current folder into a workspace before creating        | `npx workspai create project gofiber.standard api --create-workspace --yes` |
| Create a project without workspace management                   | `npx workspai create project gofiber.standard api --no-workspace --yes`     |
| Preview a supported create plan                                 | `npx workspai create project frontend.nextjs web --dry-run`                 |

# Creating a workspace

## Create in the managed Workspai location

```bash
npx workspai create workspace platform --yes
```

The default target is:

```text
~/.workspai/workspaces/platform
```

With `--yes`, Workspai does not ask questions. If you do not provide a
profile, it uses `minimal`.

## Create under the current directory

```bash
npx workspai create workspace platform --here --yes
```

If the current directory is `/home/me/code`, the result is:

```text
/home/me/code/platform
```

`--here` means "create the named workspace as a child of this directory." It
does not turn the current directory itself into a workspace.

## Create under another parent directory

```bash
npx workspai create workspace platform --output /data/workspaces --yes
```

The result is:

```text
/data/workspaces/platform
```

`--output` is always the parent directory. Workspai adds the workspace name to
it.

Relative output paths are resolved from the current directory:

```bash
npx workspai create workspace platform --output teams --yes
```

This creates `<current-directory>/teams/platform`.

## Use the interactive workspace wizard

```bash
npx workspai create workspace
```

When values are missing, Workspai can ask for:

- The workspace name
- The managed home or current-directory location
- The author name
- The workspace profile
- Whether to install the optional Python engine
- The Python environment method when installation is selected

You can also start one level higher:

```bash
npx workspai create
```

In an interactive terminal, this first asks whether you want to create a
workspace or a project.

## Workspace profiles

| Profile       | Intended runtime scope                           | Python engine by default |
| ------------- | ------------------------------------------------ | ------------------------ |
| `minimal`     | Lightweight workspace foundation                 | No                       |
| `node-only`   | Node.js projects                                 | No                       |
| `go-only`     | Go projects                                      | No                       |
| `java-only`   | Java projects                                    | No                       |
| `dotnet-only` | .NET projects                                    | No                       |
| `python-only` | Python projects                                  | Yes                      |
| `polyglot`    | Multiple runtimes                                | Yes                      |
| `enterprise`  | Multiple runtimes with governance-oriented setup | Yes                      |

Example:

```bash
npx workspai create workspace platform --profile go-only --yes
```

## Keep a Python-aware profile without installing Python now

```bash
npx workspai create workspace platform \
  --profile polyglot \
  --skip-python-engine \
  --yes
```

The workspace remains `polyglot`, but its metadata records the Python engine as
`skipped`. Workspace Intelligence, project registration, import, adopt, model,
context, and verify remain available.

Use `--skip-python-engine` for workspace creation. For project creation, use
`--skip-install` instead.

## What Create runs automatically

Workspace and project creation finish with a canonical foundation sync. Workspai
registers created projects and refreshes the workspace contract, model,
proof-backed graph, diff, impact, agent context, grounding files, and evidence
index. A successful Create receipt therefore means that the new source and its
basic Workspace Intelligence artifacts agree.

Create does not silently run dependency initialization, Doctor, Analyze,
Readiness, release gates, or the strict verification chain. Those operations can
change host state or produce environment-specific verdicts and remain explicit:

```bash
# Install profile-owned and project dependencies when you want them.
workspai bootstrap --profile node-only

# Produce the complete evidence and verification chain.
workspai workspace intelligence run --for-agent generic --strict --json
```

`node-only`, `go-only`, `java-only`, and `dotnet-only` bootstrap never install
the optional workspace Python engine. A `minimal` workspace installs it on
demand only when a registered Workspai kit requires that engine. Explicitly
selecting `python-only`, `polyglot`, or `enterprise` enables the Python-capable
bootstrap path.

The machine-readable source for profiles, every executable kit, runtime
ownership, Python-engine requirements, and automatic versus explicit lifecycle
steps is `contracts/create-planner-capabilities.v1.json`. The same contract is
published through `workspai commands --json` and consumed by Workspai for VS
Code.

## If Python is not installed

Python-free profiles do not require Python.

For a Python-aware profile, interactive mode offers guidance and fallback
choices. In non-interactive `--yes` mode, Workspai falls back to a Python-free
profile when Python is unavailable:

| Requested profile | Fallback profile |
| ----------------- | ---------------- |
| `python-only`     | `minimal`        |
| `polyglot`        | `node-only`      |
| `enterprise`      | `node-only`      |

Before writing workspace files, Workspai probes the selected Python installer.
Poetry, local venv, and pipx choices show whether their executable and Python
module prerequisites are usable. Workspai honors the selected method rather
than silently changing it; missing `venv`, `pip`, Poetry, or pipx support returns
the exact setup command, and the workspace remains uncreated.

Failure receipts include platform-specific installation commands and the
official documentation URL. On Linux they distinguish Debian/Ubuntu, Fedora,
Arch, and Alpine package managers; macOS uses Homebrew guidance; and Windows
uses `winget` or `py -m pip` as appropriate. Advanced diagnostics remain behind
`--debug` and are not mixed into normal onboarding output.

## Git behavior for a new workspace

Git initialization is enabled by default. Disable it with:

```bash
npx workspai create workspace platform --skip-git --yes
```

If the target is already inside another Git worktree, Workspai avoids creating
a nested repository. A missing Git installation or a failed initial commit
produces a warning but does not remove an otherwise valid workspace.

## Preview workspace creation

```bash
npx workspai create workspace platform \
  --profile polyglot \
  --skip-python-engine \
  --skip-git \
  --dry-run
```

The preview shows the target, profile, Python plan, Git plan, expected files,
and next steps. It does not create a workspace, install Python, initialize Git,
or update a registry.

## Existing target directories

Workspace creation does not merge into or overwrite an existing target. If the
resolved directory already exists, choose another name or output parent.

To bring existing software into Workspai, use the operation that matches who
owns its location:

```bash
# Keep a project where it is.
npx workspai adopt /path/to/project

# Copy or clone a project into the selected workspace.
npx workspai import /path/to/project --workspace /path/to/my-workspace

# Register an existing Workspai workspace without moving it.
npx workspai workspace connect /path/to/existing-workspace

# Restore and register a portable workspace archive.
npx workspai workspace import team.workspai-archive.zip --output ./team
```

Running `npx workspai create` interactively exposes the same choices as
“Create a project”, “Add existing software”, and—when appropriate—“Create
another workspace”. Inside a workspace, project and onboarding choices appear
first; creating another workspace remains an explicit escape hatch rather than
the default.

## Main workspace files

A normal workspace includes:

```text
.workspai-workspace
.workspai/workspace.json
.workspai/toolchain.lock
.workspai/policies.yml
.workspai/cache-config.yml
.workspai/workspace.contract.json
.workspai/workspace-registry.v1.json
.gitignore
README.md
```

The user-level workspace registry is stored under the Workspai home, normally:

```text
~/.workspai/workspaces.json
```

# Creating a project

## Choose a kit interactively

```bash
npx workspai create project
```

Workspai asks for a kit and project name. You can also use the top-level wizard:

```bash
npx workspai create
```

If you choose project creation, the same project flow is used.

When the terminal is interactive and the current directory is not inside a
workspace, **every supported backend, frontend, desktop, and extension kit** shows the workspace
management question before scaffolding:

```text
This project is outside a Workspai workspace. How should it be managed?

1. Link it to the managed default workspace (recommended)
2. Turn the current folder into a workspace
3. Create it without workspace management
```

This applies to direct commands and interactive kit selection.

## Create a project with an explicit kit

```bash
npx workspai create project <kit> <name>
```

Examples:

```bash
npx workspai create project fastapi.standard api
npx workspai create project gofiber.standard gateway
npx workspai create project springboot.standard orders
npx workspai create project dotnet.webapi.clean billing
npx workspai create project rust.axum telemetry-api
npx workspai create project frontend.nextjs dashboard
npx workspai create project desktop.tauri desktop-app
npx workspai create project desktop.electron admin-console
npx workspai create project extension.vscode editor-tools
npx workspai create project php.laravel customer-api
```

The shorter frontend alias remains available:

```bash
npx workspai create frontend nextjs dashboard
```

## Supported backend kits

| Kit                   | Runtime | Scaffold owner       | Core module mutation |
| --------------------- | ------- | -------------------- | -------------------- |
| `fastapi.standard`    | Python  | RapidKit Core        | Yes                  |
| `fastapi.ddd`         | Python  | RapidKit Core        | Yes                  |
| `nestjs.standard`     | Node.js | RapidKit Core bridge | Yes                  |
| `gofiber.standard`    | Go      | Workspai npm CLI     | No                   |
| `gogin.standard`      | Go      | Workspai npm CLI     | No                   |
| `springboot.standard` | Java    | Workspai npm CLI     | No                   |
| `dotnet.webapi.clean` | .NET    | Workspai npm CLI     | No                   |
| `rust.axum`           | Rust    | Workspai npm CLI     | No                   |

NestJS runs on Node.js, but its current scaffold is provided through the
RapidKit Core bridge.

## Supported frontend generators

Workspai has official-generator paths for:

| Frontend             | Common kit name               |
| -------------------- | ----------------------------- |
| Next.js              | `nextjs` or `frontend.nextjs` |
| React Router / Remix | `remix`                       |
| React with Vite      | `vite-react`                  |
| Vue with Vite        | `vite-vue`                    |
| Svelte with Vite     | `vite-svelte`                 |
| Solid with Vite      | `vite-solid`                  |
| Vanilla Vite         | `vite-vanilla`                |
| Nuxt                 | `nuxt`                        |
| Angular              | `angular`                     |
| Astro                | `astro`                       |
| SvelteKit            | `sveltekit`                   |

The ecosystem's official generator creates the application. Workspai then adds
project metadata and performs the selected workspace registration.

## Desktop, extension, and additional backend generators

| Category  | Project           | Kit                | Creation owner                        |
| --------- | ----------------- | ------------------ | ------------------------------------- |
| Backend   | Axum              | `rust.axum`        | Workspai deterministic Cargo baseline |
| Backend   | Laravel           | `php.laravel`      | Composer / Laravel                    |
| Desktop   | Tauri             | `desktop.tauri`    | create-tauri-app                      |
| Desktop   | Electron Forge    | `desktop.electron` | create-electron-app                   |
| Extension | VS Code Extension | `extension.vscode` | generator-code                        |

Every generated project receives a canonical `kind` and `category`. The four
user-facing categories are `backend`, `frontend`, `desktop`, and `extension`;
they remain visible in the Workspace Model and Knowledge Graph so consumers do
not have to guess a project’s role from its runtime.

Official generators may download packages and therefore need network access.
Each available integration requests the upstream latest stable channel rather
than pinning an old framework major. npm engine compatibility is enforced
strictly against the Node.js runtime running Workspai, and required ecosystem
tools such as Rust/Cargo, Git, PHP, or Composer are checked before generation.
The upstream generator remains authoritative for its exact supported runtime
range; Workspai records the `latest-stable` policy in the generated project
metadata and evidence.

`desktop.electron`, `extension.vscode`, and `php.laravel` do not accept
`--skip-install`, because their official generators do not expose a reliable,
documented no-install contract.

# Where the project is created

The project path is always:

```text
(--output or current directory) + project name
```

Without `--output`:

```bash
npx workspai create project gofiber.standard gateway
```

This creates `<current-directory>/gateway`.

With a relative output parent:

```bash
npx workspai create project gofiber.standard gateway --output services
```

This creates `<current-directory>/services/gateway`.

With an absolute output parent:

```bash
npx workspai create project gofiber.standard gateway --output /data/apps
```

This creates `/data/apps/gateway`.

Workspai does not overwrite or merge into an existing project directory.

# Project creation inside a workspace

## Create at the workspace root

If the current directory is `/home/me/platform` and it is a workspace:

```bash
npx workspai create project gofiber.standard gateway
```

The project is created at `/home/me/platform/gateway` and registered with that
workspace.

## Create from a workspace subdirectory

If the current directory is `/home/me/platform/services`, the same command
creates `/home/me/platform/services/gateway`. Workspai does not force every
project into the workspace root.

## Create outside the current workspace with `--output`

```bash
npx workspai create project gofiber.standard gateway --output /data/apps
```

The project stays at `/data/apps/gateway` and is linked to the current
workspace as an external project. Workspai does not move or copy its source.

## Create directly inside another workspace

If the final project path is inside workspace B but the command was launched
from workspace A, the workspace found from the final project path takes
priority. The project is registered with workspace B.

# Project creation outside a workspace

## Interactive behavior

When no workspace is found and you did not provide an explicit workspace flag,
Workspai asks how the project should be managed before scaffolding.

The same question is shown for:

- RapidKit Core-backed projects
- Go, Spring Boot, and .NET npm-backed projects
- All supported frontend generators
- Direct `create project <kit> <name>` commands
- Interactive `create` and `create project` kit selection

## Choice 1: Link to the managed default workspace

This is the recommended option.

The project is created in the path you requested. After a successful scaffold,
Workspai creates or reuses:

```text
~/.workspai/workspaces/workspai
```

The managed default workspace uses:

| Setting                       | Value              |
| ----------------------------- | ------------------ |
| Name                          | `workspai`         |
| Profile                       | `polyglot`         |
| Python engine                 | `skipped`          |
| Git initialization            | skipped            |
| External project relationship | `linked` / adopted |

The project is not moved and is not copied.

The workspace is created only after the project scaffold succeeds. A failed
scaffold does not create a new managed default workspace for that project.

## Choice 2: Turn the current folder into a workspace

Choose this interactively, or use:

```bash
npx workspai create project gofiber.standard gateway \
  --create-workspace \
  --yes
```

Unlike `create workspace --here`, this turns the current directory itself into
a workspace. It then creates the project under the requested output parent.
This registration is foundation-only: it does not probe Python or Poetry,
create a virtual environment, or install `rapidkit-core`. The selected kit owns
its runtime prerequisites and installation flow.

For example, from `/home/me/platform`:

```text
Workspace: /home/me/platform
Project:   /home/me/platform/gateway
```

This uses the full current-folder Workspace Intelligence registration flow
(contract, model, graph, agent context, and registry) without coupling the
workspace to the optional Python engine.

## Choice 3: Create without workspace management

Choose this interactively, or use:

```bash
npx workspai create project gofiber.standard gateway \
  --no-workspace \
  --yes
```

The project is scaffolded, but Workspai does not:

- Create the managed default workspace
- Turn the current directory into a workspace
- Add the project to the global workspace registry
- Link or adopt the project
- Synchronize a workspace contract

Do not combine `--create-workspace` and `--no-workspace`. In the current CLI,
`--no-workspace` takes precedence.

## Non-interactive behavior and `--yes`

In CI, a non-interactive terminal, or when `--yes` is supplied, Workspai cannot
ask the three-way question. If no explicit workspace flag is present, it uses
the managed default workspace behavior.

```bash
npx workspai create project gofiber.standard gateway --yes
```

To opt out in automation, be explicit:

```bash
npx workspai create project gofiber.standard gateway --no-workspace --yes
```

To turn the current directory into a workspace in automation:

```bash
npx workspai create project gofiber.standard gateway --create-workspace --yes
```

# How external linking works

If a project is physically outside its workspace, Workspai records a linked
relationship. The source remains in its original path.

Project metadata includes:

```text
.workspai/project.json
.workspai/adopt.json
.workspai/adopt-readiness.json
```

Workspace metadata includes:

```text
.workspai/imported-projects.json
.workspai/workspace.contract.json
.workspai/workspace-registry.v1.json
```

The adoption policy records:

```text
mode: linked
moved_source: false
copied_source: false
```

Projects physically inside a workspace are registered normally and generally
do not need `adopt.json`.

# Common project flags

| Flag                 | Meaning                                                                         |
| -------------------- | ------------------------------------------------------------------------------- |
| `--yes`              | Do not ask optional questions; use managed-default behavior outside a workspace |
| `--output <parent>`  | Choose the parent directory for the project                                     |
| `--create-workspace` | Turn the current directory into a workspace before scaffolding                  |
| `--no-workspace`     | Scaffold without workspace registration or linking                              |
| `--skip-install`     | Defer dependency installation or warm-up where the generator supports it        |
| `--skip-git`         | Skip generator/wrapper Git initialization where supported                       |
| `--dry-run`          | Show a create plan without normal finalization                                  |

`--skip-install` has stack-specific behavior:

| Project type        | Behavior                                                       |
| ------------------- | -------------------------------------------------------------- |
| FastAPI and NestJS  | Defers dependency and lock work                                |
| Go Fiber and Go Gin | Skips `go mod tidy`                                            |
| Spring Boot         | Skips Maven wrapper/dependency warm-up                         |
| .NET                | Accepted, but there is no separate dependency warm-up step     |
| Frontend            | Passed to official generators that support a no-install option |

Project-level `--skip-python-engine` is rejected. It is only a workspace
creation option.

## Project dry runs

All supported project dry runs are read-only and show the resolved kit, target,
generator, and flags without creating the project tree.

```bash
npx workspai create project fastapi.standard api --dry-run
npx workspai create project frontend.nextjs web --dry-run
npx workspai create project gofiber.standard api --dry-run
```

# Workspace profile checks during project creation

When a project is created from inside a workspace, Workspai compares the
project runtime with the workspace profile.

| Policy mode | Incompatible runtime behavior |
| ----------- | ----------------------------- |
| `warn`      | Show a warning and continue   |
| `strict`    | Stop before registration      |

Frontend projects are checked as Node.js projects. `--no-workspace` disables
final registration, but it does not necessarily bypass the profile policy of an
enclosing workspace.

# Unsupported create requests

Workspai does not guess a native scaffold for every ecosystem. Projects such as
WordPress, Laravel, Symfony, Rails, generic PHP, Ruby, Rust, and other
unregistered stacks should be created with their ecosystem tooling and then
adopted:

```bash
npx workspai adopt /path/to/project
```

See [create-planner-capabilities.md](./create-planner-capabilities.md) for the
native, official, and existing-project lanes.

# Failure and cleanup behavior

| Situation                                                | Result                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Invalid name                                             | Stops before normal scaffold writes                                         |
| Target directory already exists                          | Stops without merging or overwriting                                        |
| Project scaffold fails                                   | Workspace linking does not run                                              |
| Git initialization fails                                 | Usually warns and keeps the scaffold                                        |
| Go or Maven dependency warm-up fails                     | Warns and keeps the scaffold                                                |
| Workspace registration/finalization fails after scaffold | Lifecycle rollback restores metadata and removes a newly owned project tree |

Create finalization uses a durable lifecycle transaction. On failure it restores
captured metadata and removes only newly owned project/workspace trees; it never
deletes pre-existing source. A residue is possible only if rollback cleanup
itself fails, in which case the command reports the cleanup failure and leaves a
recovery journal.

# Recommended command patterns

Interactive local use:

```bash
npx workspai create project
```

Automated creation linked to the managed default workspace:

```bash
npx workspai create project gofiber.standard api --yes --skip-install
```

Automated creation in a new current-folder workspace:

```bash
npx workspai create project gofiber.standard api \
  --create-workspace \
  --yes \
  --skip-install
```

Automated standalone project creation:

```bash
npx workspai create project gofiber.standard api \
  --no-workspace \
  --yes \
  --skip-install
```

Explicit workspace creation followed by project creation:

```bash
npx workspai create workspace platform \
  --profile polyglot \
  --skip-python-engine \
  --yes

cd ~/.workspai/workspaces/platform
npx workspai create project frontend.nextjs web --yes
npx workspai create project fastapi.standard api --yes --skip-install
```
