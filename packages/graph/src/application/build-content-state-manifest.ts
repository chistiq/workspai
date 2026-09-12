import { createHash } from 'node:crypto';

import type { WisDigestReference } from '@workspai/shared/contracts';

import {
  GRAPH_CONTENT_STATE_MANIFEST_CONTRACT,
  type GraphContentStateDirectory,
  type GraphContentStateLeaf,
  type GraphContentStateManifest,
  type GraphContentStateNode,
} from '../contracts/index.js';
import {
  assembleContentStateMerkle,
  normalizePortableLocator,
} from '../domain/content-state-merkle.js';

import type { GraphContentStateManifestBuildRequest } from './content-state-manifest-types.js';

function digestUtf8(material: string): WisDigestReference {
  return Object.freeze({
    algorithm: 'sha256',
    value: createHash('sha256').update(material, 'utf8').digest('hex'),
  });
}

/**
 * Builds a portable content-state manifest with derived directory digests and a
 * project/workspace Merkle root from admitted file leaves.
 */
export function buildContentStateManifest(
  request: GraphContentStateManifestBuildRequest
): GraphContentStateManifest {
  const leaves = [...request.leaves]
    .map((leaf) => Object.freeze({ ...leaf, locator: normalizePortableLocator(leaf.locator) }))
    .sort((left, right) => left.locator.localeCompare(right.locator));
  const seen = new Set<string>();
  for (const leaf of leaves) {
    if (seen.has(leaf.locator)) {
      throw new Error(`Duplicate content-state leaf locator: ${leaf.locator}`);
    }
    seen.add(leaf.locator);
  }

  const assembled = assembleContentStateMerkle(leaves, digestUtf8);

  const nodes: GraphContentStateNode[] = [];
  for (const locator of [...assembled.directories.keys()]
    .filter((entry) => entry.length > 0)
    .sort((left, right) => left.localeCompare(right))) {
    const directory = assembled.directories.get(locator)!;
    nodes.push(
      Object.freeze({
        kind: 'directory',
        locator,
        digest: directory.digest,
        children: directory.children,
      }) satisfies GraphContentStateDirectory
    );
  }
  for (const leaf of leaves) {
    nodes.push(
      Object.freeze({
        kind: 'file',
        locator: leaf.locator,
        contentDigest: leaf.contentDigest,
        inputKind: leaf.inputKind,
        scanProfileDigest: leaf.scanProfileDigest,
        ...(leaf.observations ? { observations: Object.freeze(leaf.observations) } : {}),
      }) satisfies GraphContentStateLeaf
    );
  }

  return Object.freeze({
    contract: GRAPH_CONTENT_STATE_MANIFEST_CONTRACT,
    scope: request.scope,
    merkleRoot: assembled.merkleRoot,
    nodes: Object.freeze(nodes),
    shardDependencies: Object.freeze(request.shardDependencies ?? []),
    generatedAt: request.generatedAt,
  });
}
