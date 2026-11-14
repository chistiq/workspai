/** Presentation guidance shared by CLI-owned host renderers; authority stays with evidence. */
export const AGENT_RESPONSE_GUIDANCE =
  "Answer in the user's language, with detail proportional to the request and no mandatory headings. Report the result, relevant scope/evidence, checks actually run and unresolved work. Applied changes are not verified outcomes; preserve uncertainty and CLI-owned approval, transaction and verification requirements.";

export const AGENT_MUTATION_GUIDANCE =
  'Routine project-local changes follow repository instructions and use native tools. Use Goal/Proof-Carrying Change when repository policy requires it, the change crosses project or architecture boundaries, or a governed Workspai effect needs authorization. Do not create a Goal/Change or run workspace-wide repair just to satisfy context retrieval. When a Change is required, predict expected project-relative artifacts before writing, obtain only the required exact authorization, record actual effects, verify after the last mutation and report unresolved blockers.';

export const AGENT_JSON_CONSUMPTION_GUIDANCE =
  "Read this as JSON data. If the host saves output to a file, parse it with JSON.parse(fs.readFileSync(file, 'utf8')) regardless of its extension; never require or execute that file. Select needed fields rather than echoing the entire packet or raw parse-error payload. If parsing fails, inspect a bounded excerpt and use native evidence with the limitation disclosed.";

export const AGENT_CONTINUATION_GUIDANCE =
  'Follow only remaining grounding.requiredReadOrder entries. canonicalEvidence paths are locators, not a reading checklist. Do not reload workspace INDEX, context or verify reports for a local task unless a finding or the user request needs them. Once a source path is known, use --path to select its closest lifecycle boundary when needed.';

export const AGENT_VERIFICATION_GUIDANCE =
  'Inspect the affected manifest and test prerequisites before running checks; command discovery is not proof that dependencies are installed. If a lifecycle unit names workspaceOwner, resolve setup from that root manifest rather than installing independently in the member. Reuse a running install/check instead of starting duplicates. While progress continues, wait using the host’s longer polling interval (up to 30 seconds) and give concise updates; silence alone is not failure. Diagnose stalled work before cancellation. Report setup, test execution and test results separately. Cover actual caller types, input boundaries and resource limits with relevant regression checks.';

export const AGENT_CONTEXT_GUIDANCE = [
  'For project work, start with the exact project and task. Read the nearest repository instructions, then run `workspai agent context --task "..."` once before source search or implementation/test reads; minimal path and instruction discovery is allowed. Add --path only when the project-relative source or manifest is known. The packet already validates project grounding and retrieves scoped Graph and lifecycle evidence: do not run a separate bootstrap, membership lookup or identical Graph search for evidence already supplied and still current. Use standalone `agent bootstrap --view agent --json` only for entry inspection without a task. If CLI execution is unavailable, use scoped Workspai tools actually exposed by the host, or disclose unavailable context and continue authorized native work. Read one applicable Skill, cited source and the closest manifest-backed checks. In mixed repositories, the root runtime does not describe every package.',
  AGENT_JSON_CONSUMPTION_GUIDANCE,
  AGENT_CONTINUATION_GUIDANCE,
  AGENT_VERIFICATION_GUIDANCE,
  'Graph results are bounded discovery evidence, not proof of implementation, tests or completion. Expand only relevant IDs with revision-bound evidence. Reuse a delivery receipt only in the same conversation while its graph hash and scope still match; missing or stale Graph context does not prove source is absent.',
  AGENT_MUTATION_GUIDANCE,
  'Never invent permission, commands, evidence or test results. If a required project policy cannot be satisfied, preserve the block and explain it. A passing project test verifies that check only; it does not seal an unrelated workspace Change.',
  'Reuse prior inspection only while project identity, scope, source and environment remain valid. After edits, inspect the final diff and run the closest applicable checks from the project manifest.',
].join(' ');
