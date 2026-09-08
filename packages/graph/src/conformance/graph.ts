import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_CLAIM_DERIVATIONS,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
  GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT,
  GRAPH_QUERY_CACHE_REUSE_CONTRACT,
  GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  GRAPH_NARY_ASSERTION_CONTRACT,
  GRAPH_QUALITY_CONTRACT,
  GRAPH_QUERY_CACHE_CONTRACT,
  type GraphCanonicalGraph,
  type GraphModelGenerationBinding,
  type GraphOntologyProfile,
  type GraphNaryRelationAssertion,
  type GraphPublicationManifest,
  type GraphQualityReport,
  type GraphQueryCacheEntry,
  type GraphQueryCacheInvalidation,
  type GraphQueryCacheKey,
  type GraphQueryCacheReuseDecision,
  type GraphValidationIssue,
  type GraphValidationResult,
} from '../contracts/index.js';

const DIGEST_VALUE = /^[a-f0-9]{32,256}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const MAX_VALIDATION_ISSUES = 100;
const MAX_GRAPH_NODES = 10_000_000;
const MAX_GRAPH_EDGES = 50_000_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function add(issues: GraphValidationIssue[], code: string, path: string, message: string): void {
  if (issues.length < MAX_VALIDATION_ISSUES) issues.push({ code, path, message });
}
function contract(value: unknown, expected: { id: string; version: string }): boolean {
  return record(value) && value.id === expected.id && value.version === expected.version;
}
function digest(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.algorithm === 'string' &&
    value.algorithm.length > 0 &&
    typeof value.value === 'string' &&
    DIGEST_VALUE.test(value.value)
  );
}
function generationReference(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.generatedAt === 'string' &&
    ISO_TIMESTAMP.test(value.generatedAt) &&
    digest(value.contentDigest)
  );
}
function generation(value: unknown): boolean {
  return (
    record(value) &&
    generationReference(value.reference) &&
    contract(value.graphSchema, GRAPH_CANONICAL_GRAPH_CONTRACT) &&
    typeof value.architectureEpoch === 'string' &&
    value.architectureEpoch.length > 0 &&
    [
      'ontologySetDigest',
      'proofPolicySetDigest',
      'inputsDigest',
      'factSetDigest',
      'providerSetDigest',
      'compositionPolicyDigest',
    ].every((key) => digest(value[key]))
  );
}
function uniqueNonEmptyStrings(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0) &&
    new Set(value).size === value.length
  );
}
function portableLocator(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').includes('..') &&
    !/^[A-Za-z]:/u.test(value)
  );
}
function result<T>(input: unknown, issues: GraphValidationIssue[]): GraphValidationResult<T> {
  return issues.length === 0
    ? { accepted: true, value: Object.freeze(input as T), issues: [] }
    : { accepted: false, issues };
}

