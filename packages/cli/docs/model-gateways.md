# AI Gateway

AI Gateway is a first-class Workspai project category for unified model access
and routing. It is not an Agent Framework.

## Why Gateway is not Agent Framework

Agent Framework owns agent loops, tools, handoffs, state, and orchestration.
AI Gateway owns model and provider access, routing preferences, fallbacks,
privacy policy, and normalized transport behavior.

A model identifier is runtime configuration, not a project kit. Workspai owns
project generation, governance, context, lifecycle, verification, workspace
integration, and proof. OpenRouter owns provider and model routing. Generated
projects do not reimplement OpenRouter's routing algorithms.

Future agent-to-gateway composition should consume the generated Model Gateway
port. Do not copy these templates into an Agent Framework kit.

## Current kits

These kits are source-ready in this worktree. That is not Workspai release
admission. Local Linux success may justify only
`source-stable, awaiting cross-platform qualification`. SDK `1.x` stability is
an upstream classification, not a Workspai release gate.

| Kit | Runtime | Official Client SDK | Reviewed |
| --- | --- | --- | --- |
| `gateway.openrouter.typescript` | Node.js `>=20` | `@openrouter/sdk` `1.3.11` | 2026-09-21 |
| `gateway.openrouter.python` | Python `>=3.10` | `openrouter` `1.2.11` | 2026-09-21 |

Aliases: `openrouter.typescript`, `gateway.openrouter.ts`, `openrouter-typescript`,
and the matching Python aliases. Bare `openrouter` is not an alias.

Interactive Create shows **AI Gateway** with the hint **Unified model access
and routing** after at least one gateway kit is registered. Labels are:

- `AI Gateway · OpenRouter · TypeScript`
- `AI Gateway · OpenRouter · Python`

```bash
npx workspai create project gateway.openrouter.typescript <name>
npx workspai create project gateway.openrouter.python <name>
```

Create does not install dependencies, call a model, or write credentials.

## Intentionally unsupported languages

The official Go SDK (`github.com/OpenRouterTeam/go-sdk`) was evaluated on
2026-09-21. The upstream README classifies the current `0.x` line as beta and
warns that breaking changes may ship in minor releases. proxy.golang.org
reported `v0.8.11`. Go is excluded from the stable Create surface until
upstream classifies a release line as stable.

The OpenRouter Agent SDK (`@openrouter/agent`) belongs to the agent-runtime
dimension. It is not used by AI Gateway kits and is not added as
`agent.openrouter.typescript` in this family.

## Configuration

Required environment:

- `OPENROUTER_API_KEY` — server-side only
- `OPENROUTER_MODEL` — chosen by the operator; Workspai does not default a
  billable model

Optional attribution maps to the official SDK fields:

- TypeScript: `httpReferer`, `appTitle` via `OPENROUTER_HTTP_REFERER` and
  `OPENROUTER_APP_TITLE`
- Python: `http_referer`, `x_open_router_title` via `OPENROUTER_HTTP_REFERER`
  and `OPENROUTER_X_OPEN_ROUTER_TITLE`

Routing and privacy policy live in source-controlled `gateway.policy.json`.
Field names match the pinned SDK for that language. Unknown fields are rejected
fail-closed in both languages. Supported controls:

| Official field | TypeScript policy | Python policy | Validation |
| --- | --- | --- | --- |
| model fallbacks | `models` | `models` | unique non-empty strings; must not repeat `OPENROUTER_MODEL` |
| `allowFallbacks` | `allowFallbacks` | `allow_fallbacks` | boolean when present |
| `order` / `only` / `ignore` | same camelCase | same snake_case | unique non-empty strings; `only`∩`ignore` empty; `order` must not include ignored providers |
| `sort` | string or `{ by, partition }` | string or `{ by, partition }` | `price`/`throughput`/`latency`/`exacto`; `partition` is `model` or `none` |
| `quantizations` | camelCase list | snake_case list | pinned SDK enum values |
| `requireParameters` | `requireParameters` | `require_parameters` | boolean when present |
| `zdr` | `zdr` | `zdr` | boolean; cannot combine with `dataCollection`/`data_collection` `allow` |
| `dataCollection` | `dataCollection` | `data_collection` | `allow` or `deny` |
| `enforceDistillableText` | `enforceDistillableText` | `enforce_distillable_text` | boolean when present; both pinned SDKs expose this field |
| `maxPrice` | `maxPrice` | `max_price` | object with `prompt`/`completion`/`request`/`image`/`audio` as non-negative numeric strings that remain finite after numeric interpretation |
| `preferredMinThroughput` | number or `{ p50, p75, p90, p99 }` | same | finite non-negative numbers |
| `preferredMaxLatency` | number or `{ p50, p75, p90, p99 }` | same | finite non-negative numbers |
| timeout | `timeoutMs` | `timeout_ms` | integer 1–600000; env overrides with a digit string |
| attribution | `httpReferer`, `appTitle` | `http_referer`, `x_open_router_title` | strings when present |

