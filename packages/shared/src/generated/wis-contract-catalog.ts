/* Generated from schemas/src/wis-contract-catalog.v0.1.0-draft.schema.json. Do not edit. */

/**
 * This interface was referenced by `WisContractCatalog`'s JSON-Schema
 * via the `definition` "Sha256Digest".
 */
export type Sha256Digest = string;
/**
 * This interface was referenced by `WisContractCatalog`'s JSON-Schema
 * via the `definition` "NonEmptyString".
 */
export type NonEmptyString = string;

/**
 * Portable digest-bound catalog of generated WIS contracts.
 */
export interface WisContractCatalog {
  schemaVersion: 'workspai-shared-generated-registry.v2';
  status: 'candidate' | 'stable' | 'deprecated';
  portfolioDigest: Sha256Digest;
  /**
   * @minItems 1
   * @maxItems 1024
   */
  contracts: [ContractEntry, ...ContractEntry[]];
}
/**
 * This interface was referenced by `WisContractCatalog`'s JSON-Schema
 * via the `definition` "ContractEntry".
 */
export interface ContractEntry {
  key: string;
  id: string;
  title: string;
  version: NonEmptyString;
  dialect: string;
  source: string;
  digest: Sha256Digest;
  typeExport: string;
  validatorExport: string;
  /**
   * @maxItems 128
   */
  dependencies: string[];
}
