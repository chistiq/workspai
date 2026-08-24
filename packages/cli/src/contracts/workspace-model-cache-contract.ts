/**
 * Semantic revision of the Workspace Model producer. It is independent of the
 * npm version so local candidates and backports cannot reuse semantically stale
 * caches under an unchanged package version.
 */
export const WORKSPACE_MODEL_PRODUCER_REVISION = 'workspace-model-producer.v3' as const;
