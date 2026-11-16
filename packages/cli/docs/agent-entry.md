# Canonical-First Agent Entry

Workspai gives coding agents one portable way to enter an adopted project
without treating a broad repository scan as the source of architectural truth.

The protocol is:

```text
Host discovery
  → portable project entry
  → task context (identity, freshness, scoped Graph, lifecycle)
  → applicable Goal handoff and Skill
  → targeted live source inspection
```

This is deliberately **host-first, not model-first**. A model does not decide
which repository instruction file is loaded. Codex, Claude Code, Gemini CLI,
Qwen Code, Kimi Code, GitHub Copilot, Cursor, Windsurf, Amazon Q, Grok, and
other agent harnesses each own their discovery behavior. Workspai projects one
canonical protocol through the entry surface each host supports.

## Discoverable entry versus observed use

Managed project entry uses one compact shared policy in `AGENTS.md`. Detailed
execution, JSON-consumption and verification rules arrive in the task packet
instead of being repeated in every always-loaded file. Copilot also receives
a short, independently executable gate in `.github/copilot-instructions.md`,
the repository instruction location documented in the
[VS Code instruction reference](https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference).
If both files are loaded, their instructions reuse the same current task packet.
The native gate does not depend on the host following an import directive.

The generated block is prepended without rewriting repository-authored content,
including CRLF, blank lines and trailing whitespace. Refresh is idempotent;
`local` and `off` remove the owned block and preserve authored text. Tracked
deletions, unsafe symlinks, non-file paths and ambiguous managed markers are
preserved and reported as blocked coverage. Safe repository-local instruction
symlinks retain their identity. Adoption/checkpoint plans include the native
file so failure recovery covers the added surface.

New manifest hosts expose `statusScope: "entry-artifacts"` and SHA-256 bindings
for their entry files and imported entry dependencies. For files containing
owned markers, only those blocks are bound: unrelated authored edits do not
invalidate the binding. Bootstrap checks canonical containment and current
content, so removing or changing a gate cannot remain ready merely because
the file exists. Legacy manifests without bindings remain readable, with
degraded host coverage until grounding is refreshed.

Readiness is not evidence of host activation or model obedience. Bootstrap
entry metadata explicitly reports `hostLoading` and `modelCompliance` as
`not-observed`; task packets report `delivery.status: "prepared"` with the
same limits. Their integrity hash identifies the prepared context, not proof
that a particular conversation received or followed it. Host loading must be
verified in that host's instruction references or session trace, and compliance
requires observing the actual tool calls. Workspai does not silently enable
editor settings, install hooks or intercept another host's native tools.

## Prepare context for a task

For an existing Workspai project, ask for one bounded packet tied to the
current request:

```bash
npx workspai agent context \
  --project "<verified source root>" \
  --task "Find why the retry policy fails for empty input and fix it" \
  --path src/retry.py
```

For a concrete project task, read the nearest repository instructions, then
request task context **before source search or opening
implementation and test files**. Minimal path and instruction discovery is
allowed. The packet validates the entry contract; a separate manifest read is
not an additional prerequisite. If Workspai cannot run, disclose that limitation and continue authorized
native work. Generated instructions are routing guidance; enforcement still
depends on the host loading and following them.

Generated gates always request an explicit `--project`, resolved from the user
target or the instruction file's repository location. A source read does not
select a terminal directory. Before using a `ready` or `partial` packet, compare
`scope.project`, `scope.projectPath` and `scope.workspace` with that target. Neither
exit zero nor `partial` proves that the right project was selected.

Without `--project`, cwd is accepted only when canonical membership, a verified local Git
root or a root lifecycle manifest establishes a project boundary. Otherwise
`project-selection-required` is returned **before descendant lifecycle discovery**.
An empty `.git` directory or invalid worktree pointer is not root evidence.
The command does not scan or adopt child projects to guess intent. Explicitly
selected directories remain supported for arbitrary languages and structures.
A missing `--path` target or a nested Git/Workspai project boundary also returns
selection recovery instead of substituting parent evidence. Ordinary monorepo
package manifests remain eligible for closest-unit selection. For a new file,
omit `--path` until an existing source or manifest can be selected.

### Consume saved tool output as data

The packet is JSON even when an agent host saves terminal output to a `.txt`
file. Parse the file as data; never import, require or execute it. A failed
`require` can echo the whole JSON line into the error stack and duplicate the
context. If the host already presents decoded JSON, no extra parsing is needed.
When a file must be read, select only the fields needed for the next step:

