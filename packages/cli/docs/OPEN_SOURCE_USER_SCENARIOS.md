# Workspai Practical User Scenarios (Open Source Edition)

This guide shows complete, copyable ways to use Workspai on real projects:
connect existing code, create new applications, prepare AI context, check
changes, and use the same results in CI.

Command syntax: [commands-reference.md](./commands-reference.md). Import and
adopt behavior: [workspace-operations.md](./workspace-operations.md). All
scenarios use the same
[Workspace Intelligence runner](./workspace-intelligence-runner.md), so the
system map, checks, and saved reports stay consistent.

## Scenario 0 — Existing project (adopt or import)

Goal: connect code you already have without reshuffling repositories.

### Adopt in place (keep source where it is)

```bash
npx workspai adopt /path/to/existing-app --workspace /path/to/workspace --json
cd /path/to/workspace
npx workspai workspace intelligence run --for-agent generic --strict --json
cd /path/to/existing-app
npx workspai doctor project --json
```

Works for Next.js, Vite, NestJS, FastAPI, Go, Spring Boot, and other detected stacks. See [workspace-operations.md#import-and-adoption](./workspace-operations.md#import-and-adoption).

### Import (copy or clone into workspace)

```bash
npx workspai import ../orders-api --workspace ./platform
npx workspai import https://github.com/acme/orders-api.git --git --workspace ./platform
```

### New frontend in workspace

```bash
cd my-workspace
npx workspai create project nextjs marketing-web --yes
```

Success check: `workspace registry status --json` lists each project once and
the unified runner writes
`.workspai/reports/workspace-intelligence-run-last-run.json`.

## What changed from the old flow?

Old flow (typical):

- Create workspace/project
- Run `init` / `dev`
- Minimal governance and supply-chain controls

Current flow (new baseline):

- Same developer-friendly start
- Plus optional mirror/offline controls, checksum/attestation verification, Sigstore governance, and auditable reports
- Works for both small teams and enterprise adoption paths

## Scenario 1 — Junior Developer

Goal: get productive quickly with minimal complexity.

### Steps

```bash
npx workspai create workspace my-workspace --here --yes --profile polyglot
cd my-workspace
npx workspai bootstrap --profile polyglot
npx workspai setup python
npx workspai setup node --warm-deps
npx workspai create project fastapi.standard api --output .
cd api
npx workspai init
npx workspai dev
```

Run the canonical chain from the workspace before treating its evidence as a
release or agent input:

```bash
cd ..
npx workspai workspace intelligence run --for-agent generic --strict --json
```

The canonical durable outputs are `.workspai/reports/workspace-model.json`,
`.workspai/reports/workspace-knowledge-graph.json`,
`.workspai/reports/workspace-context-agent.json`, `.workspai/reports/INDEX.json`,
`.workspai/reports/workspace-intelligence-run-last-run.json`, and `AGENTS.md`.
Use `npx workspai pipeline --json --strict` separately as the broader governance
and release gate.

The model is the canonical workspace boundary. The Knowledge Graph is generated
from that model-owned inventory, structurally hash-bound to it, and enriched
with provider facts and proofs. Consumers must not treat the graph as a second
source of truth.

Success check: the application starts locally, project Doctor reports the
expected runtime, and the unified run report contains all 11 ordered stages.

### When manual vs automatic?

- Manual: run commands directly in local dev.
- Automatic: not required at this level.

## Scenario 2 — Mid-level Developer / Team

Goal: improve stability and repeatability using mirror artifacts.

### Steps

1. Define minimal mirror config (`.workspai/mirror-config.json`) with artifact sources and checksums.
2. Run:

```bash
cd my-workspace
npx workspai doctor workspace
npx workspai workspace list
npx workspai mirror status
npx workspai cache status
npx workspai mirror sync
npx workspai mirror verify
npx workspai init
npx workspai dev
```

Success check: `mirror verify` succeeds and its latest report exists under
`.workspai/reports/` before build or test begins.

### When manual vs automatic?

- Manual: initial mirror setup and local validation.
- Automatic: in CI pipelines, run `mirror sync/verify` before build/test.

## Scenario 3 — Senior Developer / Platform Engineer

Goal: enforce stronger security controls (attestation + Sigstore governance) in stage/prod-like environments.

### Steps

1. Configure `mirror-config.json` with:

- `security.requireAttestation: true`
- `security.requireSigstore: true`
- `security.requireTransparencyLog: true`
- environment policy allowlists (`identity`, `issuer`, `rekorUrl`)

2. Run:

```bash
RAPIDKIT_ENV=stage npx workspai mirror sync --json
RAPIDKIT_ENV=stage npx workspai mirror verify --json
npx workspai bootstrap --profile=enterprise --ci --offline --json
```

Success check: the bootstrap compliance report records the enterprise profile,
offline mode, checksum/attestation decisions, and a machine-readable exit.

### When manual vs automatic?

- Manual: initial policy authoring and first dry run.
- Automatic: fully automated in CI/CD after policy is validated.

## Scenario 4 — Enterprise Operator / SecOps

Goal: enforce signed governance policy bundle, generate and export audit evidence.

### Steps

1. Add signed governance bundle:

- `.workspai/governance-policy.json`
- `.workspai/governance-policy.sig`
- `.workspai/governance-public.pem`

2. Configure in `mirror-config.json`:

- `security.requireSignedGovernance: true`
- `security.governanceBundle: { ... }`
- `security.evidenceExport: { target: "file" | "http", ... }`

3. Run:

```bash
RAPIDKIT_ENV=prod npx workspai mirror sync --json
RAPIDKIT_ENV=prod npx workspai mirror verify --json
RAPIDKIT_ENV=prod npx workspai bootstrap --profile=enterprise --ci --offline --json
```

Success check: signed-policy verification passes and the configured evidence
sink receives the same governed run identity as the local report.

### When manual vs automatic?

- Manual: key management, policy signing, endpoint provisioning.
- Automatic: all command execution in CI/CD and release pipelines.

## Scenario 5 — AI agent or IDE consumer

Goal: answer a workspace question with bounded, traceable evidence instead of
loading every source file or the complete graph into a model prompt.

### Steps

```bash
cd my-workspace
npx workspai workspace intelligence run --for-agent generic --strict --json
npx workspai workspace graph search "authentication endpoint" --limit 12 --json
npx workspai workspace graph benchmark "authentication endpoint" --limit 12 --json
npx workspai workspace mcp serve
```

The runner creates and validates the model, knowledge graph, context, and agent
surfaces. CLI consumers should start with `AGENTS.md` and
`.workspai/reports/INDEX.json`, then call `workspace graph search` for a bounded
result. MCP consumers should call `searchWorkspaceGraph`, follow returned proof
references, and request the full graph only when the bounded evidence is not
enough.

The benchmark compares readable proof-source payload with the bounded retrieval
payload. Its token value is an estimate, not a universal model-cost or
answer-quality claim; see [Graph Benchmark Methodology](./graph-benchmark-methodology.md).

### You are done when

- the unified runner returns exit `0` for a release-ready workspace, or exit `2`
  with explicit remediation evidence rather than an execution failure;
- every search result identifies evidence or a proof path;
- the consumer can answer the question without injecting the complete model or
  graph by default.

## Operational outputs (for automation and auditing)

Generated reports:

- `.workspai/reports/bootstrap-compliance.latest.json`
- `.workspai/reports/mirror-ops.latest.json`
- `.workspai/reports/transparency-evidence.latest.json`

Optional exported evidence sinks:

- file sink (NDJSON/JSON append strategy)
- HTTP webhook sink (SIEM/GRC intake)

## Practical recommendation

- Individuals/small teams: start with Scenario 0 → 1 → 2.
- Product teams/platform teams: adopt Scenario 3.
- Regulated/high-compliance environments: run Scenario 4 by default.
- AI/IDE integrations: add Scenario 5 after the workspace is registered.

## See also

- [Documentation index](./README.md)
- [workspace-operations.md](./workspace-operations.md)
- [doctor-command.md](./doctor-command.md)
- [ci-workflows.md](./ci-workflows.md) (`pipeline --json --strict`)
- [workspace-knowledge-graph.md](./workspace-knowledge-graph.md)
- [GLOSSARY.md](./GLOSSARY.md)
