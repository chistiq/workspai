import {
  GRAPH_PROOF_POLICY_CONTRACT,
  type GraphEdge,
  type GraphProofPolicy,
} from '../contracts/index.js';

export interface GraphProofPolicyAssessment {
  readonly admitted: boolean;
  readonly state: 'admitted' | 'insufficient' | 'disputed' | 'stale' | 'policy-mismatch';
  readonly reasons: readonly string[];
}

const AUTHORITY_RANK = Object.freeze({ inferred: 0, declared: 1, observed: 2, verified: 3 });

export function assessGraphEdgeProof(
  edge: GraphEdge,
  policy: GraphProofPolicy
): GraphProofPolicyAssessment {
  const reasons: string[] = [];
  if (
    policy.contract.id !== GRAPH_PROOF_POLICY_CONTRACT.id ||
    policy.contract.version !== GRAPH_PROOF_POLICY_CONTRACT.version ||
    edge.proof.policy.id !== policy.id ||
    edge.proof.policy.version !== policy.version
  )
    return {
      admitted: false,
      state: 'policy-mismatch',
      reasons: ['The edge was not evaluated under the requested proof policy.'],
    };
  if (edge.state === 'disputed' || edge.proof.state === 'disputed') {
    if (!policy.allowDisputed) reasons.push('Disputed claims are excluded by policy.');
  }
  if (edge.freshness.status === 'stale' && !policy.allowStale)
    reasons.push('Stale evidence is excluded by policy.');
  if (policy.verificationRequired && edge.proof.state !== 'verified')
    reasons.push('Verified proof is required.');
  const strongestAuthority = Math.max(
    ...edge.proof.authorities.map((authority) => AUTHORITY_RANK[authority])
  );
  if (strongestAuthority < AUTHORITY_RANK[policy.minimumAuthority])
    reasons.push('Observed authority does not meet the policy floor.');
  const independentRoots = new Set(edge.proof.corroborationGroups.map((group) => group.root)).size;
  if (independentRoots < policy.minimumIndependentRoots)
    reasons.push('Independent evidence-root requirement is not met.');
  const disputed = edge.state === 'disputed' || edge.proof.state === 'disputed';
  return {
    admitted: reasons.length === 0,
    state:
      reasons.length === 0
        ? 'admitted'
        : disputed
          ? 'disputed'
          : edge.freshness.status === 'stale'
            ? 'stale'
            : 'insufficient',
    reasons: Object.freeze(reasons),
  };
}