export function validateGraphOntologyProfile(
  input: unknown
): GraphValidationResult<GraphOntologyProfile> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_ONTOLOGY_INVALID', '', 'Ontology profile must be an object.');
  else {
    if (!contract(input.contract, GRAPH_ONTOLOGY_PROFILE_CONTRACT))
      add(
        issues,
        'GRAPH_ONTOLOGY_CONTRACT_UNSUPPORTED',
        '/contract',
        'Ontology contract is unsupported.'
      );
    if (typeof input.id !== 'string' || typeof input.version !== 'string')
      add(issues, 'GRAPH_ONTOLOGY_IDENTITY_INVALID', '', 'Ontology id and version are required.');
    if (!Array.isArray(input.entities) || input.entities.length === 0)
      add(
        issues,
        'GRAPH_ONTOLOGY_ENTITIES_REQUIRED',
        '/entities',
        'Ontology requires entity definitions.'
      );
    if (!Array.isArray(input.relations) || input.relations.length === 0)
      add(
        issues,
        'GRAPH_ONTOLOGY_RELATIONS_REQUIRED',
        '/relations',
        'Ontology requires relation definitions.'
      );
    const entityKinds = new Set<string>();
    const families = new Set<string>();
    for (const [index, entity] of (Array.isArray(input.entities) ? input.entities : []).entries()) {
      if (!record(entity) || typeof entity.kind !== 'string' || typeof entity.family !== 'string')
        add(
          issues,
          'GRAPH_ONTOLOGY_ENTITY_INVALID',
          `/entities/${index}`,
          'Entity kind and family are required.'
        );
      else {
        if (entityKinds.has(entity.kind))
          add(
            issues,
            'GRAPH_ONTOLOGY_ENTITY_DUPLICATE',
            `/entities/${index}/kind`,
            'Entity kinds must be unique.'
          );
        entityKinds.add(entity.kind);
        families.add(entity.family);
      }
    }
    const relationKinds = new Set<string>();
    for (const [index, relation] of (Array.isArray(input.relations)
      ? input.relations
      : []
    ).entries()) {
      if (!record(relation) || typeof relation.kind !== 'string')
        add(
          issues,
          'GRAPH_ONTOLOGY_RELATION_INVALID',
          `/relations/${index}`,
          'Relation kind is required.'
        );
      else {
        if (relationKinds.has(relation.kind))
          add(
            issues,
            'GRAPH_ONTOLOGY_RELATION_DUPLICATE',
            `/relations/${index}/kind`,
            'Relation kinds must be unique.'
          );
        relationKinds.add(relation.kind);
        for (const family of [
          ...(Array.isArray(relation.subjectFamilies) ? relation.subjectFamilies : []),
          ...(Array.isArray(relation.objectFamilies) ? relation.objectFamilies : []),
        ])
          if (typeof family !== 'string' || !families.has(family))
            add(
              issues,
              'GRAPH_ONTOLOGY_FAMILY_UNRESOLVED',
              `/relations/${index}`,
              'Relation references an unknown entity family.'
            );
        if (
          relation.symmetric === true &&
          typeof relation.inverse === 'string' &&
          relation.inverse !== relation.kind
        )
          add(
            issues,
            'GRAPH_ONTOLOGY_SYMMETRIC_INVERSE_INVALID',
            `/relations/${index}/inverse`,
            'A symmetric relation can only be its own inverse.'
          );
      }
    }
  }
  return result(input, issues);
}

