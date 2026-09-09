import {
  GRAPH_IDENTITY_SCHEME,
  type GraphEntityIdentityInput,
  type GraphEntityIdentityNormalization,
  type GraphValidationResult,
} from '../contracts/index.js';
import type { GraphDigestPort } from '../ports/index.js';

const TOKEN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export function normalizeGraphEntityIdentity(
  input: GraphEntityIdentityInput
): GraphValidationResult<GraphEntityIdentityNormalization> {
  const namespace = input.namespace.normalize('NFC').toLowerCase();
  const kind = input.kind.normalize('NFC').toLowerCase();
  let locator = input.relativeLocator.normalize('NFC').replaceAll('\\', '/');
  locator = locator.replace(/^\.\//u, '').replace(/\/{2,}/gu, '/');
  if (input.caseSensitivity === 'insensitive') locator = locator.toLocaleLowerCase('en-US');
  if (
    !TOKEN.test(namespace) ||
    !TOKEN.test(kind) ||
    locator.length === 0 ||
    locator.length > 4096 ||
    locator.startsWith('/') ||
    /^[A-Za-z]:/u.test(locator) ||
    locator.split('/').some((segment) => segment === '..' || segment.length === 0) ||
    locator.includes('\0')
  ) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_ENTITY_IDENTITY_INPUT_INVALID',
          path: '/relativeLocator',
          message:
            'Entity identity requires a portable repository-relative locator and bounded namespace.',
        },
      ],
    };
  }
  const id = `entity:${namespace}:${kind}:${encodeURIComponent(locator)}`;
  return {
    accepted: true,
    value: Object.freeze({
      normalizedLocator: locator,
      reference: Object.freeze({
        id,
        identityScheme: GRAPH_IDENTITY_SCHEME,
        kind,
        scope: input.scope,
      }),
    }),
    issues: [],
  };
}

/**
 * Resolves the canonical portable entity identity without embedding repository
 * paths in the identifier. This is the producer boundary for real repository
 * inputs; evidence retains the normalized locator separately.
 */
export async function resolveGraphEntityIdentity(
  input: GraphEntityIdentityInput,
  digestPort: GraphDigestPort
): Promise<GraphValidationResult<GraphEntityIdentityNormalization>> {
  const normalized = normalizeGraphEntityIdentity(input);
  if (!normalized.accepted) return normalized;
  const namespace = input.namespace.normalize('NFC').toLowerCase();
  const kind = input.kind.normalize('NFC').toLowerCase();
  const digest = await digestPort.digest(
    new TextEncoder().encode(`${namespace}\0${kind}\0${normalized.value.normalizedLocator}`)
  );
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_ENTITY_IDENTITY_DIGEST_INVALID',
          path: '/digest',
          message: 'Entity identity requires a lowercase SHA-256 digest.',
        },
      ],
    };
  }
  return {
    accepted: true,
    value: Object.freeze({
      normalizedLocator: normalized.value.normalizedLocator,
      reference: Object.freeze({
        ...normalized.value.reference,
        id: `entity:${namespace}:${kind}:sha256:${digest}`,
      }),
    }),
    issues: [],
  };
}
