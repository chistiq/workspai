import { createHash } from 'node:crypto';

import type { WisDigestReference } from '@workspai/shared/contracts';

import {
  GRAPH_CHANGE_OVERLAY_CONTRACT,
  GRAPH_CHANGE_SET_CONTRACT,
  GRAPH_CONTENT_STATE_MANIFEST_CONTRACT,
  GRAPH_DELTA_CONTRACT,
  GRAPH_PROPOSED_CHANGE_SET_CONTRACT,
  GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT,
  type GraphChangeOverlay,
  type GraphChangeSet,
  type GraphContentStateDirectoryChild,
  type GraphContentStateManifest,
  type GraphDelta,
  type GraphProposedChangeSet,
  type GraphProposedGraphDelta,
  type GraphValidationIssue,
  type GraphValidationResult,
} from '../contracts/index.js';
import {
  assembleContentStateMerkle,
  canonicalDirectoryMaterial,
} from '../domain/content-state-merkle.js';

const DIGEST_VALUE = /^[a-f0-9]{32,256}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(issues: GraphValidationIssue[], code: string, path: string, message: string): void {
  if (issues.length < 100) {
    issues.push({ code, path, message });
  }
}

function contract(
  value: unknown,
  expected: { readonly id: string; readonly version: string }
): boolean {
  return record(value) && value.id === expected.id && value.version === expected.version;
}

function digest(value: unknown): value is WisDigestReference {
  return (
    record(value) &&
    value.algorithm === 'sha256' &&
    typeof value.value === 'string' &&
    DIGEST_VALUE.test(value.value)
  );
}

function digestUtf8(material: string): WisDigestReference {
  return Object.freeze({
    algorithm: 'sha256',
    value: createHash('sha256').update(material, 'utf8').digest('hex'),
  });
}

function directoryChildRecord(value: unknown): value is GraphContentStateDirectoryChild {
  return (
    record(value) &&
    typeof value.name === 'string' &&
    (value.kind === 'file' || value.kind === 'directory') &&
    digest(value.digest)
  );
}

function verifyContentStateMerkle(
  input: Record<string, unknown>,
  issues: GraphValidationIssue[]
): void {
  if (!Array.isArray(input.nodes) || !digest(input.merkleRoot)) {
    return;
  }
  const leaves: { locator: string; contentDigest: WisDigestReference }[] = [];
  const directories: Record<string, unknown>[] = [];
  for (const node of input.nodes) {
    if (!record(node)) {
      continue;
    }
    if (node.kind === 'file' && typeof node.locator === 'string' && digest(node.contentDigest)) {
      leaves.push({ locator: node.locator, contentDigest: node.contentDigest });
    }
    if (node.kind === 'directory' && typeof node.locator === 'string') {
      directories.push(node);
    }
  }
  let assembled;
  try {
    assembled = assembleContentStateMerkle(leaves, digestUtf8);
  } catch {
    issue(
      issues,
      'GRAPH_CONTENT_STATE_MERKLE_INVALID',
      '/nodes',
      'Content-state Merkle tree could not be assembled from file leaves.'
    );
    return;
  }
  if (assembled.merkleRoot.value !== input.merkleRoot.value) {
    issue(
      issues,
      'GRAPH_CONTENT_STATE_MERKLE_MISMATCH',
      '/merkleRoot',
      'Merkle root does not match the directory tree assembled from file leaves.'
    );
  }
  const expectedLocators = [...assembled.directories.keys()]
    .filter((locator) => locator.length > 0)
    .sort();
  const actualLocators = directories.map((directory) => String(directory.locator)).sort();
  if (expectedLocators.join('\u0000') !== actualLocators.join('\u0000')) {
    issue(
      issues,
      'GRAPH_CONTENT_STATE_DIRECTORY_SET_INVALID',
      '/nodes',
      'Directory nodes must match the locators derived from file leaves.'
    );
  }
  for (const directory of directories) {
    const expected = assembled.directories.get(String(directory.locator));
    if (!expected) {
      continue;
    }
    if (!digest(directory.digest) || directory.digest.value !== expected.digest.value) {
      issue(
        issues,
        'GRAPH_CONTENT_STATE_DIRECTORY_DIGEST_INVALID',
        `/nodes/${String(directory.locator)}`,
        'Directory digest does not match the canonical child material.'
      );
    }
    if (!Array.isArray(directory.children) || !directory.children.every(directoryChildRecord)) {
      issue(
        issues,
        'GRAPH_CONTENT_STATE_DIRECTORY_CHILDREN_INVALID',
        `/nodes/${String(directory.locator)}/children`,
        'Directory children are incomplete.'
      );
      continue;
    }
    if (
      canonicalDirectoryMaterial(directory.children) !==
      canonicalDirectoryMaterial(expected.children)
    ) {
      issue(
        issues,
        'GRAPH_CONTENT_STATE_DIRECTORY_CHILDREN_MISMATCH',
        `/nodes/${String(directory.locator)}/children`,
        'Directory children do not match the assembled Merkle tree.'
      );
    }
  }
}