export function validateCanonicalGraph(
  input: unknown,
  ontology: GraphOntologyProfile
): GraphValidationResult<GraphCanonicalGraph> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_CANONICAL_GRAPH_INVALID', '', 'Canonical graph must be an object.');
  else {
    const ontologyResult = validateGraphOntologyProfile(ontology);
    if (!ontologyResult.accepted)
      add(
        issues,
        'GRAPH_CANONICAL_ONTOLOGY_INVALID',
        '/ontology',
        'Canonical graph cannot be validated against an invalid ontology.'
      );
    if (!contract(input.contract, GRAPH_CANONICAL_GRAPH_CONTRACT))
      add(
        issues,
        'GRAPH_CANONICAL_GRAPH_CONTRACT_UNSUPPORTED',
        '/contract',
        'Canonical graph contract is unsupported.'
      );
    if (!generation(input.generation))
      add(
        issues,
        'GRAPH_GENERATION_INCOMPLETE',
        '/generation',
        'Generation requires its schema, architecture epoch and every immutable semantic digest.'
      );
    if (typeof input.graphVersion !== 'string' || input.graphVersion.length === 0)
      add(
        issues,
        'GRAPH_CANONICAL_VERSION_INVALID',
        '/graphVersion',
        'Canonical graph version is required.'
      );
    if (
      !Array.isArray(input.ontology) ||
      !input.ontology.some(
        (profile) =>
          record(profile) && profile.id === ontology.id && profile.version === ontology.version
      )
    )
      add(
        issues,
        'GRAPH_CANONICAL_ONTOLOGY_UNBOUND',
        '/ontology',
        'Canonical graph must bind the ontology used for semantic validation.'
      );
    if (!Array.isArray(input.nodes) || input.nodes.length > MAX_GRAPH_NODES)
      add(
        issues,
        'GRAPH_CANONICAL_NODES_INVALID',
        '/nodes',
        'Canonical nodes must be a bounded array.'
      );
    const nodes = new Map<string, string>();
    const identities = new Map<string, string>();
    for (const [index, node] of (Array.isArray(input.nodes) ? input.nodes : []).entries()) {
      if (
        !record(node) ||
        typeof node.id !== 'string' ||
        !record(node.identityScheme) ||
        node.identityScheme.id !== GRAPH_IDENTITY_SCHEME.id ||
        node.identityScheme.version !== GRAPH_IDENTITY_SCHEME.version ||
        typeof node.kind !== 'string' ||
        !record(node.scope)
      )
        add(issues, 'GRAPH_NODE_INVALID', `/nodes/${index}`, 'Node identity is invalid.');
      else {
        if (nodes.has(node.id))
          add(
            issues,
            'GRAPH_NODE_DUPLICATE',
            `/nodes/${index}/id`,
            'Canonical node ids must be unique.'
          );
        else nodes.set(node.id, String(node.kind));
        const aliases = Array.isArray(node.aliases) ? node.aliases : [];
        const identityValues: unknown[] = [
          node.id,
          ...aliases.map((alias) => (record(alias) ? alias.id : undefined)),
        ];
        for (const [identityIndex, identity] of identityValues.entries()) {
          if (typeof identity !== 'string') continue;
          const previous = identities.get(identity);
          if (previous && previous !== node.id)
            add(
              issues,
              'GRAPH_NODE_IDENTITY_COLLISION',
              `/nodes/${index}/${identityIndex === 0 ? 'id' : `aliases/${identityIndex - 1}/id`}`,
              'Canonical ids and aliases cannot resolve to different nodes.'
            );
          else identities.set(identity, node.id);
        }
      }
    }
    if (!Array.isArray(input.edges) || input.edges.length > MAX_GRAPH_EDGES)
      add(
        issues,
        'GRAPH_CANONICAL_EDGES_INVALID',
        '/edges',
        'Canonical edges must be a bounded array.'
      );
    const relations = new Map(ontology.relations.map((relation) => [relation.kind, relation]));
    const entityFamilies = new Map(ontology.entities.map((entity) => [entity.kind, entity.family]));
    const edgeIds = new Set<string>();
    for (const [index, edge] of (Array.isArray(input.edges) ? input.edges : []).entries()) {
      if (!record(edge) || typeof edge.id !== 'string')
        add(issues, 'GRAPH_EDGE_INVALID', `/edges/${index}`, 'Edge identity is invalid.');
      else {
        if (edgeIds.has(edge.id))
          add(
            issues,
            'GRAPH_EDGE_DUPLICATE',
            `/edges/${index}/id`,
            'Canonical edge ids must be unique.'
          );
        edgeIds.add(edge.id);
        if (!['accepted', 'disputed', 'rejected', 'unresolved'].includes(String(edge.state)))
          add(
            issues,
            'GRAPH_EDGE_STATE_INVALID',
            `/edges/${index}/state`,
            'Edge resolution state is invalid.'
          );
        if (!nodes.has(String(edge.from)) || !nodes.has(String(edge.to)))
          add(
            issues,
            'GRAPH_EDGE_ENDPOINT_UNRESOLVED',
            `/edges/${index}`,
            'Accepted graph edges must reference canonical nodes.'
          );
        const relation = relations.get(String(edge.relation));
        if (!relation)
          add(
            issues,
            'GRAPH_EDGE_RELATION_UNSUPPORTED',
            `/edges/${index}/relation`,
            'Edge relation is absent from the ontology.'
          );
        else {
          if (edge.semantics !== relation.semantics)
            add(
              issues,
              'GRAPH_EDGE_SEMANTICS_MISMATCH',
              `/edges/${index}/semantics`,
              'Edge semantics must match the ontology relation definition.'
            );
          const fromFamily = entityFamilies.get(nodes.get(String(edge.from)) ?? '');
          const toFamily = entityFamilies.get(nodes.get(String(edge.to)) ?? '');
          if (fromFamily && !relation.subjectFamilies.includes(fromFamily))
            add(
              issues,
              'GRAPH_EDGE_SUBJECT_FAMILY_INVALID',
              `/edges/${index}/from`,
              'Edge subject family is not permitted by the ontology.'
            );
          if (toFamily && !relation.objectFamilies.includes(toFamily))
            add(
              issues,
              'GRAPH_EDGE_OBJECT_FAMILY_INVALID',
              `/edges/${index}/to`,
              'Edge object family is not permitted by the ontology.'
            );
        }
        if (
          !uniqueNonEmptyStrings(edge.facts, 1_000_000) ||
          !Array.isArray(edge.derivations) ||
          edge.derivations.length === 0 ||
          edge.derivations.some((entry) => !GRAPH_CLAIM_DERIVATIONS.includes(entry as never)) ||
          !record(edge.proof) ||
          !Array.isArray(edge.proof.evidence) ||
          edge.proof.evidence.length === 0 ||
          ![
            'supported',
            'corroborated',
            'verified',
            'disputed',
            'insufficient',
            'unresolved',
          ].includes(String(edge.proof.state)) ||
          !contract(edge.proof.policy, relation?.proofPolicy ?? { id: '', version: '' }) ||
          !digest(edge.proof.inputDigest) ||
          typeof edge.proof.evaluatedAt !== 'string' ||
          !ISO_TIMESTAMP.test(edge.proof.evaluatedAt) ||
          edge.proof.evidence.some(
            (evidence) =>
              !record(evidence) ||
              typeof evidence.id !== 'string' ||
              typeof evidence.sourceKind !== 'string' ||
              !digest(evidence.digest) ||
              (evidence.relativeLocator !== undefined && !portableLocator(evidence.relativeLocator))
          )
        )
          add(
            issues,
            'GRAPH_EDGE_PROOF_INSUFFICIENT',
            `/edges/${index}/proof`,
            'A materialized edge requires fact and evidence lineage.'
          );
        if (
          typeof edge.confidence !== 'number' ||
          !Number.isFinite(edge.confidence) ||
          edge.confidence < 0 ||
          edge.confidence > 1
        )
          add(
            issues,
            'GRAPH_EDGE_CONFIDENCE_INVALID',
            `/edges/${index}/confidence`,
            'Edge confidence must be finite and between zero and one.'
          );
      }
    }
    if (!Array.isArray(input.assertions))
      add(
        issues,
        'GRAPH_CANONICAL_ASSERTIONS_INVALID',
        '/assertions',
        'N-ary assertions must be explicit, including an empty array.'
      );
    else
      for (const [index, assertion] of input.assertions.entries()) {
        if (issues.length >= MAX_VALIDATION_ISSUES) break;
        const assertionResult = validateGraphNaryAssertion(assertion, ontology);
        if (!assertionResult.accepted)
          add(
            issues,
            'GRAPH_CANONICAL_ASSERTION_REJECTED',
            `/assertions/${index}`,
            'Canonical graph contains a semantically invalid n-ary assertion.'
          );
      }
    for (const field of ['disputes', 'unresolved', 'diagnostics'])
      if (!Array.isArray(input[field]))
        add(
          issues,
          'GRAPH_CANONICAL_DIMENSION_MISSING',
          `/${field}`,
          'Canonical result dimensions must be explicit, including empty arrays.'
        );
    if (
      Array.isArray(input.disputes) &&
      input.disputes.some(
        (entry) =>
          !record(entry) ||
          typeof entry.id !== 'string' ||
          !uniqueNonEmptyStrings(entry.factIds, 1_000_000)
      )
    )
      add(
        issues,
        'GRAPH_CANONICAL_DISPUTE_INVALID',
        '/disputes',
        'Every dispute requires identity and at least one unique fact reference.'
      );
    if (
      Array.isArray(input.unresolved) &&
      input.unresolved.some(
        (entry) =>
          !record(entry) ||
          typeof entry.id !== 'string' ||
          !uniqueNonEmptyStrings(entry.candidates, 1_000_000)
      )
    )
      add(
        issues,
        'GRAPH_CANONICAL_UNRESOLVED_INVALID',
        '/unresolved',
        'Every unresolved identity requires explicit candidate identities.'
      );
  }
  return result(input, issues);
}

