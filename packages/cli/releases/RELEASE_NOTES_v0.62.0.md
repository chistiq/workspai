<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Bounded agent entry and portable operational Skills",
  "summary": "Workspai 0.62.0 gives coding agents a smaller canonical-first entry, portable workspace identity, and evidence-derived operational Skills without preloading the complete Model or Graph.",
  "highlights": [
    {
      "icon": "🎯",
      "text": "Agents start with Goal state, compact context, relevant Skills, and bounded Graph retrieval"
    },
    {
      "icon": "🧩",
      "text": "Runtime-, test-, and delivery-aware operational Skills are generated from canonical workspace evidence"
    },
    {
      "icon": "🔒",
      "text": "Portable workspace identity prevents machine-local paths from entering durable agent output"
    },
    {
      "icon": "🤖",
      "text": "One generic intelligence run prepares entry surfaces for eleven supported agent hosts"
    }
  ]
}
-->

# Workspai CLI v0.62.0

Released August 20, 2026.

## Bounded Agent Entry and Portable Operational Skills

Workspai 0.62.0 makes first contact with an adopted project deterministic and
bounded. The canonical Workspace Model and proof-backed Knowledge Graph remain
the deep source of workspace evidence, but an agent no longer needs to preload
either complete artifact before it can begin useful work.

The default route is now:

```text
Project entry
  → Agent bootstrap receipt
  → Active Goal and compact workspace context
  → Relevant operational Skill
  → Project-scoped Graph search
  → Targeted live source inspection
```

The bootstrap receipt still validates the complete Model and Graph, their
structural binding, live input fingerprint, project membership, active Goal,
host entry, and artifact integrity. A missing, stale, incompatible, or unsafe
binding continues to fail closed.

## A smaller canonical-first read path

The project entry manifest, project lens, bootstrap receipt, and workspace
report index now agree on one compact read order:

1. resolve the project-to-workspace binding at runtime;
2. validate the host-specific bootstrap receipt;
3. inspect active Goal state when present;
4. read compact project and workspace context;
5. select a relevant operational Skill;
6. retrieve bounded proof-backed Graph evidence for the task;
7. inspect only the live source files required to confirm or change behavior.

Complete Model and Graph files remain canonical deep evidence for explicit
export, audit, and advanced investigation. They are validated by Workspai but
are no longer part of the default agent read budget.

## Evidence-derived operational Skills

Agent Sync now produces operational playbooks from current Workspace
Intelligence evidence:

- one runtime-validation Skill for each primary runtime represented by the
  registered projects;
- a polyglot validation Skill when a workspace contains multiple primary
  runtimes;
- a test-evidence recovery Skill when registered project commands expose a
  supported test lifecycle;
- a delivery-evidence Skill when project artifacts show CI, container, or chart
  intent;
- the existing dependency, API diagnosis, release, contract rename, and schema
  migration playbooks.

Every generated Skill includes portable frontmatter, scoped projects, safe
verification commands, current contract context, an evidence-first procedure,
and a stable Workspai ownership marker.

Generated Skills are projected to compatible host surfaces:

- `.agents/skills/<skill>/SKILL.md`
- `.github/skills/<skill>/SKILL.md`
- `.claude/skills/<skill>/SKILL.md`
- `.cursor/skills/<skill>/SKILL.md`
- `.grok/skills/<skill>/SKILL.md`

Reconciliation removes only stale files carrying the Workspai ownership
marker. Authored Skills, rules, prompts, symbolic links, and unrelated host
customizations remain untouched.

## Portable workspace identity

Durable agent-facing reports now identify the workspace as
`workspace:<name>`, not by a machine-local filesystem root. This applies to the
workspace context, report index, customization pack, MCP design, project lens,
bootstrap receipt, and generated host instructions.

An adopted project can still resolve the real workspace path when a local tool
must open an artifact:

```bash
workspai project workspace status --json
```

That resolver output is explicitly classified as machine-local,
non-portable, forbidden to persist, and forbidden to disclose.

## Supported consumers

The canonical entry protocol is generated and verified for:

- generic `AGENTS.md` consumers
- Codex
- Claude
- Gemini
- Qwen
- Kimi
- Grok
- GitHub Copilot
- Cursor
- Windsurf
- Amazon Q

Hosts with a documented portable Skills surface receive `SKILL.md`
projections. Other hosts retain their native instruction or rule adapter and
consume the same canonical Goal, context, evidence, and Graph contracts.

## Contract compatibility

Version-one project-entry, project-context, and bootstrap-receipt schemas
accept both the legacy direct Model/Graph route and the new bounded route. New
producers emit the bounded form. Existing persisted artifacts remain readable,
and consumers can migrate without lockstep releases.

The schema branches declare their required properties locally so strict AJV
compilation succeeds during adoption, bootstrap, Agent Sync, and CI contract
validation.

## Qualification

The release candidate was qualified with:

- a real four-project Java, Python, NestJS, and Next.js workspace;
- 44 strict bootstrap runs across four projects and eleven agent hosts, all
  returning `ready`, zero failed checks, and no absolute paths;
- the gRPC repository with 10,443 live files and nine detected runtime
  candidates;
- a gRPC Knowledge Graph containing 4,683 entities, 5,271 relations, and 7,318
  proofs with complete entity and relation proof coverage;
- project- and workspace-scoped Goal dry runs plus a real create, bootstrap
  binding, and cancel lifecycle;
- portable-path scans across entry manifests, project lenses, Goal Packs,
  handoffs, report indexes, context, MCP designs, and generated Skills;
- focused contract, entry, context, Agent Sync, and operational-Skills tests.

Doctor, readiness, and verification verdicts remain evidence-dependent. A
ready bootstrap proves canonical entry and freshness; it does not silently turn
advisory or missing release evidence into a passing release claim.

## Upgrade

```bash
npm install -g workspai@0.62.0
workspai --version
```

Expected output:

```text
0.62.0
```

## Compatibility

- Node.js `20.19.0` or newer remains required.
- The `wspai` alias will be published at the matching `0.62.0` version.
- Existing version-one agent-entry and project-context artifacts remain valid.
- Existing Goal Packs, workspace evidence, and authored agent customization
  remain valid.
- No public command is removed.

## Breaking changes

None.
