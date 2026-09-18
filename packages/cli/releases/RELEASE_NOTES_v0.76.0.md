<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Stable OpenAI Agents SDK adapters pending digest re-admission",
  "summary": "Workspai 0.76.0 labels OpenAI Agents SDK starters stable for Python 0.22.2 and TypeScript 0.18.0. Create and Attach stay fail-closed until the new digest is bound from a green matrix.",
  "highlights": [
    {
      "icon": "🏷️",
      "text": "OpenAI Python and TypeScript adapters are labeled stable"
    },
    {
      "icon": "🔒",
      "text": "Create stays fail-closed until the new digest is matrix-bound"
    },
    {
      "icon": "🔀",
      "text": "--runtime python still requires --framework; the CLI does not guess"
    },
    {
      "icon": "🛡️",
      "text": "Handoffs, MCP, sessions, and voice stay unsupported"
    }
  ]
}
-->

# Workspai CLI v0.76.0

Released September 18, 2026.

**Publication status:** Published.

## Stable OpenAI Agents SDK Adapters

This minor release labels OpenAI Agents SDK starters `stable`. It does not
bind the new manifest digest, so Create and Attach stay fail-closed until a
green matrix is promoted. It does not add handoffs, MCP, sessions, voice,
sandbox, or approval loops, or let weekly discovery rewrite Create contracts.

## Agent Framework Adapters

- Python pins `openai-agents` `0.22.2`. TypeScript pins `@openai/agents`
  `0.18.0` with `zod` `4.6.5`.
- Create kit ids are `agent.openai.python` and `agent.openai.typescript`.
  Interactive Create lists every published agent kit; apply still refuses a
  blocked adapter.
- `--framework openai-agents` selects the OpenAI runtime. `--runtime python`
  without `--framework` requires an explicit choice because Microsoft Agent
  Framework and OpenAI Agents SDK are both published.
- Labeling the adapters `stable` changes the manifest digest. The previous
  preview admission on `8eb1308` no longer matches. Bind the next green
  matrix before Create or Attach can write those kits.
- Generated starters resolve the owning `agents/<instance>/` project, inspect
  admitted JSON through allowlisted read-only tools, stream live stdout, accept
  a prompt from argv or stdin, and fail closed on missing context. They do not
  paste context into instructions or treat `boundedGraphSearch` as a shell.

## Compatibility and Verification Boundaries

Existing public commands and schema versions remain supported. Microsoft Agent
Framework adapters stay `preview`. Independent Graph work on `main` is not part
of this CLI publication and is not CLI production authority. This release does
not claim complete runtime validation for every repository or production-complete
OpenAI coverage.

## Install

```bash
npm install -g workspai@0.76.0
workspai --version
```

The optional npm alias `wspai@0.76.0` targets the same CLI version.

See the [Changelog](../CHANGELOG.md), [Command Reference](../docs/commands-reference.md),
and [Agent Framework Adapter Contract](../docs/agent-framework-adapters.md).
