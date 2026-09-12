import type { WisDigestReference, WisScopeReference } from '@workspai/shared/contracts';

import {
  GRAPH_CLAIM_AUTHORITIES,
  GRAPH_CLAIM_DERIVATIONS,
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphEntityReference,
  type GraphFactBatch,
  type GraphProviderDetectionRequest,
  type GraphProviderDetectionResult,
  type GraphProviderManifest,
  type GraphValidationIssue,
  type GraphValidationResult,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export type GraphProviderOutputAdmission =
  | {
      readonly accepted: true;
      readonly manifest: GraphProviderManifest;
      readonly batch: GraphFactBatch;
      readonly issues: readonly [];
    }
  | {
      readonly accepted: false;
      readonly issues: readonly GraphValidationIssue[];
    };

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/#@+-]{0,511}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const DIGEST_VALUE = /^[a-f0-9]{32,256}$/u;
const MAX_VALIDATION_ISSUES = 100;
const MAX_BATCH_INPUTS = 1_000_000;
const MAX_PROVIDER_FACTS = 10_000_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(issues: GraphValidationIssue[], code: string, path: string, message: string): void {
  if (issues.length < MAX_VALIDATION_ISSUES) issues.push({ code, path, message });
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function nonEmptyUniqueStrings(value: unknown, maximum = 1_000): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    value.every(validIdentifier) &&
    new Set(value).size === value.length
  );
}

function validDigest(value: unknown): value is WisDigestReference {
  return (
    record(value) &&
    validIdentifier(value.algorithm) &&
    typeof value.value === 'string' &&
    DIGEST_VALUE.test(value.value)
  );
}