function validateInputChanges(path: string, value: unknown, issues: GraphValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issue(issues, 'GRAPH_CHANGE_INPUTS_INVALID', path, 'Changed inputs must be an array.');
    return;
  }
  for (const [index, entry] of value.entries()) {
    if (!record(entry)) {
      issue(
        issues,
        'GRAPH_CHANGE_INPUT_INVALID',
        `${path}/${index}`,
        'Input change must be an object.'
      );
      continue;
    }
    if (
      !['added', 'edited', 'deleted', 'renewed', 'rename-candidate'].includes(String(entry.kind)) ||
      typeof entry.locator !== 'string' ||
      entry.locator.length === 0 ||
      typeof entry.inputKind !== 'string' ||
      !digest(entry.scanProfileDigest)
    ) {
      issue(
        issues,
        'GRAPH_CHANGE_INPUT_INVALID',
        `${path}/${index}`,
        'Input change identity is incomplete.'
      );
    }
  }
}

export function validateGraphChangeSet(input: unknown): GraphValidationResult<GraphChangeSet> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input)) {
    issue(issues, 'GRAPH_CHANGE_SET_INVALID', '', 'ChangeSet must be an object.');
  } else {
    if (!contract(input.contract, GRAPH_CHANGE_SET_CONTRACT)) {
      issue(
        issues,
        'GRAPH_CHANGE_SET_CONTRACT_UNSUPPORTED',
        '/contract',
        'ChangeSet contract is unsupported.'
      );
    }
    if (typeof input.id !== 'string' || input.id.length === 0) {
      issue(issues, 'GRAPH_CHANGE_SET_ID_INVALID', '/id', 'ChangeSet id is required.');
    }
    validateInputChanges('/inputs', input.inputs, issues);
    if (!Array.isArray(input.causes)) {
      issue(issues, 'GRAPH_CHANGE_CAUSES_INVALID', '/causes', 'ChangeSet causes must be an array.');
    }
  }
  return issues.length > 0
    ? { accepted: false, issues }
    : { accepted: true, value: input as GraphChangeSet, issues: [] };
}

export function validateGraphDelta(input: unknown): GraphValidationResult<GraphDelta> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input)) {
    issue(issues, 'GRAPH_DELTA_INVALID', '', 'GraphDelta must be an object.');
  } else {
    if (!contract(input.contract, GRAPH_DELTA_CONTRACT)) {
      issue(
        issues,
        'GRAPH_DELTA_CONTRACT_UNSUPPORTED',
        '/contract',
        'GraphDelta contract is unsupported.'
      );
    }
    if (typeof input.baseGeneration !== 'string' || typeof input.targetGeneration !== 'string') {
      issue(issues, 'GRAPH_DELTA_GENERATION_INVALID', '', 'GraphDelta generations are required.');
    }
    validateInputChanges('/changedInputs', input.changedInputs, issues);
    if (!record(input.execution)) {
      issue(
        issues,
        'GRAPH_DELTA_EXECUTION_INVALID',
        '/execution',
        'GraphDelta execution accounting is required.'
      );
    }
  }
  return issues.length > 0
    ? { accepted: false, issues }
    : { accepted: true, value: input as GraphDelta, issues: [] };
}