```bash
node -e 'const fs = require("node:fs"); const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const selected = p.status === "ready" || p.status === "partial" ? {status:p.status, scope:p.scope, selection:p.selection, findings:p.grounding?.checks?.findings, proofs:p.graph?.proofs, lifecycle:p.lifecycle, skill:p.skill, execution:p.execution} : {status:p.status, selection:p.selection, budget:p.budget, message:p.message, nextActions:p.nextActions, recovery:p.recovery}; console.log(JSON.stringify(selected));' <saved-output-file>
```

Use a bounded excerpt for a parse failure, rather than printing the raw packet
or repeatedly requesting the same context. Keep unresolved findings visible.

### Packet contents and budget

The command returns one project-grounding receipt, scoped Graph matches and
lifecycle checks for the nearest manifest. It is read-only.
Always pass the verified source root using `--project` in generated agent flows.
Opening or reading a source file does not select that directory
for the terminal. Each lifecycle stage includes `cwd`, relative to the canonical
project root; apply it explicitly for every command and retry.
Grounding and Graph retrieval share one validated snapshot within this command;
the packet does not reread and revalidate the entire workspace for each component.
If the project is unmanaged or Workspai evidence is stale, the packet says so
and still provides native lifecycle guidance; project work can continue. For
an existing project, adoption or import remains an explicit user choice.

The packet's `scope` is always the selected project for this task. Use its
project-scoped Graph, Skill and lifecycle commands for local source work. Use
workspace-wide Doctor, verify, Graph or intelligence commands only for an
explicitly workspace-wide request or a finding that requires workspace scope.
Do not widen scope to recover a project-level failure.

`scope.workspace` is a logical identity, not a path. The portable
`scope.workspaceResolution` reports `source` as `explicit`, `parent`, `local-link` or
`registry`, plus `managedDefault` for the central managed default workspace.
Resolution checks a marked parent, then a validated project link, then the
reverse registry. A blocked higher-priority route does not fall through to a
different workspace. New adoption uses a containing parent workspace; outside
one, it uses the managed default unless the user selects another destination.
Absolute workspace paths stay local and are never included in the packet.
`scope.binding: "resolution-blocked"` means a stale, invalid or ambiguous
binding needs resolution; it is not an unmanaged project and is not permission
to adopt it again.

When `graph.status` is `results` or `no-matches`, the packet's bounded Graph
query is complete; do not repeat it through MCP or CLI. If an IDE Graph tool
cannot select the project folder, use the packet's CLI result or command
pointer. If the packet itself reports Graph unavailable, use its `nextAction`
and native source/tests; missing Graph evidence does not prove source is absent.
A workspace intelligence refresh is workspace-wide and should run only when
Graph evidence is necessary and that wider refresh is authorized.

If `graph.userAction.kind` is `request-project-graph-access`, first decide
whether Graph evidence is necessary for this task. If it is, ask the user once
for permission to read this project's Graph from its canonical workspace. Do
not guess workspace paths or scan other projects. After the user approves the
managed central workspace, retry the same command with `--workspace-default`.
For another workspace, use `--workspace <path>` only with the exact canonical
root the user provides. The CLI validates that the selected workspace contract
contains the exact project before reading its project-scoped Graph; it does
not adopt, relink, refresh, change the selected source, or expose the absolute
workspace path in the packet. If membership is unverified or the host denies
filesystem access, do not try other roots: ask for the missing choice or host
read permission once, then fall back to native project tools if access remains
unavailable. Declining Graph access does not block the original project task.

Prepared entry artifacts do not prove that the host loaded them or exposed its
native tools. `delivery.hostLoading` and `delivery.modelCompliance` remain
`not-observed`; verify tool availability from the active host and actual session
trace.

An `insufficient-budget` result is a valid machine-readable refusal with an
exact retry size or a narrower-scope action. The command exits successfully by
default so agent hosts can deliver that JSON instead of converting it into a
tool failure. Retry once with the reported size when it is within the supported
maximum; otherwise narrow `--limit` or `--path`. Use `--strict` only in
automation that intentionally treats a budget refusal as a nonzero result.
Always branch on `status` before reading `grounding` or `graph`: a refusal
contains only its budget, message and recovery actions.

Selection refusals also exit zero by default and exit two with `--strict`;
invalid input still exits two. They contain no grounding, Graph or lifecycle
packet. `selection.source` distinguishes an explicit project from inferred cwd;
`verifiedBy` describes boundary evidence, not proof of user intent or model use.