export function validateGraphQueryCacheKey(
  input: unknown
): GraphValidationResult<GraphQueryCacheKey> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_QUERY_CACHE_KEY_INVALID', '', 'Query cache key must be an object.');
  else {
    if (!contract(input.contract, GRAPH_QUERY_CACHE_CONTRACT))
      add(
        issues,
        'GRAPH_QUERY_CACHE_CONTRACT_UNSUPPORTED',
        '/contract',
        'Query cache contract is unsupported.'
      );
    if (!record(input.graphGeneration) || !record(input.graphGeneration.contentDigest))
      add(
        issues,
        'GRAPH_QUERY_CACHE_MUTABLE_GENERATION',
        '/graphGeneration',
        'Cache keys require an immutable generation digest, never latest.'
      );
    const budget = record(input.budget) ? input.budget : undefined;
    if (
      !budget ||
      ['maxDepth', 'maxNodes', 'maxEdges', 'maxEvidence'].some(
        (key) => !Number.isInteger(budget[key]) || Number(budget[key]) <= 0
      )
    )
      add(
        issues,
        'GRAPH_QUERY_CACHE_BUDGET_INVALID',
        '/budget',
        'Every query budget is part of the exact cache identity.'
      );
    for (const key of [
      'queryDigest',
      'ontologyDigest',
      'proofPolicyDigest',
      'profileDigest',
      'redactionPolicyDigest',
      'authorizationDigest',
    ])
      if (!record(input[key]))
        add(
          issues,
          'GRAPH_QUERY_CACHE_DEPENDENCY_MISSING',
          `/${key}`,
          'All semantic dependencies are required for reuse.'
        );
  }
  return result(input, issues);
}

