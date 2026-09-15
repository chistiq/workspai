<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Newer Microsoft Agent Framework pins. Discovery stays a report.",
  "summary": "Workspai 0.75.2 moves Microsoft Agent Framework tested baselines to Python 1.18 and .NET 1.21, and keeps version discovery from changing Create contracts on its own.",
  "highlights": [
    {
      "icon": "📌",
      "text": "Python 1.18.0 and .NET 1.21.0 are the reviewed tested baselines"
    },
    {
      "icon": "🔎",
      "text": "Weekly discovery reports registry candidates without opening a pull request"
    },
    {
      "icon": "🛡️",
      "text": "Create and Attach stay fail-closed until a reviewed pin update lands"
    },
    {
      "icon": "🔁",
      "text": "Agent Create re-observes nested runtime units before it claims Intelligence is sealed"
    }
  ]
}
-->

# Workspai CLI v0.75.2

Released September 14, 2026.

**Publication status:** Published.

## Reviewed Framework Pins Without Automatic Promotion

This patch updates Microsoft Agent Framework tested baselines from the
green discovery report. It does not add a framework, relax verification, or
let weekly discovery rewrite Create contracts.

## Agent Framework Baselines

- Python pins `agent-framework-core` `1.18.0` and `agent-framework-foundry`
  `1.13.0`.
- .NET pins `Microsoft.Agents.AI` `1.21.0` and
  `Microsoft.Agents.AI.Foundry` `1.21.0-preview.260911.1`, with
  `Microsoft.NET.Test.Sdk` `18.10.0` and `xunit.v3.mtp-v2` `4.0.1`.
- Weekly discovery still checks PyPI and NuGet, then stops at a report and
  artifact. It does not commit, open a pull request, or regenerate contracts.
- Create and Attach continue to fail closed unless the reviewed pin and
  admission inventory match.
- Governed agent Create re-observes Model and Graph after writing
  `agents/<instance>`, so nested compile, unittest, and start units are present
  when Create finishes. The generated Change still stays open until
  `change verify`.
- Agent kits do not receive a synthetic HTTP port. Authored Foundry
  environment names stay on the workspace contract.

## Release Operations

- Official-generator qualification can choose `primary` or `full` explicitly.
  An all-generator executed `primary` run for the exact commit can satisfy the
  release gate. Targeted and contract-only runs remain ineligible.

## Compatibility and Verification Boundaries

Existing public commands and schema versions remain supported. Independent
Graph work on `main` is not part of this CLI publication and is not CLI
production authority. This release does not claim complete runtime validation
for every repository.

## Install

```bash
npm install -g workspai@0.75.2
workspai --version
```

The optional npm alias `wspai@0.75.2` targets the same CLI version.

See the [Changelog](../CHANGELOG.md), [Command Reference](../docs/commands-reference.md),
and [Agent Framework Adapter Contract](../docs/agent-framework-adapters.md).
