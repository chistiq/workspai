# Compact fact composition kernel v1

## Bottleneck

On clean pnpm `07d862d12b7ba0c858f4073b6afa97d646fefac7`, a full package build stays partial and spends the bulk of its time in composition. Fact canonicalization alone is about 7.5s. The strings exist so JavaScript can order them with `localeCompare` and hash the canonical fact set.

## Compact IR

`workspai.graph-compact-fact.v1` (`WGF1`) is a little-endian batch: a string table plus fixed fact records. Supported records are entity or literal endpoints, evidence with id/sourceKind/relativeLocator/digest, provenance, freshness status and optional renewal, a string extension map, and an empty unknown-zone list. Anything else stays on the TypeScript reference.

## Rust boundary

The bundled WASM export `graph_engine_compose_facts` turns one batch into the same semantic JSON string as `semanticFactCanonical`. It does not sort, admit policy, or publish a graph. Callers copy batches under the existing 256MB WASM memory cap (at most 8192 facts per call). No Cargo install and no download are required at runtime.

## Semantic authority

TypeScript remains the reference. The kernel is used for a build only when `WORKSPAI_GRAPH_FACT_KERNEL=1`. A rejected batch, a trap, or a length mismatch falls back to the TypeScript string for that batch. Differential tests require the strings to be equal. pnpm and OpenBot content-digest prefixes matched with the kernel on and off (`c68fed3af94dec80` and `78b408cd3b23c30d`).

## Why it is not the default

The canonical strings still have to come back to JavaScript for `localeCompare`. On pnpm the fact-canonicalization phase did not get faster (about 7.5s either way). A warm second process looked faster end to end; that delta is not attributed to the kernel. The production path stays the TypeScript reference until a kernel can produce the ordered digest without returning every string.

## Memory

pnpm peak in these runs was about 3.2GB RSS and about 2.7–2.9GB heap. The 256MB WASM limit is large enough for a fact batch and too small for the whole pnpm object graph. This design does not raise that limit.
