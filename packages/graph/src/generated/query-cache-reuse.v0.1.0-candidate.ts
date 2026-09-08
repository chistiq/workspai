/* Generated from schemas/query-cache-reuse.v0.1.0-candidate.schema.json. Do not edit. */

export type WorkspaiGraphQueryCacheReuseCandidate =
  | {
      contract: { id: 'workspai.graph.query-cache-reuse'; version: '0.1.0-candidate' };
      reusable: true;
      status: 'exact';
      entryDigest: {};
    }
  | {
      contract: { id: 'workspai.graph.query-cache-reuse'; version: '0.1.0-candidate' };
      reusable: false;
      status: 'miss' | 'stale' | 'denied' | 'incompatible' | 'corrupt';
      /**
       * @minItems 1
       */
      reasons: [string, ...string[]];
    };
