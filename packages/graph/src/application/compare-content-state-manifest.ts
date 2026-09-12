import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphChangeCause,
  GraphContentStateComparisonBudget,
  GraphContentStateComparisonRequest,
  GraphContentStateComparisonResult,
  GraphContentStateDirectory,
  GraphContentStateLeaf,
  GraphContentStateManifest,
  GraphDiagnostic,
  GraphInputChange,
  GraphScope,
} from '../contracts/index.js';
import { normalizePortableLocator, parentLocator } from '../domain/content-state-merkle.js';

const DEFAULT_BUDGET: GraphContentStateComparisonBudget = Object.freeze({
  maxComparedBranches: 100_000,
  maxChangedInputs: 100_000,
});

function digestEqual(left: WisDigestReference, right: WisDigestReference): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function scopesCompatible(left: GraphScope, right: GraphScope): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'project' && right.kind === 'project') {
    const baseIds = [...left.projectIds].sort();
    const targetIds = [...right.projectIds].sort();
    return (
      baseIds.length === targetIds.length && baseIds.every((id, index) => id === targetIds[index])
    );
  }
  if (left.kind === 'workspace' && right.kind === 'workspace') {
    return left.workspaceId === right.workspaceId;
  }
  return false;
}

function indexManifest(manifest: GraphContentStateManifest): {
  files: Map<string, GraphContentStateLeaf>;
  directories: Map<string, GraphContentStateDirectory>;
} {
  const files = new Map<string, GraphContentStateLeaf>();
  const directories = new Map<string, GraphContentStateDirectory>();
  for (const node of manifest.nodes) {
    const locator = normalizePortableLocator(node.locator);
    if (node.kind === 'file') {
      if (files.has(locator)) {
        throw new Error(`Duplicate content-state leaf locator: ${locator}`);
      }
      files.set(locator, Object.freeze({ ...node, locator }));
    } else {
      if (directories.has(locator)) {
        throw new Error(`Duplicate content-state directory locator: ${locator}`);
      }
      directories.set(locator, Object.freeze({ ...node, locator }));
    }
  }
  return { files, directories };
}

function accountDirectoryBranches(
  base: GraphContentStateManifest,
  target: GraphContentStateManifest,
  baseDirectories: Map<string, GraphContentStateDirectory>,
  targetDirectories: Map<string, GraphContentStateDirectory>
): {
  comparedBranches: number;
  skippedBranches: number;
  skippedDirectories: ReadonlySet<string>;
} {
  let comparedBranches = digestEqual(base.merkleRoot, target.merkleRoot) ? 0 : 1;
  let skippedBranches = 0;
  const skippedDirectories = new Set<string>();
  const locators = new Set([...baseDirectories.keys(), ...targetDirectories.keys()]);
  for (const locator of [...locators].sort()) {
    const left = baseDirectories.get(locator);
    const right = targetDirectories.get(locator);
    if (left && right) {
      if (digestEqual(left.digest, right.digest)) {
        skippedBranches += 1;
        skippedDirectories.add(locator);
      } else {
        comparedBranches += 1;
      }
      continue;
    }
    comparedBranches += 1;
  }
  return { comparedBranches, skippedBranches, skippedDirectories };
}

/** True when an ancestor directory digest matched and that subtree must not be enumerated. */
function underSkippedBranch(locator: string, skippedDirectories: ReadonlySet<string>): boolean {
  let current = parentLocator(locator);
  while (current.length > 0) {
    if (skippedDirectories.has(current)) {
      return true;
    }
    current = parentLocator(current);
  }
  return false;
}

function filesInComparedBranches(
  files: Map<string, GraphContentStateLeaf>,
  skippedDirectories: ReadonlySet<string>
): Map<string, GraphContentStateLeaf> {
  const selected = new Map<string, GraphContentStateLeaf>();
  for (const [locator, leaf] of files) {
    if (!underSkippedBranch(locator, skippedDirectories)) {
      selected.set(locator, leaf);
    }
  }
  return selected;
}

function fileLeafEqual(left: GraphContentStateLeaf, right: GraphContentStateLeaf): boolean {
  return (
    left.inputKind === right.inputKind &&
    digestEqual(left.contentDigest, right.contentDigest) &&
    digestEqual(left.scanProfileDigest, right.scanProfileDigest)
  );
}

function contentAndKindEqual(left: GraphContentStateLeaf, right: GraphContentStateLeaf): boolean {
  return left.inputKind === right.inputKind && digestEqual(left.contentDigest, right.contentDigest);
}

