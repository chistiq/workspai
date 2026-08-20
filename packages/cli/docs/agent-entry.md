# Canonical-First Agent Entry

Workspai gives coding agents one portable way to enter an adopted project
without treating a broad repository scan as the source of architectural truth.

The protocol is:

```text
Host discovery
  → portable project entry
  → canonical identity and evidence
  → freshness and integrity checks
  → active Goal handoff
  → bounded Graph retrieval
  → targeted live source inspection
```

This is deliberately **host-first, not model-first**. A model does not decide
which repository instruction file is loaded. Codex, Claude Code, Gemini CLI,
Qwen Code, Kimi Code, GitHub Copilot, Cursor, Windsurf, Amazon Q, Grok, and
other agent harnesses each own their discovery behavior. Workspai projects one
canonical protocol through the entry surface each host supports.

## Start from an adopted project

Adopt or import the project once:

```bash
npx workspai adopt .
```

When the eventual agent host is not known, run the canonical chain with
`--for-agent generic`:

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
`.workspai/reports/project-context-agent.json`, and host adapters when project
grounding is managed.

The shared context is intentionally compact. A complete Model or Graph export
is validated as canonical evidence but is not injected into first-contact
instructions. Agents retrieve task-specific, proof-backed slices through graph
search and only open the returned proof paths.

At the start of an agent session, issue a receipt from the project directory:

```bash
npx workspai agent bootstrap --for-agent codex --strict --json
```

Use `generic` when the host has no dedicated identifier. Use the legacy
`orca` input only for compatibility; Workspai resolves it to `grok`.

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

The receipt does not claim that a model followed the instructions. It proves
that the host has a valid route to current Workspai evidence and tells the
consumer what it may claim next. The portable manifest keeps `generic` as its
provider-neutral bootstrap command; each runtime receipt replaces that step in
`requiredReadOrder` with the resolved host (or `all` for a complete host audit),
so a consumer is never routed back through the wrong adapter.

The Workspace Model and complete Knowledge Graph are validated by the receipt,
but are deliberately **not** part of `requiredReadOrder`. They are on-demand
deep-evidence artifacts: load them only for an explicit full export, offline
audit, or a task that cannot be answered from the project lens, bounded context,
and task-scoped Graph query. This keeps first contact bounded on large workspaces.
The compact Workspace Skills index *is* part of the route: use it to select one
relevant playbook, rather than loading every Skill or asking the model to infer
an operational procedure from raw source alone.

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

| Host                                                     | Project discovery surface                                |
| -------------------------------------------------------- | -------------------------------------------------------- |
| Generic and unsupported model-only clients               | `.workspai/PROJECT-GROUNDING.md` plus explicit bootstrap |
| Codex, Kimi Code, GitHub Copilot, Cursor, Windsurf, Grok | `AGENTS.md`                                              |
| Claude Code                                              | `CLAUDE.md` adapter                                      |
| Gemini CLI                                               | `GEMINI.md` adapter                                      |
| Qwen Code                                                | `QWEN.md` adapter                                        |
| Amazon Q                                                 | `.amazonq/rules/workspai-agent-entry.md`                 |

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
canonical inventory remains under `.workspai/skills/`; standard portable
projections use `skills/<skill-name>/SKILL.md` with YAML frontmatter for hosts
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
4. stop broad discovery when the receipt is blocked;
5. read an applicable active Goal handoff before planning changes;
6. use the bounded Graph query returned by `nextActions`;
7. open only returned proofs and target source files;
8. make mutation and verification claims only through the governed CLI flow.

Do not infer support from the package version alone. Discover
`projectAgentEntry` and `agentBootstrapReceipt` through
`contracts/published-contract-catalog.v1.json`.

## Package boundary

The CLI currently owns adoption, synchronization, receipt orchestration, and
exit semantics. The entry manifest and receipt are versioned, portable
contracts rather than CLI-internal objects. Future independent Model, Graph,
Goal, or agent packages can therefore implement their own providers behind the
same contract without changing the project-facing protocol.
