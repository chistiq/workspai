# CI Workflows

Map of GitHub Actions workflows in this repository. Use this when editing CI to avoid overlapping coverage.

## Workflows

| Workflow                 | Path                                             | Purpose                                                                   |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Build / test matrix      | `.github/workflows/ci.yml`                       | Build, lint, typecheck, tests, coverage, contract gates                   |
| Workspace E2E matrix     | `.github/workflows/workspace-e2e-matrix.yml`     | Cross-OS workspace lifecycle smoke; setup `--warm-deps`; cache/mirror ops |
| Windows bridge E2E       | `.github/workflows/windows-bridge-e2e.yml`       | Native Windows bridge and lifecycle checks                                |
| E2E smoke                | `.github/workflows/e2e-smoke.yml`                | Focused bridge regression smoke                                           |
| Frontend generator smoke | `.github/workflows/frontend-generator-smoke.yml` | Official frontend generator drift gate                                    |
| Security                 | `.github/workflows/security.yml`                 | Security scanning and policy checks                                       |
| Manual npm release       | `.github/workflows/release-npm-manual.yml`       | Maintainer-only release gate and publish workflow                         |
| Contributor onboarding   | `.github/workflows/contributor-onboarding.yml`   | Accepted-contributor onboarding automation                                |
| Welcome                  | `.github/workflows/welcome.yml`                  | First-issue and first-contribution messages                               |

The release workflow requires `Frontend Generator Smoke` for the exact release
SHA. Maintainers must dispatch that workflow against the intended release ref
before starting a manual npm release if no matching run exists.

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