Refusals expose structured `recovery`. A runnable action provides `command`
with `executable`, `args`, `cwd` and `cwdBase`; pass argv directly to a process
API rather than joining it into shell code. `request-project-directory` means
the original `--project` directory, or the original invocation cwd when omitted.
Retries preserve task, host, project and known source selection. Canonical
parent and nested-project retries rebase paths relative to that directory.
No machine-local absolute path is persisted in the packet.
Actions needing an unknown project or source identify `requiredOption` instead
of inventing an executable placeholder. Resolve that input from the existing
request and file locations; ask the user only when it remains ambiguous.
Workspace access is a separate `userAction`, not an automatic retry: wait for
approval before adding `--workspace-default` or `--workspace`.
`--limit` is a Graph match count from 1 to 12; `--max-bytes` is the UTF-8 budget.
A component already exceeding its maximum is not fixed by raising the aggregate
budget. Recovery narrows the relevant component or explicitly falls back to
native evidence; it never emits a truncated task packet as ready.

For live-input failures, `grounding.checks.findings` and an unavailable `graph`
can include `inputValidation`. Findings identify logical workspace/project
scopes, content/inventory changes, membership or aggregate mismatches, or a scan
failure. Expected/actual hashes are included when available; machine-local
paths and source contents are not. At most eight findings are returned, with an
explicit `omittedFindings` count; omitted details never turn a failed validation
into success. A changed project elsewhere in the same workspace can invalidate
the shared Graph. This remains a disclosed limitation for local native work,
not an instruction to repair unrelated projects. The findings identify scopes,
not an exact historical file diff.

Only `grounding.requiredReadOrder` drives further reads. `canonicalEvidence`
paths are locators for follow-up questions, not a checklist to reload. Generated
runtime, test-recovery, delivery, API-diagnosis and dependency Skills use the current task packet and
scoped native evidence without mandatory workspace INDEX/context/verify reads or
workspace-wide command fallbacks. Release and cross-boundary Skills preserve
their governed evidence requirements.

`execution` describes the command path base and workspace-locator access.
`workspace:` identifies the canonical workspace, never the project's own
`.workspai` directory. Prefer a host URI resolver; otherwise run
`execution.workspaceLocator.resolveCommand` once from the project root, use
the `workspacePath` field as the local base, and append the locator suffix.
This optional access lookup does not repeat grounding. Reuse the result only
while project/workspace identity is unchanged; keep resolved absolute paths
out of portable evidence. Unmanaged projects have no workspace resolver.

Before verification, inspect the closest manifest and installed prerequisites.
Check the declared runner and interpreter before the first test attempt; avoid
cycling through unrelated managers when prerequisites are absent. Report setup
failure separately from tests that actually ran, and disclose unavailable
Workspai grounding or Graph evidence in the final result.
For a declared Node workspace member, `workspaceOwner` identifies the owning
root manifest and package manager. Member scripts use that manager, and the
member does not receive an independent install stage. Resolve setup from the
owner manifest; excluded or independent packages keep their own lifecycle.
A discovered test command is not proof its dependencies are installed. Reuse an
in-flight setup/check instead of starting duplicates; use longer host polling
intervals (up to 30 seconds) while progress continues. Diagnose stalled work
before cancellation. Report setup failure, tests not started, and tests failed
as distinct outcomes. The CLI guidance does not enforce a third-party host's
waiting behavior or guarantee that a model follows it.

Inspect package-script definitions before appending arguments: an appended
output path does not replace a destination already hardcoded in a script.
For temporary Git fixtures, inspect editor and signing prerequisites; any
needed overrides belong to the test process, preserving inherited overrides,
global configuration and signing for real commits. Regenerate checked-in
artifacts only when repository rules or an affected check establishes their
dependency on the source change.

An external host must discover project instructions before source exploration.
When evaluating entry behavior, open the adopted project as a workspace folder
or verify the host's instruction discovery for that source directory. The CLI
cannot intercept another host's native file tools before it is invoked.

Task context is the primary task entry. Do not run a separate bootstrap,
membership lookup or identical Graph search for information already supplied
and still current. The nested grounding continuation omits the validated
manifest/project lens and completed Graph retrieval while preserving applicable
Goal handoffs, Skills, findings and claim restrictions. When started from an
adopted project's subdirectory, lifecycle selection still uses the canonical
project root; `--path` remains relative to that root.
Task packets include a compact `skill` derived from the selected lifecycle
manifests, with project identity, runtime boundaries and validation procedure.
It replaces the workspace skill-catalog read for routine task validation; it
does not grant execution permission or claim that dependencies are installed.
Host Skill entries use applicability metadata to exclude skills owned only by
other projects. Legacy indexes without this metadata remain readable.

