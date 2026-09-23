<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Release-admitted Google ADK agents for Python and TypeScript",
  "summary": "Workspai 0.78.0 adds preview Google ADK Python and TypeScript kits whose exact baselines passed the complete Linux, macOS, and Windows qualification and entered the reviewed release inventory.",
  "highlights": [
    {
      "icon": "🤖",
      "text": "Google ADK Python 2.9.2 and TypeScript 2.1.0 kits are enabled for Create and Attach"
    },
    {
      "icon": "✅",
      "text": "The complete adapter matrix passed on Linux, macOS, and Windows"
    },
    {
      "icon": "🌊",
      "text": "Streaming follows official ADK partial and final-response semantics"
    },
    {
      "icon": "🔒",
      "text": "Telemetry stays off by default and requires an explicit process-start opt-in"
    }
  ]
}
-->

# Workspai CLI v0.78.0

Released September 23, 2026.

**Publication status: published.** Released September 23, 2026.

## Release-admitted Google ADK Agent Kits

Workspai 0.78.0 adds governed Google Agent Development Kit starters for Python
and TypeScript. Both adapters remain labeled `preview`, but their exact tested
baselines are now release-admitted for Create and Attach after the complete
Linux, macOS, and Windows qualification matrix passed and its candidate was
promoted into the reviewed v2 inventory.

Google ADK remains an Agent Framework integration. Gemini Developer API and
Vertex AI are model-provider profiles inside the generated starters; they are
not AI Gateway kits. OpenRouter remains in the separate Gateway category.

## Python and TypeScript Runtimes

- `agent.google-adk.python` pins `google-adk` `2.9.2` and requires Python
  `>=3.10`.
- `agent.google-adk.typescript` pins `@google/adk` `2.1.0`, `zod` `4.6.5`,
  TypeScript `5.9.3`, and `@types/node` `22.20.3`; it requires Node.js
  `>=20.19.0`.
- Each project receives one isolated `agents/<instance>/` runtime with its own
  dependency manifest, entrypoint, credentialless tests, context loader, and
  environment example.
- Create does not install dependencies, call Gemini or Vertex, run generated
  code, or persist credentials.
- `gemini-api` and `vertex-ai` are explicit provider profiles. The framework
  identity remains `google-adk` in the Workspace Model and Doctor.

## Streaming, Context, and Telemetry

- `event.partial === true` is handled as a display fragment, including repeated
  fragments and prefix collisions. The official final-response event remains
  the canonical turn and is not appended to streamed fragments a second time.
- Intermediate metadata does not reset the fragment window. Tool-call,
  function-response, official final-response, and true model-turn boundaries
  close it deliberately.
- Python and TypeScript use the SDK-provided final-response predicate rather
  than inferring completion from incidental event fields.
- Generated agents inspect Workspai context through bounded read-only tools.
  They do not paste the complete host context into model instructions.
- Telemetry is disabled before ADK import unless
  `WORKSPAI_AGENT_TRACING=1` is present at process startup. Credentialless
  conformance observes a non-recording span by default and a recording span in
  a separate explicitly opted-in process.

## Qualification and Admission

- The full Agent Framework matrix exercised every built-in adapter runtime on
  Linux, macOS, and Windows.
- Each Google lane recorded all 18 mandatory checks and distinct evidence for
  partial streaming, metadata interleaving, tool boundaries, default
  non-recording telemetry, and opted-in recording telemetry.
- Release admission remains bound to the exact adapter manifest, framework
  baseline, runtime, and complete platform list. Any drift fails closed until
  a new reviewed candidate is promoted.
- The packed enterprise CLI smoke requires the exact admitted six-adapter
  inventory, so packaged and source execution cannot disagree about Google ADK
  availability.

## Capability Boundaries

This release supports the governed single-agent starter, typed read-only
Workspai context tools, local execution, streamed model output, and explicit
Gemini Developer API or Vertex AI configuration. Sequential, parallel, loop,
graph Workflow Runtime, A2A, MCP, Agent Engine, Cloud Run, GKE, Google Search,
voice, browser agents, remote agents, and durable sessions remain unsupported.
In-memory sessions are process-local.

## Compatibility

Existing commands and schema versions remain supported. OpenAI Agents SDK
adapters remain `stable`; Microsoft Agent Framework and Google ADK adapters
remain `preview`. OpenRouter gateway kits retain their `source-ready` status.
The generic framework admission boundary still rejects an unpublished or
drifted kit before `--dry-run` and before any workspace mutation.

## Install

```bash
npm install -g workspai@0.78.0
workspai --version
```

The optional `wspai` alias is prepared at the matching `0.78.0` version.

See the [Changelog](../CHANGELOG.md), [Command Reference](../docs/commands-reference.md),
and [Agent Framework Adapter Contract](../docs/agent-framework-adapters.md).
