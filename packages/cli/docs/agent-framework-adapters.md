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

Microsoft Agent Framework is the first concrete implementation of this
foundation. Its Python and .NET adapters are intentionally separate because
their package graphs, runtime requirements, entrypoints, and verification
commands differ. Both remain preview and non-selectable until the required
conformance matrix passes for every advertised platform and runtime lane.

## Published contracts

| Contract                                                                       | Purpose                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `contracts/agent-framework-capabilities.v1.json`                               | Normative ownership, capability, lifecycle, security, versioning, and admission rules |
| `contracts/workspace-intelligence/agent-framework-adapter-manifest.v1.json`    | JSON Schema for one framework/version adapter declaration                             |
| `contracts/workspace-intelligence/agent-framework-conformance-report.v1.json`  | JSON Schema for reproducible adapter admission evidence                               |
| `contracts/workspace-intelligence/agent-framework-change-plan.v1.json`         | Portable, mutation-free scaffold or attach plan returned to the host                  |
| `contracts/workspace-intelligence/agent-framework-ownership-receipt.v1.json`   | Hash-bound proof of the files Workspai may safely refresh                             |
| `contracts/workspace-intelligence/agent-framework-admission-candidate.v1.json` | Review-pending, digest-bound index of the complete cross-platform evidence matrix     |

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
| `microsoft-agent-framework-python` | `1.17.0`         | Python `>=3.10` | `agent-framework` PyPI package family      |
| `microsoft-agent-framework-dotnet` | `1.20.0`         | .NET `>=8.0`    | `Microsoft.Agents.AI` NuGet package family |

The first provider profile pins its integration independently: Python uses
`agent-framework-foundry` `1.12.0`, while .NET uses
`Microsoft.Agents.AI.Foundry` `1.20.0-preview.260831.1` over the stable
`Microsoft.Agents.AI` `1.20.0` core. Preview integration status is not
misrepresented as framework stability.

Each adapter implements detection, scaffold and attach planning, managed-file
rendering, project context, validation, and runtime resolution. It never
installs a dependency, invokes a model, executes generated code, or writes a
source file directly. The lifecycle host binds the target project and every
content digest into the PCC event chain, requires an explicit filesystem grant,
then atomically applies the unchanged plan and records effect evidence.

Generated starter files use an isolated `agents/<instance>` root and keep
adapter state under `.workspai/agent-frameworks/<adapter>/<instance>.json`.
Existing user-authored files are blockers, never overwrite targets. A managed
comment alone does not prove ownership: refresh also requires the previous
Workspai ownership receipt, which is bound to the exact adapter-manifest digest;
locally modified managed files fail closed.
Provider credentials remain environment references. The first provider profile uses
Microsoft Foundry, but provider identity is not part of framework identity and
additional profiles must preserve the same security boundary.

A path-filtered six-lane adapter matrix compiles the generated Python and .NET
projects on Linux, macOS, and Windows. Every lane records all 18 mandatory
checks, the exact runtime and framework baseline, a digest of the adapter
manifest, and one bounded evidence file per check. Reports are retained as CI
artifacts for review. A final job validates every evidence path and admits the
matrix only when all three operating-system lanes pass for both adapters.

After verification, CI emits one admission-candidate artifact. It binds the
source commit, CLI version, adapter-manifest digests, lane reports, and every
evidence file by SHA-256. Its status is always `pending`: successful CI produces
reviewable evidence, not release authority. Promotion into the built-in registry
remains a separate maintainer-reviewed release action.

CI evidence is not silently embedded into a release. The default registry
therefore remains blocked until a reviewed release process supplies the exact
digest-bound report set. This keeps a green workflow from becoming runtime
authority merely because it ran.

## Create and attach

A future agent-project kit declares one primary adapter:

```text
workspai create project <agent-kit> <name>
```

An existing framework project will use the same adapter through an explicit
attach operation. Detection itself is read-only and never authorizes writes.
Both flows plan changes before writing and may write only owned files or managed
sections under declared relative roots.

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
multi-language Microsoft Agent Framework. Only the Microsoft adapters are now
implemented, and their preview state still prevents premature selection.

## Implementation sequence

1. Keep this v1 contract stable and validate it in CLI, extension, and package
   publication gates.
2. Use the framework-neutral registry, detector, and bounded manifest loader.
3. Review the Microsoft Python and .NET digest-bound evidence produced by the
   full conformance matrix.
4. Promote and package each adapter's evidence independently only after all
   Linux, macOS, and Windows lanes pass.
5. Add a kit only after create and attach share the admitted adapter.

AutoGen is not planned as a new-project target because Microsoft Agent
Framework is its supported successor path. Eve, LangGraph, and OpenAI Agents
SDK are not advertised; each requires its own adapter, tested baseline, and
conformance evidence.
