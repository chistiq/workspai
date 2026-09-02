# CI Workflows

Map of GitHub Actions workflows in this repository. Use this when editing CI to avoid overlapping coverage.

## Workflows

| Workflow                 | Path                                                 | Purpose                                                                   |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Build / test matrix      | `.github/workflows/ci.yml`                           | Path-aware docs or full matrix validation plus the required `CI Gate`     |
| Workspace E2E matrix     | `.github/workflows/workspace-e2e-matrix.yml`         | Cross-OS workspace lifecycle smoke; setup `--warm-deps`; cache/mirror ops |
| Windows bridge E2E       | `.github/workflows/windows-bridge-e2e.yml`           | Native Windows bridge and lifecycle checks                                |
| E2E smoke                | `.github/workflows/e2e-smoke.yml`                    | Focused bridge regression smoke                                           |
| Official generator smoke | `.github/workflows/frontend-generator-smoke.yml`     | Contract-driven official-generator drift gate                             |
| Security                 | `.github/workflows/security.yml`                     | Path-aware scanning plus the always-resolved `Security Gate`              |
| Manual npm release       | `.github/workflows/release-npm-manual.yml`           | Maintainer-only release gate and publish workflow                         |
| Discord announcement     | `.github/workflows/discord-release-announcement.yml` | Preview and publish one idempotent product-aware release announcement     |
| Contributor onboarding   | `.github/workflows/contributor-onboarding.yml`       | Accepted-contributor onboarding automation                                |
| Contributor Hub          | `.github/workflows/contributor-hub.yml`              | Daily live issue-route freshness                                          |
| Welcome                  | `.github/workflows/welcome.yml`                      | First-issue and first-contribution messages                               |

## Change-aware validation

`CI Gate` and `Security Gate` are the stable branch-protection checks. They
always resolve for pushes and pull requests, while expensive work is selected
from the changed paths:

| Change surface                         | Required validation                                                    |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Markdown and contributor-route content | One Ubuntu docs build, text guard, link/drift checks, and README smoke |
| CLI source, contracts, or tooling      | Full build/test matrix                                                 |
| Runtime adapter or core bridge         | Full matrix plus focused Phase 4 lanes                                 |
| Generator implementation or contract   | Impact-selected official or native generator smoke                     |
| Workspace lifecycle surface            | Cross-platform workspace E2E                                           |
| Dependency or security surface         | npm audit, SBOM, dependency review, and CodeQL                         |

Specialized workflows use identical `push` and `pull_request` path filters.
Manual and scheduled runs remain available for full qualification and upstream
drift detection. Workflow definitions and release-gate definitions trigger the
lanes they govern.

The `main` branch requires a pull request, one approving review, resolved
conversations, and successful `CI Gate` and `Security Gate` checks for normal
contributors. Repository administrators retain a bypass for release recovery
and CI bootstrap; routine changes should still use a pull request. Force pushes
and branch deletion remain disabled. Contributors can use GitHub's Update
branch action when strict checks require synchronization with the latest
`main`; merged head branches are deleted automatically.

The release workflow requires the cost-bounded
`Official Generator Smoke · primary` Linux run for the exact release SHA. A
normal push that touches the contracted generator surface produces this gate;
maintainers do not need to run the full cross-platform matrix before publishing.

Consumer mirror synchronization does not add another required CLI workflow.
Local pre-commit synchronizes mirrors when contract sources are staged;
pre-push requires canonical CLI outputs to be committed but does not require a
consumer release. The extension's own CI remains responsible for hard parity
against the CLI version selected for that extension release. Consumer-owned
version floors remain separate from CLI-owned schema inventories, preventing
parity checks from coupling product versions. Breaking contract removal or
incompatible schema changes remain CLI release blockers through the canonical
compatibility and schema-version gates.

Pushes and pull requests select the affected generator family from changed
paths. Frontend changes run the frontend generators, desktop/extension/Laravel
changes run that platform group, and native-only changes skip the unrelated
official network matrix while retaining native artifact verification. Shared
contracts, dependencies, smoke infrastructure, and release gates conservatively
run every official generator. The weekly schedule and manual dispatch still run
the complete Linux, macOS, and Windows matrix as a compatibility and
upstream-drift signal. npm and Composer download caches reduce repeated network
work without treating an earlier commit or calendar-day result as proof for a
new SHA.