export function validateGraphPublicationManifest(
  input: unknown
): GraphValidationResult<GraphPublicationManifest> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_PUBLICATION_INVALID', '', 'Publication manifest must be an object.');
  else {
    if (!generation(input.generation))
      add(
        issues,
        'GRAPH_PUBLICATION_GENERATION_INVALID',
        '/generation',
        'Publication must bind a complete immutable graph generation.'
      );
    if (!digest(input.artifactDigest))
      add(
        issues,
        'GRAPH_PUBLICATION_ARTIFACT_DIGEST_INVALID',
        '/artifactDigest',
        'Publication requires the canonical artifact digest.'
      );
    if (!digest(input.qualityDigest))
      add(
        issues,
        'GRAPH_PUBLICATION_QUALITY_DIGEST_INVALID',
        '/qualityDigest',
        'Publication requires its quality-report digest.'
      );
    if (input.publication !== 'staged' && input.publication !== 'committed')
      add(
        issues,
        'GRAPH_PUBLICATION_STATE_INVALID',
        '/publication',
        'Publication state must be staged or committed.'
      );
    if (input.previousGeneration !== undefined && !generationReference(input.previousGeneration))
      add(
        issues,
        'GRAPH_PUBLICATION_PREVIOUS_GENERATION_INVALID',
        '/previousGeneration',
        'Previous generation must be an immutable generation reference.'
      );
  }
  return result(input, issues);
}

export function validateGraphModelGenerationBinding(
  input: unknown
): GraphValidationResult<GraphModelGenerationBinding> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_MODEL_BINDING_INVALID', '', 'Model binding must be an object.');
  else {
    if (!generationReference(input.graphGeneration))
      add(
        issues,
        'GRAPH_MODEL_BINDING_GRAPH_GENERATION_INVALID',
        '/graphGeneration',
        'Model binding requires an immutable graph generation.'
      );
    if (!generationReference(input.modelGeneration))
      add(
        issues,
        'GRAPH_MODEL_BINDING_MODEL_GENERATION_INVALID',
        '/modelGeneration',
        'Model binding requires an immutable model generation.'
      );
    if (typeof input.architectureEpoch !== 'string' || input.architectureEpoch.length === 0)
      add(
        issues,
        'GRAPH_MODEL_BINDING_ARCHITECTURE_EPOCH_INVALID',
        '/architectureEpoch',
        'Graph and Model must bind through an explicit architecture epoch.'
      );
  }
  return result(input, issues);
}

export function validateGraphQueryCacheEntry(
  input: unknown
): GraphValidationResult<GraphQueryCacheEntry> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_QUERY_CACHE_ENTRY_INVALID', '', 'Query cache entry must be an object.');
  else {
    if (!contract(input.contract, GRAPH_QUERY_CACHE_ENTRY_CONTRACT))
      add(
        issues,
        'GRAPH_QUERY_CACHE_ENTRY_CONTRACT_UNSUPPORTED',
        '/contract',
        'Query cache entry contract is unsupported.'
      );
    const keyResult = validateGraphQueryCacheKey(input.key);
    if (!keyResult.accepted)
      add(
        issues,
        'GRAPH_QUERY_CACHE_ENTRY_KEY_INVALID',
        '/key',
        'Cache entry contains an invalid or mutable semantic key.'
      );
    if (!digest(input.keyDigest) || !digest(input.resultDigest))
      add(
        issues,
        'GRAPH_QUERY_CACHE_ENTRY_DIGEST_INVALID',
        '',
        'Cache key and result require immutable digests.'
      );
    if (!record(input.freshness) || typeof input.freshness.status !== 'string')
      add(
        issues,
        'GRAPH_QUERY_CACHE_ENTRY_FRESHNESS_INVALID',
        '/freshness',
        'Cache entry freshness must be explicit.'
      );
    if (!Object.prototype.hasOwnProperty.call(input, 'result'))
      add(
        issues,
        'GRAPH_QUERY_CACHE_ENTRY_RESULT_MISSING',
        '/result',
        'Cache entries must carry a result, including explicit null results.'
      );
  }
  return result(input, issues);
}

