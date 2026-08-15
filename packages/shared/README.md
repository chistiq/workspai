# `@workspai/shared`

Unpublished protocol foundation for independent Workspai packages.

Status: **development-only · protocol foundation · not publishable**

> This is the developing independent Shared implementation. The released
> Workspai CLI currently uses its official internal contract and envelope
> implementation. Shared is not imported by or connected to the CLI runtime;
> that migration is prohibited until standalone stability and the later bridge,
> parity and replacement gates pass.

This workspace exists so Graph and later domain packages share one dependency-
leaf binding for accepted WIS identity, result, diagnostic, generation and scope
contracts. Its protocol API contains no discovery, graph, model, diagnosis,
rendering, transport, filesystem or process behavior. The separate executable
is a thin explicit-file/stdin validation adapter and owns no domain behavior.

The current exports are SH1/SH2 candidate contracts, generated validation, a
self-validating multi-contract catalog and the bounded SH3-B current/previous
compatibility API—not a stable public API. SH3-C adds executable, deterministic
scale and adversarial gates while preserving explicit remote-browser and peak-
memory limitations. SH5 adds explicit ESM `/browser` and `/node` entry points
plus the development-only `workspai-shared` validator executable. The candidate can generate multiple
independent schemas, types and standalone validators in one deterministic,
dependency-aware portfolio. Publication remains blocked until the Shared
roadmap's semantic-lock, compatibility, conformance and external-consumer gates
pass.
SH6 additionally proves that the independently developing Graph package can
consume the public contracts, compatibility, validation and registry subpaths
from separately packed tarballs. This is adoption evidence only: it neither
advances Graph maturity nor connects Shared to the central CLI.
SH7 is an active standalone-stability audit. Its strict command intentionally
returns exit `2` while normative, remote-platform, real-browser, provenance and
independently owned external-consumer evidence remain incomplete. A blocked
audit is not a failed local build and cannot be converted into admission by an
internal fixture.
Both `private: true` and a refusing `prepublishOnly` guard prevent accidental
publication during development.

The canonical source, versioning, quality gates and any future npm publication
remain in the `chistiq/workspai` monorepo. A future package-focused GitHub
repository is a read-only discovery mirror, not a release or contribution
authority.

Consumer contracts, API guidance, security boundaries, support policy,
architecture and roadmaps are maintained once in the canonical Workspai
documentation portfolio. They are intentionally not duplicated in this public
package repository or npm artifact.

Candidate development checks:

```bash
npm run generate:check
npm run scale:check
npm run check
npm run admission:audit
# Strict admission decision; currently expected to exit 2.
npm run admission:check
```

Candidate standalone validation after a local package build:

```bash
workspai-shared schema list --json
workspai-shared validate artifact.json --contract core-result-envelope --json
workspai-shared compatibility artifact.json --json
```

The executable accepts `-` for stdin, never echoes validated payloads, performs
no discovery or network access and returns exit `0` for success, `1` for input
or usage failure, `3` for contract/compatibility failure and `130` for observed
cancellation. These preview commands do not make the package publishable.

Contribution and design workflows are maintained by the Workspai package team.
