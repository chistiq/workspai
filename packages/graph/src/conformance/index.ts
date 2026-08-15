export const GRAPH_CONFORMANCE_PROFILE = Object.freeze({
  id: 'workspai.graph.conformance',
  version: '0.1.0-draft',
  maturity: 'seed' as const,
  requiredSuites: [
    'contracts',
    'semantic-invalid',
    'architecture-boundaries',
    'determinism',
    'security-adversarial',
    'cross-platform',
    'package-consumer',
  ] as const,
});

export {
  GRAPH_SHARED_ADOPTION_PROFILE,
  assessGraphSharedEnvelope,
  type GraphSharedAdoptionFailureCode,
  type GraphSharedAdoptionResult,
} from './shared-adoption.js';