export function validateGraphQueryCacheReuseDecision(
  input: unknown
): GraphValidationResult<GraphQueryCacheReuseDecision> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_QUERY_CACHE_REUSE_INVALID', '', 'Cache reuse decision must be an object.');
  else {
    if (!contract(input.contract, GRAPH_QUERY_CACHE_REUSE_CONTRACT))
      add(
        issues,
        'GRAPH_QUERY_CACHE_REUSE_CONTRACT_UNSUPPORTED',
        '/contract',
        'Cache reuse contract is unsupported.'
      );
    if (input.reusable === true) {
      if (input.status !== 'exact' || !digest(input.entryDigest))
        add(
          issues,
          'GRAPH_QUERY_CACHE_REUSE_EXACT_INVALID',
          '',
          'Reusable decisions must be exact and bind the accepted entry digest.'
        );
      if ('reasons' in input)
        add(
          issues,
          'GRAPH_QUERY_CACHE_REUSE_AMBIGUOUS',
          '/reasons',
          'An exact reuse cannot also carry miss reasons.'
        );
    } else if (input.reusable === false) {
      if (
        !['miss', 'stale', 'denied', 'incompatible', 'corrupt'].includes(String(input.status)) ||
        !Array.isArray(input.reasons) ||
        input.reasons.length === 0 ||
        input.reasons.some((reason) => typeof reason !== 'string' || reason.length === 0) ||
        new Set(input.reasons).size !== input.reasons.length
      )
        add(
          issues,
          'GRAPH_QUERY_CACHE_REUSE_REJECTION_INVALID',
          '',
          'Rejected reuse requires a supported status and unique non-empty reasons.'
        );
      if ('entryDigest' in input)
        add(
          issues,
          'GRAPH_QUERY_CACHE_REUSE_AMBIGUOUS',
          '/entryDigest',
          'A rejected reuse cannot identify an accepted entry.'
        );
    } else
      add(
        issues,
        'GRAPH_QUERY_CACHE_REUSE_DISCRIMINATOR_INVALID',
        '/reusable',
        'Cache reuse decision must explicitly accept or reject reuse.'
      );
  }
  return result(input, issues);
}

export function validateGraphQueryCacheInvalidation(
  input: unknown
): GraphValidationResult<GraphQueryCacheInvalidation> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(
      issues,
      'GRAPH_QUERY_CACHE_INVALIDATION_INVALID',
      '',
      'Cache invalidation must be an object.'
    );
  else {
    if (!contract(input.contract, GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT))
      add(
        issues,
        'GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT_UNSUPPORTED',
        '/contract',
        'Cache invalidation contract is unsupported.'
      );
    if (
      !Array.isArray(input.keyDigests) ||
      input.keyDigests.length === 0 ||
      input.keyDigests.some((entry) => !digest(entry)) ||
      new Set(input.keyDigests.map((entry) => JSON.stringify(entry))).size !==
        input.keyDigests.length
    )
      add(
        issues,
        'GRAPH_QUERY_CACHE_INVALIDATION_KEYS_INVALID',
        '/keyDigests',
        'Invalidation requires unique immutable cache-key digests.'
      );
    if (
      ![
        'generation',
        'ontology',
        'proof-policy',
        'profile',
        'scope',
        'redaction',
        'authorization',
        'corruption',
      ].includes(String(input.reason))
    )
      add(
        issues,
        'GRAPH_QUERY_CACHE_INVALIDATION_REASON_INVALID',
        '/reason',
        'Invalidation reason must name an exact semantic dependency.'
      );
  }
  return result(input, issues);
}

