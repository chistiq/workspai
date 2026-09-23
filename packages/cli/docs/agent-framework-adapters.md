# Agent Framework Adapter Contract

Workspai treats an agent framework as an execution integration, not as the
source of repository truth. A project kit may scaffold a framework and an
existing project may attach the same framework, but both paths must use one
versioned adapter contract.

```text
new-project kit ----\
                     -> framework adapter -> framework runtime
existing project ---/            |
                                  -> Workspai Context, Goal, PCC, and Verify
```

Microsoft Agent Framework is the first adapter implementation of this
foundation. Its Python and .NET adapters are intentionally separate because
their package graphs, runtime requirements, entrypoints, and verification
commands differ. Both become available for governed attachment only after the
exact manifest and release baseline pass the required Linux, macOS, and Windows
conformance lanes and are bound into the reviewed release-admission inventory.
Per-platform semantic implementation digests accompany that evidence for
traceability, but do not act as runtime authorization locks.

OpenAI Agents SDK adapters for Python and TypeScript are implemented in the
same registry and lifecycle. They become Create/Attach kits only after their
complete cross-platform matrix is reviewed into that inventory. Public
commands fail closed rather than silently substituting Microsoft, OpenAI, or
another runtime.

OpenRouter Client SDK access belongs to the [AI Gateway](./model-gateways.md)
category. Do not add OpenRouter under Agent Frameworks, and do not use
`@openrouter/agent` to implement a gateway kit.

## Published contracts

| Contract                                                                       | Purpose                                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `contracts/agent-framework-capabilities.v1.json`                               | Normative ownership, capability, lifecycle, security, versioning, and admission rules    |
| `contracts/workspace-intelligence/agent-framework-adapter-manifest.v1.json`    | JSON Schema for one framework/version adapter declaration                                |
| `contracts/workspace-intelligence/agent-framework-conformance-report.v2.json`  | JSON Schema binding reproducible adapter evidence to manifest and implementation digests |
| `contracts/workspace-intelligence/agent-framework-change-plan.v1.json`         | Portable, mutation-free scaffold or attach plan returned to the host                     |
| `contracts/workspace-intelligence/agent-framework-ownership-receipt.v1.json`   | Hash-bound proof of the files Workspai may safely refresh                                |
| `contracts/workspace-intelligence/agent-framework-admission-candidate.v2.json` | Review-pending, digest-bound index of the complete cross-platform evidence matrix        |

The schemas are also discoverable through
`contracts/published-contract-catalog.v1.json` and the extension compatibility
contract.

The CLI runtime foundation loads only bounded JSON manifests from an authorized
root. It does not dynamically import adapter code during discovery. A manifest
that escapes through `..` or a symlink, exceeds the size limit, fails JSON
Schema validation, or violates semantic admission rules is rejected.

## Authority boundary

Workspai owns:

- canonical Workspace Model and Knowledge Graph evidence;
- bounded Context, Goal scope, and impact;
- mutation admission, Proof-Carrying Change state, and effect receipts;
- independent verification and canonical evidence sealing;
- ownership-safe managed writes.

The selected framework owns:

- agent and workflow execution;
- model invocation and framework-native tool dispatch;
- conversation, memory, checkpoint, and runtime state;
- channels, schedules, handoffs, and framework telemetry.

An adapter must not convert model or framework output into verified Workspai
evidence. Source mutation must cross the PCC or Repair approval boundary, and
verification remains owned by the CLI.

## Capability truth

Every manifest declares every capability. Values are explicit:

- `native`: supplied and owned by the framework;
- `adapter-provided`: supplied by a bounded adapter implementation;
- `conditional`: available only when declared prerequisites are satisfied;
- `unsupported`: not available and never implied by UI or documentation.

Framework identity, project runtime, and model provider are independent. A
Python or TypeScript project can select a framework and then select any model
provider admitted by that framework without changing Workspai truth.

Detection uses weighted, typed authored probes rather than framework names or
generated Workspai files. Supported probes are contained paths, bounded literal
file reads, and package declarations from npm, PyPI, or NuGet manifests.
Dependency discovery can scan only declared suffixes, within a declared maximum
depth and a fixed global entry budget. Generated markers can confirm an already
detected framework but can never select one. Multiple matching adapters are a
conflict, not a ranking guess.

## Microsoft Agent Framework baseline

The built-in implementation currently targets the upstream stable baselines
verified from the Microsoft source tree:

| Adapter                            | Tested framework | Runtime         | Authored detection                         |
| ---------------------------------- | ---------------- | --------------- | ------------------------------------------ |
| `microsoft-agent-framework-python` | `1.18.0`         | Python `>=3.10` | `agent-framework` PyPI package family      |
| `microsoft-agent-framework-dotnet` | `1.21.0`         | .NET `>=8.0`    | `Microsoft.Agents.AI` NuGet package family |

The first provider profile pins its integration independently: Python uses
`agent-framework-foundry` `1.13.0`, while .NET uses
`Microsoft.Agents.AI.Foundry` `1.21.0-preview.260911.1` over the stable
`Microsoft.Agents.AI` `1.21.0` core. Preview integration status is not
misrepresented as framework stability. The dedicated .NET test project pins
`Microsoft.NET.Test.Sdk` `18.10.0` and `xunit.v3.mtp-v2` `4.0.1`.

Each adapter implements detection, scaffold and attach planning, managed-file
rendering, project context, validation, and runtime resolution. It never
installs a dependency, invokes a model, executes generated code, or writes a
source file directly. The lifecycle host binds the target project and every
content digest into the PCC event chain, requires an explicit filesystem grant,
then atomically applies the unchanged plan and records effect evidence.

Generated starter files use an isolated `agents/<instance>` root and keep
adapter state under `.workspai/agent-frameworks/<adapter>/<instance>.json`.
That instance contains the only runtime dependency manifest; the project root
does not receive an empty Python or .NET manifest that could be mistaken for a
second executable unit. Python and .NET starters resolve bounded context from
the directory that owns `agents/<instance>/`. They do not use process cwd.
`workspace run start` executes from the agent package directory and still
finds `.workspai/reports/project-context-agent.json` at the project root.
Loaders share the OpenAI containment contract: canonical path walk, regular-file
open, 128 KiB cap, UTF-8 JSON, and `schemaVersion: project-context-agent.v1`.
The Python starter is pip-editable (`[build-system]` + setuptools modules) and
uses the official Foundry hello-world `Agent(client=FoundryChatClient(...))`
pattern with three read-only documented tools: `describe_workspai_context`,
`read_workspai_project_summary`, and `list_workspai_supported_commands`. The
.NET starter uses `AIProjectClient.AsAIAgent` plus `AIFunctionFactory.Create`,
enables `RestorePackagesWithLockFile`, and does not emit invented NuGet lock
hashes. Neither starter pastes admitted JSON into instructions; live
entrypoints stream stdout and accept a prompt from argv or stdin. Neither
starter hardcodes a Foundry model name; `FOUNDRY_MODEL` is
required. `DefaultAzureCredential` remains the local development convenience
Microsoft documents; generated READMEs tell production hosts to prefer
`ManagedIdentityCredential`. Adapters remain `preview`. Unsupported Microsoft
primitives (durable workflows, MCP, HITL loops, hosted tools) stay out of the
generated first-version scaffold.
Workspace Model reports these projects as `agent`,
retains `microsoft-agent-framework` as their framework identity, and reports
only lifecycle stages backed by concrete manifests, entrypoints, tests, or an
owned project runner.
Each starter also includes credentialless tests for the bounded context
boundary, allowlisted views, and Azure-shaped redaction, plus an
environment-name example with no secret values. Python context
tests isolate the operational context file and restore it afterward; they stay
dependency-free unless `agent-framework` is installed for the optional
LocalChatClient loop. .NET uses a separately pinned test project. The conformance
matrix executes these tests in addition to compiling and exercising the
deterministic framework lifecycle.
Existing user-authored files are blockers, never overwrite targets. A managed
comment alone does not prove ownership: refresh also requires the previous
Workspai ownership receipt, which is bound to the exact adapter-manifest digest;
locally modified managed files fail closed.
Provider credentials remain environment references. The first provider profile uses
Microsoft Foundry, but provider identity is not part of framework identity and
additional profiles must preserve the same security boundary.

## OpenAI Agents SDK baseline

The built-in OpenAI adapters pin independently verified SDK baselines. They do
not reuse Microsoft detection, kits, or model-provider defaults.

| Adapter                    | Tested framework | Runtime         | Authored detection                 |
| -------------------------- | ---------------- | --------------- | ---------------------------------- |
| `openai-agents-python`     | `0.22.2`         | Python `>=3.10` | exact PyPI package `openai-agents` |
| `openai-agents-typescript` | `0.18.0`         | Node.js `>=22`  | exact npm package `@openai/agents` |

