import type {
  GraphCanonicalGraph,
  GraphDiagnostic,
  GraphOntologyProfile,
  GraphProviderRunSummary,
  GraphProviderRuntime,
  GraphQualityReport,
  GraphScope,
  GraphUnsupportedZone,
  GraphUnknownZone,
} from '../contracts/index.js';
import type { GraphProductHostPorts } from '../ports/index.js';

import type { GraphCompositionPolicy, GraphCompositionSource } from './composition-types.js';

export interface GraphRepoBuildCompositionReuse {
  readonly reusedSources: readonly GraphCompositionSource[];
  readonly providersToRecompute: readonly string[];
}

export interface GraphRepoBuildPolicy {
  readonly network: 'deny' | 'allow';
  readonly redactionProfile: string;
  readonly limits: {
    readonly maxFiles: number;
    readonly maxTotalBytes: number;
    readonly maxFileBytes: number;
    readonly maxProviderReadBytes: number;
    readonly maxDepth: number;
    readonly maxDirectoryEntries: number;
  };
  readonly excludedDirectories: readonly string[];
  readonly sensitiveFiles: 'omit-known';
  readonly composition: GraphCompositionPolicy;
}

export interface GraphRepoBuildRequest {
  readonly root: string;
  readonly scope: GraphScope;
  readonly ontology: GraphOntologyProfile;
  readonly providers: readonly GraphProviderRuntime[];
  readonly policy: GraphRepoBuildPolicy;
  readonly ports: GraphProductHostPorts;
  readonly compositionReuse?: GraphRepoBuildCompositionReuse;
}

export interface GraphRepoBuildMetrics {
  readonly inputFiles: number;
  readonly inputBytes: number;
  readonly providerFacts: number;
  readonly omittedFiles: number;
}

export interface GraphRepoBuildQuality {
  readonly graph?: GraphQualityReport;
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
  readonly providerFailures: readonly { readonly providerId: string; readonly code: string }[];
}

export interface GraphRepoBuildResult {
  readonly status: 'complete' | 'partial' | 'failed' | 'cancelled';
  readonly graph?: GraphCanonicalGraph;
  readonly quality: GraphRepoBuildQuality;
  readonly providers: readonly GraphProviderRunSummary[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly metrics: GraphRepoBuildMetrics;
  readonly compositionSources?: readonly GraphCompositionSource[];
}