Graph views report lexical candidates or `no-matches` with a recovery action.
Neither status proves an implementation binding or source absence. Long task
queries downweight workflow vocabulary, preserve Unicode identifiers, and retain
the project filter before ranking. Expand cited evidence and use scoped native
search when an index cannot answer the question. Provider bounds and workspace
aggregate coverage remain explicit; no language-independent completeness or
semantic accuracy is promised.

`workspace run ... --scope project:<identity>` checks Doctor evidence from the
selected canonical project directory and rejects missing or differently bound
health evidence. Workspace release readiness remains a workspace/release gate,
not a prerequisite for this local run. Unscoped fleet execution retains the
workspace gates. Empty and ambiguous scope selectors are errors; they never
fall back to the fleet. Doctor project/workspace selectors cannot be combined.
Runtime prerequisites in the selected project still block its own execution.
Scoped Doctor warnings remain visible and produce a nonzero run exit in strict
mode. A standalone Node manifest with no declared dependency requirements does
not need a `node_modules` directory; workspace roots, agent owners and malformed
dependency groups cannot inherit that exemption from an empty shell manifest.

For Python packaging projects, init includes a declared validation extra only
when a supported static or setuptools-dynamic optional-dependency declaration
proves pytest ownership. The CLI does not invent a test dependency. Inspect the
manifest and runner prerequisites for other setup conventions; command discovery
and extracted-function assertions do not prove that package tests ran.

New project lenses use the task command in `agentRouting.mandatoryPreflight`
and defer remaining reads to the packet. The entry manifest's optional
`protocol.taskContextCommand` selects this route; its original bootstrap read
order remains available for standalone inspection and legacy consumers.

The default whole-packet budget is 32,768 UTF-8 bytes; `--max-bytes` accepts
8,192–131,072 bytes. Components share this budget rather than fixed percentage
allocations. A packet that cannot fit returns `insufficient-budget` (exit 0 by
default, exit 2 with `--strict`),
with a valid whole-command retry size that includes JSON numeric-width changes.
An exceeded component maximum instead recommends narrowing the selection or
using native evidence; raising the packet budget alone is not a remedy. No
selected component is silently replaced by a budget-error fragment in a
successful or partial task packet.

To attach Workspai to a project, adopt or import it once:

```bash
npx workspai adopt .
```

Adoption seals initial intelligence. For a later full workspace refresh or CI
gate, use the canonical chain with `--for-agent generic` when the eventual host
is not known. It is not an extra prerequisite for each project task:

```bash
npx workspai workspace intelligence run --for-agent generic --strict --json
```

`generic` creates one consumer-neutral context pack and projects lightweight
entry surfaces for **all supported agent hosts**. It does not build a separate
Model or Graph for every provider. A later host can therefore discover the
same canonical evidence without repeating the expensive intelligence run.
Choosing a named agent may tune the shared context consumer, but the canonical
chain still preserves portable entry coverage for every supported host.

Workspai writes a portable entry contract at
`.workspai/agent-entry.v1.json`, a bounded project lens at
`.workspai/reports/project-context-agent.json`, an integrity-bound graph reference,
project-local `.agents/skills/workspai-*` wrappers, and host adapters when project
grounding is managed. The wrappers contain no machine-local workspace path and
resolve their canonical playbook through the project bootstrap contract.

The mandatory project context is intentionally compact. Workspace-wide context,
the evidence index, and a complete Model or Graph export
is validated as canonical evidence but is not injected into first-contact
instructions. Agents retrieve task-specific, proof-backed slices through graph
search and only open the returned proof paths.

### Select verification commands from the affected package

In a polyglot repository, use the detected manifest boundary for the changed
file before deciding which checks to run:

```bash
workspai project lifecycle plan --path packages/api/src/handler.ts --json
```

The versioned `workspai.project-lifecycle-context.v1` response reports the
closest matching runtime unit, its manifest provenance, and detected init,
test, build, and start stages. These are discovered project commands, not proof
that they ran or passed. Inspect a cited manifest or script if a command's
scope or prerequisites are unclear. Omit `--path` to request all discovered
units. The default output budget is 8,192 UTF-8 bytes; `--max-bytes` accepts
1,024–65,536 bytes. If the complete selection does not fit, the command returns
`insufficient-budget` and exit 2 with the required size or package-selection
guidance; no lifecycle unit is silently dropped. An unmapped `--path` returns
`path-not-mapped` rather than guessing a runtime or command.

For standalone entry inspection without a concrete task, issue a receipt from
the project directory. This is an alternative to task context, not an extra
prerequisite:

```bash
npx workspai agent bootstrap --for-agent codex --strict --json --view agent
```

Use `generic` when the host has no dedicated identifier. Use the legacy
`orca` input only for compatibility; Workspai resolves it to `grok`.