function validScope(value: unknown): value is WisScopeReference {
  if (!record(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'workspace') return validIdentifier(value.workspaceId);
  if (value.kind === 'project') {
    return (
      Array.isArray(value.projectIds) &&
      value.projectIds.length > 0 &&
      value.projectIds.every(validIdentifier)
    );
  }
  if (value.kind === 'selection') {
    return (
      (Array.isArray(value.projectIds) && value.projectIds.length > 0) ||
      (Array.isArray(value.entityIds) && value.entityIds.length > 0) ||
      (typeof value.selector === 'string' && value.selector.length > 0)
    );
  }
  return value.kind === 'organization' && validIdentifier(value.organizationId);
}

function validPortableLocator(value: unknown): value is string {
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

function validateEntity(
  value: unknown,
  path: string,
  issues: GraphValidationIssue[]
): value is GraphEntityReference {
  if (!record(value)) {
    issue(issues, 'GRAPH_ENTITY_INVALID', path, 'Entity reference must be an object.');
    return false;
  }
  let valid = true;
  if (!validIdentifier(value.id)) {
    issue(
      issues,
      'GRAPH_ENTITY_ID_INVALID',
      `${path}/id`,
      'Entity id must be a portable identifier.'
    );
    valid = false;
  }
  if (
    !record(value.identityScheme) ||
    value.identityScheme.id !== GRAPH_IDENTITY_SCHEME.id ||
    value.identityScheme.version !== GRAPH_IDENTITY_SCHEME.version
  ) {
    issue(
      issues,
      'GRAPH_IDENTITY_SCHEME_UNSUPPORTED',
      `${path}/identityScheme`,
      'Entity must use the current Graph identity scheme.'
    );
    valid = false;
  }
  if (!validIdentifier(value.kind)) {
    issue(issues, 'GRAPH_ENTITY_KIND_INVALID', `${path}/kind`, 'Entity kind must be explicit.');
    valid = false;
  }
  if (!validScope(value.scope)) {
    issue(issues, 'GRAPH_ENTITY_SCOPE_INVALID', `${path}/scope`, 'Entity scope is invalid.');
    valid = false;
  }
  if (Array.isArray(value.aliases)) {
    const aliasIds = new Set<string>();
    for (const [index, alias] of value.aliases.entries()) {
      if (!record(alias) || !validIdentifier(alias.id) || typeof alias.reason !== 'string') {
        issue(
          issues,
          'GRAPH_ENTITY_ALIAS_INVALID',
          `${path}/aliases/${index}`,
          'Alias must carry a portable id and reason.'
        );
        valid = false;
      } else if (aliasIds.has(alias.id) || alias.id === value.id) {
        issue(
          issues,
          'GRAPH_ENTITY_ALIAS_COLLISION',
          `${path}/aliases/${index}/id`,
          'Aliases must be unique and differ from the canonical id.'
        );
        valid = false;
      } else aliasIds.add(alias.id);
    }
  }
  return valid;
}

function validateFact(
  value: unknown,
  path: string,
  manifest: GraphProviderManifest,
  issues: GraphValidationIssue[]
): value is GraphWorkspaceFact {
  if (!record(value)) {
    issue(issues, 'GRAPH_FACT_INVALID', path, 'Fact must be an object.');
    return false;
  }
  let valid = validateEntity(value.subject, `${path}/subject`, issues);
  if (
    !validIdentifier(value.factId) ||
    !validIdentifier(value.factType) ||
    !validIdentifier(value.predicate)
  ) {
    issue(
      issues,
      'GRAPH_FACT_IDENTITY_INVALID',
      path,
      'Fact id, type and predicate must be portable identifiers.'
    );
    valid = false;
  }
  if (
    typeof value.factType === 'string' &&
    !manifest.capabilities.factFamilies.includes(value.factType)
  ) {
    issue(
      issues,
      'GRAPH_FACT_FAMILY_NOT_DECLARED',
      `${path}/factType`,
      'Provider manifest does not authorize this fact family.'
    );
    valid = false;
  }
  if (
    typeof value.predicate === 'string' &&
    !manifest.capabilities.relationKinds.includes(value.predicate)
  ) {
    issue(
      issues,
      'GRAPH_RELATION_NOT_DECLARED',
      `${path}/predicate`,
      'Provider manifest does not authorize this relation kind.'
    );
    valid = false;
  }
  if (
    record(value.subject) &&
    typeof value.subject.kind === 'string' &&
    !manifest.capabilities.entityKinds.includes(value.subject.kind)
  ) {
    issue(
      issues,
      'GRAPH_ENTITY_KIND_NOT_DECLARED',
      `${path}/subject/kind`,
      'Provider manifest does not authorize this entity kind.'
    );
    valid = false;
  }
  if (
    !record(value.object) ||
    (!('identityScheme' in value.object) && !('value' in value.object))
  ) {
    issue(
      issues,
      'GRAPH_FACT_OBJECT_INVALID',
      `${path}/object`,
      'Fact object must be an entity or explicit literal.'
    );
    valid = false;
  } else if ('identityScheme' in value.object) {
    valid = validateEntity(value.object, `${path}/object`, issues) && valid;
    if (
      typeof value.object.kind === 'string' &&
      !manifest.capabilities.entityKinds.includes(value.object.kind)
    ) {
      issue(
        issues,
        'GRAPH_ENTITY_KIND_NOT_DECLARED',
        `${path}/object/kind`,
        'Provider manifest does not authorize this entity kind.'
      );
      valid = false;
    }
  } else {
    const literalKind = value.object.kind;
    const literalValue = value.object.value;
    const literalValid =
      (literalKind === 'null' && literalValue === null) ||
      (literalKind === 'string' && typeof literalValue === 'string') ||
      (literalKind === 'boolean' && typeof literalValue === 'boolean') ||
      (literalKind === 'number' &&
        typeof literalValue === 'number' &&
        Number.isFinite(literalValue));
    if (!literalValid) {
      issue(
        issues,
        'GRAPH_FACT_LITERAL_INVALID',
        `${path}/object`,
        'Literal kind and finite JSON value must agree.'
      );
      valid = false;
    }
  }
  if (
    !validScope(value.scope) ||
    JSON.stringify(value.scope) !==
      JSON.stringify((value.subject as Record<string, unknown> | undefined)?.scope)
  ) {
    issue(
      issues,
      'GRAPH_FACT_SCOPE_MISMATCH',
      `${path}/scope`,
      'Fact and subject scopes must be identical.'
    );
    valid = false;
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    issue(
      issues,
      'GRAPH_FACT_EVIDENCE_REQUIRED',
      `${path}/evidence`,
      'A graph-affecting fact requires evidence.'
    );
    valid = false;
  } else {
    for (const [index, evidence] of value.evidence.entries()) {
      if (
        !record(evidence) ||
        !validIdentifier(evidence.id) ||
        !validIdentifier(evidence.sourceKind) ||
        !validDigest(evidence.digest)
      ) {
        issue(
          issues,
          'GRAPH_FACT_EVIDENCE_INVALID',
          `${path}/evidence/${index}`,
          'Evidence identity, source kind and content digest are required.'
        );
        valid = false;
      }
      if (
        record(evidence) &&
        evidence.relativeLocator !== undefined &&
        !validPortableLocator(evidence.relativeLocator)
      ) {
        issue(
          issues,
          'GRAPH_EVIDENCE_LOCATOR_NON_PORTABLE',
          `${path}/evidence/${index}/relativeLocator`,
          'Evidence locators must be portable relative paths.'
        );
        valid = false;
      }
    }
  }
  if (
    !record(value.provenance) ||
    value.provenance.id !== manifest.id ||
    value.provenance.version !== manifest.version
  ) {
    issue(
      issues,
      'GRAPH_FACT_PROVENANCE_MISMATCH',
      `${path}/provenance`,
      'Fact provenance must match its admitted batch provider.'
    );
    valid = false;
  }
  if (
    !GRAPH_CLAIM_DERIVATIONS.includes(value.derivation as never) ||
    !GRAPH_CLAIM_AUTHORITIES.includes(value.authority as never)
  ) {
    issue(
      issues,
      'GRAPH_FACT_CLAIM_SEMANTICS_INVALID',
      path,
      'Derivation and authority must be independently declared.'
    );
    valid = false;
  }
  if (value.derivation === 'inferred' && value.authority === 'verified') {
    issue(
      issues,
      'GRAPH_INFERRED_FACT_CANNOT_BE_VERIFIED',
      `${path}/authority`,
      'Inferred facts cannot claim verified authority.'
    );
    valid = false;
  }
  if (
    typeof value.confidence !== 'number' ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    issue(
      issues,
      'GRAPH_FACT_CONFIDENCE_INVALID',
      `${path}/confidence`,
      'Confidence must be a finite number between zero and one.'
    );
    valid = false;
  }
  if (typeof value.observedAt !== 'string' || !ISO_TIMESTAMP.test(value.observedAt)) {
    issue(
      issues,
      'GRAPH_FACT_TIMESTAMP_INVALID',
      `${path}/observedAt`,
      'observedAt must be a UTC RFC3339 timestamp.'
    );
    valid = false;
  }
  if (!validDigest(value.inputDigest)) {
    issue(
      issues,
      'GRAPH_FACT_INPUT_DIGEST_INVALID',
      `${path}/inputDigest`,
      'Fact input digest is required.'
    );
    valid = false;
  }
  if (
    !record(value.freshness) ||
    !['current', 'stale', 'unknown'].includes(String(value.freshness.status)) ||
    (value.freshness.validUntil !== undefined &&
      (typeof value.freshness.validUntil !== 'string' ||
        !ISO_TIMESTAMP.test(value.freshness.validUntil))) ||
    (value.freshness.renewal !== undefined &&
      (typeof value.freshness.renewal !== 'string' || value.freshness.renewal.length === 0))
  ) {
    issue(
      issues,
      'GRAPH_FACT_FRESHNESS_INVALID',
      `${path}/freshness`,
      'Fact freshness state is required.'
    );
    valid = false;
  }
  if (!Array.isArray(value.unknownZones)) {
    issue(
      issues,
      'GRAPH_FACT_UNKNOWNS_INVALID',
      `${path}/unknownZones`,
      'Unknown zones must be explicit, including an empty array.'
    );
    valid = false;
  }
  if (
    !record(value.truthLifecycle) ||
    !Array.isArray(value.truthLifecycle.invalidatedBy) ||
    value.truthLifecycle.invalidatedBy.length === 0 ||
    value.truthLifecycle.invalidatedBy.some(
      (entry) => !['input-change', 'deletion', 'expiry', 'provider-change'].includes(String(entry))
    ) ||
    new Set(value.truthLifecycle.invalidatedBy).size !== value.truthLifecycle.invalidatedBy.length
  ) {
    issue(
      issues,
      'GRAPH_FACT_LIFECYCLE_REQUIRED',
      `${path}/truthLifecycle`,
      'Fact invalidation lifecycle is required.'
    );
    valid = false;
  }
  return valid;
}

export function validateGraphProviderManifest(
  input: unknown
): GraphValidationResult<GraphProviderManifest> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    issue(issues, 'GRAPH_PROVIDER_MANIFEST_INVALID', '', 'Provider manifest must be an object.');
  else {
    if (
      !record(input.contract) ||
      input.contract.id !== GRAPH_PROVIDER_MANIFEST_CONTRACT.id ||
      input.contract.version !== GRAPH_PROVIDER_MANIFEST_CONTRACT.version
    )
      issue(
        issues,
        'GRAPH_PROVIDER_CONTRACT_UNSUPPORTED',
        '/contract',
        'Provider manifest contract is unsupported.'
      );
    if (!validIdentifier(input.id) || !validIdentifier(input.version))
      issue(issues, 'GRAPH_PROVIDER_IDENTITY_INVALID', '', 'Provider id and version are required.');
    if (
      typeof input.displayName !== 'string' ||
      input.displayName.length === 0 ||
      input.displayName.length > 200
    )
      issue(
        issues,
        'GRAPH_PROVIDER_DISPLAY_NAME_INVALID',
        '/displayName',
        'Provider display name must be bounded and non-empty.'
      );
    if (!['deterministic', 'seeded', 'nondeterministic'].includes(String(input.determinism)))
      issue(
        issues,
        'GRAPH_PROVIDER_DETERMINISM_INVALID',
        '/determinism',
        'Provider determinism mode must be explicit.'
      );
    if (
      !record(input.capabilities) ||
      !nonEmptyUniqueStrings(input.capabilities.entityKinds) ||
      !nonEmptyUniqueStrings(input.capabilities.relationKinds) ||
      !Array.isArray(input.capabilities.relationSemantics) ||
      input.capabilities.relationSemantics.length === 0 ||
      input.capabilities.relationSemantics.some(
        (entry) => !['structural', 'behavioral', 'declarative', 'derived'].includes(String(entry))
      ) ||
      new Set(input.capabilities.relationSemantics).size !==
        input.capabilities.relationSemantics.length ||
      !nonEmptyUniqueStrings(input.capabilities.factFamilies) ||
      !nonEmptyUniqueStrings(input.capabilities.allowedClaims)
    )
      issue(
        issues,
        'GRAPH_PROVIDER_CAPABILITY_INVALID',
        '/capabilities',
        'Provider must declare at least one fact family.'
      );
    if (
      !record(input.permissions) ||
      !['none', 'read'].includes(String(input.permissions.filesystem)) ||
      !['deny', 'allow'].includes(String(input.permissions.network)) ||
      !['deny', 'allow'].includes(String(input.permissions.process)) ||
      input.permissions.credentials !== 'deny'
    )
      issue(
        issues,
        'GRAPH_PROVIDER_CREDENTIAL_POLICY_INVALID',
        '/permissions/credentials',
        'Foundation providers may not request credentials.'
      );
    if (
      !record(input.limits) ||
      typeof input.limits.maxFacts !== 'number' ||
      !Number.isInteger(input.limits.maxFacts) ||
      input.limits.maxFacts <= 0 ||
      input.limits.maxFacts > MAX_PROVIDER_FACTS ||
      typeof input.limits.maxDurationMs !== 'number' ||
      !Number.isInteger(input.limits.maxDurationMs) ||
      input.limits.maxDurationMs <= 0 ||
      input.limits.maxDurationMs > 3_600_000 ||
      (input.limits.maxInputBytes !== undefined &&
        (!Number.isInteger(input.limits.maxInputBytes) || Number(input.limits.maxInputBytes) <= 0))
    )
      issue(
        issues,
        'GRAPH_PROVIDER_LIMITS_INVALID',
        '/limits',
        'Finite positive provider limits are mandatory.'
      );
    if (
      !nonEmptyUniqueStrings(input.contractVersions) ||
      !nonEmptyUniqueStrings(input.supportedInputs)
    )
      issue(
        issues,
        'GRAPH_PROVIDER_PROTOCOLS_INVALID',
        '',
        'Contract versions and supported inputs must be bounded unique identifiers.'
      );
    if (!['none', 'input', 'native'].includes(String(input.incremental)))
      issue(
        issues,
        'GRAPH_PROVIDER_INCREMENTAL_INVALID',
        '/incremental',
        'Provider incremental capability is invalid.'
      );
    if (
      !Array.isArray(input.identitySchemes) ||
      !input.identitySchemes.some(
        (candidate) =>
          record(candidate) &&
          candidate.id === GRAPH_IDENTITY_SCHEME.id &&
          candidate.version === GRAPH_IDENTITY_SCHEME.version
      )
    )
      issue(
        issues,
        'GRAPH_PROVIDER_IDENTITY_SCHEME_UNSUPPORTED',
        '/identitySchemes',
        'Provider must declare the current canonical identity scheme.'
      );
  }
  return issues.length === 0
    ? { accepted: true, value: Object.freeze(input as GraphProviderManifest), issues: [] }
    : { accepted: false, issues };
}

export function validateGraphProviderDetectionRequest(
  input: unknown
): GraphValidationResult<GraphProviderDetectionRequest> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    issue(issues, 'GRAPH_PROVIDER_DETECTION_REQUEST_INVALID', '', 'Request must be an object.');
  else {
    if (
      !Array.isArray(input.availableInputs) ||
      input.availableInputs.length > 100_000 ||
      input.availableInputs.some(
        (entry) => typeof entry !== 'string' || entry.length === 0 || entry.length > 4096
      ) ||
      new Set(input.availableInputs).size !== input.availableInputs.length
    )
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_INPUTS_INVALID',
        '/availableInputs',
        'Available inputs must be a bounded unique list.'
      );
    if (!['project', 'workspace'].includes(String(input.scopeKind)))
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_SCOPE_INVALID',
        '/scopeKind',
        'Detection scope must be project or workspace.'
      );
    if (typeof input.networkAllowed !== 'boolean')
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_NETWORK_POLICY_INVALID',
        '/networkAllowed',
        'Detection must receive an explicit network policy.'
      );
  }
  return issues.length === 0
    ? { accepted: true, value: Object.freeze(input as GraphProviderDetectionRequest), issues: [] }
    : { accepted: false, issues };
}