export function validateGraphContentStateManifest(
  input: unknown
): GraphValidationResult<GraphContentStateManifest> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input)) {
    issue(
      issues,
      'GRAPH_CONTENT_STATE_MANIFEST_INVALID',
      '',
      'Content-state manifest must be an object.'
    );
  } else {
    if (!contract(input.contract, GRAPH_CONTENT_STATE_MANIFEST_CONTRACT)) {
      issue(
        issues,
        'GRAPH_CONTENT_STATE_MANIFEST_CONTRACT_UNSUPPORTED',
        '/contract',
        'Content-state manifest contract is unsupported.'
      );
    }
    if (!digest(input.merkleRoot)) {
      issue(
        issues,
        'GRAPH_CONTENT_STATE_ROOT_INVALID',
        '/merkleRoot',
        'Merkle root digest is invalid.'
      );
    }
    if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
      issue(
        issues,
        'GRAPH_CONTENT_STATE_NODES_INVALID',
        '/nodes',
        'Content-state nodes are required.'
      );
    }
    if (typeof input.generatedAt !== 'string' || !ISO_TIMESTAMP.test(input.generatedAt)) {
      issue(
        issues,
        'GRAPH_CONTENT_STATE_GENERATED_AT_INVALID',
        '/generatedAt',
        'generatedAt must be UTC.'
      );
    }
    if (!record(input.scope) || !['project', 'workspace'].includes(String(input.scope.kind))) {
      issue(
        issues,
        'GRAPH_CONTENT_STATE_SCOPE_INVALID',
        '/scope',
        'Content-state scope is invalid.'
      );
    }
    verifyContentStateMerkle(input, issues);
  }
  return issues.length > 0
    ? { accepted: false, issues }
    : { accepted: true, value: input as GraphContentStateManifest, issues: [] };
}

export function validateGraphProposedChangeSet(
  input: unknown
): GraphValidationResult<GraphProposedChangeSet> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input)) {
    issue(
      issues,
      'GRAPH_PROPOSED_CHANGE_SET_INVALID',
      '',
      'Proposed change set must be an object.'
    );
  } else {
    if (!contract(input.contract, GRAPH_PROPOSED_CHANGE_SET_CONTRACT)) {
      issue(
        issues,
        'GRAPH_PROPOSED_CHANGE_SET_CONTRACT_UNSUPPORTED',
        '/contract',
        'Proposed change set contract is unsupported.'
      );
    }
    if (typeof input.id !== 'string' || input.id.length === 0) {
      issue(
        issues,
        'GRAPH_PROPOSED_CHANGE_SET_ID_INVALID',
        '/id',
        'Proposed change set id is required.'
      );
    }
    if (typeof input.baseGeneration !== 'string' || input.baseGeneration.length === 0) {
      issue(
        issues,
        'GRAPH_PROPOSED_CHANGE_BASE_INVALID',
        '/baseGeneration',
        'Proposed change requires a base generation.'
      );
    }
    validateInputChanges('/inputs', input.inputs, issues);
    if (!Array.isArray(input.causes)) {
      issue(
        issues,
        'GRAPH_PROPOSED_CHANGE_CAUSES_INVALID',
        '/causes',
        'Proposed change causes must be an array.'
      );
    }
    if (
      !record(input.proposal) ||
      !['patch', 'working-tree', 'branch', 'pull-request', 'external'].includes(
        String(input.proposal.kind)
      ) ||
      typeof input.proposal.identity !== 'string' ||
      typeof input.proposal.digest !== 'string' ||
      !DIGEST_VALUE.test(input.proposal.digest)
    ) {
      issue(
        issues,
        'GRAPH_PROPOSED_CHANGE_PROPOSAL_INVALID',
        '/proposal',
        'Proposal identity is invalid.'
      );
    }
    if (!Array.isArray(input.assumptions)) {
      issue(
        issues,
        'GRAPH_PROPOSED_CHANGE_ASSUMPTIONS_INVALID',
        '/assumptions',
        'Assumptions must be an array.'
      );
    }
  }
  return issues.length > 0
    ? { accepted: false, issues }
    : { accepted: true, value: input as GraphProposedChangeSet, issues: [] };
}

