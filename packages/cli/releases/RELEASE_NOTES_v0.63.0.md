<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Causal repair queues and real-world Doctor hardening",
  "summary": "Workspai 0.63.0 keeps aggregate workspace repairs causally bounded and makes Doctor faster and more accurate across real polyglot repositories.",
  "highlights": [
    {
      "icon": "🎯",
      "text": "Each repair transaction owns one causal finding family and one canonical project"
    },
    {
      "icon": "🔗",
      "text": "Registered linked projects use portable external references without leaking machine-local roots"
    },
    {
      "icon": "🩺",
      "text": "Doctor distinguishes applicable checks, unsupported evidence, and unavailable tooling"
    },
    {
      "icon": "⚡",
      "text": "Composite and root-manifest detection avoids expensive and misleading nested lifecycle scans"
    }
  ]
}
-->

# Workspai CLI v0.63.0

Released August 21, 2026.

## Causal Repair Queues and Real-World Doctor Hardening

Workspai 0.63.0 strengthens the boundary between an aggregate incident shown to
a human and the exact mutation transaction executed by the CLI. A Doctor,
readiness, verify, analyze, or workspace-run card may summarize findings from
several projects. That card remains a presentation boundary. It no longer
implies that unrelated findings should be repaired in one transaction.

The governed loop is now:

```text
Aggregate card
  → Fresh remediation evidence
  → One blocking causal finding family
  → One canonical project boundary
  → Checkpoint and bounded mutation
  → Exact producer refresh and verification
  → Fresh evidence selects the next target
  → Aggregate Workspace Verify
```

Advisory and informational findings remain visible, but they do not silently
widen a blocking repair transaction.

## Sequential causal repair

The Studio repair capability contract now declares two additive invariants:

- `aggregateRepair: sequential-causal-queue`
- `transactionScope: one-causal-finding-family`

The Repair Engine groups actions by card, canonical project, finding identity,
and causal key. It selects one actionable blocking family at a time and rejects
plans that attempt to combine unrelated causes or projects. A bounded
cross-project closure is permitted only when declared dependency evidence makes
that closure explicit.

After the selected target verifies, Workspai regenerates evidence before
choosing the next target. This prevents a stale workspace-wide plan from
replaying commands against findings that were resolved, superseded, or changed
by the previous transaction.

## Governed linked-project repair

Projects adopted in linked mode can live outside the physical workspace root.
Durable remediation artifacts now represent them as:

```text
external/<project>
```

The runtime resolves that portable reference through the canonical workspace
contract and permits execution only inside the registered external boundary.
Checkpoint, patch, delete, reconciliation, validation, verification, and
rollback therefore use the same project identity without copying a local path
into portable artifacts.

Portable remediation output also:

- rejects file traversal outside the registered project;
- preserves one canonical external-project casing across actions and stages;
- filters proofs that do not belong to the selected project boundary;
- normalizes Workspai-owned `npx` invocations to `npx --no-install workspai`.

## More accurate Doctor evidence

Doctor now distinguishes observed intent from universally required project
surfaces:

- `.env.sample`, `.env.template`, `.env.public`, config directories, and
  environment documentation satisfy a configuration contract when applicable;
- host and shell variables such as `PATH`, `HOME`, and CI runner variables no
  longer create misleading dotenv repair proposals;
- Python tests can be established through pytest, unittest, tox, nox,
  configuration, or conventional test directories;
- Python command entrypoints declared through PEP 621 or Poetry scripts satisfy
  the runtime entrypoint probe;
- Bun projects can establish runtime-native test depth through Bun, Vitest,
  Jest, Playwright, and related test commands or configuration;
- migration and HTTP health checks become not-applicable when the project has
  no corresponding persistence or service intent.

Missing dependency-audit executables are reported as `tool-unavailable` even
when the process runner returns a non-throwing `ENOENT` result. Doctor never
turns unavailable, malformed, timed-out, or unsupported audit evidence into a
clean security claim.

## Composite repository boundaries

A repository root without its own runtime manifest may still contain many
independently operated nested projects. Doctor now reports that root as an
explicit composite boundary when it detects multiple nested runtime families.
It does not choose one nested runtime and incorrectly apply that runtime's
dependency lifecycle to the entire aggregate repository.

Repositories with a root-owned runtime manifest retain their primary adapter
and cross-runtime evidence without an unnecessary duplicate nested-runtime
scan.

## Real-world qualification

The release candidate was qualified against isolated workspaces containing:

- Cline: Bun, Node.js, and Rust;
- Deno: Rust, Node.js, Deno, Bun, and C;
- Scanners: an aggregate repository spanning nine runtime families;
- AssetOpsBench: Python, uv, pytest, FastMCP, and agent workflows;
- Visual Studio Code: Electron, Node.js, Rust, Python, C, and C++;
- a four-project Java, Python, NestJS, and Next.js workspace.

Observed qualification outcomes include:

- Deno Doctor completion in under two seconds after removing the redundant
  root-manifest nested scan;
- aggregate Scanners Doctor completion in under two seconds without the prior
  false .NET materialization blocker;
- Bun/Vitest evidence recognized as runtime-native testing;
- missing Bun and Cargo audit tools reported as unavailable, never clean;
- a Java dependency-baseline advisory no longer becoming a false blocking
  materialization finding;
- portable remediation plans containing no machine-local project root.

The complete CLI suite passed with 2,522 tests across 226 test files. Eight
tests and four files remain intentionally skipped by their platform or
environment contracts.

## Upgrade

```bash
npm install -g workspai@0.63.0
workspai --version
```

Expected output:

```text
0.63.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias will be published at the matching `0.63.0` version.
- Existing version-one Studio handoff and repair schemas remain valid.
- Existing workspace contracts, Goal Packs, agent entry artifacts, and
  authored customization remain valid.
- No public command is removed.

## Breaking changes

None. The repair capability fields are additive. The stricter transaction
selection changes unsafe aggregate behavior without invalidating existing
version-one artifacts.