export function validateGraphProviderDetectionResult(
  input: unknown,
  manifest: GraphProviderManifest
): GraphValidationResult<GraphProviderDetectionResult> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    issue(issues, 'GRAPH_PROVIDER_DETECTION_INVALID', '', 'Detection result must be an object.');
  else {
    if (
      !record(input.contract) ||
      input.contract.id !== GRAPH_PROVIDER_DETECTION_CONTRACT.id ||
      input.contract.version !== GRAPH_PROVIDER_DETECTION_CONTRACT.version
    )
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_CONTRACT_UNSUPPORTED',
        '/contract',
        'Provider detection contract is unsupported.'
      );
    if (
      !record(input.provider) ||
      input.provider.id !== manifest.id ||
      input.provider.version !== manifest.version
    )
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_PROVIDER_MISMATCH',
        '/provider',
        'Detection provider must match the admitted manifest.'
      );
    const matched = Array.isArray(input.matchedInputs) ? input.matchedInputs : [];
    const missing = Array.isArray(input.missingPermissions) ? input.missingPermissions : [];
    const diagnostics = Array.isArray(input.diagnostics) ? input.diagnostics : [];
    if (
      matched.some(
        (entry) => typeof entry !== 'string' || !manifest.supportedInputs.includes(entry)
      ) ||
      new Set(matched).size !== matched.length
    )
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_MATCH_INVALID',
        '/matchedInputs',
        'Matched inputs must be a unique subset of the provider capability envelope.'
      );
    if (
      missing.some(
        (entry) =>
          typeof entry !== 'string' ||
          !['filesystem', 'network', 'process', 'credentials'].includes(entry)
      ) ||
      new Set(missing).size !== missing.length
    )
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_PERMISSION_INVALID',
        '/missingPermissions',
        'Missing permissions must be explicit and unique.'
      );
    if (
      diagnostics.some(
        (entry) =>
          !record(entry) || !validIdentifier(entry.code) || typeof entry.message !== 'string'
      )
    )
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_DIAGNOSTIC_INVALID',
        '/diagnostics',
        'Detection diagnostics require stable codes and messages.'
      );
    if (
      !['applicable', 'not-applicable', 'blocked', 'unknown'].includes(String(input.status)) ||
      (input.status === 'applicable' && (matched.length === 0 || missing.length > 0)) ||
      (input.status === 'not-applicable' && matched.length > 0) ||
      (input.status === 'blocked' && missing.length === 0) ||
      (input.status === 'unknown' && diagnostics.length === 0)
    )
      issue(
        issues,
        'GRAPH_PROVIDER_DETECTION_STATUS_INCONSISTENT',
        '/status',
        'Detection status must agree with matched inputs, missing permissions and diagnostics.'
      );
  }
  return issues.length === 0
    ? { accepted: true, value: Object.freeze(input as GraphProviderDetectionResult), issues: [] }
    : { accepted: false, issues };
}

