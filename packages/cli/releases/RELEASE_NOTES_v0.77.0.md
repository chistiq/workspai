<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Source-ready OpenRouter AI Gateway kits",
  "summary": "Workspai 0.77.0 adds pinned OpenRouter TypeScript and Python AI Gateway Create kits. The surface stays source-ready and is not labeled qualified or stable.",
  "highlights": [
    {
      "icon": "🔀",
      "text": "OpenRouter TypeScript and Python gateway kits are on Create"
    },
    {
      "icon": "📌",
      "text": "@openrouter/sdk 1.3.11 and openrouter 1.2.11 stay the reviewed pins"
    },
    {
      "icon": "🛡️",
      "text": "Attach is unsupported and the beta Go SDK stays excluded"
    },
    {
      "icon": "🧪",
      "text": "Path-triggered qualification runs on Linux, macOS, and Windows"
    }
  ]
}
-->

# Workspai CLI v0.77.0

Released September 21, 2026.

## Source-ready OpenRouter AI Gateway Kits

This minor release adds the first AI Gateway Create kits. They are
source-ready. Upstream SDK `1.x` stability is not Workspai release admission,
and this version does not label the kits `qualified` or `stable`.

## AI Gateway

- TypeScript kit `gateway.openrouter.typescript` pins `@openrouter/sdk`
  `1.3.11`. Python kit `gateway.openrouter.python` pins `openrouter` `1.2.11`.
- Generated projects are server-owned, keep the model as runtime configuration,
  and do not call a model during Create. Attach is unsupported. The official Go
  SDK remains beta and is excluded.
- `contracts.consumes` comes from the kit `gatewayId`. Doctor and the workspace
  model keep framework `openrouter`, kind `gateway`, archetype `service`, and
  the authored Node.js or Python runtime.
- Setuptools src-layout packages are not blocked for a missing `src/__init__.py`
  when a nested package already has one.
- Path-triggered Model Gateway Qualification, and manual `full` mode, qualify
  both adapters on Linux, macOS, and Windows. Manual `fast` mode stays on
  Linux.
- Version discovery compares sdk-core packages only. A candidate is reported
  when the registry and GitHub agree on a newer eligible stable version. The
  job summary shows that diff. Exit status `10` means update-available, not ten
  updates. Discovery does not write the baseline, open a pull request, or admit
  a release. `typescript` and `@types/node` are not candidates. Go `0.x` stays
  excluded.

## Workspace Run

Lifecycle stage commands, including `&&` chains, run as argv. They are not
passed to a shell, so an absolute interpreter path is not expanded by
`/bin/sh`.

## Compatibility and Verification Boundaries

Existing public commands and schema versions remain supported. OpenAI Agents
SDK adapters stay `stable`. Microsoft Agent Framework adapters stay `preview`.
Independent Graph work on `main` is not part of this CLI publication. This
release does not claim production-complete OpenRouter coverage or a qualified
gateway surface.

## Install

```bash
npm install -g workspai@0.77.0
workspai --version
```

The optional npm alias `wspai@0.77.0` targets the same CLI version.

See the [Changelog](../CHANGELOG.md), [Command Reference](../docs/commands-reference.md),
and [AI Gateway](../docs/model-gateways.md).
