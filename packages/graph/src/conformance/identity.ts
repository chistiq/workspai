import {
  GRAPH_IDENTITY_SCHEME,
  type GraphEntityIdentityInput,
  type GraphEntityIdentityNormalization,
  type GraphValidationResult,
} from '../contracts/index.js';
import { GRAPH_LOCATOR_IDENTITY } from './locator-identity-api.js';
import { graphLocatorSurvivesIdentityRendering } from '../domain/locator-identity.js';
import type { GraphDigestPort } from '../ports/index.js';

const TOKEN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const WINDOWS_DRIVE = /^[A-Za-z]:/u;

export function normalizeGraphEntityIdentity(
  input: GraphEntityIdentityInput
): GraphValidationResult<GraphEntityIdentityNormalization> {
  const namespace = input.namespace.normalize('NFC').toLowerCase();
  const kind = input.kind.normalize('NFC').toLowerCase();
  const classified = GRAPH_LOCATOR_IDENTITY.classify(input.relativeLocator, kind);
  if (classified.class === 'unsafe') {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_ENTITY_IDENTITY_INPUT_INVALID',
          path: '/relativeLocator',
          message:
            'Entity identity requires a portable repository-relative locator, an opaque declared locator, and a bounded namespace.',
        },
      ],
    };
  }
  let locator = classified.locator;
  if (input.caseSensitivity === 'insensitive' && classified.class === 'portable') {
    locator = locator.toLocaleLowerCase('en-US');
  }
  if (
    !TOKEN.test(namespace) ||
    !TOKEN.test(kind) ||
    locator.length === 0 ||
    locator.length > 4096 ||
    locator.includes('\0') ||
    (classified.class === 'portable' &&
      (locator.startsWith('/') ||
        WINDOWS_DRIVE.test(locator) ||
        locator.split('/').some((segment) => segment === '..' || segment.length === 0))) ||
    !graphLocatorSurvivesIdentityRendering(locator, kind)
  ) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_ENTITY_IDENTITY_INPUT_INVALID',
          path: '/relativeLocator',
          message:
            'Entity identity requires a portable repository-relative locator, an opaque declared locator, and a bounded namespace.',
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
function identityCacheKey(input: GraphEntityIdentityInput): string {
  return `${input.namespace}\u0000${input.kind}\u0000${input.relativeLocator}\u0000${input.caseSensitivity}\u0000${JSON.stringify(input.scope)}`;
}

export function createMemoizedIdentityResolver(
  digestPort: GraphDigestPort
): (
  input: GraphEntityIdentityInput
) => Promise<GraphValidationResult<GraphEntityIdentityNormalization>> {
  const cache = new Map<string, Promise<GraphValidationResult<GraphEntityIdentityNormalization>>>();
  return (input) => {
    const key = identityCacheKey(input);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = resolveGraphEntityIdentity(input, digestPort);
    cache.set(key, pending);
    return pending;
  };
}

async function sha256Hex(digestPort: GraphDigestPort, bytes: Uint8Array): Promise<string> {
  return digestPort.digestSync ? digestPort.digestSync(bytes) : digestPort.digest(bytes);
}

export async function resolveGraphEntityIdentity(
  input: GraphEntityIdentityInput,
  digestPort: GraphDigestPort
): Promise<GraphValidationResult<GraphEntityIdentityNormalization>> {
  const normalized = normalizeGraphEntityIdentity(input);
  if (!normalized.accepted) return normalized;
  const namespace = input.namespace.normalize('NFC').toLowerCase();
  const kind = input.kind.normalize('NFC').toLowerCase();
  const digest = await sha256Hex(
    digestPort,
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
