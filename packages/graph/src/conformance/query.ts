import {
  GRAPH_BINDING_PROFILE_CONTRACT,
  GRAPH_PROOF_POLICY_CONTRACT,
  GRAPH_PROHIBITED_RETRIEVAL_STRATEGIES,
  GRAPH_QUERY_CONTRACT,
  GRAPH_QUERY_RESULT_CONTRACT,
  GRAPH_QUERY_STRATEGIES,
  type GraphBindingProfile,
  type GraphProofPolicy,
  type GraphQuery,
  type GraphQueryResult,
  type GraphValidationIssue,
  type GraphValidationResult,
} from '../contracts/index.js';

const QUERY_KINDS = new Set([
  'dependencies',
  'owners',
  'impact',
  'entry-points',
  'related',
  'cycles',
  'evidence',
  'path',
  'bindings',
  'operational-risk',
  'contract-topology',
  'architecture-conformance',
]);
const PROOF_STATES = new Set([
  'supported',
  'corroborated',
  'verified',
  'disputed',
  'insufficient',
  'unresolved',
]);
const SEMANTICS = new Set(['structural', 'behavioral', 'declarative', 'derived']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(code: string, path: string, message: string): GraphValidationIssue {
  return { code, path, message };
}

function finish<T>(input: unknown, issues: GraphValidationIssue[]): GraphValidationResult<T> {
  return issues.length === 0
    ? { accepted: true, value: Object.freeze(input as T), issues: [] }
    : { accepted: false, issues };
}

function contract(value: unknown, expected: { id: string; version: string }): boolean {
  return record(value) && value.id === expected.id && value.version === expected.version;
}

function uniqueStrings(value: unknown, minimum: number, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0) &&
    new Set(value).size === value.length
  );
}

export function validateGraphProofPolicy(input: unknown): GraphValidationResult<GraphProofPolicy> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    issues.push(issue('GRAPH_PROOF_POLICY_INVALID', '', 'Proof policy must be an object.'));
  else {
    if (!contract(input.contract, GRAPH_PROOF_POLICY_CONTRACT))
      issues.push(
        issue(
          'GRAPH_PROOF_POLICY_CONTRACT_UNSUPPORTED',
          '/contract',
          'Proof policy contract is unsupported.'
        )
      );
    if (
      typeof input.id !== 'string' ||
      input.id.length === 0 ||
      typeof input.version !== 'string' ||
      input.version.length === 0
    )
      issues.push(
        issue(
          'GRAPH_PROOF_POLICY_IDENTITY_INVALID',
          '',
          'Proof policy id and version are required.'
        )
      );
    if (!['declared', 'observed', 'verified', 'inferred'].includes(String(input.minimumAuthority)))
      issues.push(
        issue(
          'GRAPH_PROOF_POLICY_AUTHORITY_INVALID',
          '/minimumAuthority',
          'Proof authority floor is invalid.'
        )
      );
    if (
      !Number.isInteger(input.minimumIndependentRoots) ||
      Number(input.minimumIndependentRoots) < 1 ||
      Number(input.minimumIndependentRoots) > 100
    )
      issues.push(
        issue(
          'GRAPH_PROOF_POLICY_ROOT_LIMIT_INVALID',
          '/minimumIndependentRoots',
          'Independent evidence-root bound is invalid.'
        )
      );
    for (const key of ['verificationRequired', 'allowDisputed', 'allowStale'])
      if (typeof input[key] !== 'boolean')
        issues.push(
          issue('GRAPH_PROOF_POLICY_FLAG_INVALID', `/${key}`, 'Proof policy flags must be boolean.')
        );
  }
  return finish(input, issues);
}

export function validateGraphBindingProfile(
  input: unknown
): GraphValidationResult<GraphBindingProfile> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    issues.push(issue('GRAPH_BINDING_PROFILE_INVALID', '', 'Binding profile must be an object.'));
  else {
    if (!contract(input.contract, GRAPH_BINDING_PROFILE_CONTRACT))
      issues.push(
        issue(
          'GRAPH_BINDING_PROFILE_CONTRACT_UNSUPPORTED',
          '/contract',
          'Binding profile contract is unsupported.'
        )
      );
    if (
      typeof input.id !== 'string' ||
      input.id.length === 0 ||
      typeof input.version !== 'string' ||
      input.version.length === 0
    )
      issues.push(
        issue(
          'GRAPH_BINDING_PROFILE_IDENTITY_INVALID',
          '',
          'Binding profile id and version are required.'
        )
      );
    if (!uniqueStrings(input.sourceKinds, 1, 100))
      issues.push(
        issue(
          'GRAPH_BINDING_PROFILE_SOURCE_KINDS_INVALID',
          '/sourceKinds',
          'Binding source kinds must be unique and bounded.'
        )
      );
    if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 64)
      issues.push(
        issue(
          'GRAPH_BINDING_PROFILE_STEPS_INVALID',
          '/steps',
          'Binding steps must be non-empty and bounded.'
        )
      );
    else
      for (const [index, step] of input.steps.entries()) {
        if (
          !record(step) ||
          !uniqueStrings(step.relations, 1, 100) ||
          !['outgoing', 'incoming', 'both'].includes(String(step.direction)) ||
          !uniqueStrings(step.semantics, 1, 4) ||
          step.semantics.some((value) => !SEMANTICS.has(value)) ||
          (step.targetKinds !== undefined && !uniqueStrings(step.targetKinds, 0, 100))
        )
          issues.push(
            issue(
              'GRAPH_BINDING_PROFILE_STEP_INVALID',
              `/steps/${index}`,
              'Binding step relation, direction, semantics or target kinds are invalid.'
            )
          );
      }
    if (!PROOF_STATES.has(String(input.minimumProof)))
      issues.push(
        issue(
          'GRAPH_BINDING_PROFILE_PROOF_INVALID',
          '/minimumProof',
          'Binding proof threshold is invalid.'
        )
      );
  }
  return finish(input, issues);
}

