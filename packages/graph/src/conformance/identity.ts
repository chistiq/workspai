import {
  GRAPH_IDENTITY_SCHEME,
  type GraphEntityIdentityInput,
  type GraphEntityIdentityNormalization,
  type GraphValidationResult,
} from '../contracts/index.js';

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
