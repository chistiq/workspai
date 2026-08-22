<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Platform-aware creation and polyglot intelligence fidelity",
  "summary": "Workspai 0.64.0 makes workspace creation deterministic across platforms and strengthens Graph and Doctor evidence on real polyglot repositories.",
  "highlights": [
    {
      "icon": "🧭",
      "text": "Create consumers share one versioned contract for profiles, kits, runtimes, and lifecycle"
    },
    {
      "icon": "🛠️",
      "text": "Python toolchain preflight now gives platform- and method-specific recovery guidance"
    },
    {
      "icon": "🕸️",
      "text": "Graph imports preserve language and same-name monorepo package boundaries"
    },
    {
      "icon": "🩺",
      "text": "Doctor reports dependency evidence without overstating environment-specific installation state"
    }
  ]
}
-->

# Workspai CLI v0.64.0

Released August 22, 2026.

## Platform-Aware Creation and Polyglot Intelligence Fidelity

Workspai 0.64.0 strengthens two ends of the Workspace Intelligence lifecycle:
creating a canonical workspace correctly on the user's platform, and producing
accurate evidence from the polyglot software adopted into that workspace.

The release publishes machine-readable creation semantics for IDE and agent
consumers, makes optional Python-engine setup fail with actionable platform
guidance, and improves Graph and Doctor behavior against real repositories with
mixed languages, nested projects, generated code, and runtime-specific
dependency stores.

## One Create contract for every consumer

The versioned Create Planner capability contract now describes:

- workspace profiles and their runtime intent;
- executable official project kits;
- profile-to-kit compatibility;
- optional Python-engine requirements and supported installation methods;
- required canonical lifecycle steps after workspace and project creation.

CLI, IDE, and agent consumers can therefore plan against the same advertised
surface instead of maintaining separate static assumptions. Workspace and
project creation complete registry, contract, model, graph, agent-context,
grounding, and evidence-index synchronization before reporting success.
Dependency initialization and strict release verification remain explicit
operations.

Canonical profile and kit metadata now determines dependency initialization.
Node.js, Go, Java, and .NET workspaces do not install the optional Python engine
merely because a generic module capability exists.

## Deterministic Python toolchain preflight

Interactive creation now evaluates the selected installation method before
attempting setup. Guidance distinguishes Python, virtual-environment support,
pip, pipx, and Poetry, and is specific to Linux, macOS, or Windows.

The selected method remains authoritative:

- choosing Poetry does not silently turn into a pipx workflow;
- choosing pipx reports pipx prerequisites and installation paths;
- choosing venv reports the platform package or runtime repair required;
- skipping the optional Python engine remains an explicit supported path.

Failed setup removes newly-created partial virtual environments. Existing
Workspai-owned environments whose interpreter cannot launch pip are rebuilt
instead of being trusted as healthy. Failure output is concise and excludes
bundled stack traces, generic network advice, and machine-local paths.

Git initialization feedback is also more exact. Repository initialization,
staging, and initial-commit signing are separate outcomes; declining or failing
a configured signature leaves generated files staged and reports that state.

## Higher-fidelity polyglot Graph evidence

Source-structure imports are language-aware across JavaScript and TypeScript,
Python, Rust, C and C++, JVM, .NET, Go, Ruby, PHP, Elixir, Dart, Lua, and R.
C and C++ project-root includes resolve to proof-backed header entities.

Same-name packages in a monorepo retain distinct identities at their portable
manifest boundaries. External ecosystem dependencies still deduplicate by
ecosystem and package name, preserving bounded retrieval without merging local
projects that happen to share a name.

False-positive controls now:

- prevent Rust macros such as `register_extension!` from activating the Deno
  runtime-bridge provider;
- ignore `unknown` candidates when deciding whether a project is polyglot;
- require generated-source markers to occur in source comments rather than
  arbitrary string literals.

## More defensible Doctor dependency evidence

Doctor now makes the distinction between a declared dependency boundary and an
environment-specific materialized dependency tree explicit. Aggregate, native,
Deno, Cargo, Go, Bundler, Mix, and Clojure projects no longer receive a stronger
installation claim than their evidence supports.

Cargo workspaces with explicit default members outrank private Node.js tooling
manifests when Workspai selects the primary adopted runtime. This keeps the
operational project identity attached to the actual workspace lifecycle rather
than incidental repository tooling.

## Hermetic real-world qualification

Qualification runners use isolated Workspai state and cannot read or modify the
user's canonical workspace registry. Publication-safety checks reject portable
artifacts containing machine-local roots or sensitive local state.

The release was exercised across isolated real repositories and a multi-project
workspace, covering large C/C++, Rust, JavaScript and TypeScript, Python, Go,
Java, .NET, PHP, Ruby, and mixed-runtime boundaries. Qualification explicitly
checks Graph determinism, Doctor applicability, runtime selection, Goal
measurement preflight, and publication safety.

## Upgrade

```bash
npm install -g workspai@0.64.0
workspai --version
```

Expected output:

```text
0.64.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias will be published at the matching `0.64.0` version.
- Existing workspace, Model, Graph, Goal, repair, and agent-entry contracts
  remain supported.
- The Create Planner capability contract is additive and versioned.
- No public command is removed.

## Breaking changes

None.