export function validateGraphNaryAssertion(
  input: unknown,
  ontology: GraphOntologyProfile
): GraphValidationResult<GraphNaryRelationAssertion> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_NARY_ASSERTION_INVALID', '', 'N-ary assertion must be an object.');
  else {
    if (!contract(input.contract, GRAPH_NARY_ASSERTION_CONTRACT))
      add(
        issues,
        'GRAPH_NARY_CONTRACT_UNSUPPORTED',
        '/contract',
        'N-ary assertion contract is unsupported.'
      );
    if (!ontology.relations.some((relation) => relation.kind === input.relation))
      add(
        issues,
        'GRAPH_NARY_RELATION_UNSUPPORTED',
        '/relation',
        'N-ary relation is absent from the ontology.'
      );
    if (!Array.isArray(input.participants) || input.participants.length < 2)
      add(
        issues,
        'GRAPH_NARY_PARTICIPANTS_INSUFFICIENT',
        '/participants',
        'N-ary assertion requires at least two role-labelled participants.'
      );
    else {
      const roles = new Set<string>();
      for (const [index, participant] of input.participants.entries()) {
        if (
          !record(participant) ||
          typeof participant.role !== 'string' ||
          !record(participant.entity)
        )
          add(
            issues,
            'GRAPH_NARY_PARTICIPANT_INVALID',
            `/participants/${index}`,
            'Participant role and entity are required.'
          );
        else if (roles.has(participant.role))
          add(
            issues,
            'GRAPH_NARY_ROLE_DUPLICATE',
            `/participants/${index}/role`,
            'Participant roles must be unique unless an ontology explicitly defines multiplicity.'
          );
        else roles.add(participant.role);
      }
    }
    if (
      !Array.isArray(input.facts) ||
      input.facts.length === 0 ||
      !record(input.proof) ||
      !Array.isArray(input.proof.evidence) ||
      input.proof.evidence.length === 0
    )
      add(
        issues,
        'GRAPH_NARY_PROOF_INSUFFICIENT',
        '/proof',
        'N-ary assertion requires fact and evidence lineage.'
      );
  }
  return result(input, issues);
}

export function validateGraphQualityReport(
  input: unknown
): GraphValidationResult<GraphQualityReport> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    add(issues, 'GRAPH_QUALITY_INVALID', '', 'Graph quality report must be an object.');
  else {
    if (!contract(input.contract, GRAPH_QUALITY_CONTRACT))
      add(
        issues,
        'GRAPH_QUALITY_CONTRACT_UNSUPPORTED',
        '/contract',
        'Graph quality contract is unsupported.'
      );
    if (!record(input.generation) || !record(input.generation.contentDigest))
      add(
        issues,
        'GRAPH_QUALITY_GENERATION_MISSING',
        '/generation',
        'Quality must bind an immutable graph generation.'
      );
    for (const field of [
      'unknownZones',
      'unsupportedZones',
      'staleZones',
      'conflicts',
      'orphans',
      'providerFailures',
      'releaseClaims',
    ])
      if (!Array.isArray(input[field]))
        add(
          issues,
          'GRAPH_QUALITY_DIMENSION_MISSING',
          `/${field}`,
          'Quality cannot omit a permanent result dimension.'
        );
    const proofStates = record(input.proofStates) ? input.proofStates : undefined;
    if (
      !proofStates ||
      ['supported', 'corroborated', 'verified', 'disputed', 'insufficient', 'unresolved'].some(
        (state) => !Number.isInteger(proofStates[state]) || Number(proofStates[state]) < 0
      )
    )
      add(
        issues,
        'GRAPH_QUALITY_PROOF_COUNTS_INVALID',
        '/proofStates',
        'Every proof state requires a non-negative count.'
      );
    if (
      Array.isArray(input.providerFailures) &&
      input.providerFailures.length > 0 &&
      Array.isArray(input.releaseClaims) &&
      input.releaseClaims.includes('complete')
    )
      add(
        issues,
        'GRAPH_QUALITY_COMPLETE_CLAIM_INVALID',
        '/releaseClaims',
        'Provider failures prohibit an unqualified complete claim.'
      );
  }
  return result(input, issues);
}