export function validateGraphProposedGraphDelta(
  input: unknown
): GraphValidationResult<GraphProposedGraphDelta> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input)) {
    issue(issues, 'GRAPH_PROPOSED_DELTA_INVALID', '', 'Proposed graph delta must be an object.');
  } else {
    if (!contract(input.contract, GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT)) {
      issue(
        issues,
        'GRAPH_PROPOSED_DELTA_CONTRACT_UNSUPPORTED',
        '/contract',
        'Proposed graph delta contract is unsupported.'
      );
    }
    if (typeof input.baseGeneration !== 'string' || typeof input.targetOverlay !== 'string') {
      issue(
        issues,
        'GRAPH_PROPOSED_DELTA_BINDING_INVALID',
        '',
        'Proposed graph delta must bind base generation and target overlay.'
      );
    }
    if ('targetGeneration' in input) {
      issue(
        issues,
        'GRAPH_PROPOSED_DELTA_TARGET_GENERATION_FORBIDDEN',
        '/targetGeneration',
        'Proposed graph delta must not claim a canonical target generation.'
      );
    }
    validateInputChanges('/changedInputs', input.changedInputs, issues);
  }
  return issues.length > 0
    ? { accepted: false, issues }
    : { accepted: true, value: input as GraphProposedGraphDelta, issues: [] };
}

export function validateGraphChangeOverlay(
  input: unknown
): GraphValidationResult<GraphChangeOverlay> {
  const issues: GraphValidationIssue[] = [];
  if (!record(input)) {
    issue(issues, 'GRAPH_CHANGE_OVERLAY_INVALID', '', 'Change overlay must be an object.');
  } else {
    if (!contract(input.contract, GRAPH_CHANGE_OVERLAY_CONTRACT)) {
      issue(
        issues,
        'GRAPH_CHANGE_OVERLAY_CONTRACT_UNSUPPORTED',
        '/contract',
        'Change overlay contract is unsupported.'
      );
    }
    if (typeof input.id !== 'string' || input.id.length === 0) {
      issue(issues, 'GRAPH_CHANGE_OVERLAY_ID_INVALID', '/id', 'Overlay id is required.');
    }
    if (!['complete', 'partial', 'failed', 'stale'].includes(String(input.status))) {
      issue(issues, 'GRAPH_CHANGE_OVERLAY_STATUS_INVALID', '/status', 'Overlay status is invalid.');
    }
    if (!record(input.baseGeneration) || !digest(input.baseGeneration.contentDigest)) {
      issue(
        issues,
        'GRAPH_CHANGE_OVERLAY_BASE_INVALID',
        '/baseGeneration',
        'Overlay must bind an immutable base generation.'
      );
    }
    const proposed = validateGraphProposedChangeSet(input.proposedChangeSet);
    if (!proposed.accepted) {
      issues.push(...proposed.issues);
    }
    const predicted = validateGraphProposedGraphDelta(input.predictedDelta);
    if (!predicted.accepted) {
      issues.push(...predicted.issues);
    }
    if (typeof input.generatedAt !== 'string' || !ISO_TIMESTAMP.test(input.generatedAt)) {
      issue(
        issues,
        'GRAPH_CHANGE_OVERLAY_GENERATED_AT_INVALID',
        '/generatedAt',
        'generatedAt must be UTC.'
      );
    }
    if (
      record(input.quality) &&
      Array.isArray(input.quality.releaseClaims) &&
      !input.quality.releaseClaims.includes('no-latest-advancement')
    ) {
      issue(
        issues,
        'GRAPH_CHANGE_OVERLAY_CLAIMS_INVALID',
        '/quality/releaseClaims',
        'Overlay must declare no-latest-advancement.'
      );
    }
  }
  return issues.length > 0
    ? { accepted: false, issues }
    : { accepted: true, value: input as GraphChangeOverlay, issues: [] };
}
