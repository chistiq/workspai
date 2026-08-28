# Naming and coexistence (Phase 4.0)

Rules for **operational intelligence** artifacts so npm CLI, VS Code extension, and agent tools share one canonical layout without duplicate generators.

## Canonical vs generated surfaces

| Layer                    | Canonical (workspace-native)                                                                 | Generated (agent-sync)                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Operational playbooks    | `.workspai/skills/{skillId}.md`                                                              | Legacy `.rapidkit/skills/{legacySkillId}.md` read fallback                        |
| Skills index             | `.workspai/reports/workspace-skills-index.json`                                              | —                                                                                 |
| Copilot skill umbrella   | `.github/skills/workspai-workspace-intelligence/SKILL.md`                                    | `.github/skills/rapidkit-workspace-intelligence/SKILL.md` legacy consumer surface |
| Explain report           | `.workspai/reports/workspace-explain-last-run.json`                                          | —                                                                                 |
| Action / repair feedback | `.workspai/reports/workspace-intelligence-history.json` (`kind: agent-action`, `doctor-fix`) | —                                                                                 |

**Rule:** Never add a standalone `workspace skills generate` command. Operational skills are produced only by `workspace agent-sync --write` (extend the Agent Customization Pack). Templates are candidates, not guaranteed output: agent-sync materializes a candidate only when the canonical model, graph, contract, or command surface proves it applies. The skills index records generated and suppressed decisions with their evidence signals.

## Skill identifiers

Built-in operational skill candidates use the `workspai-*` prefix:

- `workspai-diagnose-api-failure`
- `workspai-release-readiness`
- `workspai-safe-schema-migration`
- `workspai-dependency-upgrade`
- `workspai-rename-contract`

Paths are derived from id via `operationalSkillPath()` in `src/contracts/workspace-artifact-paths.ts`.
Legacy `rapidkit-*` skill and prompt paths may remain for older consumers during the rebrand window; new consumers should read the `workspai-*` paths first.

`workspai-release-readiness` is workspace-applicable. API diagnosis, schema migration, dependency upgrade, and contract rename are emitted only for projects with matching evidence. Runtime, test, delivery, and polyglot skills are derived dynamically. Every emitted skill states why it exists, its scoped projects, observed signals, registered lifecycle boundary, and safe verification commands. Absence of evidence suppresses a skill rather than presenting a generic playbook as a detected capability.

## Command coexistence

| User intent                           | Command                             | Notes                                                              |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Project / release / blocker narrative | `workspace explain …`               | Primary explain surface                                            |
| Shorthand alias                       | `workspace why …`                   | Same parser as `explain`                                           |
| Diff → blast radius → gates           | `workspace trace --from <diff>`     | Slice of explain (`kind: trace`)                                   |
| Graph node centrality                 | `workspace graph explain <project>` | Graph-topology slice; see **Graph explain coexistence** below      |
| Record agent outcome                  | `workspace feedback record --json`  | Appends `kind: agent-action` to history, no separate feedback file |
| Record Doctor repair outcome          | `doctor workspace                   | project --fix --json`                                              | Writes `doctor-fix-result-last-run.json` and appends `kind: doctor-fix` to history |
| MCP read bridge                       | `workspace mcp serve`               | Read-mostly stdio JSON-RPC; maps Phase 4 explain + skills tools    |

## Graph explain coexistence (4.11)

`workspace graph explain <project>` remains the **graph-topology slice** — centrality, direct/transitive dependents via `explainGraphNode` in `workspace-graph.ts`.

`workspace explain project:<name>` is the **unified narrative** — consumers, contracts, verification plan, release risk from reports.

Do not duplicate BFS/traversal: graph explain stays single-sourced in `workspace-graph.ts`; unified explain composes it when building project sections.

## Extension alignment

Schema versions advertised by `workspai --version --json` and `commands --json` must match files under `contracts/workspace-intelligence/`. Run `npm run sync:shared-contracts` after npm changes so `rapidkit-vscode/contracts` stays aligned.

## Answer contract (shared)

All operational skills and the workspace-intelligence Copilot skill use the same answer shape:

**Scope → Evidence → Diagnosis → Fix Plan → Run → Verify → Assumptions**

Defined in `src/contracts/standard-answer-contract.ts` and referenced by the agent customization pack.