export function validateGraphQuery(input: unknown): GraphValidationResult<GraphQuery> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    issues.push(issue('GRAPH_QUERY_INVALID', '', 'Graph query must be an object.'));
  else {
    if (!contract(input.contract, GRAPH_QUERY_CONTRACT))
      issues.push(
        issue(
          'GRAPH_QUERY_CONTRACT_UNSUPPORTED',
          '/contract',
          'Graph query contract is unsupported.'
        )
      );
    if (!QUERY_KINDS.has(String(input.kind)))
      issues.push(
        issue('GRAPH_QUERY_KIND_UNSUPPORTED', '/kind', 'Graph query kind is unsupported.')
      );
    if (input.relations !== undefined && !uniqueStrings(input.relations, 0, 1_000))
      issues.push(
        issue(
          'GRAPH_QUERY_RELATIONS_INVALID',
          '/relations',
          'Query relations must be unique and bounded.'
        )
      );
    if (input.strategy !== undefined) {
      const strategy = String(input.strategy);
      if ((GRAPH_PROHIBITED_RETRIEVAL_STRATEGIES as readonly string[]).includes(strategy)) {
        issues.push(
          issue(
            'GRAPH_QUERY_STRATEGY_PROHIBITED',
            '/strategy',
            'Similarity and vector retrieval cannot be a query strategy or canonical reuse authority.'
          )
        );
      } else if (!(GRAPH_QUERY_STRATEGIES as readonly string[]).includes(strategy)) {
        issues.push(
          issue('GRAPH_QUERY_STRATEGY_INVALID', '/strategy', 'Query strategy is unsupported.')
        );
      }
    }
    if (input.minimumProof !== undefined && !PROOF_STATES.has(String(input.minimumProof)))
      issues.push(
        issue('GRAPH_QUERY_PROOF_INVALID', '/minimumProof', 'Query proof threshold is invalid.')
      );
    if (input.includeDisputed !== undefined && typeof input.includeDisputed !== 'boolean')
      issues.push(
        issue(
          'GRAPH_QUERY_DISPUTE_FLAG_INVALID',
          '/includeDisputed',
          'Dispute selection must be boolean.'
        )
      );
  }
  return finish(input, issues);
}

export function validateGraphQueryResult(
  input: unknown
): GraphValidationResult<GraphQueryResult<unknown>> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    issues.push(issue('GRAPH_QUERY_RESULT_INVALID', '', 'Graph query result must be an object.'));
  else {
    if (!contract(input.contract, GRAPH_QUERY_RESULT_CONTRACT))
      issues.push(
        issue(
          'GRAPH_QUERY_RESULT_CONTRACT_UNSUPPORTED',
          '/contract',
          'Graph query result contract is unsupported.'
        )
      );
    for (const key of ['paths', 'evidence', 'disputes', 'unknownBoundaries', 'diagnostics'])
      if (!Array.isArray(input[key]))
        issues.push(
          issue(
            'GRAPH_QUERY_RESULT_ARRAY_REQUIRED',
            `/${key}`,
            `Query result ${key} must be an array.`
          )
        );
    if (
      !record(input.generation) ||
      typeof input.generation.id !== 'string' ||
      !record(input.generation.contentDigest)
    )
      issues.push(
        issue(
          'GRAPH_QUERY_RESULT_GENERATION_INVALID',
          '/generation',
          'Query result requires an immutable graph generation.'
        )
      );
    if (
      !record(input.retrievalPlan) ||
      !record(input.truncation) ||
      !record(input.freshness) ||
      !record(input.quality) ||
      !record(input.analysis)
    )
      issues.push(
        issue(
          'GRAPH_QUERY_RESULT_ENVELOPE_INCOMPLETE',
          '',
          'Query result requires retrieval, truncation and freshness envelopes.'
        )
      );
    if (
      typeof input.confidence !== 'number' ||
      !Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1
    )
      issues.push(
        issue(
          'GRAPH_QUERY_RESULT_CONFIDENCE_INVALID',
          '/confidence',
          'Query confidence must be finite and bounded.'
        )
      );
  }
  return finish(input, issues);
}
