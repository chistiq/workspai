# Setup & Workflow

Canonical setup reference for **maintainers** of the Workspai CLI.

**End users:** start with [../README.md](../README.md), [OPEN_SOURCE_USER_SCENARIOS.md](./OPEN_SOURCE_USER_SCENARIOS.md), and [workspace-operations.md](./workspace-operations.md).

Unless noted otherwise, run commands in this guide from `packages/cli`. From the
monorepo root, use `npm --workspace workspai run <script>`.

## Prerequisites

- Node.js `>= 20.19.0`
- npm ([PACKAGE_MANAGER_POLICY.md](./PACKAGE_MANAGER_POLICY.md))

```bash
npm ci
```

## Build & quality gates

```bash
npm run build
npm run validate
npm run validate:docs
npm run contracts:validate
```

| Command | Purpose |
| --- | --- |
| `validate` | typecheck + lint + format + tests |
| `validate:docs` | markdown links, drift guard, doc examples, README smoke |
| `contracts:validate` | generated/shared contracts, parity, runtime conformance, and adversarial gates |

See [ci-workflows.md](./ci-workflows.md) for GitHub Actions mapping.

## Workspace CLI smoke

```bash
npm run build

node dist/index.js --help
node dist/index.js --version

node dist/index.js create workspace test-ws --here --yes --profile polyglot
node dist/index.js workspace list
cd test-ws
node ../dist/index.js bootstrap --profile polyglot
node ../dist/index.js setup python
node ../dist/index.js setup node --warm-deps
node ../dist/index.js doctor workspace
node ../dist/index.js workspace policy show
node ../dist/index.js cache status
node ../dist/index.js mirror status
```

## Release confidence scripts

```bash
npm run test:scenarios
npm run test:scenarios:full
npm run test:runtime-matrix:full
npm run smoke:frontend-generators
npm pack --dry-run
```

## Common development commands

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
```

Details: [DEVELOPMENT.md](./DEVELOPMENT.md).

## Environment variables

Bridge + Core integration:

- `WORKSPAI_DEV_PATH` — local RapidKit Core checkout (`RAPIDKIT_DEV_PATH` fallback)
- `RAPIDKIT_CORE_PYTHON_PACKAGE` — override Core install target
- `RAPIDKIT_BRIDGE_FORCE_VENV=1` — force cached bridge venv
- `RAPIDKIT_BRIDGE_UPGRADE_PIP=1` — upgrade pip in bridge venv
- `RAPIDKIT_BRIDGE_LOCK_TIMEOUT_MS` — maximum wait for another process that is
  preparing the same cached bridge (default: 10 minutes)
- `RAPIDKIT_BRIDGE_LOCK_STALE_MS` — stale-owner recovery threshold (default: 15
  minutes and always longer than the configured lock timeout)
- `XDG_CACHE_HOME` — bridge cache root

Bridge creation is serialized across processes. A cached environment is reused
only after `rapidkit --version --json` satisfies the executable Core contract;
an incomplete or unhealthy environment is discarded and rebuilt under the
same lock. This makes concurrent first-use from terminals, IDEs, agents, and CI
workers safe without requiring a global Python installation.

Scenario toggles: `RAPIDKIT_SCENARIO_FULL_BOOTSTRAP`, `RAPIDKIT_SCENARIO_WORKSPACE_CREATE`

General: `DEBUG`, `NODE_ENV`

## Open-source release hygiene

Before tagging:

```bash
npm run validate
npm run validate:docs
npm run security
npm run test:scenarios
npm pack --dry-run
```

Use placeholders in examples (never real credentials). Do not commit local coverage output unless intentional.

## See also

- [Documentation index](./README.md)
- [commands-reference.md](./commands-reference.md)
- [contracts/README.md](./contracts/README.md)
