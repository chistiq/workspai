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
export {
  GRAPH_EXTRACTION_SUPPORT,
  extractionSupportFor,
  type GraphExtractionSupport,
  type GraphExtractionSupportClaim,
  type GraphExtractionTier,
} from './extraction-pipeline.js';
export {
  ECMASCRIPT_SYNTAX_VERSION,
  scanEcmascriptCallChains,
  tokenizeEcmascript,
} from './ecmascript-syntax.js';
export {
  GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT,
  GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT_BYTES,
  GRAPH_CONTENT_ADDRESSED_FACTS_MAX_ENTRY_BYTES,
  GRAPH_CONTENT_ADDRESSED_FACTS_SCHEMA,
  consumeContentAddressedFactCacheStats,
  contentAddressedCompute,
  contentAddressedFactCacheStats,
  contentAddressedFactKey,
  contentAddressedGet,
  createContentAddressedFactSession,
  disposeContentAddressedFactSession,
  runWithContentAddressedFactSession,
  runWithOwnedContentAddressedFactSession,
} from './content-addressed-facts.js';
export {
  GRAPH_GO_HTTP_RUNTIME_CAPABILITIES,
  GRAPH_JS_HTTP_RUNTIME_CAPABILITIES,
  GRAPH_JS_HTTP_SPECIFIERS,
  GRAPH_PYTHON_HTTP_RUNTIME_CAPABILITIES,
  goHttpMethodsFor,
  pythonHttpConstructorsFor,
} from './http-runtime-capabilities.js';
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
export {
  SOURCE_DECLARATIONS_PROVIDER_ID,
  GRAPH_SOURCE_DECLARATIONS_PROVIDER_VERSION,
  NATIVE_DECLARATION_MIN_FILES,
  DECLARATION_KEYWORD_LOOKBEHIND,
  CONSTRUCTOR_LOOKBEHIND,
  createSourceDeclarationsProvider,
  isConstructorCall,
  isKeywordDeclarationName,
} from './source-declarations.js';
export {
  extractPublishedMatrixDeclarations,
  routeGraphNativeDeclarations,
  type GraphNativeDeclarationRoute,
  type GraphPublishedDeclarationRoute,
} from './route-native-declarations.js';
export { SOURCE_LANGUAGE_PROVIDER_ID, createSourceLanguageProvider } from './source-language.js';
export {
  DOCUMENTATION_SURFACES_PROVIDER_ID,
  createDocumentationSurfacesProvider,
} from './documentation-surfaces.js';
export {
  SCOPE_CONTAINMENT_PROVIDER_ID,
  WORKSPACE_IDENTITY_INPUT_LOCATOR,
  createScopeContainmentProvider,
  isHostSuppliedGraphInputLocator,
} from './scope-containment.js';
export {
  OPENAPI_CONTRACTS_PROVIDER_ID,
  createOpenApiContractsProvider,
} from './openapi-contracts.js';
export {
  GRAPHQL_CONTRACTS_PROVIDER_ID,
  createGraphqlContractsProvider,
} from './graphql-contracts.js';
export {
  KUBERNETES_TOPOLOGY_PROVIDER_ID,
  createKubernetesTopologyProvider,
} from './kubernetes-topology.js';
export { CI_WORKFLOW_PROVIDER_ID, createCiWorkflowProvider } from './ci-workflow.js';
export {
  INFRASTRUCTURE_AS_CODE_PROVIDER_ID,
  createInfrastructureAsCodeProvider,
} from './infrastructure-as-code.js';
export {
  PYTHON_PROJECT_MANIFEST_PROVIDER_ID,
  createPythonProjectManifestProvider,
} from './python-project-manifest.js';
export {
  VSCODE_EXTENSION_MANIFEST_PROVIDER_ID,
  createVscodeExtensionManifestProvider,
} from './vscode-extension-manifest.js';
export {
  ARCHITECTURE_DECISIONS_PROVIDER_ID,
  createArchitectureDecisionsProvider,
} from './architecture-decisions.js';
export {
  API_IMPLEMENTATION_BINDING_PROVIDER_ID,
  createApiImplementationBindingProvider,
} from './api-implementation-binding.js';

import type { GraphNativePort } from '../ports/index.js';
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
import { createSourceDeclarationsProvider } from './source-declarations.js';
import { createSourceLanguageProvider } from './source-language.js';
import { createDocumentationSurfacesProvider } from './documentation-surfaces.js';
import { createOpenApiContractsProvider } from './openapi-contracts.js';
import { createGraphqlContractsProvider } from './graphql-contracts.js';
import { createKubernetesTopologyProvider } from './kubernetes-topology.js';
import { createCiWorkflowProvider } from './ci-workflow.js';
import { createInfrastructureAsCodeProvider } from './infrastructure-as-code.js';
import { createPythonProjectManifestProvider } from './python-project-manifest.js';
import { createVscodeExtensionManifestProvider } from './vscode-extension-manifest.js';
import { createArchitectureDecisionsProvider } from './architecture-decisions.js';
import { createApiImplementationBindingProvider } from './api-implementation-binding.js';

export interface GraphStandardRepositoryProviderOptions {
  readonly native?: GraphNativePort;
  readonly loadNative?: () => Promise<GraphNativePort | undefined>;
}

export const STANDARD_REPOSITORY_PROVIDER_COUNT = 24;

/** The deterministic, offline provider set admitted for the standalone repository preview. */
export function createStandardRepositoryProviders(
  options: GraphStandardRepositoryProviderOptions = {}
): readonly GraphProviderRuntime[] {
  return Object.freeze([
    createRepositoryFilesProvider(),
    createPackageJsonProvider(),
    createVscodeExtensionManifestProvider(),
    createPythonProjectManifestProvider(),
    createEcmaScriptImportsProvider(),
    createLanguageImportsProvider(),
    createRepositorySurfacesProvider(),
    createGitHeadProvider(),
    createRepositoryRoutesProvider(),
    createComposeTopologyProvider(),
    createCodeownersProvider(),
    createSourceEntrypointsProvider(),
    createProtobufTopologyProvider(),
    createGraphqlContractsProvider(),
    createOpenApiContractsProvider(),
    createApiImplementationBindingProvider(),
    createKubernetesTopologyProvider(),
    createInfrastructureAsCodeProvider(),
    createCiWorkflowProvider(),
    createArchitectureDecisionsProvider(),
    createBuildTopologyProvider(),
    createSourceDeclarationsProvider(options),
    createSourceLanguageProvider(),
    createDocumentationSurfacesProvider(),
  ]);
}
