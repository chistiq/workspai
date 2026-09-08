<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Script-free installation and typed CLI resolution",
  "summary": "Workspai 0.72.1 removes consumer install hooks for clean npm 11 installation and moves Windows PATH precedence into typed Doctor evidence.",
  "highlights": [
    {
      "icon": "📦",
      "text": "Global installation no longer requests allowScripts authorization for Workspai-owned lifecycle hooks"
    },
    {
      "icon": "🩺",
      "text": "Doctor reports canonical, shadowed, unresolved, and unverifiable Windows CLI resolution states"
    },
    {
      "icon": "🧾",
      "text": "CLI resolution is preserved in JSON evidence, receipts, score accounting, and drift history"
    },
    {
      "icon": "🪟",
      "text": "Windows recovery identifies the active target, ordered candidates, npm prefix, and bounded npx fallback"
    },
    {
      "icon": "✅",
      "text": "Enterprise package gates prevent consumer lifecycle hooks from returning"
    }
  ]
}
-->

# Workspai CLI v0.72.1

Released September 1, 2026.

**Publication status:** Published.

## Script-Free Installation and Typed CLI Resolution

Workspai 0.72.1 makes the normal global installation path compatible with npm
11's secure install-script defaults. The CLI package no longer publishes a
Windows-only `postinstall` diagnostic or a redundant package-level Husky
`prepare` hook. Repository Git hooks remain owned by the monorepo root; they are
not consumer installation behavior.

The useful part of the removed hook has not been discarded. Windows command
resolution is now a first-class Doctor check with structured evidence. Doctor
can explain which `workspai` executable PATH selects, whether the npm global
shim has precedence, and which bounded command remains safe while the host PATH
is being corrected.

## Clean npm installation

- The published `workspai` package has no `preinstall`, `install`,
  `postinstall`, or `prepare` lifecycle script.
- npm 11 does not require `--allow-scripts=workspai` for a normal global
  installation.
- The old install-only CLI resolution helper is no longer part of the tarball.
- The package smoke gate rejects consumer lifecycle scripts and removed helper
  files before publication.
- Root-level contributor Git hooks remain independent from the package users
  install from npm.

## Typed Windows PATH evidence

Doctor reports one of five explicit resolution states:

- `canonical`: the npm global shim is the active PATH match;
- `shadowed`: another executable precedes the npm shim;
- `unresolved`: Windows cannot resolve `workspai` from PATH;
- `unverified`: PATH inspection failed or the npm global prefix is unknown;
- `not-applicable`: the host is not Windows.

The machine-readable projection can include the active path, npm global prefix,
ordered candidates, and a recovery recommendation. A shadowed or unverifiable
command remains an advisory rather than pretending that installation failed.
The bounded fallback is `npx --yes workspai <command>`; Doctor never mutates the
user's PATH. A failed `where.exe` or npm-prefix subprocess probe becomes
unverified evidence and never aborts the rest of Doctor.

## Doctor integration

- System, workspace, and project Doctor modes consume the same resolution
  probe.
- The result participates in health accounting and score breakdowns.
- Workspace and project evidence, receipts, and drift comparison retain the
  same status instead of reconstructing it downstream.
- Human output hides the non-Windows not-applicable row unless verbose output
  is requested.
- Workspace Doctor JSON now emits the Go system check consistently with the
  persisted evidence document.

## Compatibility

- Existing version-one Model, Graph, Goal, Decisions, PCC, Live, MCP, Repair,
  Doctor, and agent contracts remain supported.
- The `system.cliResolution` Doctor field is additive.
- No public command, flag, schema version, or artifact path is removed.
- npm 10 remains supported; npm 11 gains a warning-free default installation.

## Validation

- The packed `workspai@0.72.1` tarball installed into an isolated npm 11 global
  prefix without an `install-scripts` or `allowScripts` warning.
- The installed binary reported `0.72.1` and emitted typed Doctor system JSON.
- Doctor, package, contract, documentation, alias, and enterprise publication
  gates passed.

## Install

```bash
npm install -g workspai@0.72.1
workspai --version
```

The optional `wspai` alias is released at the matching `0.72.1` version.