`--view agent` emits `workspai.agent-bootstrap-view.v1`, a terminal consumer
projection of the full receipt. Existing invocations without this option retain
the complete `workspai.agent-bootstrap-receipt.v1` output. The view preserves the
source receipt identity and integrity references, host and project binding,
freshness, readiness dimensions, claim limits, active Goal and **every warning
and failed check**. Successful check details become explicit counts. This view
is not new architecture evidence and cannot corroborate its own source receipt.

The view's `requiredReadOrder` is a continuation: bootstrap already validated
membership and selected the active Goal, so it does not request its own command,
the local workspace resolver or the Goal index again. An applicable Goal's exact
pack and handoff appear before Skills and Graph retrieval. The full receipt and
manifest retain their original protocol read order for compatibility. A source,
scope or integrity change still requires renewed validation; the view is not a
cross-generation permission cache.

The default output budget is 12,288 UTF-8 bytes. Use `--max-bytes <n>` with
`--view agent --json` to select 1,024–131,072 bytes. Accounting includes the entire
compact JSON representation and trailing newline; it is **not** a model token
or billing measurement. If required data cannot fit, the CLI emits a typed
`insufficient-budget` result and exits `2` rather than silently truncating a
finding, claim boundary or Goal. Follow `nextActions` to raise the budget or use
`--view full`. `groundingStatus` in this rejection reports only the source
receipt status; the rejected view itself is not ready.

Generated host instructions and Skills ask for answers in the user's language,
with detail proportional to the request. They require the result, relevant scope
and evidence, actual verification and unresolved work without imposing seven
fixed headings. Approval, mutation transaction and CLI-owned verification
obligations are unchanged. Read one relevant Skill and task-scoped Graph evidence
before expanding source inspection; a matching file name is not proof that the
whole project was understood or verified.

### Governed source changes

Durable v1 entry manifests with `sourceMutation: governed-only` and bootstrap
receipts with `governed-cli-transaction-only` remain valid. Their integrity is
still checked and their restrictive policy is preserved; reading them does not
rewrite metadata or grant the newer proportional policy. Regenerating managed
entry surfaces explicitly adopts the current protocol, including the optional
`protocol.taskContextCommand`; repository-authored rules remain authoritative.

The bootstrap claim `sourceMutation: risk-and-project-policy-based` keeps
ordinary project work proportional while preserving governed changes. Follow
explicit repository policy. For a routine edit scoped to one project, inspect
the relevant source and use the project's native checks; do not create a Goal
or Change just to package retrieval context. Use Proof-Carrying Change before a
write when repository policy requires it, the change crosses project or
architecture boundaries, or a governed Workspai effect needs authorization:

1. Reuse an active Goal only when its project scope and acceptance criteria
   cover this request; otherwise create a scoped Goal.
2. Begin a Change bound to that Goal and the current Model/Graph generation.
3. Record a non-canonical prediction with one project-relative artifact
   operation for every expected changed source, test, or configuration file.
   Include expected files even when they do not change API or dependency
   topology, so derived Graph evidence is attributed to the right artifacts.
4. Obtain authorization for only the effect classes needed. A user request or
   host approval may authorize the requested local work; the agent must not
   invent a grant, claim approval that did not occur, or widen the effect scope.
5. Perform the work, record receipts for observed effects, and run
   `workspai change verify --change <change-id> --json`. Add `--strict` when
   this Goal also requires the entire workspace to be ready and fresh; strict
   mode is a workspace-wide gate, not merely a stronger check of the edited
   project.
   Single-project Goals use a project gate when the actual receipts stay inside
   that project: it checks the selected project and its affected transitive
   dependents. Workspace policy and graph integrity still apply. A workspace
   mutation outside that project, a Goal whose criterion is workspace-wide,
   missing model baseline, or `--strict` keeps the full workspace gate.
6. If verification blocks, inspect `change status` / `change explain`, follow
   the returned `nextActions`, and report remaining blockers. Do not treat an
   applied edit or passing project tests as a sealed Change.

In adopted external projects, do not assume the Workspai source document exists
in the project's `docs/` directory. Use the installed CLI's command help and
available versioned contracts. If a governed step required by project policy
cannot be resolved, stop before writing and report that limitation. An editor
rollback feature does not substitute for PCC.

Read-only questions and inspections do not need a Change. If the host cannot
create or record a Change required by project policy, stop before that governed
write and report the limitation. A Change receipt does not authorize unrelated
effects or replace a host's approval boundary. The full lifecycle and receipt
formats are defined in [Proof-Carrying Change](./proof-carrying-change.md).

