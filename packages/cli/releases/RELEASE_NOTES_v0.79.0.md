<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Current agent SDK baselines, fully release-admitted",
  "summary": "Workspai 0.79.0 updates Microsoft Agent Framework, OpenAI Agents Python, Google ADK Python, and OpenRouter SDK baselines, promotes the complete six-adapter matrix, and resolves the September 30 npm security audit findings.",
  "highlights": [
    {
      "icon": "✅",
      "text": "All six Agent Framework kits passed Linux, macOS, and Windows qualification"
    },
    {
      "icon": "🔄",
      "text": "Microsoft, OpenAI, Google ADK, and OpenRouter baselines are current"
    },
    {
      "icon": "🧩",
      "text": "Generated Python agents follow the current Microsoft and Google lifecycle contracts"
    },
    {
      "icon": "🔒",
      "text": "The npm audit gate is clean after dependency security updates"
    }
  ]
}
-->

# Workspai CLI v0.79.0

Released September 30, 2026.

**Publication status: published.** Released September 30, 2026.

## Release-admitted Agent Framework Matrix

Workspai 0.79.0 promotes the exact six-adapter candidate produced by
[Agent Framework Adapter Matrix run 88](https://github.com/chistiq/workspai/actions/runs/36690151085).
Every required lane passed on Linux, macOS, and Windows, and the reviewed v2
inventory is bound to source commit
`532a8e91831682cf679e616916a6c9fe34de4c7b`.

The admitted baselines are:

- Microsoft Agent Framework Python `1.19.0` with Foundry `1.13.1`;
- Microsoft Agent Framework .NET `1.22.0` with Foundry
  `1.22.0-preview.260918.1`;
- OpenAI Agents SDK Python `0.22.3` and TypeScript `0.18.0`;
- Google ADK Python `2.10.0` and TypeScript `2.1.0`.

Create and Attach remain fail-closed. A manifest, version, runtime, platform,
or baseline change invalidates admission until a new complete candidate is
reviewed and promoted.

## Upstream Lifecycle Alignment

- Microsoft Python enters the SDK agent as an async context manager, matching
  the current framework resource lifecycle.
- Google ADK Python creates `App(root_agent=...)`, supplies that app to
  `Runner`, and enters the runner through its async context.
- Generated starters retain Workspai's bounded context, credential, mutation,
  and verification boundaries. No dependency install or model call occurs
  during Create.

## OpenRouter Client SDK Baselines

The source-ready AI Gateway kits now pin `@openrouter/sdk` `1.3.33` and
`openrouter` `1.2.32`. Their Workspai qualification status is unchanged:
upstream stable SDK status does not replace the dedicated three-platform
gateway qualification gate. The Go SDK remains excluded while its `0.x` line
is classified beta; the latest reviewed version is `v0.8.32`.

## Security

The September 30 Security Audit reported denial-of-service advisories in
`brace-expansion` and a host-normalization advisory in `fast-uri`. This release
pins `brace-expansion` `5.0.12` and refreshes the AJV-compatible transitive
dependency to `fast-uri` `3.1.8`. `npm audit --audit-level=high` reports zero
vulnerabilities with the release lockfile.

## Compatibility

Existing command and contract schema versions remain supported. OpenAI Agents
SDK adapters remain labeled `stable`; Microsoft Agent Framework and Google ADK
adapters remain `preview`. Stability describes the adapter surface, while
release admission binds the exact reviewed runtime matrix. OpenRouter gateway
kits remain source-ready.

## Install

```bash
npm install -g workspai@0.79.0
workspai --version
```

The optional `wspai` alias is published at the matching `0.79.0` version.

See the [Changelog](../CHANGELOG.md), [Command Reference](../docs/commands-reference.md),
and [Agent Framework Adapter Contract](../docs/agent-framework-adapters.md).
