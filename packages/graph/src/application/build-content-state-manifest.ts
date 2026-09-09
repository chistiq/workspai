import { createHash } from 'node:crypto';

import type { WisDigestReference } from '@workspai/shared/contracts';

import {
  GRAPH_CONTENT_STATE_MANIFEST_CONTRACT,
  type GraphContentStateDirectory,
  type GraphContentStateDirectoryChild,
  type GraphContentStateLeaf,
  type GraphContentStateManifest,
  type GraphContentStateNode,
} from '../contracts/index.js';
import {
  assertPortableLocator,
  canonicalDirectoryMaterial,
  directoryChild,
  parentLocator,
} from '../domain/content-state-merkle.js';

import type {
  GraphContentStateLeafInput,
  GraphContentStateManifestBuildRequest,
} from './content-state-manifest-types.js';

function digestMaterial(material: string): WisDigestReference {
  return Object.freeze({
    algorithm: 'sha256',
    value: createHash('sha256').update(material, 'utf8').digest('hex'),
  });
}

function digestDirectoryChildren(
  children: readonly GraphContentStateDirectoryChild[]
): WisDigestReference {
  return digestMaterial(canonicalDirectoryMaterial(children));
}

function collectDirectoryLocators(leaves: readonly GraphContentStateLeafInput[]): string[] {
  const directories = new Set<string>(['']);
  for (const leaf of leaves) {
    assertPortableLocator(leaf.locator);
    let current = parentLocator(leaf.locator);
    while (true) {
      directories.add(current);
      if (current.length === 0) {
        break;
      }
      current = parentLocator(current);
    }
  }
  return [...directories].sort((left, right) => right.length - left.length);
}

function directoryChildren(
  directory: string,
  leaves: readonly GraphContentStateLeafInput[],
  directoryDigests: Map<string, WisDigestReference>
): GraphContentStateDirectoryChild[] {
  const prefix = directory.length === 0 ? '' : `${directory}/`;
  const childDirs = new Set<string>();
  const childFiles = new Map<string, GraphContentStateLeafInput>();

  for (const leaf of leaves) {
    const relative = directory.length === 0 ? leaf.locator : leaf.locator.slice(prefix.length);
    if (directory.length > 0 && !leaf.locator.startsWith(prefix)) {
      continue;
    }
    if (relative.length === 0) {
      continue;
    }
    const [segment, ...rest] = relative.split('/');
    if (!segment) {
      continue;
    }
    if (rest.length === 0) {
      childFiles.set(segment, leaf);
      continue;
    }
    childDirs.add(segment);
  }

  const children: GraphContentStateDirectoryChild[] = [];
  for (const name of [...childDirs].sort()) {
    const locator = directory.length === 0 ? name : `${directory}/${name}`;
    const digest = directoryDigests.get(locator);
    if (!digest) {
      throw new Error(`Missing directory digest for ${locator}`);
    }
    children.push(directoryChild(name, 'directory', digest));
  }
  for (const [name, leaf] of [...childFiles.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    children.push(directoryChild(name, 'file', leaf.contentDigest));
  }
  return children;
}

/**
 * Builds a portable content-state manifest with derived directory digests and a
 * project/workspace Merkle root from admitted file leaves.
 */
export function buildContentStateManifest(
  request: GraphContentStateManifestBuildRequest
): GraphContentStateManifest {
  const leaves = [...request.leaves].sort((left, right) =>
    left.locator.localeCompare(right.locator)
  );
  const seen = new Set<string>();
  for (const leaf of leaves) {
    if (seen.has(leaf.locator)) {
      throw new Error(`Duplicate content-state leaf locator: ${leaf.locator}`);
    }
    seen.add(leaf.locator);
  }

  const directoryDigests = new Map<string, WisDigestReference>();
  for (const directory of collectDirectoryLocators(leaves)) {
    directoryDigests.set(
      directory,
      digestDirectoryChildren(directoryChildren(directory, leaves, directoryDigests))
    );
  }

  const nodes: GraphContentStateNode[] = [];
  for (const directory of [...directoryDigests.keys()]
    .filter((entry) => entry.length > 0)
    .sort((left, right) => left.localeCompare(right))) {
    nodes.push(
      Object.freeze({
        kind: 'directory',
        locator: directory,
        digest: directoryDigests.get(directory)!,
        children: Object.freeze(directoryChildren(directory, leaves, directoryDigests)),
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
    merkleRoot: directoryDigests.get('') ?? digestDirectoryChildren([]),
    nodes: Object.freeze(nodes),
    shardDependencies: Object.freeze(request.shardDependencies ?? []),
    generatedAt: request.generatedAt,
  });
}
