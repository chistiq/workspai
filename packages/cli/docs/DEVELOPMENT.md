# Development Guide

Maintainer reference for the Workspai CLI (Node/TypeScript bridge to Python Core).

**End users:** [../README.md](../README.md) · [README.md](./README.md) · [OPEN_SOURCE_USER_SCENARIOS.md](./OPEN_SOURCE_USER_SCENARIOS.md)

## Prerequisites

- Node.js `>=20.19.0`
- npm — see [PACKAGE_MANAGER_POLICY.md](./PACKAGE_MANAGER_POLICY.md)

```bash
npm ci
npm run build
```

## Quality checks

```bash
npm run validate
npm run contracts:validate
npm run test:drift
```

Focused suites: [ci-workflows.md](./ci-workflows.md) · [SETUP.md](./SETUP.md)

## Configuration

User defaults: [config-file-guide.md](./config-file-guide.md) (`$HOME/.workspairc.json`, `workspai.config.*`, with legacy fallbacks).

Priority: CLI flags > environment variables > config file > defaults.

### Local Core checkout

```bash
export WORKSPAI_DEV_PATH=/path/to/local/rapidkit-core
npx workspai my-workspace
```

`RAPIDKIT_DEV_PATH` remains supported as a legacy fallback.

## CLI workflows

```bash
# Direct project creation
npx workspai create project fastapi.standard my-api --output .
npx workspai create project nextjs my-web --yes

# Workspace mode
npx workspai create workspace my-workspace --here --yes --profile polyglot
cd my-workspace
npx workspai bootstrap --profile polyglot
npx workspai create project
```

Full syntax: [commands-reference.md](./commands-reference.md)

## Testing

```bash
npm test
npm run test:e2e
npm run test:scenarios:full
npm run test:runtime-matrix:full
```

### Pre-push gate cache

The local pre-push workflow content-addresses the runtime contract matrix and
official-generator dry-run smoke. A successful result is reused for up to 24
hours only when the built CLI, relevant contracts/templates/scripts, package
metadata, lockfile, platform, architecture, Node version and command are
unchanged. Failed runs are never cached. CI always executes both gates fresh.

```bash
# Force every cached pre-push gate to execute again.
WORKSPAI_PREPUSH_CACHE=0 git push

# Override the local TTL in milliseconds (zero disables reuse).
WORKSPAI_PREPUSH_CACHE_TTL_MS=0 git push
```

Cache records live under `node_modules/.cache/workspai-prepush-gates` and are
disposable. Other pre-push checks remain uncached.

## Manual smoke

```bash
npm run build
node dist/index.js --help
node dist/index.js create project fastapi.standard test-fastapi --output . --yes --skip-install
```

## Debugging

```bash
npx workspai my-workspace --debug
```

## Environment variables

See [SETUP.md](./SETUP.md#environment-variables) for bridge, scenario, and cache variables.

## See also

- [Documentation index](./README.md)
- [contracts/README.md](./contracts/README.md)
- [OPTIMIZATION_GUIDE.md](./OPTIMIZATION_GUIDE.md)
- [UTILITIES.md](./UTILITIES.md)