The TypeScript starter also pins peer `zod` `4.6.5`, TypeScript `5.9.3`, and
`@types/node` `22.20.3`. The `openai` PyPI or npm package alone is not this
framework. Generated markers under `.workspai/agent-frameworks/` cannot select
it.

Generated loaders resolve the Workspai project as the directory that owns
`agents/<instance>/`. They do not use process cwd, unbounded ancestor search,
or a copied context file inside the agent package. Canonical containment,
a regular-file open (`O_NOFOLLOW` when the platform provides it), the 128 KiB
cap, UTF-8 JSON, and `schemaVersion: project-context-agent.v1` are enforced in
the starter. Generation, freshness, and integrity remain host-owned agent-sync
work. Internal symlinks, including Windows reparse points treated as links, are
allowed only when every resolved hop stays inside the project root. Diagnostics
do not include file contents.

The loader walk is not an atomic open. Between `lstat` of one hop and `open` of
the next, a local actor who can replace a path component may still race the
walk. The bound we claim, and only that bound, is: after a successful open with
`O_NOFOLLOW` when the kernel provides it, that file descriptor is `fstat`'d and
at most 128 KiB is read from that descriptor. This is not a proof of complete
TOCTOU immunity, of Windows junction behavior on every host, or of
enterprise-grade isolation.

Claimed capabilities are conservative and independently evidenced:

- native: `single-agent`, `typed-tools`, `local-execution`
- conditional: `telemetry` (defaults off; `WORKSPAI_AGENT_TRACING=1` opts in;
  `OPENAI_AGENTS_DISABLE_TRACING=1|true` keeps tracing off even if the opt-in
  is set), `provider-neutral-models` (starter only reads `OPENAI_MODEL` /
  `OPENAI_DEFAULT_MODEL`)
- unsupported in this version: handoffs, MCP, sessions/resume, voice, sandbox,
  hosted tools, and human-approval loops

Python cancellation uses `Runner.max_turns` and `ModelSettings.timeout` from
`openai-agents` `0.22.2`. `ModelSettings.timeout` is a per-model-request
timeout applied only on the live model path. Injected `ScriptedModel` runs omit
it because that setting hung the official test double on Python 3.13.
TypeScript cancellation uses `maxTurns` plus `AbortSignal` from
`@openai/agents` `0.18.0`. Those SDK controls are not a Workspai-owned timeout
service. Workspai still owns mutation admission and verification; a successful
model run is not verified evidence.

Generated starters do not paste `project-context-agent.json` into model
instructions. They expose three read-only tools over allowlisted views:
context size and `schemaVersion`, workspace/project identity (including
`boundedGraphSearch` as a pointer, not a shell), and the admitted command
surface. Live Python uses `Runner.run_streamed`; live TypeScript streams
`Runner.run({ stream: true })`. Credentialless ScriptedModel tests stay on
the non-stream `run` path. A prompt is taken from argv or stdin.

Generated OpenAI context tests copy the operational
`.workspai/reports/project-context-agent.json` aside for the suite and restore
it afterward. A green test run is not allowed to delete or replace that host
artifact.

Create lists every published agent kit under **AI Agent**, including
`agent.openai.python` and `agent.openai.typescript`. That picker is the
published catalog: it is not filtered by release-admission digest match or
workspace profile. A later adapter-manifest change must not hide a kit.
Create and Attach still refuse a kit whose adapter is not release-admitted;
visibility in the picker is not permission to write a blocked adapter.
Attach still requires `--framework openai-agents` when the
runtime is shared. OpenAI adapters are labeled `stable`; release admission
remains blocked until the exact v2 cross-platform candidate is promoted.
Handoffs, MCP, sessions, voice, sandbox, and approval loops stay unsupported.
Microsoft adapters remain `preview`.

## Google Agent Development Kit baseline

Google ADK is an agent runtime and orchestration framework. It is not an AI
Gateway, not OpenRouter, and not a Gemini/Vertex model-provider product.
Provider profiles in the generated starter are `gemini-api` (Gemini Developer
API) and `vertex-ai`. OpenRouter stays in the separate Gateway category.

Python `google-adk` and TypeScript `@google/adk` are independent runtimes.
Exact pins live in `src/agent-frameworks/version-baselines.v1.json`. Discovery
must re-prove registry and GitHub agreement on the day it runs; TypeScript 2.0
graph Workflow Runtime is not generalized to Python.

