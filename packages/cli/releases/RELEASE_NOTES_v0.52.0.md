<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Verified Engineering Goals and Transaction-Safe Repair",
  "summary": "Workspai can now turn release, dependency-security, and coverage requests into durable success contracts, while dependency repairs remain open until lockfiles, audits, tests, builds, and canonical verification agree.",
  "highlights": [
    {
      "icon": "🎯",
      "text": "Durable release, dependency-security, and coverage goals"
    },
    {
      "icon": "🔐",
      "text": "Transaction-safe dependency repair with explicit completion stages"
    },
    {
      "icon": "🧭",
      "text": "Goal-aware agent handoff backed by canonical workspace evidence"
    },
    {
      "icon": "📣",
      "text": "Contract-validated release announcements generated from one source"
    }
  ]
}
-->

# Workspai CLI v0.52.0

Released July 31, 2026.

## Verified Engineering Goals and Transaction-Safe Repair

Workspai 0.52.0 turns an engineering request into a durable definition of
done. A user or agent can ask for release readiness, zero blocking dependency
vulnerabilities, or a coverage target; Workspai records the scope, constraints,
baseline, required checks, and current evidence, then verifies the outcome
against the canonical workspace rather than trusting a final message.

This release also closes a critical repair gap. Editing a dependency manifest
is no longer enough to call a security repair complete. Dependency remediation
now carries an explicit transaction that must reconcile the manifest and
lockfile, rerun the audit, pass declared tests and builds, and finish with
canonical Workspace Intelligence verification.

## Turn intent into a verifiable goal

The new `workspace goal` surface supports three first-class outcomes:

- `release-readiness` verifies readiness and workspace gates;
- `dependency-security` requires fresh audit evidence with no blocking
  vulnerabilities;
- `test-coverage` verifies a requested project or workspace coverage target.

Examples:

```bash
workspai workspace goal plan release-readiness --json
workspai workspace goal plan dependency-security --scope project:api --json
workspai workspace goal plan test-coverage --scope project:web --target 75 --json
workspai workspace goal verify <goal-id> --json
```

Each goal is stored under `.workspai/goals/<goal-id>/`. Its latest governed
status is also published at
`.workspai/reports/verified-goal-last-run.json`, so CLI, CI, IDE, and agent
consumers can resume the same objective without inventing a second state model.

Goals record whether breaking changes or forced repairs are allowed. Builds
and tests remain required by default. Dependency-security goals also capture a
bounded, multi-ecosystem manifest and lockfile baseline so verification can
detect unapproved major changes, missing lockfiles, and changes outside the
authorized project boundary.

## Dependency repair is now a complete transaction

Doctor and remediation plans can now attach the public
`workspai.doctor-dependency-repair-transaction.v1` contract to a project-level
security finding. The required closure sequence is:

```text
reconcile manifest + lockfile
        → focused audit
        → declared tests
        → declared build
        → canonical Workspace Intelligence verification
```

This makes the boundary explicit for Studio and other consumers:

- a `package.json` or equivalent manifest edit is progress, not completion;
- verification waits until the installed dependency tree and lockfile agree;
- audit, test, and build evidence belong to the affected project;
- the final workspace gate still decides whether dependent blockers remain.

Remediation plans preserve this transaction with the finding instead of
reducing it to a generic refresh command. Agent handoffs can therefore carry
the goal and the required repair stages while leaving high-risk dependency
choices visible for review.

## One registry for governed evidence

Verified-goal paths and schema identities are registered in the same canonical
Workspace Intelligence artifact registry as Model, Graph, Doctor, Verify,
Context, and Explain. Runtime, published-contract, extension-compatibility,
and command-surface contracts expose the same capability.

This release also strengthens source-of-truth guards so a producer cannot
silently introduce a second report path or schema literal outside that
registry. The generated status artifact is part of the governed artifact set
and remains available to downstream consumers through the report index.

## Release communication from the release artifact

Versioned release notes can now carry validated announcement metadata. A
shared release-document parser drives both GitHub release-note validation and
the new Discord announcement workflow, preventing hand-written summaries from
drifting away from the published version.

The workflow validates the product, tag, notes file, headline, highlights,
upgrade command, Discord limits, and release URL before it can send or update
an announcement. Mention parsing is disabled by default.

## Compatibility

There are no intentional breaking changes in this release.

- `workspai` remains the canonical package and command.
- `wspai` remains the optional short alias and is aligned to `0.52.0`.
- Existing workspaces, reports, and durable repair tokens remain readable.
- Python remains optional outside Python/Core-dependent workflows.
- The full official-generator matrix remains independent from the primary
  publish gate; release publishing continues to require the focused primary
  generator smoke contract.

## Verification

- Full CLI suite: 2,248 tests passed across 209 test files; 8 tests remain
  explicitly skipped.
- Verified-goal suites cover workspace and project scope, all three goal kinds,
  dependency baselines, safety constraints, resume/status behavior, and
  governed status artifacts.
- Doctor and remediation suites cover project-aware dependency transactions,
  ordered closure stages, artifact handoff, and canonical final verification.
- Workspace Intelligence runtime conformance passed 11 stages with 16 governed
  artifacts; all 12 adversarial groups passed.
- TypeScript, ESLint, format, documentation, generated and mirrored contracts,
  package size, alias smoke, and cross-repository CLI/extension parity passed.
- `npm audit --audit-level=moderate` reported zero vulnerabilities.

## Upgrade

```bash
npm install -g workspai@0.52.0
workspai --version
workspai workspace sync --json
workspai workspace intelligence run --for-agent generic --strict --json
```

Optional short alias:

```bash
npm install -g wspai@0.52.0
wspai --version
```
