# Workspai Runtime Support Matrix

Last updated: 2026-07-18

This document defines the public support contract for Workspai workspace projects.
It separates three concerns:

- **First-class**: curated kit/framework with scaffold/import/govern/lifecycle support. Core module mutation additionally requires metadata for a module-enabled kit.
- **Extended**: scaffold/import/govern/lifecycle or import/govern workflows are supported, but Core module mutation is disabled unless explicitly added later.
- **Observed**: import/govern/contract visibility is supported; lifecycle commands may require manual project scripts or future adapters.

## Runtime Tiers

| Runtime             | Tier        | Scaffold | Import | Lifecycle Commands                                | Module Commands | Doctor    |
| ------------------- | ----------- | -------: | -----: | ------------------------------------------------- | --------------: | --------- |
| Python              | first-class |      yes |    yes | init, dev, start, build, test, lint, format, help | kit-dependent | full      |
| Node.js             | extended    |      yes |    yes | init, dev, start, build, test, lint, format, help | kit-dependent | full      |
| Go                  | extended    |      yes |    yes | init, dev, start, build, test, lint, format, help |              no | readiness |
| Java / Spring Boot  | extended    |      yes |    yes | init, dev, start, build, test, lint, format, help |              no | readiness |
| .NET / ASP.NET Core | extended    |      yes |    yes | init, dev, start, build, test, lint, format, help |              no | readiness |
| PHP                 | extended    |      yes |    yes | init, dev, start, build, test, lint, format, help |              no | readiness |
| Ruby                | observed    |       no |    yes | help                                              |              no | observed  |
| Rust                | extended    |      yes |    yes | init, dev, start, build, test, lint, format, help |              no | readiness |
| Elixir              | observed    |       no |    yes | help                                              |              no | observed  |
| Clojure             | observed    |       no |    yes | help                                              |              no | observed  |
| Scala               | observed    |       no |    yes | help                                              |              no | observed  |
| Kotlin              | observed    |       no |    yes | help                                              |              no | observed  |
| Deno                | observed    |       no |    yes | help                                              |              no | observed  |
| Bun                 | observed    |       no |    yes | help                                              |              no | observed  |
| Unknown             | observed    |       no |    yes | help                                              |              no | observed  |

## Framework Tiers

> **Runtime vs framework:** Python remains a first-class runtime and Node.js is
> extended. Core module mutation is guaranteed only when project metadata names
> a module-enabled kit: `fastapi.standard`, `fastapi.ddd`, or
> `nestjs.standard`. Arbitrary FastAPI, NestJS, Python, Node.js, and frontend
> projects remain governable without gaining module mutation.

| Tier        | Frameworks                                                                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| first-class | FastAPI, NestJS                                                                                                                                                                                                                     |
| extended    | Go/Fiber, Go/Gin, Spring Boot, ASP.NET Core, Django, Flask, Express, Fastify, Koa, Echo, Laravel, Symfony, Rails, Sinatra, Actix, Axum, Rocket, Phoenix, Next.js, Remix, React, Vue, Svelte, Solid, Nuxt, Angular, Astro, SvelteKit, Tauri, Electron, VS Code Extension |
| observed    | Python, Node.js, Go, Java, PHP, Ruby, Rust, Elixir, Unknown/generic projects                                                                                                                                                        |

## Import Policy

Imported projects are **observed and governed by default**:

- Workspai writes `.workspai/project.json` so workspace contract, graph, doctor, and sharing flows can discover the project.
- Workspai writes canonical project metadata to `.workspai/project.json` and reads legacy `.rapidkit/project.json` as fallback for older projects.
- Workspai writes `.workspai/import.json` and `.workspai/import-readiness.json` for auditability while preserving existing Python Core or legacy `.rapidkit` project state.
- Secrets and dependency/build caches are not copied during local-folder import.
- `module_support` defaults to `false` for imported projects unless existing RapidKit metadata explicitly opts in.

This keeps imports safe for arbitrary repositories while still enabling workspace-level visibility and lifecycle support where adapters exist.

## Executable Acceptance Gate

The runtime support contract is validated by
[RUNTIME_ACCEPTANCE_MATRIX.md](RUNTIME_ACCEPTANCE_MATRIX.md).

Run the default, network-safe gate locally before release:

```bash
npm run test:runtime-matrix
```

Run the full lifecycle gate on a prepared machine with Go, Java, .NET, Python,
and Node installed:

```bash
npm run test:runtime-matrix:full
```

This gate is not wired into regular GitHub Actions yet because it creates real
workspaces and projects across multiple runtimes. Keep it manual/local until a
dedicated scheduled or manually dispatched workflow has runtime caches and cost
controls.
