<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Six updated Agent Framework baselines admitted",
  "summary": "Workspai 0.80.0 updates all six Microsoft, OpenAI, and Google agent framework baselines and admits them after the complete Linux, macOS, and Windows qualification matrix.",
  "highlights": [
    { "icon": "🤖", "text": "Use current Microsoft, OpenAI, and Google agent framework SDK baselines" },
    { "icon": "✅", "text": "Create and Attach are enabled for all six cross-platform admitted agent kits" },
    { "icon": "🐍", "text": "Google ADK Python starters now target Python 3.11 or newer" },
    { "icon": "🔀", "text": "OpenRouter Client SDK pins are refreshed while Gateway remains source-ready" }
  ]
}
-->

# Workspai CLI v0.80.0

Planned release: October 28, 2026.

**Publication status: pending.**

## Current Agent Framework Baselines

All six built-in Microsoft Agent Framework, OpenAI Agents SDK, and Google ADK
adapters now use the current SDK baselines. The complete Linux, macOS, and
Windows matrix passed in [Agent Framework Adapter Matrix run 92](https://github.com/chistiq/workspai/actions/runs/40584579308),
and the reviewed release inventory now binds the exact manifests and
platform-specific implementation digests.

- Microsoft Agent Framework Python `1.23.0`, Foundry `1.15.0`, and
  `azure-identity` `1.27.0`.
- Microsoft Agent Framework .NET `1.26.0`, Foundry
  `1.26.0-preview.261023.1`, .NET Test SDK `18.11.0`, and xUnit `4.0.2`.
- OpenAI Agents Python `0.24.0`.
- OpenAI Agents TypeScript `0.21.0`, with `zod` `4.6.7`.
- Google ADK Python `2.13.0`, which requires Python `>=3.11`.
- Google ADK TypeScript `2.3.0`, with `zod` `4.6.7`.

The OpenAI adapters remain labeled `stable`; Microsoft and Google ADK remain
`preview`. Release admission is tied to the exact framework baseline,
manifest, runtime, and Linux/macOS/Windows platform inventory.

## OpenRouter SDK Baselines

The source-ready OpenRouter Client SDK pins are now TypeScript `1.5.13` and
Python `1.3.86`. These versions are not Workspai-qualified: Gateway remains
`source-ready`, is not release-admitted, and does not support Attach. Create
does not install dependencies, call a model, or store credentials.

## Compatibility

Existing commands and contract schemas remain supported. Node.js **20.19+**
and npm remain required. The Google ADK Python kit requires Python **3.11+**.
The `wspai` alias remains an optional matching-version package. This is a CLI
release; it does not publish an independent Graph package.

## Install or Upgrade

```bash
npm install -g workspai@0.80.0
workspai --version
```

For the short alias:

```bash
npm install -g wspai@0.80.0
wspai --version
```

## Verification

- All six Agent Framework adapters passed the full Linux, macOS, and Windows
  matrix in run 92 on commit `654b176`.
- CI & Metrics Matrix, Workspace E2E Matrix, Windows Bridge E2E, and Security
  Audit passed on the same source commit.
- Release checks for this version must pass before publication.

See the [Changelog](../CHANGELOG.md),
[Agent Framework Adapter Contract](../docs/agent-framework-adapters.md),
[AI Gateway guide](../docs/model-gateways.md), and
[project creation guide](../docs/creating-workspaces-and-projects.md).
