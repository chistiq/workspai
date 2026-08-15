/**
 * Infrastructure adapters are intentionally absent during contract design.
 * Node/filesystem/process adapters arrive only after their ports and fixtures.
 */
export const GRAPH_ADAPTERS_AVAILABLE = false as const;