Graph retrieval is a bounded discovery step, not a completeness claim. The
`test-source-evidence` provider indexes test-file paths and bounded lexical
references separately from production symbols and APIs. Its `role: test` and
`referenceSemantics: lexical-only` attributes do not establish executed tests or
semantic coverage. Fixture and example sources do not become production evidence.
Budget limits, oversized files and unreadable candidates leave explicit discovery
diagnostics; some test files may still be absent. Continue with scoped native
search when evidence is insufficient.

Source and test file entities carry `packageManifests` pointing to the nearest
enclosing manifest directory, using portable artifact paths. Multiple manifests
at that boundary remain visible; this is directory evidence, not a claim that
every file uses the repository's primary framework. An unknown root runtime can
be correct for a manifest-free polyglot container. Resolve the task package
instead of treating a root label as a complete description of all packages.
An empty Graph result does not prove that an implementation or test is absent.

### Budgeted Graph discovery and evidence expansion

For a compact, task-scoped discovery response:

```bash
workspai workspace graph search "retry policy" --scope project:api --view agent --json
```

This opt-in `workspace-graph-search-view.v1` representation returns the same ranked
matches selected by the query and limit, with lexical match reasons, primary
proof locators, package manifest paths and scope-relevant Graph diagnostics. It defers
full entity attributes, relations and additional proofs to `graph evidence`.
Neither matching a test reference nor a successful retrieval proves test
execution, semantic implementation-to-test coverage or verified completion.

Project-scoped views omit a diagnostic only when all its entity/relation
references resolve to another project's ownership. Relevant, cross-project,
unscoped and unresolved findings remain, regardless of severity. No message-text
matching determines ownership. `diagnosticSelection` records foreign omissions
and retained unscoped findings; its `aggregateScope: workspace` identifies the
coverage, provider and proof-freshness totals as workspace aggregates, not
project-specific guarantees. Legacy unscoped findings remain visible until
intelligence is refreshed. Workspace-wide views and persisted Graph diagnostics
retain the full list.

The default wire budget is 12,288 UTF-8 bytes; `--max-bytes` accepts
1,024–131,072 bytes. Accounting includes compact JSON and its trailing newline.
Selected matches and retained diagnostics are not silently dropped to fit: an insufficient budget
returns `status: insufficient-budget` and exit 2 with a retry budget or explicit
narrowing guidance. Such a refusal contains no partial discovery view. The
failure envelope remains bounded even for an oversized query or finding.

Each successful response includes `expand.argv`. Replace its literal `<id>` with
a returned match ID and invoke those arguments from the same workspace or linked
project. Expansion requires the returned Graph revision. If source, provider
generation or evidence changes, the CLI refuses the expansion with
`workspace.graph.revision.changed` and exit 2; rerun the scoped search. Observation
timestamps alone do not invalidate the revision. The revision is not a permission
token and does not bypass live-source validation or project scope.

To avoid repeating unchanged search results in a continuing agent conversation,
pass the latest `delivery.receiptId` to a later compact search:

```bash
workspai workspace graph search "retry policy" --scope project:api --view agent --context-receipt <receipt-id> --json
```

The workspace-local delivery ledger binds that receipt to the Graph revision,
project/kind scope and hashes of previously emitted matches. The response lists
reused IDs in `delivery.reusedMatchIds`; details are omitted only when the exact
prior result remains in scope and current. New matches remain in `matches`, and
all scope-relevant and unscoped diagnostics remain in the response. A missing, expired, malformed,
changed-source or changed-scope receipt falls back to full results. The ledger
stores identifiers and digests, not source contents, query text or absolute
paths; entries expire after 14 days and the ledger is bounded. Use a receipt
only when the same conversation still has the referenced result. Without
`--context-receipt`, every search remains a complete independent result.

Invocations without `--view` retain their existing v1 output. `--view full --json`
returns the full search entity/proof fields for the selected matches. The compact
bootstrap view recommends the new discovery representation in its continuation;
canonical full bootstrap receipts and entry manifests retain their compatible
protocol fields. Native-search fallback remains available when indexed coverage
does not answer the task.

Persisted Graph reads require matching provider generations as well as model
binding and live source fingerprints. An older extractor generation is a cache
miss, so new retrieval does not silently retain obsolete discovery behavior.
Agent search gives source/test file proofs priority within its existing proof
budget and emits only query-relevant lexical references in the compact view;
omission counts remain explicit. Full evidence is available through Graph
evidence queries.

Managed project `AGENTS.md` blocks preserve the authored body, including blank
lines, line endings and final-newline state, across generation, refresh and
removal. Generated instructions do not replace the repository's own source rules.

