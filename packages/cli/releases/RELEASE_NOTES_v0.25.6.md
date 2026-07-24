# Release Notes — v0.25.6 (April 19, 2026)

## 🔒⚡ Security Patch, Lazy Imports & Coverage (Patch)

### Summary

Patch release addressing a security advisory in devDependencies, reducing the cold-start bundle size by 51% through lazy imports, fixing an incorrect `fs-extra` import, and expanding test coverage for error branches in the workspace creation pipeline.

---

### Security

- **0 vulnerabilities** (was 10: 1 critical, 7 high, 2 moderate)
  - Resolved via `npm audit fix` — updated transitive devDependencies (`basic-ftp`, `rollup`, `flatted`, `minimatch`, `picomatch`, `vite`, `serialize-javascript`, `yaml`, `brace-expansion`)
  - No production dependency API changes

---

### Performance

- **`dist/index.js` 258 KB → 126 KB (-51%)**
  Five heavy modules are now loaded lazily at their first call site instead of being eagerly imported at startup:
  - `create.js` (workspace creation)
  - `demo-kit.js` (demo workspace scaffolding)
  - `gofiber-standard.js` (Go Fiber project templates)
  - `gogin-standard.js` (Go Gin project templates)
  - `doctor.js` (workspace doctor)

  This means running `rapidkit --version`, `rapidkit --help`, or any lightweight command no longer pays the cost of parsing all template and doctor code.

- **Startup time 366 ms → 317 ms** (measured on local machine; varies by environment)

---

### Fixed

- **`import fsExtra from 'fs-extra'`** — corrected from `import * as fsExtra` to a proper default import in `src/index.ts`. Using the namespace import bypassed `fs-extra`'s own re-exports and could surface subtle method-resolution issues at runtime.

---

### Tests

- **6 new unit tests** in `src/__tests__/register-workspace.test.ts` covering previously uncovered branches in `registerWorkspaceAtPath`:
  - `git init` failure → `spinner.warn` (non-fatal path)
  - `git commit` + `spinner.succeed('Git repository initialized')` (happy path with `skipGit: false`)
  - Poetry probe fails → venv fallback
  - `pipx` install method (else-branch)
  - Install throws → `spinner.fail` + rethrow
  - Registry import silent fail

- **1 new unit test** in `src/__tests__/create-internal.test.ts` covering the `git init` failure warning inside `createDemoWorkspace` (`demoMode: true`, `skipGit: false`)

---

### Technical Changes

- `src/index.ts`
  - `import fsExtra from 'fs-extra'` (was `import * as fsExtra`)
  - Static imports for `create`, `demo-kit`, `gofiber-standard`, `gogin-standard`, `doctor` replaced with inline `await import(...)` at each call site

- `src/__tests__/register-workspace.test.ts`
  - Expanded from 1 test to 7 tests

- `src/__tests__/create-internal.test.ts`
  - Added `describe('Demo workspace (demoMode: true)')` block with git-fail test

---

### Links

- 📦 [npm](https://www.npmjs.com/package/rapidkit)
- 🐙 [GitHub](https://github.com/chistiq/rapidkit)
- 🌐 [Workspai](https://www.workspai.com/)