function comparisonCauses(changedInputs: readonly GraphInputChange[]): GraphChangeCause[] {
  const kinds = new Set(changedInputs.map((change) => change.kind));
  const causes: GraphChangeCause[] = [];
  if (
    kinds.has('added') ||
    kinds.has('edited') ||
    kinds.has('deleted') ||
    kinds.has('rename-candidate')
  ) {
    causes.push(Object.freeze({ kind: 'content', source: 'content-state-comparison' }));
  }
  if (kinds.has('renewed')) {
    causes.push(Object.freeze({ kind: 'scan-profile', source: 'content-state-comparison' }));
  }
  return causes;
}

function detectFileChanges(
  baseFiles: Map<string, GraphContentStateLeaf>,
  targetFiles: Map<string, GraphContentStateLeaf>
): GraphInputChange[] {
  const changes: GraphInputChange[] = [];
  const locators = new Set([...baseFiles.keys(), ...targetFiles.keys()]);
  for (const locator of [...locators].sort()) {
    const base = baseFiles.get(locator);
    const target = targetFiles.get(locator);
    if (base && target) {
      if (fileLeafEqual(base, target)) {
        continue;
      }
      if (contentAndKindEqual(base, target)) {
        changes.push(
          Object.freeze({
            kind: 'renewed',
            locator,
            inputKind: target.inputKind,
            scanProfileDigest: target.scanProfileDigest,
            priorDigest: base.contentDigest,
            nextDigest: target.contentDigest,
          })
        );
        continue;
      }
      changes.push(
        Object.freeze({
          kind: 'edited',
          locator,
          inputKind: target.inputKind,
          scanProfileDigest: target.scanProfileDigest,
          priorDigest: base.contentDigest,
          nextDigest: target.contentDigest,
        })
      );
      continue;
    }
    if (target) {
      changes.push(
        Object.freeze({
          kind: 'added',
          locator,
          inputKind: target.inputKind,
          scanProfileDigest: target.scanProfileDigest,
          nextDigest: target.contentDigest,
        })
      );
      continue;
    }
    if (base) {
      changes.push(
        Object.freeze({
          kind: 'deleted',
          locator,
          inputKind: base.inputKind,
          scanProfileDigest: base.scanProfileDigest,
          priorDigest: base.contentDigest,
        })
      );
    }
  }
  return changes;
}

function resolveRenameCandidates(
  changes: GraphInputChange[],
  baseFiles: Map<string, GraphContentStateLeaf>,
  targetFiles: Map<string, GraphContentStateLeaf>
): { changes: GraphInputChange[]; diagnostics: GraphDiagnostic[] } {
  const diagnostics: GraphDiagnostic[] = [];
  const added = changes.filter((change) => change.kind === 'added');
  const deleted = changes.filter((change) => change.kind === 'deleted');
  if (added.length === 0 || deleted.length === 0) {
    return { changes, diagnostics };
  }

  const consumedAdded = new Set<string>();
  const consumedDeleted = new Set<string>();
  const resolved: GraphInputChange[] = changes.filter(
    (change) => change.kind !== 'added' && change.kind !== 'deleted'
  );

  for (const removed of deleted) {
    const base = baseFiles.get(removed.locator);
    if (!base) {
      continue;
    }
    const candidates = added.filter((candidate) => {
      if (consumedAdded.has(candidate.locator)) {
        return false;
      }
      const target = targetFiles.get(candidate.locator);
      return target ? fileLeafEqual(base, target) : false;
    });
    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      consumedAdded.add(candidate.locator);
      consumedDeleted.add(removed.locator);
      resolved.push(
        Object.freeze({
          kind: 'rename-candidate',
          locator: candidate.locator,
          inputKind: candidate.inputKind,
          scanProfileDigest: candidate.scanProfileDigest,
          priorDigest: removed.priorDigest,
          nextDigest: candidate.nextDigest,
          renameCandidate: Object.freeze({
            priorLocator: removed.locator,
            nextLocator: candidate.locator,
            confidence: 1,
          }),
        })
      );
      continue;
    }
    if (candidates.length > 1) {
      diagnostics.push(
        Object.freeze({
          code: 'GRAPH_INCREMENTAL_RENAME_AMBIGUOUS',
          severity: 'warning',
          path: removed.locator,
          message: 'Multiple added files match the deleted content identity.',
        })
      );
    }
  }

  for (const change of changes) {
    if (change.kind === 'added' && !consumedAdded.has(change.locator)) {
      resolved.push(change);
    }
    if (change.kind === 'deleted' && !consumedDeleted.has(change.locator)) {
      resolved.push(change);
    }
  }

  resolved.sort((left, right) => left.locator.localeCompare(right.locator));
  return { changes: resolved, diagnostics };
}