Audit every supported host in CI or before publishing project grounding:

```bash
npx workspai project agent-entry verify --for-agent all --strict --json
```

## What the receipt proves

The `workspai.agent-bootstrap-receipt.v1` payload checks:

- canonical project-to-workspace membership;
- entry manifest and project-context integrity hashes;
- host discovery files without overwriting authored repository state;
- presence and schema validity of the report index, agent context, compact
  Skills index, Workspace Model, and Knowledge Graph;
- persisted Model/Graph compatibility;
- live project input compatibility, unless explicitly skipped;
- active Goal Pack and agent-handoff bindings;
- portable output with no machine-local absolute paths.

The receipt does not claim that a model followed the instructions or that it received them.
Host coverage means the expected instruction surface was provisioned and
validated on disk; actual host injection is not observable to the CLI. The
receipt proves that Workspai has a valid route to current project evidence and
tells the consumer what it may claim next. The portable manifest keeps `generic` as its
provider-neutral bootstrap command; each runtime receipt replaces that step in
`requiredReadOrder` with the resolved host (or `all` for a complete host audit),
so a consumer is never routed back through the wrong adapter.

The top-level `status` is explicitly scoped by `statusScope: agent-grounding`.
It must not be interpreted as project setup or release readiness. The
`readiness` object reports those dimensions separately: agent grounding,
architecture evidence, project environment, and release. A clean bootstrap can
therefore be `ready` while release remains `not-verified`, or while previously
recorded Doctor findings make the project environment `degraded` or `blocked`.
When live input validation succeeds, the receipt reports Model and Graph
freshness as `fresh`; fact-level TTL and verify-before-use semantics remain in
their individual evidence records and do not weaken structural freshness.
Model grounding freshness uses structural facts rather than the aggregate TTL
of all workspace verification reports. Expired verification facts produce a
separate `verification-freshness` warning and a degraded receipt, while current
architecture evidence remains usable. Adoption accepts this route; strict
bootstrap still exits nonzero for degraded evidence. This does not renew report
TTLs or satisfy environment/release checks. Structural expiry, source changes,
missing evidence and mismatched identities remain blocking.

The Workspace Model and complete Knowledge Graph are validated by the receipt,
but are deliberately **not** part of `requiredReadOrder`. They are on-demand
deep-evidence artifacts: load them only for an explicit full export, offline
audit, or a task that cannot be answered from the project lens, bounded context,
and task-scoped Graph query. This keeps first contact bounded on large workspaces.
Standalone bootstrap retains the compact Workspace Skills index in its
continuation for specialized playbook discovery. Task context instead supplies
one inline project `skill` and removes that catalog read from its routine route.
Neither route asks the agent to load every Skill. Check project applicability
before using a specialized playbook; legacy unscoped entries remain readable.

An active Goal bound only to another project is not a task continuation for
this target. Task context retains its status and warning while omitting foreign
Goal details and repair routes; unrelated policy findings remain visible.

The generated workspace name is a logical identity, never a filesystem path.
Project-local artifacts use `.workspai/...`; canonical workspace artifacts use
the `workspace:` URI prefix. When an agent requires direct file access, it
resolves the exact local workspace root at runtime from the adopted project:

```bash
workspai project workspace status --json
```

That resolver intentionally returns absolute paths to the local process. Its
contract classifies them as machine-local, non-portable, forbidden to persist,
and forbidden to disclose. Entry manifests, project lenses, bootstrap receipts,
answers, shared logs, commits, prompts, and telemetry must not copy those paths.
Workspace-level agent reports use `workspace:<name>` as their `workspaceRoot`
identity for the same reason. A local filesystem root is runtime-only data, not
consumer-facing evidence.

