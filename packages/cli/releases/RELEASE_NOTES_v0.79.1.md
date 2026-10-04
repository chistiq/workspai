<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Easier project setup, back navigation, and safer dependencies",
  "summary": "Workspai 0.79.1 adds back navigation to guided setup, makes workspace and project quickstarts easier to follow, and removes vulnerable braces dependency chains while keeping Node.js 20.19+ support.",
  "highlights": [
    { "icon": "↩️", "text": "Go back through Create setup without restarting the command" },
    { "icon": "🚀", "text": "Discover starters for backends, frontends, AI agents, and model gateways" },
    { "icon": "📖", "text": "Simpler READMEs and a task-focused documentation entry point" },
    { "icon": "🔒", "text": "Remove vulnerable braces chains without raising the Node.js requirement" }
  ]
}
-->

# Workspai CLI v0.79.1

Released October 4, 2026.

**Publication status: published.** Released October 4, 2026.

## Go Back Without Starting Over

Run `workspai create` to create a workspace, scaffold a new project, or add
existing software. Setup menus now include **Back** after the first step;
text inputs accept **`/back`** to revisit the previous step.

Change your category, kit, name, workspace location, or initial environment
choices before creation starts. Previously accepted setup choices are retained,
and changing an earlier choice discards its abandoned downstream selections.
The setup history is isolated to the current invocation.

Workspace profile and optional Python environment selections also support
backtracking before workspace creation begins. Ctrl+C still cancels the flow.
Back navigation does not undo created files, repeat failed creation effects,
or control prompts owned by external generators.

## A Clearer First Run

The main README, npm package README, and documentation entry point now lead
with user outcomes and a shorter path to the first run.

- Create a workspace to organize apps and services with shared context and checks.
- Create a project from backend, frontend, desktop, AI Agent, AI Gateway, or
  extension starters and register it with workspace management.
- Adopt existing software without moving the source.
- Find the next guide by task; architecture and reference details remain available.

Kit support and release-admission labels remain visible in the picker. This
patch does not change framework qualification or gateway support status.

## Dependency Security

The October 4 audit reported vulnerable `braces` chains through `chokidar` 3,
Nunjucks' optional watcher peer, and `lint-staged` / `micromatch`.

This patch removes the unused root `chokidar` 3 dependency and upgrades
`lint-staged` to `^16.4.0`, which uses `picomatch`. Nunjucks rendering remains
available; its optional vulnerable watcher is absent from the release tree.
The refreshed lockfile passed a clean isolated `npm ci` and
`npm audit --audit-level=high` with zero reported vulnerabilities.

## Compatibility

Node.js **20.19+** and npm remain required. Non-interactive `--yes`, explicit
create commands, JSON output, existing command names, and contract schemas
remain supported. Workspai is the canonical package; `wspai` is the optional
short alias. Independent graph work is not part of this CLI patch release.

## Install or Upgrade

```bash
npm install -g workspai@0.79.1
workspai --version
```

For the short alias:

```bash
npm install -g wspai@0.79.1
wspai --version
```

## Verification

- Create/navigation regression suites: 143 tests passed, 2 skipped.
- Back navigation and Ctrl+C checked in a real terminal.
- CLI build, TypeScript typecheck, touched-file lint, and documentation validation passed.
- Cross-platform lockfile check and dependency audit passed.

See the [Changelog](../CHANGELOG.md), [Getting Started](../docs/creating-workspaces-and-projects.md),
and [Command Reference](../docs/commands-reference.md).
