# Start Contributing to Workspai

You do not need to understand the entire architecture before contributing.
Choose one path, claim one bounded task, and use the validation plan generated
from the files you change.

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
epic. Comment before starting. A maintainer will confirm a bounded slice with a
clear outcome, relevant files, and acceptance evidence.

## Current Candidate Starting Points

Confirm availability in the issue before starting:

1. [#14: natural-language Graph relevance corpus](https://github.com/chistiq/workspai/issues/14)
   for a focused TypeScript/test contribution.
2. [#16: cross-platform path identity](https://github.com/chistiq/workspai/issues/16)
   for one maintainer-approved OS fixture.
3. [#20: adoption lifecycle consistency](https://github.com/chistiq/workspai/issues/20)
   for one maintainer-approved transition test.
4. [#21: scheduled polyglot runtime matrix](https://github.com/chistiq/workspai/issues/21)
   for one maintainer-approved runtime job.
5. [#22: machine-readable CLI conformance](https://github.com/chistiq/workspai/issues/22)
   for one maintainer-approved command row.

Only #14 is intended as a complete first issue when its `good first issue`
label is present. For #16 and #20 through #22, claim one explicit child slice,
not the whole parent outcome.

## First Contribution in Five Steps

1. Read the issue and confirm that it is still open and unassigned.
2. Comment with the small outcome you want to own.
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
- Report vulnerabilities through the [Security Policy](../packages/cli/docs/SECURITY.md),
  never through a public issue or chat.

## Complete Technical Guide

The [Workspai contribution guide](../packages/cli/CONTRIBUTING.md) covers coding
standards, architecture ownership, runtime support, tests, contracts, pull
requests, and release rules.

Maintainers can use the reviewed outreach and lifecycle templates in
[CONTRIBUTOR_MESSAGES.md](CONTRIBUTOR_MESSAGES.md).
