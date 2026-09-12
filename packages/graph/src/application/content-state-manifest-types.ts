import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphProviderInput, GraphScope, GraphShardDependency } from '../contracts/index.js';
import { normalizePortableLocator } from '../domain/content-state-merkle.js';

export interface GraphContentStateLeafInput {
  readonly locator: string;
  readonly contentDigest: WisDigestReference;
  readonly inputKind: string;
  readonly scanProfileDigest: WisDigestReference;
  readonly observations?: {
    readonly sizeBytes?: number;
    readonly modifiedAt?: string;
    readonly gitStatus?: string;
  };
}

export interface GraphContentStateManifestBuildRequest {
  readonly scope: GraphScope;
  readonly generatedAt: string;
  readonly scanProfileDigest: WisDigestReference;
  readonly leaves: readonly GraphContentStateLeafInput[];
  readonly shardDependencies?: readonly GraphShardDependency[];
}

export function contentStateLeavesFromProviderInputs(
  inputs: readonly GraphProviderInput[],
  scanProfileDigest: WisDigestReference,
  inputKind = 'source-file'
): GraphContentStateLeafInput[] {
  return inputs.map((input) =>
    Object.freeze({
      locator: normalizePortableLocator(input.locator),
      contentDigest: input.digest,
      inputKind,
      scanProfileDigest,
      observations: Object.freeze({ sizeBytes: input.byteLength }),
    })
  );
}
