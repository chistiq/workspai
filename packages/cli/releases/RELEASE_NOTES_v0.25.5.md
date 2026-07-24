# Release Notes — v0.25.5 (April 18, 2026)

## 🪟 Windows Doctor Shadow Detection (Patch)

### Summary

Prevents a Windows-specific edge case where a workspace-local `rapidkit.cmd` or `rapidkit.exe` launcher shadows the global CLI binary during `rapidkit doctor --workspace`, causing the wrong executable to run and producing confusing or incorrect doctor results.

---

### Added

- **`detectWindowsDoctorWorkspaceShadow()`** (`src/index.ts`)
  New exported async function that checks for workspace-local RapidKit launchers on Windows when running in workspace-scoped doctor mode.
  - Only runs on Windows (`process.platform === 'win32'`)
  - Only triggers for `--workspace` / `--scope workspace` invocations
  - Scans local script candidates via `getRapidkitLocalScriptCandidates()`
  - Returns a `DoctorWorkspaceShadowDiagnostic` with `detected`, optional `candidatePath`, and `reason`

- **`DoctorWorkspaceShadowDiagnostic` interface** — typed return shape for the diagnostic

- **Warning output in `doctor` command** — when shadow is detected and `--json` is not active, prints:
  ```
  ⚠️  Windows launcher shadow detected for doctor workspace checks.
     Candidate: <path>
     Running npm-wrapper doctor workflow directly as safe fallback...
  ```

- **New tests** in `src/__tests__/phase3-commands.test.ts` covering detection logic across platforms and workspace/project scope combinations

---

### Links

- 📦 [npm](https://www.npmjs.com/package/rapidkit)
- 🐙 [GitHub](https://github.com/chistiq/rapidkit)
- 🌐 [Workspai](https://www.workspai.com/)
