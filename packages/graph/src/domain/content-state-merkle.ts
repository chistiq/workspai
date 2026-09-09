import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphContentStateDirectoryChild,
  GraphContentStateNodeKind,
} from '../contracts/index.js';

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