| Status     | Meaning                                                               | Consumer rule                                                               |
| ---------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ready`    | Host entry, contracts, integrity, and live evidence passed            | Continue with bounded Graph retrieval and targeted source reads             |
| `degraded` | Evidence is usable with an explicit limitation                        | Disclose the limitation; do not claim complete architecture or verification |
| `blocked`  | Required discovery, binding, contract, integrity, or freshness failed | Refresh or repair evidence before architectural or verification claims      |

An active Goal is reported independently as `ready`, `stale`, or `invalid`.
A stale Goal remains `present: true`; the receipt includes a complete refresh
command in `nextActions`. Absence is represented as `present: false` with
`status: none`, never as a validation failure.

`--strict` returns exit code `2` for both `degraded` and `blocked`. Without
`--strict`, a blocked receipt still returns exit code `2`; degraded evidence is
returned for an explicitly limited read-only workflow.

`--no-live-inputs` is an intentional degraded mode. It checks persisted
compatibility but cannot prove that the source tree still matches the last
intelligence run.

## Authority boundaries

Workspai does not replace source code with generated summaries:

- live source owns exact implementation behavior;
- the canonical Workspace Model owns workspace identity and structural truth;
- the Knowledge Graph is a model-bound, proof-backed retrieval projection;
- CLI evidence owns readiness, verification, repair, and Goal lifecycle claims;
- the project entry contract owns the order in which an agent reaches those
  sources.

This means an agent begins with canonical evidence, then verifies and deepens
it through narrow source inspection. It must not silently replace missing or
stale workspace evidence with an unbounded repository scan.

## Host projection

| Host                                       | Project discovery surface                                     |
| ------------------------------------------ | ------------------------------------------------------------- |
| Generic and unsupported model-only clients | `.workspai/PROJECT-GROUNDING.md` plus explicit bootstrap      |
| Codex, Kimi Code, Grok                     | `AGENTS.md` plus `.agents/skills/workspai-grounding/SKILL.md` |
| GitHub Copilot, Cursor, Windsurf           | `AGENTS.md` plus their generated host adapter when available  |
| Claude Code                                | `CLAUDE.md` adapter                                           |
| Gemini CLI                                 | `GEMINI.md` adapter                                           |
| Qwen Code                                  | `QWEN.md` adapter                                             |
| Amazon Q                                   | `.amazonq/rules/workspai-agent-entry.md`                      |

The adapters contain routing instructions, not duplicated model or graph
state. The manifest records whether each surface is native, adapted, or a
portable fallback and whether Workspai could manage it safely.

This matrix was last checked against official host documentation on
2026-08-16: [Codex `AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[Claude Code memory](https://code.claude.com/docs/en/memory),
[Gemini CLI context files](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md),
[Qwen Code settings](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md),
[Kimi Code `AGENTS.md`](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents),
[GitHub Copilot repository instructions](https://docs.github.com/en/copilot/concepts/prompting/response-customization),
[Cursor rules](https://docs.cursor.com/context/rules-for-ai),
[Windsurf `AGENTS.md`](https://docs.windsurf.com/windsurf/cascade/agents-md),
[Amazon Q project rules](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/context-project-rules.html),
and [Grok skills and instructions](https://docs.x.ai/build/features/skills-plugins-marketplaces).
DeepSeek, Mistral, hosted model APIs, and other model-only consumers do not
define a provider-wide repository entry surface independently of the agent
host. They use the generic portable bootstrap unless their host maps to one of
the verified surfaces above. Workspai does not invent a model-specific file
name from undocumented behavior.

If an authored instruction file or symbolic link prevents safe management,
Workspai preserves repository ownership and reports degraded or blocked host
coverage. It does not replace the file to make a check pass.

## Skills

Agent-sync derives operational playbooks from the detected workspace: runtime
validation is generated per detected runtime, and polyglot, test-evidence, and
delivery playbooks appear only when their supporting signals exist. The
canonical inventory remains under `.workspai/skills/`; the provider-neutral
projection uses `.agents/skills/<skill-name>/SKILL.md`, while provider mirrors
use their documented `skills/<skill-name>/SKILL.md` roots with YAML frontmatter for hosts
that implement Agent Skills. A host without a documented Skills surface still
receives its native adapter and the portable canonical-first entry contract.
Agent-sync reconciles only Skill files marked as Workspai-generated, so a
runtime that disappears cannot leave a stale generated playbook behind and
authored Skill files remain untouched.

## Consumer integration

IDEs and agent runtimes should:

1. discover the host-native instruction file;
2. run `workspai agent bootstrap --for-agent <host> --json`;
3. validate the receipt schema from the installed CLI contract catalog;
4. if the receipt is degraded or blocked, disclose it and continue native
   project work; avoid unsupported architecture or verification claims;
5. read an active Goal handoff when it exists and applies to this project and task;
6. use the bounded Graph query returned by `nextActions`;
7. open only returned proofs and target source files;
8. use governed CLI transactions where project policy or change scope requires
   them, and report only checks that actually ran. If Graph context is absent,
   continue with bounded native search and live source.

Do not infer support from the package version alone. Discover
`projectAgentEntry` and `agentBootstrapReceipt` through
`contracts/published-contract-catalog.v1.json`.

## Package boundary

The CLI currently owns adoption, synchronization, receipt orchestration, and
exit semantics. The entry manifest and receipt are versioned, portable
contracts rather than CLI-internal objects. Future independent Model, Graph,
Goal, or agent packages can therefore implement their own providers behind the
same contract without changing the project-facing protocol.
