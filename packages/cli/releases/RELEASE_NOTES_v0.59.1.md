<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Consumer-aware contract delivery",
  "summary": "Workspai 0.59.1 synchronizes canonical contracts with locally available consumers before publication while keeping CLI and consumer release schedules independent.",
  "highlights": [
    {
      "icon": "🔄",
      "text": "Contract-affecting commits regenerate and synchronize canonical and local consumer mirrors"
    },
    {
      "icon": "🛡️",
      "text": "Pre-push requires generated CLI contract outputs to be committed before publication"
    },
    {
      "icon": "🔌",
      "text": "Consumer-owned version floors no longer force redundant CLI releases"
    },
    {
      "icon": "✅",
      "text": "Breaking contract changes remain protected by compatibility and schema-version gates"
    }
  ]
}
-->

# Workspai CLI v0.59.1

Released August 17, 2026.

## Consumer-Aware Contract Delivery

Workspai 0.59.1 closes a release-ordering gap between the CLI and its
consumers. Contract changes are now regenerated and synchronized with locally
available mirrors during development, while npm publication remains governed
by the canonical CLI outputs rather than by a separate consumer release.

## Contract changes are synchronized before push

When a contract source changes, the local commit workflow regenerates the
canonical contract set, updates the root mirrors, and synchronizes supported
consumer repositories when they are available. Pre-push then requires the
generated CLI outputs to be committed, preventing a release from omitting a
contract change that exists only in a developer's working tree.

The workflow keeps consumer drift visible without making an independently
versioned extension a prerequisite for publishing a backward-compatible CLI
patch.

## Release ownership remains correctly separated

The CLI owns schemas, generated inventories, compatibility guarantees, and
breaking-change gates. Each consumer owns its minimum supported CLI version
and its own release validation. This separation lets an extension adopt an
already published capability without changing the CLI solely to update a
consumer-specific version floor.

Breaking contract removal and incompatible schema changes remain blocked by
the canonical compatibility and schema-version checks.

## Upgrade

After publication:

```bash
npm install -g workspai@0.59.1
workspai --version
```

Expected output:

```text
0.59.1
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias remains available at the matching version.
- No public CLI command or artifact schema is removed by this patch.
- Existing v0.59.0 consumers remain compatible.

## Breaking changes

None.
