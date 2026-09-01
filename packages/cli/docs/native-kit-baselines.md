# Native Kit Baselines

Workspai owns the generated source, build, container, and CI contract for these
native kits:

- `gofiber.standard`
- `gogin.standard`
- `springboot.standard`
- `dotnet.webapi.clean`
- `rust.axum`

This policy does not cover FastAPI or NestJS kits owned by the RapidKit Python
engine. It also does not cover generators delegated to an upstream official
CLI, such as Next.js, Astro, Angular, Vue, Svelte, Nuxt, or React Native.

## Current tested baseline

Reviewed: August 31, 2026

| Kit          | Runtime baseline          | Framework baseline                  | Compatibility policy                                                                  |
| ------------ | ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| Go/Fiber     | Go 1.26                   | Fiber 2.52.15                       | Stay on the maintained v2 line until a separately qualified v3 migration is complete. |
| Go/Gin       | Go 1.26                   | Gin 1.12.0                          | Generate and test against the same supported Go baseline.                             |
| Spring Boot  | Java 21                   | Spring Boot 3.5.16, springdoc 2.9.0 | Build on Java 21 and verify the generated project on Java 21 and 25.                  |
| .NET Web API | .NET 10 LTS               | ASP.NET Core 10.0.11                | Use `net10.0` consistently across source, tests, containers, and CI.                  |
| Rust/Axum    | Rust 1.98.0, edition 2024 | Axum 0.8.9                          | Pin the toolchain so local, CI, and container builds use one compiler contract.       |

The executable source of truth is
[`native-kit-baselines.ts`](../src/generators/native-kit-baselines.ts). A
baseline review changes that file and the affected generator tests together so
templates cannot silently drift apart.

## Enterprise generation contract

Every owned native kit must generate:

- deterministic runtime and framework versions rather than `latest`;
- health/readiness endpoints and runtime smoke tests;
- a multi-stage container with a non-root runtime user;
- CI with explicit read-only permissions and pinned action major versions;
- formatting, linting, build, and test gates appropriate to the ecosystem;
- automated dependency and GitHub Actions update discovery through Dependabot;
- portable Workspai metadata and lifecycle launchers.

The Spring kit additionally emits an OWASP dependency scan and CycloneDX SBOM.
The .NET kit uses the SDK's transitive vulnerability audit. Go and Rust security
scanner adoption remains gated on selecting and qualifying a pinned scanner
contract; a floating install is not an acceptable substitute.

## Upgrade rules

1. Prefer a supported, mature runtime line over a release published only days
   before the Workspai release.
2. Treat framework major upgrades as migrations, not version bumps. They need
   generated-source compatibility, runtime smoke, Docker, and cross-platform CI
   evidence.
3. Keep runtime, package, container, CI, documentation, and warning text on the
   same baseline.
4. Never use floating tool versions in generated CI.
5. Run generator golden tests without host runtimes, then qualify generated
   projects with their real runtime before promoting a preview kit to stable.
6. Review baselines for every Workspai minor release and immediately after a
   relevant security or end-of-support announcement.

## Validation

The local generator contract is network-free:

```bash
npm --workspace workspai run typecheck
npm --workspace workspai run test:no-build -- \
  src/__tests__/generators/gofiber-standard.test.ts \
  src/__tests__/generators/gogin-standard.test.ts \
  src/__tests__/generators/springboot-standard.test.ts \
  src/__tests__/generators/dotnet-webapi-clean.test.ts \
  src/__tests__/project-taxonomy-and-new-kits.test.ts
```

Release qualification must also generate every owned kit in an isolated
workspace and run its native restore, format/lint, build, test, and container
checks on supported CI hosts. A machine without Go, .NET, or Rust can validate
the scaffold contract, but it cannot provide runtime qualification evidence.
