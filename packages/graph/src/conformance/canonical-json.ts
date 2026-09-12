import { createHash } from 'node:crypto';

import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphValidationResult } from '../contracts/index.js';
import { canonicalizeGraphValue } from './canonical-value.js';

export { canonicalizeGraphValue, measureCanonicalGraphValueBytes } from './canonical-value.js';

export function digestCanonicalGraphValue(
  input: unknown
): GraphValidationResult<WisDigestReference> {
  const canonical = canonicalizeGraphValue(input);
  if (!canonical.accepted) return canonical;
  return {
    accepted: true,
    value: Object.freeze({
      algorithm: 'sha256',
      value: createHash('sha256').update(canonical.value, 'utf8').digest('hex'),
      canonicalization: 'workspai.graph.canonical-json.v1',
    }),
    issues: [],
  };
}