The Windows coverage lane intentionally uses bounded Vitest worker concurrency
and platform-aware transaction timeouts. Filesystem-heavy workspace tests must
finish their transaction before teardown; cleanup retries transient Windows
`EBUSY`, `ENOTEMPTY`, and `EPERM` states instead of converting one slow operation into a
cascade of unrelated missing-file failures. These budgets remain finite and do
not retry failed assertions or product operations.

## Release announcements

`packages/cli/releases/release-products.v1.json` maps a release product to its
display name, package version, tag template, notes path, repository, and upgrade
command. Release-event runs resolve the product from its tag, so future
independently versioned monorepo packages do not require a new workflow.
Each versioned release-note file carries one hidden
`workspai-release-announcement` JSON block with its public headline, summary,
and two to five highlights.

Validate or preview the current CLI announcement locally:

```bash
npm --workspace workspai run check:release-announcement
npm --workspace workspai run release:announcement -- \
  --product workspai-cli \
  --tag v0.72.1 \
  --markdown-output /tmp/workspai-discord-announcement.md
```

Publishing a GitHub Release sends the generated embed to Discord. Configure the
repository Actions secret `ANNOUNCEMENTS_WEBHOOK_URL` with the incoming
webhook for `#announcements`. Manual workflow dispatch defaults to preview-only.
When send is explicitly enabled, an existing message for the same product and
tag is updated rather than duplicated. The workflow stores the Discord message
id in a hidden marker on the GitHub Release. Release events read automation
from the released tag; manual previews use the selected branch commit.

## Consumer workspace: agent grounding CI

For Workspai **consumer workspaces** (not this CLI repo), use the copy-paste template:

- [examples/ci-agent-grounding.yml](./examples/ci-agent-grounding.yml)

Minimal job:

```yaml
- run: npx workspai workspace intelligence run --for-agent generic --strict --json
- run: npx workspai pipeline --json --strict --no-agent-sync
- run: node ./node_modules/workspai/scripts/check-agent-customization-drift.mjs --workspace .
```

The canonical runner owns ordered evidence and agent grounding. The separate
pipeline uses `--no-agent-sync` so it cannot rewrite those surfaces afterward.
Run the drift check last so CI fails when generated customization files are stale.
Runner exit `1` is a hard execution failure; exit `2` is a completed but
evidence-blocked run and must also block release. When evidence must be uploaded
after either outcome, follow the `continue-on-error` plus final-failure pattern
in the template. See
[Unified Workspace Intelligence Runner](./workspace-intelligence-runner.md) for
the exact preflight, 11-stage, artifact, and exit contract.

## Local validation scripts

| Script                        | Command                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| Runtime acceptance (default)  | `npm run test:runtime-matrix`                                             |
| Runtime acceptance (full)     | `npm run test:runtime-matrix:full`                                        |
| Frontend generators (dry-run) | `npm run smoke:frontend-generators`                                       |
| Frontend generators (network) | `npm run smoke:frontend-generators:network`                               |
| Docs drift guard              | `npm run check:docs-drift`                                                |
| README command smoke          | `npm run smoke:readme`                                                    |
| Agent customization drift     | `npm run check:agent-customization-drift -- --workspace <workspace-root>` |
| Cross-platform lockfile       | `npm run check:cross-platform-lockfile`                                   |

The root `postinstall` lifecycle runs the lockfile check before build or test
jobs can start. This prevents a lockfile regenerated from a platform-pruned
`node_modules` tree from reaching native Vitest/Rolldown startup on another
operating system. Restore an accidentally deleted lockfile from Git; perform a
deliberate full regeneration only with both the lockfile and `node_modules`
absent.

## Recommended pre-release checks

```bash
npm run validate
npm run validate:docs
npm run security
npm run contracts:validate
npm run test:runtime-matrix:full
```

## See also

- [SETUP.md](./SETUP.md)
- [DEVELOPMENT.md](./DEVELOPMENT.md)
- [Documentation index](./README.md)
