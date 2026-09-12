import {
  WIS_CURRENT_CORE_RESULT_ENVELOPE_ID,
  WIS_CURRENT_CORE_VERSION,
  negotiateWisCoreResultEnvelope,
} from '@workspai/shared/compatibility';
import type { WisResultEnvelope } from '@workspai/shared/contracts';
import { getWisGeneratedContract } from '@workspai/shared/registry';
import type { WisValidationDiagnostic, WisValidationOptions } from '@workspai/shared/validation';

import { GRAPH_PACKAGE_STATUS_CONTRACT } from '../contracts/index.js';

const REQUIRED_SHARED_SUBPATHS = Object.freeze([
  '@workspai/shared/contracts',
  '@workspai/shared/compatibility',
  '@workspai/shared/validation',
  '@workspai/shared/registry',
] as const);

const SUPPORTED_GRAPH_SCHEMAS = Object.freeze([GRAPH_PACKAGE_STATUS_CONTRACT.id] as const);

export const GRAPH_SHARED_ADOPTION_PROFILE = Object.freeze({
  id: 'workspai.graph.shared-adoption',
  version: '0.1.0-draft',
  consumer: '@workspai/graph',
  sharedCoreVersion: WIS_CURRENT_CORE_VERSION,
  requiredSharedSubpaths: REQUIRED_SHARED_SUBPATHS,
  supportedGraphSchemas: SUPPORTED_GRAPH_SCHEMAS,
  compatibilityPolicy: 'current-exact-domain-contract-only' as const,
  cliBridge: 'prohibited' as const,
});

export type GraphSharedAdoptionFailureCode =
  | 'shared-contract-registry-drift'
  | 'invalid-shared-envelope'
  | 'unsupported-shared-version'
  | 'domain-contract-migration-required'
  | 'foreign-producer'
  | 'unsupported-graph-schema';

export type GraphSharedAdoptionResult =
  | {
      readonly accepted: true;
      readonly status: 'exact';
      readonly value: WisResultEnvelope<unknown>;
      readonly sharedContract: {
        readonly id: string;
        readonly version: string;
        readonly digest: string;
      };
      readonly diagnostics: readonly [];
    }
  | {
      readonly accepted: false;
      readonly status: GraphSharedAdoptionFailureCode;
      readonly diagnostics: readonly WisValidationDiagnostic[];
    };

function rejected(
  status: GraphSharedAdoptionFailureCode,
  code: string,
  path: string,
  message: string
): GraphSharedAdoptionResult {
  return {
    accepted: false,
    status,
    diagnostics: [{ code, phase: 'semantic', path, message }],
  };
}

/**
 * Validates the Shared envelope boundary before Graph interprets a domain
 * payload. Shared compatibility may migrate the protocol envelope, but it can
 * never silently migrate or authorize a Graph-domain contract.
 */
export function assessGraphSharedEnvelope(
  input: unknown,
  options?: WisValidationOptions
): GraphSharedAdoptionResult {
  const sharedContract = getWisGeneratedContract('core-result-envelope');
  if (
    !sharedContract ||
    sharedContract.id !== WIS_CURRENT_CORE_RESULT_ENVELOPE_ID ||
    sharedContract.version !== WIS_CURRENT_CORE_VERSION
  ) {
    return rejected(
      'shared-contract-registry-drift',
      'GRAPH_SHARED_REGISTRY_DRIFT',
      '',
      'The installed Shared registry does not identify the required current Core envelope.'
    );
  }

  const compatibility = negotiateWisCoreResultEnvelope(input, options);
  if (!compatibility.compatible) {
    return {
      accepted: false,
      status:
        compatibility.status === 'unsupported'
          ? 'unsupported-shared-version'
          : 'invalid-shared-envelope',
      diagnostics: compatibility.diagnostics,
    };
  }

  if (compatibility.status === 'migrated') {
    return rejected(
      'domain-contract-migration-required',
      'GRAPH_DOMAIN_MIGRATION_REQUIRED',
      '/schemaId',
      'Shared Core migration does not authorize migration of a Graph-domain payload.'
    );
  }

  const value = compatibility.value as WisResultEnvelope<unknown>;
  if (value.producer.id !== GRAPH_SHARED_ADOPTION_PROFILE.consumer) {
    return rejected(
      'foreign-producer',
      'GRAPH_FOREIGN_PRODUCER',
      '/producer/id',
      'The envelope producer is outside the Graph package trust boundary.'
    );
  }

  if (!SUPPORTED_GRAPH_SCHEMAS.some((schemaId) => schemaId === value.schemaId)) {
    return rejected(
      'unsupported-graph-schema',
      'GRAPH_UNSUPPORTED_SCHEMA',
      '/schemaId',
      'The Graph package does not support the declared domain schema.'
    );
  }

  return {
    accepted: true,
    status: 'exact',
    value,
    sharedContract: {
      id: sharedContract.id,
      version: sharedContract.version,
      digest: sharedContract.digest,
    },
    diagnostics: [],
  };
}
