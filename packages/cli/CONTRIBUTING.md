# Contributing to Workspai

Thank you for helping improve open-source Workspace Intelligence.

Workspai welcomes bug fixes, documentation, tests, runtime support, usability
improvements, contract changes, new capabilities, and carefully designed package
boundaries. You do not need to understand the entire system before making a
useful contribution.

## Choose a Contribution Path

| You want to                    | Start here                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Fix a bug                      | Open or claim a bug issue, add a failing regression test, then make the smallest correct fix                  |
| Improve an existing feature    | Describe the user problem and current behavior in an issue or discussion before changing contracts            |
| Improve documentation          | Submit a focused PR; open an issue first only for broad information architecture changes                      |
| Add tests                      | Target an uncovered behavior, failure mode, platform, runtime, or contract boundary                           |
| Add or improve runtime support | Start with the runtime support and create-planner contracts, then propose the required adapters or generators |
| Add a new CLI capability       | Discuss its user outcome, command ownership, artifacts, schemas, and consumer impact first                    |
| Propose a new package          | Open a design discussion before creating a package directory                                                  |
| Report a security issue        | Follow the [Security Policy](docs/SECURITY.md); do not open a public issue                                    |

Good first contributions usually include documentation corrections, focused
tests, clearer diagnostics, small cross-platform fixes, and isolated bug fixes.
Look for
[`good first issue`](https://github.com/chistiq/workspai/labels/good%20first%20issue)
and [`help wanted`](https://github.com/chistiq/workspai/labels/help%20wanted)
labels.

## Before You Start

Use the existing GitHub templates:

- [Bug report](https://github.com/chistiq/workspai/issues/new?template=bug_report.yml)
- [Feature request](https://github.com/chistiq/workspai/issues/new?template=feature_request.yml)
- [Discussions](https://github.com/chistiq/workspai/discussions) for design questions and early proposals

Open an issue or discussion before work that:

- Adds or changes a public command
- Changes a JSON schema or canonical artifact
- Changes the Workspace Intelligence chain
- Adds a runtime, generator, or external integration
- Introduces a dependency or package
- Changes persisted metadata or shipped behavior

Small bug fixes, tests, typo corrections, and focused documentation improvements
can go directly to a pull request when the intent is clear.

## Development Setup

### Requirements

- Node.js `>=20.19.0`
- npm through the repository-declared package manager
- Git
- Python 3.10+ only for Python/Core-dependent tests
- Go, Java, or .NET only for tests that exercise those runtimes

See the [Package Manager Policy](docs/PACKAGE_MANAGER_POLICY.md).

### Clone and install

```bash
git clone https://github.com/chistiq/workspai.git
cd workspai
corepack npm ci
```

### Lockfile safety

Treat `package-lock.json` as a cross-platform build artifact. Do not delete only
the lockfile and then run `npm install` against an existing `node_modules`
directory: npm can reconstruct the lock from the current platform and omit
optional native bindings required by Linux, macOS, or Windows CI.

- For a reproducible install, keep the committed lockfile and run
  `corepack npm ci`.
- For a dependency change, keep the lockfile and use an explicit
  `corepack npm install <package>@<version>` command.
- If the lockfile was deleted accidentally, restore it from Git before running
  `corepack npm ci`.
- Only perform an intentional full lockfile regeneration in a clean branch or
  container where both `package-lock.json` and `node_modules` are absent, using
  the repository-pinned npm version.

Every install and pre-push validation runs
`npm run check:cross-platform-lockfile`. A missing platform binding is a hard
failure; do not bypass the guard or hide it with a platform-specific fallback.

### English-only repository text

All authored repository text must use ASCII English, including source strings,
tests, fixtures, documentation, release notes, and filenames. Language-neutral
Unicode symbols and emoji are allowed; non-ASCII letters, combining accents,
and non-ASCII decimal digits are not.

```bash
corepack npm run check:english-text
```

The complete repository is checked by lint and CI. Pre-commit validates the
exact staged content, so an unstaged correction cannot hide a violation already
present in the index. Do not add file, test, or historical-document exceptions.

### Build and test

From the monorepo root:

```bash
corepack npm run build
corepack npm test
corepack npm run validate
```

Run CLI package commands directly when you need a focused workflow:

```bash
corepack npm --workspace workspai run build
corepack npm --workspace workspai run typecheck
corepack npm --workspace workspai test
```

For local manual testing:

```bash
corepack npm run install:local
workspai --version
corepack npm run uninstall:local
```

Read the [Development Guide](docs/DEVELOPMENT.md) for focused suites, manual
smoke tests, configuration, and debugging.

## Repository Map

```text
workspai/
  packages/
    cli/                 # Canonical CLI, contracts, docs, generators, and tests
      contracts/         # Published schemas and capability contracts
      docs/              # User, operator, contract, and contributor docs
      scripts/           # Build, validation, smoke, and release tooling
      src/               # TypeScript implementation and tests
      templates/         # Bundled fallback templates
    wspai/               # Small npm alias package
  .github/               # CI workflows, issue templates, and contributor automation
```

The CLI owns the current public command surface. Do not create a new package
only to organize internal code; use modules inside `packages/cli` unless the
proposal needs an independently versioned, published, and consumed boundary.

## Fixing a Bug

A strong bug-fix pull request includes:

1. A minimal reproduction or failing test.
2. The root cause, not only the visible symptom.
3. The smallest change that fixes the behavior.
4. A regression test at the closest stable boundary.
5. Documentation updates when user-visible behavior changes.

Include environment details for platform-sensitive failures:

```text
Workspai version:
Node and npm versions:
Operating system:
Command:
Expected behavior:
Actual behavior:
Relevant logs or JSON output:
```

Do not remove compatibility behavior unless there is a concrete migration plan
for persisted data, published commands, or external consumers.

## Improving an Existing Feature

Start from the user outcome, not an internal implementation preference.

Describe:

- Who needs the change
- What they cannot do today
- The expected command or workflow
- Which durable artifacts or exit codes change
- Which consumers are affected: CLI, CI, IDE, MCP, extension, or AI agents
- How the behavior will be tested and documented

Workspace Intelligence changes must preserve provenance, freshness, artifact
flow, and structured verdict semantics. Read these contracts before changing the
chain or its output families:

- [`workspace-intelligence-chain.v1.json`](contracts/workspace-intelligence-chain.v1.json)
- [`workspace-intelligence-architecture.v1.json`](contracts/workspace-intelligence-architecture.v1.json)
- [Artifact Catalog](docs/contracts/ARTIFACT_CATALOG.md)
- [Command Ownership Matrix](docs/contracts/COMMAND_OWNERSHIP_MATRIX.md)

Update schemas, generated contracts, tests, docs, and consumer projections
together when a contract changes.

## Adding Runtime or Generator Support

Runtime detection, lifecycle execution, native creation, and module mutation are
different capabilities. Supporting one does not imply all four.

A proposal should state:

- Detection signals and confidence
- Runtime lifecycle commands
- Native, official-generator, or existing-project create lane
- Workspace profile compatibility
- Project metadata and contract changes
- Offline and cross-platform expectations
- Module support or explicit non-support
- Test matrix and documentation

Start with:

- [Runtime Support Matrix](docs/contracts/RUNTIME_SUPPORT_MATRIX.md)
- [Create Planner Capabilities](docs/create-planner-capabilities.md)
- [Runtime Acceptance Matrix](docs/contracts/RUNTIME_ACCEPTANCE_MATRIX.md)

## Proposing a New Package

New packages have a long-term maintenance cost. Open a discussion before adding
one and answer:

1. What user or integration problem requires a separate package?
2. Why can this not remain a module in `packages/cli`?
3. Who imports, installs, or deploys it independently?
4. What is its public API and compatibility policy?
5. Which contracts and artifacts does it own or consume?
6. How is it built, tested, versioned, published, and secured?
7. Who will maintain it after release?

A new package is appropriate when it has a real independent consumer and
release boundary, for example a reusable SDK or a dedicated service process. A
folder split alone is not enough.

Do not implement a planned package boundary from the README without an accepted
proposal. Planned names communicate direction, not approved API design.

## Documentation Contributions

Use simple, task-oriented language. Keep the README as a landing page and put
complete syntax or operational detail in `docs/`.

When changing commands or user-visible behavior:

- Update the command reference or relevant guide.
- Update examples and expected artifacts.
- Keep local Markdown links valid.
- Preserve the canonical Workspace Intelligence chain meaning.
- Run the documentation checks below.

```bash
corepack npm --workspace workspai run check:markdown-links
corepack npm --workspace workspai run check:docs-drift
corepack npm --workspace workspai run validate:docs-examples
corepack npm --workspace workspai run smoke:readme
```

## Tests and Quality Gates

Run the smallest relevant suite while developing, then the required package
checks before opening a pull request.

Common checks:

```bash
corepack npm --workspace workspai run typecheck
corepack npm --workspace workspai run lint
corepack npm --workspace workspai run format:check
corepack npm --workspace workspai test
```

Contract changes also require:

```bash
corepack npm --workspace workspai run contracts:check
corepack npm --workspace workspai run contracts:validate
```

Do not skip failing hooks or weaken tests to make a pull request pass. If a full
suite has an unrelated environmental failure, report it clearly and include the
focused passing evidence.

## Pull Request Checklist

- Keep the pull request focused on one problem.
- Explain the user-visible outcome and implementation tradeoffs.
- Link the issue or discussion when one was required.
- Add or update tests for behavior changes.
- Update documentation and contracts together with public behavior.
- Avoid unrelated formatting, generated output, or dependency changes.
- Confirm that no secrets, local paths, or private artifacts are included.
- List the commands you ran and any checks you could not run.
- Keep commits reviewable and use clear messages.

Maintainers may ask to split broad pull requests so each change can be reviewed,
tested, and released safely.

## Releases

Only maintainers publish releases. Contributors should not bump versions, create
tags, or publish packages as part of a normal pull request unless a maintainer
explicitly requests it.

Maintainer release validation is documented in [SETUP.md](docs/SETUP.md) and the
package release scripts.

## Community and Conduct

Be respectful, specific, and collaborative. Assume good intent, discuss ideas
with evidence, and focus reviews on the change rather than the contributor.

- Ask usage and design questions in [GitHub Discussions](https://github.com/chistiq/workspai/discussions).
- Report reproducible bugs and feature requests in [GitHub Issues](https://github.com/chistiq/workspai/issues).
- Report vulnerabilities through the [Security Policy](docs/SECURITY.md).

Every focused improvement helps make Workspace Intelligence more useful and
trustworthy for its users and consumers.
