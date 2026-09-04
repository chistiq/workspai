<!-- workspai-release-announcement
{
  "productId": "workspai-cli",
  "headline": "Reliable polyglot intelligence and bounded agent context",
  "summary": "Workspai 0.73.0 keeps the adoption-to-agent loop accurate across large and nested polyglot repositories while making contributor and CI routing more efficient.",
  "highlights": [
    {
      "icon": "🧭",
      "text": "Explicit Workspace, Goal, and Change scopes work from CI, IDE, MCP, and external automation callers"
    },
    {
      "icon": "🕸️",
      "text": "Polyglot Graph retrieval ranks authored evidence accurately without artificial aggregate-to-child dependency cycles"
    },
    {
      "icon": "🤖",
      "text": "Bounded agent context handles large diagnostic sets while preserving access to complete canonical evidence"
    },
    {
      "icon": "🧪",
      "text": "Node.js SDK detection and conversational Graph queries remain stable across JavaScript and TypeScript repositories"
    },
    {
      "icon": "🛡️",
      "text": "Path-aware CI, least-privilege workflows, live issue routing, and patched dependencies reduce risk"
    }
  ]
}
-->

# Workspai CLI v0.73.0

Released September 4, 2026.

**Publication status:** Published.

## Reliable Polyglot Intelligence and Bounded Agent Context

Workspai 0.73.0 improves the full path from adopting an existing repository to
giving agents current, portable, proof-backed project context. The release was
qualified against a real multi-language SDK containing .NET, Go, Java,
Node.js, Python, and Rust projects, then checked against large-repository
evidence from Kubernetes and VS Code.

The result is a more reliable loop rather than a collection of repository-
specific exceptions: live framework evidence wins over stale managed metadata,
registered project boundaries remain distinct, natural-language Graph queries
retain their actual subject, and external consumers can address an explicit
Workspace or project without changing their process directory.

## Polyglot Model and Graph accuracy

- Vitest command names no longer satisfy the Vite executable hint by substring.
- Workspai-managed linked metadata no longer overrides current repository
  framework evidence indefinitely.
- Aggregate repositories exclude explicitly registered nested project roots
  from inferred source-import scans.
- Inferred path dependencies and Go replacements cannot create synthetic edges
  between overlapping aggregate and nested ownership boundaries.
- Explicit contract and manually authored dependency edges remain authoritative.
- Node.js queries cover both JavaScript and TypeScript source while avoiding a
  generic `node` word becoming an accidental language filter.
- Runtime terms constrain search scope without becoming proof that an entity
  answers the actual question.
- Direct label, identity, and alias matches receive stronger evidence than
  incidental attribute matches.
- Generated artifacts are deprioritized unless the query explicitly asks for
  generated output.
- Common conversational, tense, and plural variations resolve to stable search
  concepts for bounded Graph retrieval.

## Consumer and automation continuity

- An explicitly scoped Goal resolves against the canonical Workspace Model
  even when the caller is outside the target project directory.
- `change` operations with an explicit Workspace path work from CI, IDE, MCP,
  and automation processes without artificial current-directory membership.
- Doctor invalidates project-scan evidence produced under the previous
  framework and diagnostic policy.
- Project Agent Context now honors its existing maximum of 16 diagnostics.
- Local freshness and availability findings retain priority, duplicate
  diagnostics are removed, and oversized sets end with a typed truncation
  notice linking to the complete canonical Workspace Knowledge Graph.
- Canonical Graph diagnostics are never deleted or rewritten by the bounded
  consumer projection.

## Contributor and CI operations

- A machine-readable contributor issue registry records which live parent
  outcomes are currently suitable for maintainer-routed slices.
- Repository checks detect drift between the contributor hub, routing registry,
  and live GitHub issue state.
- Contribution guidance separates small direct corrections from issue-based
  work that requires a maintainer-confirmed bounded slice.
- CI classifies changed paths so documentation-only work keeps fast required
  checks without launching unrelated heavyweight matrices.
- Official generator smoke retains scheduled and relevant-change coverage while
  allowing a proven same-day primary result to be reused.
- Workflow concurrency cancels obsolete runs, and contributor-facing automation
  ignores bot-authored pull requests.

## Security

- `fast-uri` is updated from 3.1.5 to 3.1.7 to consume the patched dependency.
- Remaining execution workflows declare explicit read-only repository
  permissions where write access is unnecessary.
- Contributor welcome automation no longer posts human onboarding instructions
  to Dependabot.
- `pull_request_target` workflows retain boundaries that do not check out or
  execute untrusted pull-request source.

## Compatibility

- Existing version-one Model, Graph, Goal, Decisions, PCC, Live, MCP, Repair,
  Doctor, and agent contracts remain supported.
- The 16-item diagnostic ceiling in `project-context-agent.v1` is unchanged;
  the producer now complies with it deterministically.
- Complete diagnostics remain available in
  `workspace:.workspai/reports/workspace-knowledge-graph.json`.
- No public command, flag, schema version, or artifact path is removed.

## Qualification evidence

- A seven-project polyglot SDK workspace completed Model and Graph generation,
  natural-language retrieval, Context, agent synchronization, exports, Goal,
  PCC authorization, effect receipt, re-observation, verification, capsule
  validation, and evidence-preserving abort paths.
- Generic, Codex, Claude, Copilot, Cursor, Gemini, and Grok bootstrap consumers
  passed strict entry verification while keeping environment and release
  blockers distinct from architecture readiness.
- Real VS Code Graph evidence with 27 diagnostics produced a valid bounded
  Project Agent Context containing 15 retained findings and one explicit notice
  for the 12 remaining canonical findings.
- Kubernetes evidence with 24,971 project entities remained valid with its
  three relevant diagnostics, confirming that the boundary depends on finding
  count rather than Graph size.
- Focused regression, typecheck, lint, formatting, English-text, package, and
  contract checks cover the changed surfaces.

## Install

```bash
npm install -g workspai@0.73.0
workspai --version
```

The optional `wspai` alias is released at the matching `0.73.0` version.
