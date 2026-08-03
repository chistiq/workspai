<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Guarded Dependency Resolution",
  "summary": "Workspai now rejects false downgrade fixes while preserving structured, verifiable resolution paths for direct and transitive vulnerabilities across supported ecosystems.",
  "highlights": [
    {
      "icon": "🛡️",
      "text": "Downgrades and already-installed versions are no longer presented as fixes"
    },
    {
      "icon": "🧹",
      "text": "Direct and transitive findings retain bounded owner, constraint, and replacement paths"
    },
    {
      "icon": "🔒",
      "text": "Every candidate remains guarded until reconcile, audit, test, and build succeed"
    },
    {
      "icon": "🔄",
      "text": "Non-Node ecosystems receive the same structured resolution contract without npm assumptions"
    }
  ]
}
-->

# Workspai CLI v0.52.2

Released August 2, 2026.

## Guarded Dependency Resolution

Workspai 0.52.2 closes a dependency-repair edge case that could make Studio
appear to have an actionable npm fix when the candidate was actually an older
version—or the same version already installed. Those paths cannot clear the
blocker safely, so retrying them only wastes repair cycles and user attention.

Doctor now compares exact npm candidate versions with installed lockfile state.
When a direct automatic fix is invalid or unavailable, it preserves a bounded
resolution hypothesis instead of concluding that no compatible path exists.

## Invalid downgrade paths stop before Studio

Some npm audit trees repeat one proposed resolution under both a direct
dependency and one of its transitive advisories. They can also describe that
resolution as a major change even when the proposed version is lower than the
installed version.

Workspai now normalizes this evidence before it reaches other consumers:

- downgrade-only and already-installed candidates are rejected;
- equivalent package/version candidates are merged;
- conflicting records retain the safer, more conservative risk;
- the remaining candidates are sorted deterministically;
- the final disposition is recalculated from the normalized set.

If no forward direct candidate remains, Doctor records the affected package,
its direct or transitive relationship, owning packages, advisory identity,
vulnerable range, derived safe constraint when provable, and allowed resolution
strategies. None of these hypotheses is marked auto-executable.

The same contract is emitted for supported Python, Go, Rust, PHP, Ruby, .NET,
JVM, Elixir, Deno, Bun, and native-project audit evidence when the scanner can
identify affected dependencies. Consumers can therefore continue through the
project's own manifest and lock/baseline instead of assuming every repair is an
npm operation.

## Portable and bounded behavior

Installed npm versions are read from lockfile v3 `packages` entries and legacy
lockfile dependency entries. A missing or unreadable lockfile does not invent
a version comparison; npm's original remediation metadata remains available
for the existing guarded classification path.

The normalization remains local, deterministic, and project-scoped. It does
not contact a second registry, mutate the dependency tree, or authorize a
breaking change. A candidate becomes a verified repair only after manifest and
lock reconciliation, focused audit, declared tests, declared build, and the
canonical Workspace Intelligence verification loop agree.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.52.2`.
- Existing workspaces and Doctor evidence remain readable.
- Compatible automatic repairs keep their existing behavior.
- Breaking, downgrade-only, and unavailable paths remain reviewable rather
  than being applied automatically.

## Verification

- Dependency-audit tests cover downgrade-only and already-installed
  candidates, duplicate direct/transitive records, owner relationships, safe
  range derivation, non-Node resolution evidence, and conservative risk.
- Existing compatible, mixed, breaking-only, unavailable, legacy lockfile,
  and clean-audit cases remain covered.
- Version alignment, release-document validation, TypeScript, and formatting
  checks passed.

## Upgrade

```bash
npm install -g workspai@0.52.2
workspai --version
workspai workspace sync --json
workspai doctor workspace --plan --json
```

Optional short alias:

```bash
npm install -g wspai@0.52.2
wspai --version
```
