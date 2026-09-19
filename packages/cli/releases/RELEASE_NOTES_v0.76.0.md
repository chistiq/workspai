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
      "text": "Create and Attach write agent kits only after manifest and implementation digests are promoted"
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

Release target: September 19, 2026.

**Publication status:** Pending the v2 implementation-bound matrix and the
post-promotion CI run. Do not publish from the pre-promotion tree.

## Stable OpenAI Agents SDK Adapters

This minor release labels OpenAI Agents SDK starters `stable` and binds the
matching manifest and semantic implementation digests from one Adapter Matrix,
so Create and Attach cannot use evidence from older generated templates. It does not
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
- Release admission v2 binds both the manifest and deterministic semantic
  implementation digest. The pre-promotion inventory is intentionally empty;
  the qualifying matrix must produce and promote evidence for the release SHA.
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
