# Declaration acceleration: local observations

Date: 2026-09-17. Baseline source: `d42446fec323912971262c248e71664c99b291ad`.
Candidate: the working-tree changes accompanying this note. Linux x64,
Node 24.20.0, ten measured iterations per case. These observations do not
authorize package-primary promotion or establish superiority over the central CLI.

## Changes

- Rust borrows source without complete block comments and iterates lines without
  constructing two line vectors and an intermediate joined string.
- The Node adapter encodes directly into WASM memory, reuses its encoder/decoder,
  and bounds record allocation by source size instead of always reserving 256 KiB.
- Rust stops accumulating declarations at its limit; empty input no longer forms
  a Rust slice from a null pointer. ABI v1 and runtime fallback are preserved.
- Rust and TypeScript preserve physical lines and token separation in block
  comments. Golden tests check multiline CRLF, Unicode, inline comments and
  fragments that must not become invented declaration keywords.
- Both ECMAScript import consumers share a re-export pattern restricted to
  list/star syntax. A CPU sample on OpenBot identified the previous broad export
  expression as a hotspot; it repeatedly searched ordinary declaration bodies.

## Native extraction measurements

One warm-up iteration is excluded. Output assertions execute outside the measured
interval. Times include the Node/WASM boundary and output decoding.

| Case                                         | Baseline p50/p95 ms | Candidate p50/p95 ms | Observed p50 reduction |
| -------------------------------------------- | ------------------- | -------------------- | ---------------------- |
| 1,000 small-file calls, 10 declarations each | 8.210 / 10.685      | 5.373 / 6.926        | 34.6%                  |
| One file, 10,000 declarations                | 5.544 / 8.670       | 3.848 / 4.947        | 30.6%                  |
| One file, 10,000 declarations with comments  | 5.847 / 6.758       | 5.089 / 5.655        | 13.0%                  |

Bundled WASM size decreased from 65,466 to 63,961 bytes. Candidate artifact SHA-256:
`3b82d86f76bfbf9b67978a48df56c2a66f960cd98fcc45510fd59de6b4d6338b`.

## End-to-end observations

Each sample launches `inspect --mode project-only --json` in a fresh process,
including startup, build, serialization and pipe output. The OS file cache is
uncontrolled. The candidate additionally loads a small exit hook for child-process
peak RSS. This is a sequential local before/after observation, not an interleaved
statistical experiment or a disk-cold/warm-incremental comparison.

| Corpus                  | Baseline p50/p95 ms | Candidate p50/p95 ms | Candidate peak RSS MiB |
| ----------------------- | ------------------- | -------------------- | ---------------------- |
| `fixtures/g4` directory | 140.595 / 163.118   | 153.790 / 205.425    | 79.2                   |
| OpenTelemetry Demo      | 1695.887 / 1822.110 | 1634.581 / 1819.804  | 335.4                  |
| OpenBot                 | 3062.158 / 3351.329 | 3162.078 / 3386.623  | 460.4                  |

There is **no demonstrated uniform end-to-end speedup**. G4 and OpenBot medians
increased in this final sample. Do not extrapolate the kernel improvement to
whole-repository latency or memory improvement; baseline peak RSS was not recorded.
Composition remains substantial: candidate p50 was 775 ms for OTel and 1,674 ms for
OpenBot, versus provider p50 of 602 ms and 1,154 ms respectively.

All three builds remain `partial`. Their generation content digests match the
baseline and remain deterministic across the ten runs. This checks the product's
generation digest, not byte identity of timestamp-bearing JSON or semantic recall.
Candidate counts: G4 84 nodes/92 edges; OTel 4,891/6,758; OpenBot 8,862/16,168.

The reference working trees already contained adoption/documentation metadata;
they were read without modification. Their HEADs were:

- OpenBot: `ba3ab6e4aa97d015264dbdc891654a7f449c6517`.
- OTel: `9bfe486ff48ee8a6ea942be74171342cb71a9327`.

## Correctness and checks

Read-only native/reference declaration comparison found zero mismatches and zero
native failures in 551 OpenBot files and 271 OTel files. The corpus checker skips
symlinks, configured build/dependency directories and files larger than 4 MiB;
it does not claim complete language semantics. Digests of the checked locator and
source-content pairs:

- OpenBot: `d8db5c4a7381f1d3762f75db51d678a19ddaeed0bf892dac1861cb6e6fa74a1e`.
- OTel: `b6c00363d61769222aeea2f8cec586e486f776a1b31d92afc0fb8edde4a924b0`.

Rust tests: 10 passed. TypeScript suite: 707 passed; final targeted tests also
passed after adding Unicode namespace re-export coverage. Typecheck, lint,
formatting, build and native inventory/SBOM checks pass. Pre-existing test typing
errors in graph-slice/source-semantics were corrected to enable typecheck.

The overall coverage gate still fails: 89.70% statements against 90%, and 84.07%
branches against 85%. Thresholds were not lowered. The full package/CI gate is
therefore **not green**. No macOS/Windows admission or fresh central-CLI benchmark
was performed in this change.

## Reproduction

From the repository root, after building the graph package:

```sh
node packages/graph/scripts/check-native-declaration-corpus.mjs /path/to/OpenBot /path/to/opentelemetry-demo
node packages/graph/scripts/profile-declaration-pipeline.mjs /tmp/graph-profile.json packages/graph/fixtures/g4 /path/to/opentelemetry-demo /path/to/OpenBot
```

The next performance work should measure and reduce composition/canonicalization
and repeated provider work. Broader semantic extraction, persistent incremental
CLI reuse, and proving superiority over the central CLI remain separate work.