export function validateGraphFactBatch(
  input: unknown,
  manifest: GraphProviderManifest
): GraphValidationResult<GraphFactBatch> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input))
    issue(issues, 'GRAPH_FACT_BATCH_INVALID', '', 'Fact batch must be an object.');
  else {
    if (
      !record(input.contract) ||
      input.contract.id !== GRAPH_FACT_BATCH_CONTRACT.id ||
      input.contract.version !== GRAPH_FACT_BATCH_CONTRACT.version
    )
      issue(
        issues,
        'GRAPH_FACT_BATCH_CONTRACT_UNSUPPORTED',
        '/contract',
        'Fact batch contract is unsupported.'
      );
    if (
      !record(input.provider) ||
      input.provider.id !== manifest.id ||
      input.provider.version !== manifest.version
    )
      issue(
        issues,
        'GRAPH_FACT_BATCH_PROVIDER_MISMATCH',
        '/provider',
        'Batch provider must match the admitted manifest.'
      );
    if (!validIdentifier(input.batchId) || !validScope(input.scope))
      issue(issues, 'GRAPH_FACT_BATCH_IDENTITY_INVALID', '', 'Batch id and scope are required.');
    if (
      !Array.isArray(input.inputs) ||
      input.inputs.length === 0 ||
      input.inputs.length > MAX_BATCH_INPUTS
    )
      issue(
        issues,
        'GRAPH_FACT_BATCH_INPUTS_REQUIRED',
        '/inputs',
        'At least one content-addressed input is required.'
      );
    else
      for (const [index, candidate] of input.inputs.slice(0, MAX_BATCH_INPUTS).entries())
        if (issues.length >= MAX_VALIDATION_ISSUES) break;
        else if (
          !record(candidate) ||
          !validPortableLocator(candidate.locator) ||
          !validDigest(candidate.digest)
        )
          issue(
            issues,
            'GRAPH_FACT_BATCH_INPUT_INVALID',
            `/inputs/${index}`,
            'Inputs require a portable locator and digest.'
          );
    if (
      Array.isArray(input.inputs) &&
      new Set(input.inputs.filter(record).map((entry) => String(entry.locator))).size !==
        input.inputs.length
    )
      issue(
        issues,
        'GRAPH_FACT_BATCH_INPUT_DUPLICATE',
        '/inputs',
        'Input locators must be unique within a batch.'
      );
    if (!Array.isArray(input.facts))
      issue(issues, 'GRAPH_FACT_BATCH_FACTS_INVALID', '/facts', 'Facts must be an array.');
    else {
      if (input.facts.length > manifest.limits.maxFacts)
        issue(
          issues,
          'GRAPH_FACT_BATCH_LIMIT_EXCEEDED',
          '/facts',
          'Fact count exceeds provider limits.'
        );
      const ids = new Set<string>();
      for (const [index, fact] of input.facts.slice(0, manifest.limits.maxFacts).entries()) {
        if (issues.length >= MAX_VALIDATION_ISSUES) break;
        validateFact(fact, `/facts/${index}`, manifest, issues);
        if (record(fact) && typeof fact.factId === 'string') {
          if (ids.has(fact.factId))
            issue(
              issues,
              'GRAPH_FACT_ID_DUPLICATE',
              `/facts/${index}/factId`,
              'Fact ids must be unique within a batch.'
            );
          ids.add(fact.factId);
        }
      }
    }
    for (const field of ['diagnostics', 'coverage', 'unknownZones', 'unsupportedZones'])
      if (!Array.isArray(input[field]))
        issue(
          issues,
          'GRAPH_FACT_BATCH_DIMENSION_MISSING',
          `/${field}`,
          'FactBatch result dimensions must be explicit.'
        );
    if (
      Array.isArray(input.diagnostics) &&
      input.diagnostics.some(
        (entry) =>
          !record(entry) ||
          !validIdentifier(entry.code) ||
          !['info', 'warning', 'error'].includes(String(entry.severity)) ||
          typeof entry.path !== 'string' ||
          typeof entry.message !== 'string'
      )
    )
      issue(
        issues,
        'GRAPH_FACT_BATCH_DIAGNOSTIC_INVALID',
        '/diagnostics',
        'Diagnostics require stable code, severity, path and message fields.'
      );
    if (
      Array.isArray(input.coverage) &&
      input.coverage.some(
        (entry) =>
          !record(entry) ||
          !validIdentifier(entry.dimension) ||
          !Number.isInteger(entry.observed) ||
          Number(entry.observed) < 0 ||
          (entry.expected !== undefined &&
            (!Number.isInteger(entry.expected) || Number(entry.expected) < 0))
      )
    )
      issue(
        issues,
        'GRAPH_FACT_BATCH_COVERAGE_INVALID',
        '/coverage',
        'Coverage counts must be explicit non-negative integers.'
      );
    for (const field of ['unknownZones', 'unsupportedZones'])
      if (
        Array.isArray(input[field]) &&
        input[field].some(
          (entry) =>
            !record(entry) ||
            !validIdentifier(entry.code) ||
            typeof entry.scope !== 'string' ||
            entry.scope.length === 0 ||
            typeof entry.reason !== 'string' ||
            entry.reason.length === 0
        )
      )
        issue(
          issues,
          'GRAPH_FACT_BATCH_ZONE_INVALID',
          `/${field}`,
          'Unknown and unsupported zones require code, scope and reason.'
        );
    if (
      !record(input.redaction) ||
      typeof input.redaction.policy !== 'string' ||
      !Number.isInteger(input.redaction.redacted) ||
      Number(input.redaction.redacted) < 0 ||
      !Number.isInteger(input.redaction.omitted) ||
      Number(input.redaction.omitted) < 0
    )
      issue(
        issues,
        'GRAPH_FACT_BATCH_REDACTION_INVALID',
        '/redaction',
        'Redaction accounting is required.'
      );
    if (!['complete', 'partial', 'failed', 'cancelled'].includes(String(input.status)))
      issue(issues, 'GRAPH_FACT_BATCH_STATUS_INVALID', '/status', 'FactBatch status is invalid.');
    if (
      !Array.isArray(input.processing) ||
      !Array.isArray(input.inputs) ||
      input.processing.length !== input.inputs.length
    )
      issue(
        issues,
        'GRAPH_INPUT_ACCOUNTING_INCOMPLETE',
        '/processing',
        'Every input needs exactly one processing record.'
      );
    else {
      const expectedInputs = new Map(
        input.inputs
          .filter(record)
          .map((candidate) => [candidate.locator, JSON.stringify(candidate.digest)])
      );
      const accounted = new Set<string>();
      for (const [index, processing] of input.processing.entries()) {
        if (
          !record(processing) ||
          !record(processing.input) ||
          typeof processing.input.locator !== 'string' ||
          expectedInputs.get(processing.input.locator) !==
            JSON.stringify(processing.input.digest) ||
          accounted.has(processing.input.locator) ||
          !record(processing.provider) ||
          processing.provider.id !== manifest.id ||
          processing.provider.version !== manifest.version ||
          !record(processing.stage) ||
          !validIdentifier(processing.stage.id) ||
          !validIdentifier(processing.stage.version) ||
          ![
            'processed',
            'unchanged',
            'excluded',
            'unsupported',
            'omitted',
            'failed',
            'deleted',
          ].includes(String(processing.outcome)) ||
          !Array.isArray(processing.diagnostics) ||
          (['processed', 'unchanged'].includes(String(processing.outcome)) &&
            !validDigest(processing.outputDigest)) ||
          (processing.outcome === 'unchanged' && !validDigest(processing.priorDigest))
        )
          issue(
            issues,
            'GRAPH_INPUT_ACCOUNTING_MISMATCH',
            `/processing/${index}/input`,
            'Processing records must map one-to-one to declared inputs.'
          );
        else accounted.add(processing.input.locator);
      }
    }
    if (
      input.status === 'complete' &&
      Array.isArray(input.processing) &&
      input.processing.some(
        (entry) => record(entry) && ['failed', 'omitted'].includes(String(entry.outcome))
      )
    )
      issue(
        issues,
        'GRAPH_COMPLETE_BATCH_HAS_GAPS',
        '/status',
        'A complete batch cannot contain failed or omitted inputs.'
      );
  }
  return issues.length === 0
    ? { accepted: true, value: Object.freeze(input as GraphFactBatch), issues: [] }
    : { accepted: false, issues };
}

/** The only supported provider-to-composer boundary: manifest and facts are admitted together. */
export function admitGraphProviderOutput(
  manifestInput: unknown,
  batchInput: unknown
): GraphProviderOutputAdmission {
  const manifestResult = validateGraphProviderManifest(manifestInput);
  if (!manifestResult.accepted) return { accepted: false, issues: manifestResult.issues };
  const batchResult = validateGraphFactBatch(batchInput, manifestResult.value);
  if (!batchResult.accepted) return { accepted: false, issues: batchResult.issues };
  return {
    accepted: true,
    manifest: manifestResult.value,
    batch: batchResult.value,
    issues: [],
  };
}