`exacto` is part of the pinned SDK `ProviderSort` enums, not a Workspai extension.
Malformed JSON and wrong types raise `GatewayConfigurationError` before SDK
construction. Contradictory policy, including ZDR combined with
`dataCollection: "allow"`, fails before a network request.

Omitted privacy or routing fields leave OpenRouter upstream defaults in
effect. The SDKs document `dataCollection` / `data_collection` default as
`allow` when unset. Application-side retries are set to strategy `none` so they
cannot duplicate billable requests. OpenRouter may still apply provider
fallbacks when `allowFallbacks` / `allow_fallbacks` is not `false`.

Capabilities such as tools, JSON schema, structured output, images, audio, and
embeddings vary by model and provider. These starters only claim chat
generation and streaming.

## Security

- Never commit, log, or serialize API keys.
- Generated clients are server-side only. Do not expose `OPENROUTER_API_KEY`
  through browser bundles or frontend environment prefixes such as `VITE_` or
  `NEXT_PUBLIC_`.
- Diagnostics redact Authorization headers, API keys, URL secrets, and request
  bodies.
- TLS verification is not disabled.
- Telemetry and prompt recording are not added.

## Lifecycle

After local install, documented commands are:

TypeScript: `npm install`, `npm test`, `npm run typecheck`, `npm run build`,
`npm run smoke`, `npm start`.

Python: create a virtualenv, `python -m pip install -e .`, `python -m compileall .`,
`python -m unittest discover -s tests`, `python main.py --smoke`, `python main.py`.

Workspace Run uses those same manifests and the generated project's declared
polyglot unit commands. A single-step `start` is executed as argv, not a shell
string, so Python venv paths that contain spaces still fail closed for missing
credentials. `test` and `--smoke` inject a fake transport. They do not require
a live `OPENROUTER_API_KEY`.

Streaming uses the official Client SDK event stream. Opening and iterating the
stream are both normalized: configuration errors stay configuration errors,
timeouts and caller aborts stay recognizable, and other failures become
`GatewayUpstreamError` with redacted messages and preserved status / request id /
retry-after when the SDK exposes them. Cleanup is once-only and prefers, in
order: async iterator `return()` / generator `close()`, then SDK `close()`, then
SDK `cancel()`. A cleanup failure does not replace the primary error or convert
a successful completion into an error.

The TypeScript starter forwards `AbortSignal` through `chat.send` options,
including an already-aborted signal. Pinned `@openrouter/sdk` `1.3.11`
`EventStream` extends `ReadableStream` and does not expose a dedicated `close()`.
Cancellation is `ReadableStream` async-iterator `return()` → `cancel()`. If the
stream has already errored, `cancel()` may be a no-op; the gateway still drops
its own reference and remains usable for a later request. The Python starter
closes the SDK iterator first (`EventStream.generator.close()`), which is the
consumer `generator.close()` path. Python does not expose `AbortSignal`.
Application-side retries stay disabled. Timeouts use SDK `timeoutMs` /
`timeout_ms`. An empty successful completion returns an empty string.

Exact pins live in
[`version-baselines.v1.json`](../src/model-gateways/version-baselines.v1.json).
Do not copy versions into unrelated files.

## Qualification boundary

Workspai source readiness is not release qualification. These kits are not
described as `stable`, `release-ready`, `admitted`, or `published` until Linux,
macOS, and Windows CI prove generated-project installation and lifecycle on the
same commit SHA.
