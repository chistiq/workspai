import { computeInputsHash } from './contracts/freshness-metadata-contract.js';
import { buildGraphTraversalIndex, traverseWithIndex } from './workspace-graph-traversal.js';
import type { WorkspaceDependencyGraph } from './contracts/workspace-dependency-graph-contract.js';
import { workspaceModelProjectTopology, type WorkspaceModel } from './workspace-model.js';

/**
 * Graph-aware transitive freshness (roadmap 1.18).
 *
 * Replaces timestamp-only staleness with deterministic, content-addressed
 * hashing that is **transitive through the dependency graph**: a project's
 * `transitiveInputsHash` chains its own input hash with the own-hashes of every
 * project it (transitively) depends on. So if a dependency changes, every
 * dependent's transitive hash changes too — even when the dependent's own files
 * are untouched. Comparing the recomputed hash against a recorded one yields a
 * deterministic `fresh | stale | unknown` verdict.
 *
 * Cycle-safe: dependencies are taken from the transitive-dependency closure
 * (BFS, terminates on cycles), and only the *own* hashes of those dependencies
 * are folded in (sorted), so the result is independent of traversal order.
 */

export type ProjectFreshnessHash = {
  id: string;
  ownHash: string;
  transitiveInputsHash: string;
};

/**
 * Per-project own hash, derived from the project's own model entry (no extra
 * file IO). Changes whenever the detected project model changes.
 */
export function computeProjectOwnHashes(model: WorkspaceModel): Map<string, string> {
  const ownHashes = new Map<string, string>();
  for (const project of model.projects) {
    if (ownHashes.has(project.name)) {
      continue;
    }
    ownHashes.set(project.name, computeInputsHash(project));
  }
  return ownHashes;
}

export function computeProjectFreshnessHashes(
  model: WorkspaceModel
): Map<string, ProjectFreshnessHash> {
  const ownHashes = computeProjectOwnHashes(model);
  const graph: Pick<WorkspaceDependencyGraph, 'nodes' | 'edges'> = workspaceModelProjectTopology(
    model
  ) ?? {
    nodes: model.projects.map((project) => ({ id: project.name, path: project.path })),
    edges: [],
  };
  const index = buildGraphTraversalIndex(graph);

  const result = new Map<string, ProjectFreshnessHash>();
  for (const node of graph.nodes) {
    const ownHash = ownHashes.get(node.id) ?? computeInputsHash({ missing: node.id });
    const dependencies = traverseWithIndex(index, [node.id], { direction: 'dependencies' });
    const dependencyHashes = [...dependencies.keys()]
      .filter((id) => id !== node.id)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id, hash: ownHashes.get(id) ?? '<unknown>' }));
    result.set(node.id, {
      id: node.id,
      ownHash,
      transitiveInputsHash: computeInputsHash({ own: ownHash, dependencies: dependencyHashes }),
    });
  }
  return result;
}

export type FreshnessComparison = {
  verdict: 'fresh' | 'stale' | 'unknown';
  baseline: 'none' | 'recorded';
  changed: string[];
  added: string[];
  removed: string[];
};

/**
 * Compare current per-project transitive hashes against a previously recorded
 * map. `unknown` when there is no recorded baseline; `fresh` when every project's
 * transitive hash matches; `stale` when any project changed/added/removed.
 */
export function compareFreshness(
  current: Map<string, ProjectFreshnessHash>,
  recorded: Record<string, string> | undefined
): FreshnessComparison {
  if (!recorded || Object.keys(recorded).length === 0) {
    return { verdict: 'unknown', baseline: 'none', changed: [], added: [], removed: [] };
  }
  const changed: string[] = [];
  const added: string[] = [];
  for (const [id, hash] of current.entries()) {
    if (!(id in recorded)) {
      added.push(id);
    } else if (recorded[id] !== hash.transitiveInputsHash) {
      changed.push(id);
    }
  }
  const removed: string[] = [];
  for (const id of Object.keys(recorded)) {
    if (!current.has(id)) {
      removed.push(id);
    }
  }
  changed.sort((a, b) => a.localeCompare(b));
  added.sort((a, b) => a.localeCompare(b));
  removed.sort((a, b) => a.localeCompare(b));
  const stale = changed.length > 0 || added.length > 0 || removed.length > 0;
  return {
    verdict: stale ? 'stale' : 'fresh',
    baseline: 'recorded',
    changed,
    added,
    removed,
  };
}

export function freshnessHashRecord(
  hashes: Map<string, ProjectFreshnessHash>
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [id, value] of [...hashes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    record[id] = value.transitiveInputsHash;
  }
  return record;
}
