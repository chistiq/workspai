# Create Planner Capabilities

Workspai is a Workspace Intelligence platform, not a blind scaffold wrapper.
The create planner separates project creation into three lanes so developers,
CI, and AI agents share the same expectations.

## Lanes

| Lane       | Status    | Meaning                                                                                                                                       |
| ---------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `native`   | Available | Workspai owns the scaffold contract, marker, registry, doctor, bootstrap, and workspace model path.                                           |
| `official` | Available | A stable ecosystem generator exists. Available entries run the official generator and register the project; planned entries fall back to adopt. |
| `existing` | Available | The project enters Workspace Intelligence through import/adopt, not native create.                                                            |

## Native create

Native create is reserved for Workspai-owned kits with deterministic contracts:

- FastAPI
- NestJS
- Go Fiber and Go Gin
- Spring Boot
- ASP.NET Core Web API
- Rust / Axum

These kits can be exposed through `workspai create project` because Workspai can
create the project and immediately produce the expected `.workspai` metadata,
workspace registry entries, doctor evidence, and workspace model data.
They use a tested dependency baseline instead of floating to new upstream
majors during creation. Baseline upgrades ship as reviewed Workspai changes so
the same Workspai version remains reproducible across developer machines and
CI.

## Official generators

Some ecosystems have stable official generators. Available entries are invoked
by Workspai and then registered in Workspace Intelligence:

- Next.js: `npx create-next-app@latest <name>`
- React Router: `npx create-react-router@latest <name>`
- React, Vue, Svelte, Solid, and Vite: `npm create vite@latest <name> ...`
- Nuxt: `npx create-nuxt@latest <name> ...`
- Angular: `npx @angular/cli@latest new <name>`
- Astro: `npm create astro@latest <name>`
- SvelteKit: `npx sv@latest create <name>`
- Tauri: `npm create tauri-app@latest <name> -- --template vanilla-ts`
- Electron Forge: `npx create-electron-app@latest <name> --template=vite-typescript`
- VS Code Extension: `npx --package yo@latest --package generator-code@latest -- yo code <name> ...`
- Laravel: `composer create-project --no-interaction --prefer-dist --stability=stable laravel/laravel <name>`

### Stable version and runtime policy

Available official entries request the ecosystem's current stable release at
execution time; Workspai does not silently pin an older framework major. npm
generators use the `latest` distribution tag and Composer is restricted to
stable packages. npm engine checks run in strict mode, so an upstream generator
that does not support the operator's Node.js runtime stops before Workspai
claims the scaffold is usable.

Workspai also checks non-Node prerequisites before invoking a generator:

- Tauri requires Rust and Cargo in addition to its platform-specific system
  dependencies.
- Electron Forge requires Git.
- VS Code Extension generation requires Git unless `--skip-git` is selected.
- Laravel requires PHP and Composer; Node.js/npm remain recommended for
  frontend asset workflows.

The official generator remains the authority for exact framework/runtime
compatibility because its stable requirements can change independently of a
Workspai release. The selected policy is persisted as `latest-stable` in
project metadata and create evidence.

Other ecosystems are planned official handoffs but are not automated yet:

- WordPress site: `wp core download`, `wp config create`, `wp db create`, `wp core install`
- WordPress block/plugin: `npx @wordpress/create-block@latest <slug>`
- Symfony: `composer create-project symfony/skeleton <name>`
- Rails: `rails new <name>`

The remaining entries are `official` candidates, not active native kits. Until each planned
post-create contract is implemented end to end, Workspai should guide users to
create externally and then adopt/import the project.

## Adopt only

If a project already exists, or if the requested runtime has no Workspai-owned
create contract, the correct lane is `existing`.

The runtime names in the create planner are detection signals, not an allowlist.
Adopt/import is intentionally open-ended for readable projects that can be
registered and modeled. A project does not need to be PHP, Ruby, Rust, Elixir,
Clojure, Scala, or Kotlin to enter Workspace Intelligence.

Adoption still gives the project Workspace Intelligence:

- framework and runtime detection
- workspace registry membership
- doctor and analyze evidence
- workspace model and context generation
- governance, Advisor, Studio, and agent grounding

## Product rule

Do not convert an unsupported or ambiguous stack request into a different native
kit. For example, a WordPress, Symfony, or Rails request must not
be translated into FastAPI, NestJS, Go, Java, .NET, or a frontend kit.

If executable create is unavailable, the planner should explain the supported
lane and guide the user to `existing` or a future `official` flow.

## CLI guard

`workspai create project <kit> <name>` must check the capability lane before
running any native kit, official generator, or Core engine handoff.

If the request resolves to an available `official` generator, the CLI may run
that ecosystem generator and then register the project in Workspace
Intelligence.

If the request resolves to a planned `official` handoff or an explicit
`existing` runtime signal, the CLI must stop early and explain:

- native create is not available yet for the requested stack
- whether the future lane is `official` or current `existing`
- which external generator commands are relevant, when known
- how to run `npx workspai adopt <project-path>` after the project exists

This keeps AI surfaces, CI, and developer terminals aligned: unsupported stacks
are never silently rewritten into unrelated native kits.
