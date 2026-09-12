import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphContentStateDirectoryChild,
  GraphContentStateNodeKind,
} from '../contracts/index.js';

export interface GraphContentStateMerkleLeaf {
  readonly locator: string;
  readonly contentDigest: WisDigestReference;
  readonly inputKind: string;
  readonly scanProfileDigest: WisDigestReference;
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
 * Canonical material for a file child digest: content, input kind and
 * scan-profile, without locator. Path is the tree position, not leaf identity.
 */
export function canonicalFileLeafMaterial(
  leaf: Pick<GraphContentStateMerkleLeaf, 'inputKind' | 'contentDigest' | 'scanProfileDigest'>
): string {
  return [
    leaf.inputKind,
    leaf.contentDigest.algorithm,
    leaf.contentDigest.value,
    leaf.scanProfileDigest.algorithm,
    leaf.scanProfileDigest.value,
  ].join('\u0000');
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

/** Logical content-state path: NFC so macOS NFD and Linux NFC occupy one tree slot. */
export function normalizePortableLocator(locator: string): string {
  return locator.normalize('NFC');
}

export function assertPortableLocator(locator: string): void {
  const portable = typeof locator === 'string' ? normalizePortableLocator(locator) : '';
  if (
    typeof locator !== 'string' ||
    portable.length === 0 ||
    portable.startsWith('/') ||
    portable.includes('\\') ||
    portable.split('/').includes('..')
  ) {
    throw new Error(`Content-state locator is not portable: ${String(locator)}`);
  }
}

export function parentLocator(locator: string): string {
  const portable = normalizePortableLocator(locator);
  const index = portable.lastIndexOf('/');
  return index === -1 ? '' : portable.slice(0, index);
}

export function baseName(locator: string): string {
  const portable = normalizePortableLocator(locator);
  const index = portable.lastIndexOf('/');
  return index === -1 ? portable : portable.slice(index + 1);
}

/** True when locator is the directory itself or a path-boundary descendant. */
export function isUnderDirectory(locator: string, directory: string): boolean {
  const portable = normalizePortableLocator(locator);
  const portableDirectory = normalizePortableLocator(directory);
  if (portableDirectory.length === 0) {
    return true;
  }
  return portable === portableDirectory || portable.startsWith(`${portableDirectory}/`);
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
  leaves: readonly (GraphContentStateMerkleLeaf & {
    readonly identityDigest: WisDigestReference;
  })[],
  directoryDigests: Map<string, WisDigestReference>
): GraphContentStateDirectoryChild[] {
  const prefix = directory.length === 0 ? '' : `${directory}/`;
  const childDirs = new Set<string>();
  const childFiles = new Map<
    string,
    GraphContentStateMerkleLeaf & { readonly identityDigest: WisDigestReference }
  >();

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
    children.push(directoryChild(name, 'file', leaf.identityDigest));
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
  const portableLeaves: GraphContentStateMerkleLeaf[] = [];
  const seen = new Set<string>();
  for (const leaf of leaves) {
    const locator = normalizePortableLocator(leaf.locator);
    assertPortableLocator(locator);
    if (seen.has(locator)) {
      throw new Error(`Duplicate content-state leaf locator: ${locator}`);
    }
    seen.add(locator);
    portableLeaves.push(Object.freeze({ ...leaf, locator }));
  }

  const directoryDigests = new Map<string, WisDigestReference>();
  const directories = new Map<string, GraphContentStateMerkleDirectory>();
  const identityLeaves = portableLeaves.map((leaf) =>
    Object.freeze({
      ...leaf,
      identityDigest: digestUtf8(canonicalFileLeafMaterial(leaf)),
    })
  );

  for (const directory of collectDirectoryLocators(portableLeaves)) {
    const children = Object.freeze(directoryChildren(directory, identityLeaves, directoryDigests));
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
