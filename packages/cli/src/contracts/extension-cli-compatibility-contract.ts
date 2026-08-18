import { getPublishedContractVersions } from './published-contract-versions.js';

export const EXTENSION_CLI_COMPATIBILITY_SCHEMA_VERSION = 'rapidkit-extension-cli-compatibility.v1';
/**
 * Oldest CLI release supported by the currently published extension contract.
 *
 * This is deliberately independent from packages/cli/package.json. A newer,
 * backward-compatible CLI release must not make an already compatible extension
 * unusable. Raise this floor only when the extension starts consuming a CLI
 * command or contract that is unavailable in the previous floor.
 */
export const EXTENSION_MINIMUM_VERIFIED_CLI_VERSION = '0.60.1';

export type ExtensionCliCompatibilityContract = {
  schemaVersion: typeof EXTENSION_CLI_COMPATIBILITY_SCHEMA_VERSION;
  /** npm CLI package this extension release was verified against. */
  cli: 'workspai';
  /** Semver floor for the linked Workspai CLI. */
  minimumVerifiedCliVersion: string;
  /** Schema versions bundled with this extension release (from npm contract generator). */
  publishedContractSchemas: ReturnType<typeof getPublishedContractVersions>;
};

export function buildExtensionCliCompatibilityContract(): ExtensionCliCompatibilityContract {
  return {
    schemaVersion: EXTENSION_CLI_COMPATIBILITY_SCHEMA_VERSION,
    cli: 'workspai',
    minimumVerifiedCliVersion: EXTENSION_MINIMUM_VERIFIED_CLI_VERSION,
    publishedContractSchemas: getPublishedContractVersions(),
  };
}
