<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Runtime-truth repair and workspace-aware qualification",
  "summary": "Workspai 0.72.0 makes remediation eligibility provable, collapses polyglot lifecycle execution to real workspace ownership, and improves architecture retrieval in large framework monorepos.",
  "highlights": [
    {
      "icon": "🧰",
      "text": "Repair plans expose executable requirements, blocking reasons, retry boundaries, and one canonical next action"
    },
    {
      "icon": "🧭",
      "text": "npm, pnpm, and Cargo workspace owners prevent duplicate dependency initialization"
    },
    {
      "icon": "🔎",
      "text": "Scoped Graph retrieval prefers authored source while retaining explicit access to generated and fixture evidence"
    },
    {
      "icon": "🩺",
      "text": "Doctor distinguishes application checks from library, SDK, platform, plugin, and monorepo surfaces"
    },
    {
      "icon": "✅",
      "text": "Strict PCC verification reports an evidence-blocked process result when closure is incomplete"
    }
  ]
}
-->

# Workspai CLI v0.72.0

Released September 1, 2026.

**Publication status:** Published.

## Runtime-Truth Repair and Workspace-Aware Qualification

Workspai 0.72.0 closes an orchestration gap between what a remediation plan
proposes and what the current host can actually execute. Runtime availability
is now shared evidence across Doctor, Repair planning, CLI execution, Studio,
and agents. A plan can distinguish a safe action from a blocked prerequisite
before attempting the command, and it carries one canonical next action rather
than asking each consumer to reinterpret the failure.

The release also makes polyglot lifecycle planning follow authored workspace
ownership. Large framework repositories commonly contain hundreds of nested
manifests, fixtures, benchmark inputs, and workspace members. Discovery no
longer treats each of them as an independent install target. npm, pnpm, and
Cargo owners absorb matching members, explicit exclusions are honored, and
registered nested projects are not executed once through themselves and again
through an aggregate parent.

Finally, Model, Graph, and Doctor qualification now better distinguish a
framework repository from an application built with that framework. Private
workspace roots are not classified from tooling-only development dependencies,
Graph retrieval favors authored implementation evidence, and application-only
Doctor probes remain visible as not applicable where the project is a library,
SDK, platform, plugin, or monorepo.

## Repair eligibility is evidence

- Remediation actions expose typed requirements for their executable and
  governed working directory.
- The planner and executor use one launchability probe across supported runtime
  families instead of maintaining divergent allowlists.
- A missing host tool blocks downstream setup, bootstrap, and dependency
  materialization before execution.
- The execution projection records the blocking reason, retry boundary, and
  canonical next action for terminal, JSON, Studio, and agent consumers.
- An unchanged prerequisite cannot produce an unbounded same-generation
  replan/retry loop. Fresh environment evidence is required before retry.
- Portable project identities keep linked projects understandable without
  leaking machine-specific absolute paths into operator-facing guidance.

## Workspace-owned lifecycle execution

- npm `workspaces`, `pnpm-workspace.yaml`, and Cargo `[workspace]` declarations
  define dependency-materialization ownership.
- Matching packages and crates are initialized through the owner rather than
  receiving duplicate install or fetch commands.
- Explicit workspace exclusions remain exclusions.
- Embedded eval, benchmark, integration, test-data, fixture, and metadata-only
  packages do not become execution units without real lifecycle evidence.
- An explicitly registered nested project remains independently addressable,
  while its aggregate parent does not execute it a second time.
- `workspace run <stage> --plan --json` exposes the bounded units and commands
  before an operator authorizes execution.

## More trustworthy architecture evidence

- Private workspace roots no longer inherit an application framework solely
  from tooling in `devDependencies`. Production dependencies and explicit
  lifecycle scripts remain valid framework evidence.
- Workspai-managed linked project metadata is rederived when current canonical
  detection supersedes a stale kit label.
- Graph search prefers authored source over compiled, generated, vendored,
  fixture, and test-data matches unless the query explicitly requests those
  surfaces.
- Project scope constrains exact target resolution for evidence and paths, so a
  duplicate alias outside the selected project cannot create false ambiguity.
- Frontend application-only Doctor probes become explicit not-applicable
  evidence for libraries, SDKs, platforms, plugins, and monorepo roots.

## Proof-Carrying Change closure

`change verify --strict` now maps an independently blocked change to process
exit `2`, matching the documented evidence-blocked command contract. Human and
JSON output remain available; automation can fail closed without parsing
terminal text.

## Compatibility

- Existing version-one Model, Graph, Goal, Decisions, PCC, Live, MCP, Repair,
  and agent contracts remain supported.
- Remediation requirement, launchability, retry, and next-action fields are
  additive.
- No public command, flag, or artifact path is removed.
- Existing project and workspace metadata remains readable. A normal refresh
  rederives managed detection and lifecycle ownership where needed.

## Validation

- Focused Model, Graph, Doctor, Repair, lifecycle, workspace-run, and PCC tests
  pass across 224 assertions.
- CLI typecheck, build, lint, formatting, documentation language guard, and
  whitespace validation pass.
- A clean, isolated Node.js and Rust framework-monorepo qualification reduced
  152 discovered manifest-level dependency candidates to five real workspace
  owners.
- The same qualification produced a canonical Model and Graph, a scoped Doctor
  diagnosis, bounded analysis, Goal and PCC evidence, and an honest blocked
  capsule when host prerequisites and independent verification were absent.

## Install

```bash
npm install -g workspai@0.72.0
workspai --version
```

The optional `wspai` alias is released at the matching `0.72.0` version.
