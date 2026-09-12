export const GRAPH_SHADOW_PARITY_SCHEMA_VERSION =
  'workspai.graph-shadow-parity.v1-candidate' as const;

export const GRAPH_MODEL_AUTHORITY_RECEIPT_SCHEMA_VERSION =
  'workspai.graph-model-authority-receipt.v1-candidate' as const;

export type GraphShadowComparisonStatus = 'equivalent' | 'different' | 'incomparable' | 'failed';

export type GraphShadowDifferenceClass =
  'regression' | 'truth-depth-improvement' | 'intentional-contract-change' | 'legacy-false-claim';

export interface GraphShadowComparisonBinding {
  sourceFixtureDigest: string;
  scopeDigest: string;
  providerProfileDigest: string;
  graphPolicyDigest: string;
  redactionAuthorizationDigest: string;
  resourceBudgetDigest: string;
  legacyCli: { version: string; commit: string };
  graphPackage: { version: string; commit: string };
}

export interface GraphShadowDifference {
  area:
    | 'binding'
    | 'identity'
    | 'node'
    | 'relation'
    | 'proof'
    | 'unknown'
    | 'completeness'
    | 'diagnostic';
  code: string;
  classification?: GraphShadowDifferenceClass;
  key?: string;
  legacy?: unknown;
  package?: unknown;
  reason: string;
}

export interface GraphShadowComparisonPolicy {
  mappingVersion?: string;
  identityMappings?: Readonly<Record<string, string>>;
  kindMappings?: Readonly<Record<string, string>>;
  relationMappings?: Readonly<Record<string, string>>;
  approvedDifferences?: Readonly<Record<string, Exclude<GraphShadowDifferenceClass, 'regression'>>>;
}

export interface GraphModelAuthorityReceipt {
  schemaVersion: typeof GRAPH_MODEL_AUTHORITY_RECEIPT_SCHEMA_VERSION;
  epoch: 'package-shadow';
  executionPath: 'compared';
  comparison: {
    status: GraphShadowComparisonStatus;
    profile: string;
    reportDigest: string;
  };
  authority: 'released-cli';
  packageWrites: 'prohibited';
  fallback: 'prohibited';
}

export interface GraphShadowParityReport {
  schemaVersion: typeof GRAPH_SHADOW_PARITY_SCHEMA_VERSION;
  /** Null only when an untrusted qualification binding fails structural validation. */
  binding: GraphShadowComparisonBinding | null;
  status: GraphShadowComparisonStatus;
  profile: string;
  mappingVersion: string;
  differences: GraphShadowDifference[];
  metrics: {
    legacyNodes: number;
    packageNodes: number;
    legacyRelations: number;
    packageRelations: number;
    comparedNodes: number;
    comparedRelations: number;
    regressions: number;
    approvedDifferences: number;
  };
  receipt: GraphModelAuthorityReceipt;
}