| Adapter                 | Runtime           | Authored detection            |
| ----------------------- | ----------------- | ----------------------------- |
| `google-adk-python`     | Python `>=3.10`   | exact PyPI package `google-adk` |
| `google-adk-typescript` | Node.js `>=20.19` | exact npm package `@google/adk` |

The TypeScript starter also pins `zod`, TypeScript, and `@types/node` from the
same baseline document. `@google/adk-devtools` is not a v1 dependency. Do not
run unqualified `npx adk`.

Adapters are labeled `preview`. Create kits are `agent.google-adk.python` and
`agent.google-adk.typescript`. Create and Attach stay fail-closed until the
reviewed v2 inventory includes these adapters from Linux, macOS, and Windows
evidence. Create refuses unpublished kits before `--dry-run` and before any
filesystem or workspace mutation. Streaming writes each text delta as the SDK
yields it. Telemetry stays off unless `WORKSPAI_AGENT_TRACING=1`; otherwise the
starter sets `OTEL_SDK_DISABLED=true` before importing ADK. Context loaders live
in `src/agent-frameworks/context-loaders/` and are shared by Google, OpenAI, and
Microsoft adapters. Sequential, parallel, loop, graph workflow, A2A, MCP, Agent Engine,
Cloud Run, GKE, Google Search, voice, browser agents, and remote agents are
unsupported. In-memory sessions are process-local, not durable persistence.

Credentialless conformance subclasses the public `BaseLlm` surface. It does not
monkey-patch private SDK internals and does not call Gemini or Vertex.

A path-filtered PR gate compiles only the affected Microsoft, OpenAI, or Google
adapter family on Linux. Shared lifecycle, security, registry, admission,
Create/Doctor integration, and contract changes select the affected families;
documentation-only edits do not run adapter conformance. The complete matrix is
an explicit release-qualification operation: it compiles every built-in adapter runtime on Linux,
macOS, and Windows. Every full-qualification lane
records all 18 mandatory checks, the exact runtime and framework baseline,
digests of the adapter manifest and semantic implementation, and one bounded
evidence file per check. Reports are retained as CI artifacts for review. A
final job validates every evidence path and emits an admission candidate only
when all three operating-system lanes pass for every built-in adapter.
Python conformance is pinned to 3.10.11, the final Python 3.10 release with
cross-platform binary installers; this provides one reproducible minimum-runtime
baseline while the adapter continues to declare Python `>=3.10` support.

After verification, CI emits one admission-candidate artifact. It binds the
source commit, CLI version, adapter manifest and implementation digests, lane reports, and every
evidence file by SHA-256. Its status is always `pending`: successful CI produces
reviewable evidence, not release authority. Only the protected version-update
branch may convert that candidate into the exact release-admission inventory,
and the resulting pull request still passes normal review and repository gates.

CI evidence is not silently trusted at runtime. The default registry remains
blocked when callers provide neither raw conformance reports nor explicit
permission to use the bundled reviewed release inventory. User-facing commands
enable that inventory deliberately and fail closed if an adapter version,
manifest digest, framework baseline, runtime, or platform list has changed.
Semantic implementation digests remain in lane reports, candidates, and the
reviewed inventory as audit provenance. They are verified during full
qualification and promotion, but are deliberately not runtime authorization:
routine implementation changes are guarded by affected-family tests instead
of requiring a hand-edited admission digest for every source edit.

## Attach an agent runtime

Build current Workspace Intelligence first, then inspect adapter admission
state:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
npx workspai agent framework list --json
```

Planning creates a Goal-bound, hash-bound Proof-Carrying Change but does not
write project files:

```bash
npx workspai agent framework plan \
  --project api \
  --runtime python \
  --name support-agent
```

When more than one published framework shares a runtime, pass `--framework`
explicitly. Workspai does not guess or fall back. `--runtime python` without
`--framework` requires an explicit choice because Microsoft Agent Framework,
OpenAI Agents SDK, and Google ADK are all published. Google ADK remains
Create/Attach blocked until release admission.

The interactive attach command displays the same plan and asks before granting
its filesystem effect. Automation must opt in with `--yes` and records the
identity supplied by `--granted-by`:

```bash
npx workspai agent framework attach \
  --project api \
  --runtime python \
  --name support-agent
