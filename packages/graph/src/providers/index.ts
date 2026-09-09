export {
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  defineGraphProviderManifest,
  type GraphProviderCapabilityClaim,
  type GraphProviderLimits,
  type GraphProviderManifest,
  type GraphProviderPermissions,
  type GraphRelationSemantics,
} from '../contracts/provider.js';
export { REPOSITORY_FILES_PROVIDER_ID, createRepositoryFilesProvider } from './repository-files.js';
export { PACKAGE_JSON_PROVIDER_ID, createPackageJsonProvider } from './package-json.js';
export {
  ECMASCRIPT_IMPORTS_PROVIDER_ID,
  createEcmaScriptImportsProvider,
} from './ecmascript-imports.js';
export { LANGUAGE_IMPORTS_PROVIDER_ID, createLanguageImportsProvider } from './language-imports.js';

import type { GraphProviderRuntime } from '../contracts/provider.js';

import { createPackageJsonProvider } from './package-json.js';
import { createRepositoryFilesProvider } from './repository-files.js';
import { createEcmaScriptImportsProvider } from './ecmascript-imports.js';
import { createLanguageImportsProvider } from './language-imports.js';

/** The deterministic, offline provider set admitted for the standalone repository preview. */
export function createStandardRepositoryProviders(): readonly GraphProviderRuntime[] {
  return Object.freeze([
    createRepositoryFilesProvider(),
    createPackageJsonProvider(),
    createEcmaScriptImportsProvider(),
    createLanguageImportsProvider(),
  ]);
}
