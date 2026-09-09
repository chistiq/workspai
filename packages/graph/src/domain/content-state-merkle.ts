import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphContentStateDirectoryChild,
  GraphContentStateNodeKind,
} from '../contracts/index.js';

export interface GraphContentStateMerkleLeaf {
  readonly locator: string;
  readonly contentDigest: WisDigestReference;
}

export interface GraphContentStateMerkleDirectory {
  readonly digest: WisDigestReference;
  readonly children: readonly GraphContentStateDirectoryChild[];
}

export interface GraphContentStateMerkleAssembly {
  readonly merkleRoot: WisDigestReference;
  readonly directories: ReadonlyMap<string, GraphContentStateMerkleDirectory>;
}

/**
 * Canonical material for a directory digest per ADR-0014: canonically ordered
 * child name/kind/digest tuples without machine-local path semantics.
 */
export function canonicalDirectoryMaterial(
  children: readonly GraphContentStateDirectoryChild[]
): string {
  return [...children]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (child) =>
        `${child.name}\u0000${child.kind}\u0000${child.digest.algorithm}\u0000${child.digest.value}`
    )
    .join('\u0000');
}

export function directoryChild(
  name: string,
  kind: GraphContentStateNodeKind,
  digest: WisDigestReference
): GraphContentStateDirectoryChild {
  return Object.freeze({ name, kind, digest });
}

export function assertPortableLocator(locator: string): void {
  if (
    typeof locator !== 'string' ||
    locator.length === 0 ||
    locator.startsWith('/') ||
    locator.includes('\\') ||
    locator.split('/').includes('..')
  ) {
    throw new Error(`Content-state locator is not portable: ${String(locator)}`);
  }
}

export function parentLocator(locator: string): string {
  const index = locator.lastIndexOf('/');
  return index === -1 ? '' : locator.slice(0, index);
}

export function baseName(locator: string): string {
  const index = locator.lastIndexOf('/');
  return index === -1 ? locator : locator.slice(index + 1);
}

/** True when locator is the directory itself or a path-boundary descendant. */
export function isUnderDirectory(locator: string, directory: string): boolean {
  if (directory.length === 0) {
    return true;
  }
  return locator === directory || locator.startsWith(`${directory}/`);
}

function collectDirectoryLocators(leaves: readonly GraphContentStateMerkleLeaf[]): string[] {
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
  leaves: readonly GraphContentStateMerkleLeaf[],
  directoryDigests: Map<string, WisDigestReference>
): GraphContentStateDirectoryChild[] {
  const prefix = directory.length === 0 ? '' : `${directory}/`;
  const childDirs = new Set<string>();
  const childFiles = new Map<string, GraphContentStateMerkleLeaf>();

  for (const leaf of leaves) {
    if (!isUnderDirectory(leaf.locator, directory) || leaf.locator === directory) {
      continue;
    }
    const relative = directory.length === 0 ? leaf.locator : leaf.locator.slice(prefix.length);
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
 * Assembles directory digests and the project/workspace Merkle root from file
 * leaves. Callers supply the digest function so conformance never imports
 * application hashing.
 */
export function assembleContentStateMerkle(
  leaves: readonly GraphContentStateMerkleLeaf[],
  digestUtf8: (material: string) => WisDigestReference
): GraphContentStateMerkleAssembly {
  const directoryDigests = new Map<string, WisDigestReference>();
  const directories = new Map<string, GraphContentStateMerkleDirectory>();

  for (const directory of collectDirectoryLocators(leaves)) {
    const children = Object.freeze(directoryChildren(directory, leaves, directoryDigests));
    const digest = digestUtf8(canonicalDirectoryMaterial(children));
    directoryDigests.set(directory, digest);
    directories.set(
      directory,
      Object.freeze({
        digest,
        children,
      })
    );
  }

  return Object.freeze({
    merkleRoot: directoryDigests.get('') ?? digestUtf8(canonicalDirectoryMaterial([])),
    directories,
  });
}
