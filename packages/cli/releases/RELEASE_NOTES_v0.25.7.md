# Release Notes — v0.25.7 (April 19, 2026)

## 🐹 Go Generator Template Consolidation (Patch)

### Summary

Patch release focused on internal maintainability of Go project generators. It extracts shared template logic used by both Go kits into a common module, pins bootstrap tool install targets for reproducibility, and simplifies generated `go.mod` output by removing oversized indirect dependency blocks.

---

### Changed

- Added shared Go generator module:
  - `src/generators/go-kit-common.ts`
- Extracted and centralized template builders used by both kits:
  - `buildGoMakefileTemplate(...)`
  - `buildGoLauncherShellTemplate(...)`
  - `buildGoLauncherCmdTemplate(...)`
- Updated both kit generators to consume shared helpers:
  - `src/generators/gofiber-standard.ts`
  - `src/generators/gogin-standard.ts`
- Centralized common defaults/utilities for Go scaffolding:
  - `DEFAULT_GO_VERSION`
  - `toPascalCase(...)`
  - `writeGeneratorFile(...)`

---

### Fixed

- Pinned generated Go tool install targets for stable and reproducible init/dev bootstrap:
  - `github.com/air-verse/air@v1.52.3`
  - `github.com/swaggo/swag/cmd/swag@v1.16.3`
- Simplified generated `go.mod` templates by retaining direct requirements and dropping large static indirect blocks.

---

### Compatibility

- No CLI breaking changes.
- No kit name or command contract changes.
- Existing generated projects continue to work unchanged.

---

### Validation

- Go generator unit suites pass:
  - `src/__tests__/generators/gofiber-standard.test.ts`
  - `src/__tests__/generators/gogin-standard.test.ts`

---

### Upgrade

```bash
npm install -g rapidkit@0.25.7
```

### Links

- 📦 [npm](https://www.npmjs.com/package/rapidkit)
- 🐙 [GitHub](https://github.com/chistiq/rapidkit)
- 🌐 [Workspai](https://www.workspai.com/)
