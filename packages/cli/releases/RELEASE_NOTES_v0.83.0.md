<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Workspai CLI now uses RapidKit Core 0.6.3",
  "summary": "Create FastAPI and NestJS projects with refreshed kit templates and discover 52 validated Core modules from the bundled catalog.",
  "highlights": [
    { "icon": "📦", "text": "Use Core 0.6.3 by default with Python 3.11 through 3.x" },
    { "icon": "🛠️", "text": "Create FastAPI Standard, FastAPI DDD, and NestJS Standard projects with refreshed templates" },
    { "icon": "🔎", "text": "Discover 52 validated modules and consume versioned catalog output as JSON" },
    { "icon": "🔌", "text": "Use refreshed OpenRouter SDK pins in the TypeScript and Python gateway starters" }
  ]
}
-->

# Workspai CLI v0.83.0

Released November 23, 2026. **Publication status: Published November 23, 2026.**

Workspai CLI 0.83.0 updates its RapidKit Core integration. This release covers
the optional Python engine, the three Core-backed kits, and the module catalog
used by the CLI recommender.

## Core 0.6.3 and Python compatibility

- The CLI installs and validates `rapidkit-core==0.6.3` by default. The
  bridge supports the console entry point provided by the published package.
- Core requires Python `>=3.11,<4.0`. Use a compatible interpreter for Core
  installation, Core-backed scaffolding, and module installation. If a
  workspace Core environment still uses Python 3.10, recreate that environment
  with a supported interpreter before running Core-backed commands.
- NestJS runs on Node.js. Its Core-based scaffolding and module commands use
  the Python bridge. Generators that do not use Core retain their own runtime
  requirements.
- Maintainers can override the installed Core target for development or CI.
  See the [CLI setup guide](../docs/SETUP.md).

## Kits and module catalog

- The packaged templates are synchronized for `fastapi.standard`,
  `fastapi.ddd`, and `nestjs.standard`. Offline FastAPI scaffolding renders
  the minimum supported Python version into the manifest.
- The bundled catalog contains 52 validated free modules, including canonical
  install IDs, declared dependencies, framework support, and capabilities.
  Maintainers can refresh the catalog and kit templates together using
  `npm --workspace workspai run sync-core`. See the
  [development guide](../docs/DEVELOPMENT.md).
- `workspai modules list --json-schema 1` writes parseable JSON to stdout.
  Use an exact module slug such as `free/security/cors` when installing a
  module into a compatible project.
- With a provider configured, the AI recommender batches missing or stale
  module embeddings. Cached vectors are reused only when they match the
  current input and embedding model. See the [AI guide](../docs/AI_FEATURES.md).

## OpenRouter gateway SDKs

The source-ready gateway starters use `@openrouter/sdk` `1.5.131` for
TypeScript and `openrouter` `1.3.206` for Python. SDK discovery confirmed the
same versions in the registries and GitHub releases. Linux generated-project
and lifecycle checks passed. See [Model Gateways](../docs/model-gateways.md)
for the qualification status.

## Agent Framework SDK candidates

Discovery writes the report before evaluating promotion. Registry failures,
version regressions, and GitHub disagreements remain visible in the uploaded
report and stop promotion. Candidate pins are produced as a separate file.

| Framework | Python SDK candidate | Other runtime SDK candidate |
| --- | --- | --- |
| Microsoft Agent Framework | `agent-framework-core` `1.26.0`, `agent-framework-foundry` `1.16.2` (Python 3.11+) | .NET `Microsoft.Agents.AI` `1.28.0`, Foundry `1.28.0-preview.261106.1` |
| OpenAI Agents | `openai-agents` `0.25.0` | TypeScript `@openai/agents` `0.22.0` |
| Google ADK | `google-adk` `2.15.0` | TypeScript `@google/adk` `2.5.0` |

The [exact candidate manifest](./AGENT_FRAMEWORK_CANDIDATES_v0.83.0.json)
includes runtime-support pins. All six candidates passed credentialless
generated-project conformance on Linux. The manual and weekly full matrix runs
qualify the proposal from the run's `main` commit. Apply the resulting patch to update the bundled
baseline and admission together for Create and Attach. See the
[admission guide](../../../.github/agent-framework-version-update.md).

## Install or upgrade

```bash
npm install -g workspai@0.83.0
workspai --version
workspai modules list --json-schema 1
```

Use `npm install -g wspai@0.83.0` for the optional short command.
See the [project creation guide](../docs/creating-workspaces-and-projects.md)
for the supported kit and runtime combinations.

## Verification

Implementation checks on Linux with Node 24.20.0 passed. The CLI test suite
reported 3,320 passed and 12 skipped. Build, typecheck, lint, and formatting
passed. The installed Core reported version 0.6.3 and returned the same 52
module IDs as the bundled catalog. The offline FastAPI manifest was parsed
and checked for Python 3.11.

| Kit | Modules installed with the locally linked CLI | Project checks |
| --- | --- | --- |
| FastAPI Standard | CORS | 5 project tests and 2 focused module tests passed |
| FastAPI DDD | Rate Limiting and Settings | 20 project tests and 15 focused module tests passed |
| NestJS Standard | Security Headers and Settings | 8 Jest tests, 6 E2E tests, and build passed |

Publication follows [CI and release workflows](../docs/ci-workflows.md) for the
target commit.

## Known issues in Core 0.6.3

- The published Core's `modules summary` command returns an empty list for
  the nested module catalog. Use `workspai modules list --json-schema 1` for
  inventory and the project's `registry.json` for installed modules.
- npm reported 19 moderate dependency findings in the generated NestJS
  project used for local verification. This result describes the generated
  project's dependency tree.
