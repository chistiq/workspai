# Workspai Configuration Guide

Workspai has two configuration surfaces with different scopes. Command-line
flags remain authoritative when a command supports the corresponding option.

## User configuration

`~/.workspairc.json` stores user-level settings. The legacy
`~/.rapidkitrc.json` path is read only when the canonical file is absent.

Supported fields include:

```json
{
  "defaultKit": "fastapi.standard",
  "defaultInstallMethod": "poetry",
  "pythonVersion": "3.10",
  "author": "Platform Team",
  "license": "MIT",
  "skipGit": false,
  "aiEnabled": true,
  "telemetry": false
}
```

The `workspai config` command owns persisted AI settings such as the OpenAI API
key and `aiEnabled`. Do not commit user configuration or API keys.

## Directory configuration

The CLI can discover the nearest configuration file while walking from the
current directory toward the filesystem root:

- `workspai.config.json` (recommended; data-only and safe by default)
- `workspai.config.cjs`
- `workspai.config.mjs`
- `workspai.config.js`, when its syntax matches the containing package type
- `rapidkit.config.*`, as a legacy fallback

JavaScript configuration is executable code. The CLI refuses to import it
unless trust is explicit:

```bash
npx workspai my-workspace --trust-config
# Non-interactive equivalent for controlled CI:
WORKSPAI_TRUST_CONFIG=1 npx workspai my-workspace
```

Do not trust executable configuration from an unreviewed repository. Prefer
`workspai.config.json` whenever computed values are not required.

Example:

```javascript
// workspai.config.cjs
module.exports = {
  workspace: {
    defaultAuthor: 'Platform Team',
    pythonVersion: '3.11',
    installMethod: 'poetry',
  },
  projects: {
    defaultKit: 'fastapi.standard',
    skipGit: false,
  },
};
```

RapidKit Core-backed workflows currently require Python 3.11 or newer.
`pythonVersion` selects a project target; Workspai normalizes Core-backed
installations to the Core minimum when a lower version is configured. It does
not make Python a dependency for Node-only or other Python-free Workspai
workflows.

## Command coverage

Directory configuration is currently consumed by the legacy top-level creation
shorthand, for example `npx workspai my-workspace`. Its effective precedence is:

```text
CLI flags > workspai.config.* > ~/.workspairc.json > legacy config > defaults
```

Canonical `create workspace` and `create project` flows do not currently apply
all directory-config project defaults. In particular, `addDefaultModules` and
`skipInstall` are reserved fields and are not automatically executed. Use
explicit canonical command flags instead:

```bash
npx workspai create workspace platform --profile polyglot --yes
npx workspai create project fastapi.standard api --skip-install --yes
```

Config discovery means a file can be loaded by a supported flow; it does not
mean every command consumes every field. The
[Command Reference](./commands-reference.md) is authoritative for command flags.

## Debugging

Use `--debug` on the legacy shorthand to inspect loaded and merged configuration:

```bash
npx workspai my-workspace --debug
```

A malformed or untrusted executable config fails closed with its path and an
actionable error.

## Workspace policy is separate

Configuration files supply creation defaults. Runtime governance belongs to
`.workspai/policies.yml` and should normally be managed through:

```bash
npx workspai workspace policy show
npx workspai workspace policy set mode strict
npx workspai workspace policy set dependency_sharing_mode shared-runtime-caches
```

See the [example config](../workspai.config.example.cjs),
[Creating Workspaces and Projects](./creating-workspaces-and-projects.md), and
[Command Reference](./commands-reference.md).
