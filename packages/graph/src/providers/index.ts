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
export {
  REPOSITORY_SURFACES_PROVIDER_ID,
  createRepositorySurfacesProvider,
} from './repository-surfaces.js';
export { GIT_HEAD_PROVIDER_ID, createGitHeadProvider } from './git-head.js';
export {
  REPOSITORY_ROUTES_PROVIDER_ID,
  createRepositoryRoutesProvider,
} from './repository-routes.js';
export { COMPOSE_TOPOLOGY_PROVIDER_ID, createComposeTopologyProvider } from './compose-topology.js';
export { CODEOWNERS_PROVIDER_ID, createCodeownersProvider } from './codeowners.js';
export {
  SOURCE_ENTRYPOINTS_PROVIDER_ID,
  createSourceEntrypointsProvider,
} from './source-entrypoints.js';
export {
  PROTOBUF_TOPOLOGY_PROVIDER_ID,
  createProtobufTopologyProvider,
} from './protobuf-topology.js';
export { BUILD_TOPOLOGY_PROVIDER_ID, createBuildTopologyProvider } from './build-topology.js';

import type { GraphProviderRuntime } from '../contracts/provider.js';

import { createPackageJsonProvider } from './package-json.js';
import { createRepositoryFilesProvider } from './repository-files.js';
import { createEcmaScriptImportsProvider } from './ecmascript-imports.js';
import { createLanguageImportsProvider } from './language-imports.js';
import { createRepositorySurfacesProvider } from './repository-surfaces.js';
import { createGitHeadProvider } from './git-head.js';
import { createRepositoryRoutesProvider } from './repository-routes.js';
import { createComposeTopologyProvider } from './compose-topology.js';
import { createCodeownersProvider } from './codeowners.js';
import { createSourceEntrypointsProvider } from './source-entrypoints.js';
import { createProtobufTopologyProvider } from './protobuf-topology.js';
import { createBuildTopologyProvider } from './build-topology.js';

/** The deterministic, offline provider set admitted for the standalone repository preview. */
export function createStandardRepositoryProviders(): readonly GraphProviderRuntime[] {
  return Object.freeze([
    createRepositoryFilesProvider(),
    createPackageJsonProvider(),
    createEcmaScriptImportsProvider(),
    createLanguageImportsProvider(),
    createRepositorySurfacesProvider(),
    createGitHeadProvider(),
    createRepositoryRoutesProvider(),
    createComposeTopologyProvider(),
    createCodeownersProvider(),
    createSourceEntrypointsProvider(),
    createProtobufTopologyProvider(),
    createBuildTopologyProvider(),
  ]);
}
