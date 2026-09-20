<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Stable OpenAI Agents SDK adapters for Python and TypeScript",
  "summary": "Workspai 0.76.0 labels OpenAI Agents SDK starters stable and binds Create and Attach to manifest plus semantic implementation evidence from the same cross-platform matrix.",
  "highlights": [
    {
      "icon": "🏷️",
      "text": "OpenAI Python and TypeScript adapters are labeled stable"
    },
    {
      "icon": "📦",
      "text": "Create and Attach require a reviewed manifest and cross-platform release admission"
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

Released September 20, 2026.

## Stable OpenAI Agents SDK Adapters

This minor release labels OpenAI Agents SDK starters `stable` and binds runtime
authorization to the matching manifest and release baseline from one Adapter
Matrix. Semantic implementation digests remain immutable audit provenance in
the qualification artifacts rather than a runtime lock that must be refreshed
after every routine source edit. It does not
add handoffs, MCP, sessions, voice, sandbox, or approval loops, or let weekly
discovery rewrite Create contracts.

## Agent Framework Adapters

- Python pins `openai-agents` `0.22.2`. TypeScript pins `@openai/agents`
  `0.18.0` with `zod` `4.6.5`.
- Create kit ids are `agent.openai.python` and `agent.openai.typescript`.
  Interactive Create lists every published agent kit; apply still refuses a
  blocked adapter.
- `--framework openai-agents` selects the OpenAI runtime. `--runtime python`
  without `--framework` requires an explicit choice because Microsoft Agent
  Framework and OpenAI Agents SDK are both published.
- Release admission v2 binds the manifest, framework baseline, runtime, and
  platform matrix from Adapter Matrix run `35483229302` for source commit
  `2b25305c6806cd9f39fbda66b646ed9304af167f`. Per-platform semantic
  implementation digests are retained as audit provenance.
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

Conformance-report and admission-candidate contracts move to v2. Their v1 JSON
schemas remain published for consumers, but v1 evidence cannot authorize a v2
release admission.

## Install

```bash
npm install -g workspai@0.76.0
workspai --version
```

The optional npm alias `wspai@0.76.0` targets the same CLI version.

See the [Changelog](../CHANGELOG.md), [Command Reference](../docs/commands-reference.md),
and [Agent Framework Adapter Contract](../docs/agent-framework-adapters.md).
