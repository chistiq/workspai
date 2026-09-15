import type { GraphNativePort, GraphNativeTraversalRequest } from '@workspai/graph';
import {
  GraphNativeAdapterLoadError,
  createNodeRustWasmGraphNativePort,
  routeGraphNativeTraversal,
  type GraphNativeTraversalRoute,
} from '@workspai/graph/adapters/node';

import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';

export const GRAPH_NATIVE_HOST_USER_SELECTABLE = false as const;
export const GRAPH_NATIVE_HOST_SEMANTIC_AUTHORITY = 'typescript' as const;
export const GRAPH_NATIVE_HOST_DYNAMIC_DOWNLOAD = 'prohibited' as const;

export interface HostGraphNativeReachabilityRequest {
  readonly graph: WorkspaceKnowledgeGraph;
  readonly startEntityId: string;
  readonly maxDepth?: number;
  readonly native?: GraphNativePort;
}

export interface HostGraphNativeReachabilityRoute {
  readonly engine: GraphNativeTraversalRoute['engine'];
  readonly reason: GraphNativeTraversalRoute['reason'];
  readonly entityIds: readonly string[];
  readonly userSelectable: false;
  readonly semanticAuthority: 'typescript';
  readonly dynamicDownload: 'prohibited';
}

export interface EncodedHostGraphNativeRequest {
  readonly request: GraphNativeTraversalRequest;
  readonly entityIds: readonly string[];
}

/**
 * Encodes a workspace-knowledge-graph projection into the Graph-owned native
 * traversal ABI. Identity order is canonical so TypeScript and WASM compare
 * the same integer graph.
 */
export function encodeWorkspaceGraphNativeRequest(
  graph: WorkspaceKnowledgeGraph,
  startEntityId: string,
  maxDepth = Number.MAX_SAFE_INTEGER
): EncodedHostGraphNativeRequest | undefined {
  const entityIds = [...new Set(graph.entities.map((entity) => entity.id))].sort((left, right) =>
    left.localeCompare(right)
  );
  const start = entityIds.indexOf(startEntityId);
  if (start < 0 || entityIds.length === 0) return undefined;
  const indexById = new Map(entityIds.map((id, index) => [id, index]));
  const edges = graph.relations.flatMap((relation) => {
    const from = indexById.get(relation.from);
    const to = indexById.get(relation.to);
    return from === undefined || to === undefined ? [] : ([[from, to]] as const);
  });
  return {
    request: {
      nodeCount: entityIds.length,
      edges,
      start,
      maxDepth: Number.isInteger(maxDepth) && maxDepth >= 0 ? maxDepth : entityIds.length,
    },
    entityIds,
  };
}

/**
 * Loads the product-bundled engine when the artifact is present. Missing or
 * invalid artifacts stay TypeScript-only; they never download, prompt, or
 * become Graph authority.
 */
export async function loadHostGraphNativePort(
  engineUrl?: URL
): Promise<GraphNativePort | undefined> {
  try {
    return engineUrl
      ? await createNodeRustWasmGraphNativePort(engineUrl)
      : await createNodeRustWasmGraphNativePort();
  } catch (error) {
    if (error instanceof GraphNativeAdapterLoadError) return undefined;
    throw error;
  }
}

/**
 * Routes reachability through the bundled engine only when it matches
 * TypeScript. Users never select an engine and a mismatch never silently
 * weakens the returned entity set.
 */
export function routeHostGraphReachability(
  input: HostGraphNativeReachabilityRequest
): HostGraphNativeReachabilityRoute | undefined {
  const encoded = encodeWorkspaceGraphNativeRequest(
    input.graph,
    input.startEntityId,
    input.maxDepth
  );
  if (!encoded) return undefined;
  const routed = routeGraphNativeTraversal(encoded.request, input.native);
  return {
    engine: routed.engine,
    reason: routed.reason,
    entityIds: routed.nodes.flatMap((index) => {
      const id = encoded.entityIds[index];
      return id ? [id] : [];
    }),
    userSelectable: GRAPH_NATIVE_HOST_USER_SELECTABLE,
    semanticAuthority: GRAPH_NATIVE_HOST_SEMANTIC_AUTHORITY,
    dynamicDownload: GRAPH_NATIVE_HOST_DYNAMIC_DOWNLOAD,
  };
}
