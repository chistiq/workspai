<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Enterprise agent grounding and enriched workspace context",
  "summary": "Workspai 0.61.0 gives AI agents full situational awareness from a single context read, adds enterprise-level grounding for every major coding agent, and lets the repair engine replan failed proposals.",
  "highlights": [
    {
      "icon": "🧠",
      "text": "Agents read one context file and see impact, doctor, readiness, verify, and explain summaries"
    },
    {
      "icon": "🎯",
      "text": "Enterprise grounding for Cursor, Claude, Windsurf, Grok, Amazon Q, Copilot, Codex, Gemini, and Qwen"
    },
    {
      "icon": "🔄",
      "text": "Repair engine replan option lets the model discard a failed plan and try again"
    },
    {
      "icon": "⚡",
      "text": "Dynamic skills generated from real workspace state—projects, blockers, and safe commands"
    }
  ]
}
-->

# Workspai CLI v0.61.0

Released August 19, 2026.

## Enterprise Agent Grounding and Enriched Workspace Context

Workspai 0.61.0 closes the gap between "the CLI knows everything about the
workspace" and "the agent knows everything the CLI knows." Before this release,
agents read one context file for scope, projects, and safe commands, but needed
additional artifact reads for impact, doctor findings, verification status, and
release readiness. Agent grounding covered a subset of coding hosts, and
generated skills were static templates disconnected from real workspace state.

Version 0.61.0 makes a single `workspace-context-agent.json` read sufficient
for full situational awareness, publishes enterprise-level grounding for every
major coding agent host, and generates dynamic skills from current evidence.

## Full situational awareness in one context read

Before 0.61.0, an agent that needed impact analysis had to read
`workspace-impact-last-run.json` separately. Doctor findings required
`doctor-last-run.json`. Verification status required
`workspace-verify-last-run.json`. Each additional read consumed tokens and
required the agent to know artifact paths.

`WorkspaceAgentContext` now includes optional summary fields from every
intelligence artifact in the chain:

- `impactSummary` — blast radius, risk level, affected project count, and
  recommended commands.
- `doctorSummary` — verdict, issue counts by severity, and top signals with
  scope, class, and remediation.
- `analyzeSummary` — score, verdict, and top findings with severity and
  remediation targets.
- `readinessSummary` — release gate status, blocking reasons, and gate-level
  verdicts.
- `verifySummary` — pass/fail verdict, exit code, missing evidence, and
  blocking reasons.
- `explainSummary` — human-readable diagnosis, release verdict, evidence
  freshness, and narrative sections.
- `diffSummary` — added/removed/changed projects, workspace-level changes, and
  Git changed file count.

All fields are optional and additive. The workspace context schema retains
`additionalProperties: true`. A `safeReadWorkspaceJsonArtifact` helper
validates schema versions before populating each summary, so stale or
incompatible artifacts are silently omitted rather than corrupting context.

## Enterprise agent grounding for every major host

Agent Sync previously generated Cursor rules, Copilot instructions, and a
portable `AGENTS.md`. Version 0.61.0 expands coverage to every major coding
agent host with enterprise-level rules, evidence discipline, and answer
contracts:

- **Cursor**: 5 workflow rules (grounding, evidence, diagnose, repair, release)
  plus a dynamic project-aware skill.
- **Claude**: workspace scope rule and evidence discipline rule, plus a dynamic
  grounding skill. `CLAUDE.md` entry at both workspace and project level.
- **Windsurf**: modern `.windsurf/rules/` format with `trigger` frontmatter for
  grounding and evidence. Legacy `.windsurfrules` retained for compatibility.
- **Grok**: grounding and evidence rules in `.grok/rules/`, plus a dynamic
  grounding skill.
- **Amazon Q**: workspace rule and agent entry rule in `.amazonq/rules/`.
- **GitHub Copilot**: workspace and evidence instructions, diagnose/repair/release
  prompts, advisor/repair/release agents, and grounding/intelligence skills.
- **Portable adapters** (Gemini, Qwen, generic `AGENTS.md` consumers): enhanced
  with evidence discipline and answer contract sections.

All generated files follow each host's native format and convention. Workspace-
level files provide system-wide context; project-level files provide scoped
identity and entry.

## Dynamic project-aware skills

Generated operational skills are no longer static templates. Each skill now
includes data from the current workspace evidence:

- Actual project names and identifiers from the canonical Workspace Model.
- Current blockers from verify and explain evidence.
- Safe commands from the workspace context.
- Project-specific metadata including runtime, framework, and dependency scope.

This applies to all grounding skills across Cursor, Claude, Grok, Copilot, and
the portable `.agents/skills/` surface. The dynamic content is generated at
Agent Sync time and refreshed on every intelligence run.

## Repair engine replan option

When a model proposal fails—invalid JSON, stale source hashes, or a bad
plan—the repair decision prompt previously offered only `manual-repair` and
`cancel`. Agents and users had no governed way to ask the model to try again.

Version 0.61.0 adds `replan` as a third decision option. It cancels the current
plan and lets the model generate a fresh proposal for the same target without
operator intervention. The option is available in:

- the `WorkspaceRepairDecision` TypeScript union type
- all copies of `workspace-repair-transaction.v1.json`
- the IDE decision UI with label "Let the model retry"
- the CLI `workspace repair decide` command

## Documentation

- Root and CLI README: one-liner value proposition, before/after comparison,
  accurate two-level output tree (workspace + project) verified against a real
  four-project workspace, audience-based "what to read" table, and MCP server
  details with 14 read-oriented tools.
- Repair Engine documentation: user-friendly introduction with plain-language
  explanation and a four-step quick example before the technical specification.
- Documentation index: "from zero to value in 60 seconds" quickstart with
  three copy-pasteable commands and an immediate summary of what is generated.

## Qualification

The release was qualified against:

- a four-project workspace (NestJS, Next.js, FastAPI, Go) running the full
  intelligence chain with `--for-agent generic --strict --json`
- 70 generated grounding files verified for format, frontmatter, and dynamic
  content across Cursor, Claude, Windsurf, Grok, Amazon Q, and Copilot
- enriched context summaries validated against live intelligence artifacts
- repair engine `replan` decision in both CLI and extension contract schemas
- workspace-agent-sync and workspace-context test suites (23 tests, all passing)
- output tree accuracy verified against real filesystem output
- backward compatibility with existing workspace evidence, Goal Packs, and
  agent grounding

## Upgrade

```bash
npm install -g workspai@0.61.0
workspai --version
```

Expected output:

```text
0.61.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias is published at the matching `0.61.0` version.
- All new context fields are optional and additive.
- Existing workspace evidence, Goal Packs, and agent grounding remain valid.
- No public command or artifact contract is removed.

## Breaking changes

None.
