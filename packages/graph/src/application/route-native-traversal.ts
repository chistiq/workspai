import type { GraphNativePort, GraphNativeTraversalRequest } from '../ports/index.js';

export type GraphNativeTraversalRoute =
  | {
      readonly engine: 'typescript';
      readonly reason: 'native-unavailable' | 'native-failed' | 'native-mismatch';
      readonly nodes: readonly number[];
    }
  | {
      readonly engine: 'rust-wasm';
      readonly reason: 'parity-qualified';
      readonly nodes: readonly number[];
    };

/** TypeScript remains the semantic authority for reachable-node identity. */
export function referenceGraphNativeTraversal(
  request: GraphNativeTraversalRequest
): readonly number[] {
  const adjacency = Array.from({ length: request.nodeCount }, () => new Set<number>());
  for (const [from, to] of request.edges) adjacency[from]?.add(to);
  const ordered = adjacency.map((neighbors) => [...neighbors].sort((left, right) => left - right));
  const depths = new Array<number>(request.nodeCount).fill(Number.POSITIVE_INFINITY);
  const queue = [request.start];
  const output: number[] = [];
  depths[request.start] = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor];
    if (node === undefined) break;
    output.push(node);
    const depth = depths[node] ?? Number.POSITIVE_INFINITY;
    if (depth >= request.maxDepth) continue;
    for (const neighbor of ordered[node] ?? []) {
      if (depths[neighbor] === Number.POSITIVE_INFINITY) {
        depths[neighbor] = depth + 1;
        queue.push(neighbor);
      }
    }
  }
  return output;
}

/**
 * Routes reachability through the bundled engine only when it matches TypeScript.
 * A mismatch or native failure never silently degrades the result: TypeScript
 * remains the returned authority and the route is observable.
 */
export function routeGraphNativeTraversal(
  request: GraphNativeTraversalRequest,
  native: GraphNativePort | undefined
): GraphNativeTraversalRoute {
  const reference = referenceGraphNativeTraversal(request);
  if (!native) {
    return { engine: 'typescript', reason: 'native-unavailable', nodes: reference };
  }
  const candidate = native.traverseReachable(request);
  if (candidate.status !== 'complete') {
    return { engine: 'typescript', reason: 'native-failed', nodes: reference };
  }
  if (
    candidate.nodes.length !== reference.length ||
    candidate.nodes.some((node, index) => node !== reference[index])
  ) {
    return { engine: 'typescript', reason: 'native-mismatch', nodes: reference };
  }
  return { engine: 'rust-wasm', reason: 'parity-qualified', nodes: candidate.nodes };
}
