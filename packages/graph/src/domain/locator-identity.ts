import {
  GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES,
  MAX_GRAPH_URI_DECODE_ROUNDS,
  type GraphOpaqueDeclaredLocatorPrefix,
  type GraphRelativeLocatorClass,
} from '../contracts/foundation.js';

/**
 * Independent Graph locator identity.
 *
 * Portable locators are repository-relative paths. Declared identities that
 * cannot be paths (imports, build targets) use a single-segment opaque bucket
 * and are never URI-decoded into filesystem traversal. Percent-encoded
 * traversal that is not already opaque is unsafe and must not be admitted as a
 * portable path.
 */
export {
  GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES,
  MAX_GRAPH_URI_DECODE_ROUNDS,
  type GraphOpaqueDeclaredLocatorPrefix,
  type GraphRelativeLocatorClass,
};

export type GraphRelativeLocatorClassification =
  | { readonly class: 'portable'; readonly locator: string }
  | { readonly class: 'opaque'; readonly locator: string }
  | { readonly class: 'unsafe'; readonly locator: string };

const WINDOWS_DRIVE = /^[A-Za-z]:/u;
const OPAQUE_DECLARED_LOCATOR = new RegExp(
  `^(${GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES.join('|')})/[^/]+$`,
  'u'
);
const CONTENT_PATH_KINDS = new Set(['file', 'document']);

export function opaqueGraphDeclaredLocator(
  prefix: GraphOpaqueDeclaredLocatorPrefix,
  raw: string
): string {
  return `${prefix}/${encodeURIComponent(raw).replaceAll('.', '%2E')}`;
}

export function decodeGraphLocatorState(
  value: string,
  options?: { readonly freezeOpaqueDeclared?: boolean }
): { readonly status: 'stable' | 'unstable'; readonly value: string } {
  let current = value;
  for (let round = 0; round < MAX_GRAPH_URI_DECODE_ROUNDS; round += 1) {
    if (options?.freezeOpaqueDeclared && OPAQUE_DECLARED_LOCATOR.test(current)) {
      return { status: 'stable', value: current };
    }
    try {
      const next = decodeURIComponent(current);
      if (next === current) return { status: 'stable', value: current };
      current = next;
    } catch {
      return { status: 'stable', value: round === 0 ? value : current };
    }
  }
  if (options?.freezeOpaqueDeclared && OPAQUE_DECLARED_LOCATOR.test(current)) {
    return { status: 'stable', value: current };
  }
  try {
    const next = decodeURIComponent(current);
    if (next === current) return { status: 'stable', value: current };
    return { status: 'unstable', value };
  } catch {
    return { status: 'stable', value: current };
  }
}

export function shapeGraphRelativeLocator(value: string): string {
  return value
    .normalize('NFC')
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/');
}

function hasUnsafePathShape(locator: string): boolean {
  return (
    locator.length === 0 ||
    locator.length > 4096 ||
    locator.includes('\0') ||
    locator.startsWith('/') ||
    WINDOWS_DRIVE.test(locator) ||
    locator.split('/').some((segment) => segment === '..' || segment.length === 0)
  );
}

/**
 * Fail-closed on compatibility-folded traversal (fullwidth dots/slashes, NFKC
 * percent forms) without changing NFC identity of legal names.
 */
function hasCompatibilityTraversal(locator: string): boolean {
  const compatibility = locator
    .normalize('NFKC')
    .replaceAll('\\', '/')
    .replace(/[\u2215\u2044\uff0f\u29f8]/gu, '/');
  const decoded = decodeGraphLocatorState(compatibility, { freezeOpaqueDeclared: false });
  if (decoded.status !== 'stable') return true;
  return hasUnsafePathShape(shapeGraphRelativeLocator(decoded.value));
}

export function classifyGraphRelativeLocator(
  value: string,
  kind: string
): GraphRelativeLocatorClassification {
  const locator = shapeGraphRelativeLocator(value);
  const contentPath = CONTENT_PATH_KINDS.has(kind.normalize('NFC').toLowerCase());
  if (!contentPath && OPAQUE_DECLARED_LOCATOR.test(locator)) {
    if (locator.includes('\0') || locator.length > 4096) {
      return { class: 'unsafe', locator };
    }
    return { class: 'opaque', locator };
  }
  const decoded = decodeGraphLocatorState(locator, { freezeOpaqueDeclared: !contentPath });
  if (decoded.status !== 'stable') {
    return { class: 'unsafe', locator: value };
  }
  if (!contentPath && OPAQUE_DECLARED_LOCATOR.test(decoded.value)) {
    if (decoded.value.includes('\0') || decoded.value.length > 4096) {
      return { class: 'unsafe', locator: decoded.value };
    }
    return { class: 'opaque', locator: decoded.value };
  }
  if (
    hasUnsafePathShape(decoded.value) ||
    hasUnsafePathShape(locator) ||
    hasCompatibilityTraversal(decoded.value) ||
    hasCompatibilityTraversal(locator)
  ) {
    return { class: 'unsafe', locator: value };
  }
  return { class: 'portable', locator };
}

export function admitDeclaredGraphLocator(
  raw: string,
  prefix: GraphOpaqueDeclaredLocatorPrefix
): string {
  const classified = classifyGraphRelativeLocator(raw, 'module');
  if (classified.class === 'portable' || classified.class === 'opaque') return classified.locator;
  return opaqueGraphDeclaredLocator(prefix, raw);
}