/**
 * Compares portable content-state manifests and emits bounded input changes with
 * explicit Merkle branch accounting.
 */
export function compareContentStateManifests(
  request: GraphContentStateComparisonRequest
): GraphContentStateComparisonResult {
  const budget: GraphContentStateComparisonBudget = Object.freeze({
    ...DEFAULT_BUDGET,
    ...request.budget,
  });

  if (!scopesCompatible(request.base.scope, request.target.scope)) {
    return Object.freeze({
      baseRoot: request.base.merkleRoot,
      targetRoot: request.target.merkleRoot,
      comparedBranches: 0,
      skippedBranches: 0,
      changedInputs: Object.freeze([]),
      causes: Object.freeze([
        Object.freeze({ kind: 'content' as const, source: 'content-state-comparison' }),
      ]),
      diagnostics: Object.freeze([
        Object.freeze({
          code: 'GRAPH_INCREMENTAL_SCOPE_MISMATCH',
          severity: 'error',
          path: '/scope',
          message: 'Content-state comparison requires the same project or workspace scope.',
        }),
      ]),
      status: 'failed',
    });
  }

  const baseIndexed = indexManifest(request.base);
  const targetIndexed = indexManifest(request.target);

  if (digestEqual(request.base.merkleRoot, request.target.merkleRoot)) {
    return Object.freeze({
      baseRoot: request.base.merkleRoot,
      targetRoot: request.target.merkleRoot,
      comparedBranches: 0,
      skippedBranches: baseIndexed.directories.size,
      changedInputs: Object.freeze([]),
      causes: Object.freeze([]),
      diagnostics: Object.freeze([]),
      status: 'complete',
    });
  }

  const branchAccounting = accountDirectoryBranches(
    request.base,
    request.target,
    baseIndexed.directories,
    targetIndexed.directories
  );
  if (branchAccounting.comparedBranches > budget.maxComparedBranches) {
    return Object.freeze({
      baseRoot: request.base.merkleRoot,
      targetRoot: request.target.merkleRoot,
      comparedBranches: branchAccounting.comparedBranches,
      skippedBranches: branchAccounting.skippedBranches,
      changedInputs: Object.freeze([]),
      causes: Object.freeze([]),
      diagnostics: Object.freeze([
        Object.freeze({
          code: 'GRAPH_INCREMENTAL_BRANCH_BUDGET_EXCEEDED',
          severity: 'error',
          path: '/budget/maxComparedBranches',
          message: 'Merkle branch comparison exceeded the declared budget.',
        }),
      ]),
      truncation: Object.freeze({
        dimension: 'compared-branches',
        limit: budget.maxComparedBranches,
        observed: branchAccounting.comparedBranches,
        reason: 'branch-budget-exceeded',
      }),
      status: 'partial',
    });
  }

  const comparedBaseFiles = filesInComparedBranches(
    baseIndexed.files,
    branchAccounting.skippedDirectories
  );
  const comparedTargetFiles = filesInComparedBranches(
    targetIndexed.files,
    branchAccounting.skippedDirectories
  );
  const rawChanges = detectFileChanges(comparedBaseFiles, comparedTargetFiles);
  const renameResolution = resolveRenameCandidates(
    rawChanges,
    comparedBaseFiles,
    comparedTargetFiles
  );
  let changedInputs = renameResolution.changes;
  let truncation = undefined;
  let status: GraphContentStateComparisonResult['status'] = 'complete';
  const diagnostics = [...renameResolution.diagnostics];

  if (changedInputs.length > budget.maxChangedInputs) {
    changedInputs = changedInputs.slice(0, budget.maxChangedInputs);
    truncation = Object.freeze({
      dimension: 'changed-inputs',
      limit: budget.maxChangedInputs,
      observed: renameResolution.changes.length,
      reason: 'input-budget-exceeded',
    });
    diagnostics.push(
      Object.freeze({
        code: 'GRAPH_INCREMENTAL_INPUT_BUDGET_EXCEEDED',
        severity: 'warning',
        path: '/budget/maxChangedInputs',
        message: 'Changed input enumeration exceeded the declared budget.',
      })
    );
    status = 'partial';
  }

  return Object.freeze({
    baseRoot: request.base.merkleRoot,
    targetRoot: request.target.merkleRoot,
    comparedBranches: branchAccounting.comparedBranches,
    skippedBranches: branchAccounting.skippedBranches,
    changedInputs: Object.freeze(changedInputs),
    causes: Object.freeze(comparisonCauses(changedInputs)),
    diagnostics: Object.freeze(diagnostics),
    truncation,
    status,
  });
}
