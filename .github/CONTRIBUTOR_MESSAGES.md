# Contributor Message Templates

These templates move applicants toward one first contribution. The
[Contribution Hub](CONTRIBUTING.md) is the primary link. Community chat is
optional support and must not replace an issue with explicit scope and
acceptance criteria.

Before sending a batch, run `corepack npm run check:contributor-hub:live`.
The routed queue is declared in `contributor-issues.v1.json`; keep an issue
routed only while it is open, unassigned, and ready for a maintainer to split
into one bounded task. Set its route to `false` as soon as it is claimed or no
longer ready, then update the matching list in the Contribution Hub.

## Applicant Invitation

Hi [Name],

Thanks for applying to the Chistiq Open Source Contributor Program. We would
love to have you contribute to Workspai.

Start here: https://github.com/chistiq/workspai/blob/main/.github/CONTRIBUTING.md

Choose the path that matches your skills, then comment on one issue with the
small outcome you want to own. If you share your preferred area, we can point
you to a bounded first task.

For questions, use the relevant issue or GitHub Discussions. Community chat is
also available when you receive the current invite.

## Skill-Routed Invitation

Hi [Name],

Thanks for applying to the Chistiq Open Source Contributor Program. Your
experience with [skill/area] looks relevant to Workspai's [contribution path].

Start here: https://github.com/chistiq/workspai/blob/main/.github/CONTRIBUTING.md

A good first direction for you is [issue or bounded task]. Please read it and
comment with the small outcome you want to own before starting. We will confirm
the scope, relevant files, and acceptance evidence in the issue.

## Follow-Up After Three to Five Days

Hi [Name],

Checking in on your Workspai contributor application. If you are still
interested, reply with one preference: code, testing, Graph/AI context,
documentation, product/UX, runtime, or CI. We can then point you to a bounded
first contribution that matches your background.

Start here: https://github.com/chistiq/workspai/blob/main/.github/CONTRIBUTING.md

## First Pull Request

Hi [Name],

Thank you for your first Workspai pull request. A maintainer will review the
scope, behavior, evidence, and validation results. Review feedback is part of
the collaboration and may ask you to keep the change smaller or add a closer
regression test.

You can generate the expected validation plan at any time with:

`corepack npm run contributor:plan`

Please list any check you could not run and why.

## First Merged Pull Request

Hi [Name],

Your first Workspai contribution has been merged. Thank you for shipping a
focused, reviewed improvement.

If you would like to continue, choose another bounded task from the
Contribution Hub or tell us which area you want to deepen. You do not need to
take ownership of a complete architecture epic to make meaningful progress.

## Active Contributor Milestone

Hi [Name],

Thank you for your continued contributions to Workspai. Your repeated,
reviewable improvements are helping strengthen the project.

You are welcome to propose a larger outcome, help refine starter tasks, review
fixtures and documentation, or take ownership of a clearly bounded area. Please
keep architecture and public-contract changes evidence-backed and aligned in an
issue or discussion before implementation.
