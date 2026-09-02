# Start Contributing to Workspai

You do not need to understand the entire architecture before contributing.
Choose one bounded path, then use the validation plan generated from the files
you change. Existing issues must be claimed before implementation; a very small
documentation or test correction can go directly to a focused pull request.

## Choose Your Path

| Your strength                    | Good first contribution                                                     | Current route                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| TypeScript or platform code      | Add one focused regression or implement an accepted bounded fix             | [`area: cli`](https://github.com/chistiq/workspai/issues?q=is%3Aopen+label%3A%22area%3A+cli%22)             |
| Testing and QA                   | Reproduce one failure, add a fixture, or strengthen one platform assertion  | [`good first issue`](https://github.com/chistiq/workspai/issues?q=is%3Aopen+label%3A%22good+first+issue%22) |
| Graph and AI context             | Improve one deterministic retrieval or proof-backed Graph scenario          | [`area: graph`](https://github.com/chistiq/workspai/issues?q=is%3Aopen+label%3A%22area%3A+graph%22)         |
| Documentation                    | Correct one workflow, example, troubleshooting path, or missing explanation | [documentation guide](../packages/cli/CONTRIBUTING.md#documentation-contributions)                          |
| Product and developer experience | Reproduce a confusing flow and propose a measurable outcome                 | [GitHub Discussions](https://github.com/chistiq/workspai/discussions)                                       |
| Runtime or CI experience         | Add one pinned fixture or platform-safe assertion under an accepted issue   | [`area: ci`](https://github.com/chistiq/workspai/issues?q=is%3Aopen+label%3A%22area%3A+ci%22)               |

Issue labels are discovery aids, not permission to take an entire architecture
epic. For issue-based work, comment before starting. A maintainer must confirm
the bounded slice for the parent outcomes listed below or whenever the issue
explicitly requests decomposition. A typo, broken link, narrowly scoped
documentation correction, or isolated regression test can go directly to a
pull request when it does not claim an existing issue or change public behavior.

## Current Maintainer-Routed Starting Points

The following issues are parent outcomes, not complete first tasks. Confirm that
the issue is still open and unassigned, then comment with one small slice. A
maintainer must confirm that slice before implementation:

1. [#35: shared polyglot Graph semantics](https://github.com/chistiq/workspai/issues/35)
   for one licensed runtime fixture or golden semantic assertion.
2. [#36: cross-platform path identity](https://github.com/chistiq/workspai/issues/36)
   for one maintainer-approved OS fixture.
3. [#37: incremental/full Graph equivalence](https://github.com/chistiq/workspai/issues/37)
   for one deterministic mutation and equivalence assertion.
4. [#40: adoption lifecycle consistency](https://github.com/chistiq/workspai/issues/40)
   for one maintainer-approved transition test.
5. [#41: scheduled polyglot runtime matrix](https://github.com/chistiq/workspai/issues/41)
   for one maintainer-approved runtime job.

For a task that can be claimed without maintainer decomposition, use the live
[`good first issue` queue](https://github.com/chistiq/workspai/issues?q=is%3Aissue+state%3Aopen+no%3Aassignee+label%3A%22good+first+issue%22).
If that query is empty, ask for a bounded slice instead of claiming a parent
issue. GitHub state, assignment, and labels are authoritative.

## First Contribution in Five Steps

1. Choose an open issue or a small direct-pull-request correction.
2. For issue work, confirm it is open and unassigned, then comment with the
   small outcome you want to own.
3. Follow the [development setup](../packages/cli/CONTRIBUTING.md#development-setup).
4. Make one focused change with the closest regression test or documentation evidence.
5. Run `corepack npm run contributor:plan` and execute the listed checks.

The planner examines staged, unstaged, and untracked files. It does not modify
the repository or execute the checks for you. For automation or troubleshooting:

```bash
corepack npm run contributor:plan -- --json
corepack npm run contributor:plan -- --file packages/cli/docs/agent-entry.md
```

Include the commands and results in the pull request. If a command cannot run
in your environment, say exactly which command and why; do not hide the gap.

## Pick a Task, Not an Epic

Start with at most one independently reviewable outcome. Good examples include:

- one table row and assertion in a shared fixture;
- one cross-platform path regression;
- one missing JSON/exit-code conformance case;
- one documentation workflow with verified commands;
- one reproducible UX problem with before/after acceptance criteria.

Avoid opening a first pull request that changes a public command, several
contracts, multiple runtime providers, and documentation at once. Those changes
need design alignment and should be split into reviewable slices.

## Where to Ask for Help

- Use the issue thread for scope, ownership, and implementation questions tied
  to that task.
- Use [GitHub Discussions](https://github.com/chistiq/workspai/discussions) for
  early design exploration and general contributor help.
- Use the community chat when a maintainer provides its current invite. Chat is
  a support layer, not the source of issue scope or acceptance criteria.
- Report vulnerabilities through the [Security Policy](../SECURITY.md),
  never through a public issue or chat.

## Complete Technical Guide

The [Workspai contribution guide](../packages/cli/CONTRIBUTING.md) covers coding
standards, architecture ownership, runtime support, tests, contracts, pull
requests, and release rules.

Maintainers can use the reviewed outreach and lifecycle templates in
[CONTRIBUTOR_MESSAGES.md](CONTRIBUTOR_MESSAGES.md).
