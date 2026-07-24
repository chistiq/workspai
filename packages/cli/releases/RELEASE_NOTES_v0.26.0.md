# Release Notes — v0.26.0 (April 24, 2026)

## ☕ Spring Boot Generator, Java Runtime Adapter, and Release Hardening (Minor)

### Summary

Minor release that introduces first-class Java/Spring support to RapidKit. It adds a new Spring Boot generator, a dedicated Java runtime adapter, stronger Java version/workspace preflight behavior, broader Windows CI hardening, and major test/coverage gains across the CLI.

---

### Added

- Added new Spring Boot project scaffolding:
  - `src/generators/springboot-standard.ts`
- Added Java runtime adapter surface:
  - `src/runtime-adapters/java.ts`
- Added Spring generator regression coverage:
  - `src/__tests__/generators/springboot-standard.test.ts`
- Added platform capability regression suite:
  - `src/__tests__/platform-capabilities.test.ts`

---

### Changed

- `npm run analyze` now uses a native `dist/` analyzer for this Node CLI instead of a browser-oriented visualizer flow that expected Vite-style client inputs.
- Expanded automated coverage for Java/Spring and cross-platform runtime handling.
- Full suite validation at release time:
  - `986 passed | 11 skipped`

---

### Fixed

- Hardened Maven/Gradle wrapper execution on Unix:
  - Repairs missing execute bits before invocation.
  - Falls back to `sh <wrapper>` when permission repair cannot succeed.
- Enforced Java version preflight against `pom.xml` requirements:
  - Single-project Maven flows
  - Nested Java projects discovered from workspace roots
- Hardened generated Spring CI for Windows:
  - Wrapper bootstrap is OS-aware
  - No longer relies on brittle ambient bootstrap behavior in Windows runners
- Closed remaining platform-capability branch gaps:
  - `src/utils/platform-capabilities.ts` now has `100%` coverage for statements, branches, functions, and lines.

---

### Coverage Highlights

- `src/runtime-adapters/java.ts`
  - Statements: `85.66%`
  - Branches: `76.51%`
  - Functions: `93.33%`
  - Lines: `86.73%`
- `src/runtime-adapters` folder
  - Statements: `86.58%`
  - Branches: `76.86%`
  - Functions: `93.75%`
  - Lines: `88.42%`
- `src/utils/platform-capabilities.ts`
  - Statements: `100%`
  - Branches: `100%`
  - Functions: `100%`
  - Lines: `100%`

---

### Validation

- `npm run analyze`
- `npm run lint -- --max-warnings=0`
- `npm run test -- --coverage`
- End-to-end workspace validation completed successfully in the parent repo test harness.

---

### Compatibility

- Version remains `0.26.0`.
- No breaking CLI contract changes were introduced in this release note set.
- Existing non-Java generators remain available and continue to build through the same CLI entry points.

---

### Upgrade

```bash
npm install -g rapidkit@0.26.0
```

### Links

- 📦 [npm](https://www.npmjs.com/package/rapidkit)
- 🐙 [GitHub](https://github.com/chistiq/rapidkit)
- 🌐 [Workspai](https://www.workspai.com/)