```

The operation writes only isolated adapter-owned files, records an ownership
receipt, and returns the canonical intelligence and Change verification
commands to run next. It never installs packages, calls a model, persists a
credential, or executes generated code. A separately authorized saved plan can
be applied with `agent framework apply`.

The PCC stores both the exact adapter plan and a framework-neutral architecture
prediction. Verification compares byte-backed artifact changes, requires typed
receipts for mutations inside the immutable project scope, and does not blame a
Change for concurrent work in another registered project. Its actual Graph
overlay is scoped by the same immutable lease, and entities, relations, and
proofs derived from an explicitly predicted artifact are treated as expected
consequences rather than unrelated surprises. A blocked or no-op
request created without an external Goal closes its generated Change and Goal
instead of leaving actionable lifecycle state behind.

The same admitted lifecycle is available for a new project:

```bash
npx workspai create project agent.microsoft.python support-agent
npx workspai create project agent.microsoft.dotnet operations-agent
```

Create writes a minimal runtime identity, registers the project, seals a
Model/Graph baseline so the adapter can plan, applies the adapter-owned scaffold
inside that Change, then re-observes Model, Graph, and project grounding against
the nested runtime. The interactive wizard lists every published kit under the
**AI Agent** category. Scaffolding still requires the selected adapter to be
release-admitted. A failed scaffold
rolls back the new directory and workspace registration. Detection itself
remains read-only and never authorizes writes.

The nested instance is the only executable unit. `workspace run --plan` should
show `agents/<instance>` with compile, standard-library `unittest` or the
dedicated .NET test project, and `python3 main.py` / `dotnet run` as
evidence-backed stages. Create does not install packages or call a model. The
Change stays `open` until:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
npx workspai change verify --change <change-id> --json
```

`--strict` is for workspace readiness blockers in other projects. Independent
verification of this Change is `change verify`.

A workspace may contain multiple independently scoped framework adapters. A
project that deliberately connects two frameworks must declare that bridge;
Workspai never infers cross-framework execution from coincidental dependencies.

## Security defaults

- Network access is denied unless explicitly granted.
- Secrets are referenced from an external secret source and never persisted in
  portable artifacts.
- Generated-code execution is disabled unless explicitly granted.
- Mutating tools require approval.
- Framework state and external input remain untrusted.
- Telemetry must redact sensitive values.
- Paths must be relative, contained, and checked across symlink boundaries.

## Version and stability policy

Every adapter pins exact tested framework versions and declares a bounded
supported range. Upstream status constrains Workspai status:

- a `stable` adapter requires a stable upstream and the complete passing
  platform/runtime conformance matrix;
- a beta upstream can be exposed only as `preview`;
- a maintenance-mode upstream can be exposed only as `compatibility`;
- a deprecated upstream cannot produce a new-project scaffold.

This prevents a framework upgrade from silently changing generated structure,
tool permissions, state semantics, or verification behavior.

## Conformance admission

All checks listed in the capabilities contract are mandatory. They cover
schema and protocol compatibility, truthful detection, safe scaffold and attach
plans, managed-file ownership, user-file preservation, path containment,
secret safety, evidence-generation binding, mutation admission, verification,
failure isolation, idempotency, offline behavior, and cross-platform paths.

A report is admitted only when every required check passes, counts match the
recorded checks, and no blocker remains. A skipped required check is a blocked
result, not partial support.

Admission covers every advertised platform, runtime, and exact tested-framework
version lane. Reports are bound to the manifest digest, so older evidence cannot
authorize a changed adapter. Missing or duplicate lanes, mismatched identities,
and unadvertised runtimes fail closed.

The generic boundary was hardened against two deliberately different
integration shapes: a filesystem-first Node.js framework and the
multi-language Microsoft Agent Framework. OpenAI Agents SDK Python and
TypeScript adapters now share that same create, attach, detection, ownership,
and verification host. They are selectable for Create and Attach only after
their exact manifest digest, framework baseline, runtime, and platform list
enter the reviewed release-admission inventory. Microsoft adapters remain
selectable while their current inventory entries stay valid.

## Implementation sequence

1. Keep this v1 contract stable and validate it in CLI, extension, and package
   publication gates.
2. Use the framework-neutral registry, detector, and bounded manifest loader.
3. Review the Microsoft Python and .NET digest-bound evidence produced by the
   full conformance matrix.
4. Review the OpenAI Python and TypeScript digest-bound evidence produced by
   the same matrix; do not treat local Linux success as multi-OS admission.
5. Keep automated upstream discovery separate from release authority: report
   newer registry versions, then update pins only through a reviewed change.
   Re-run the full matrix before treating a new pin as independently proven.

AutoGen is not planned as a new-project target because Microsoft Agent
Framework is its supported successor path. Eve and LangGraph are not
advertised; each requires its own adapter, tested baseline, and conformance
evidence.
