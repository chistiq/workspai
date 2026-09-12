import { describe, expect, it } from 'vitest';

import { shardMembershipLocator } from '../../src/domain/shard-membership.js';

describe('shardMembershipLocator', () => {
  it('binds the longest matching locator and rejects digest-only suffix collisions', () => {
    expect(
      shardMembershipLocator('shard:ecmascript-imports:src/index.ts', ['src/index.ts', 'index.ts'])
    ).toBe('src/index.ts');
    expect(
      shardMembershipLocator('shard:stage:library/foo.ts', ['lib/foo.ts', 'library/foo.ts'])
    ).toBe('library/foo.ts');
    expect(shardMembershipLocator('shard:stage:library/foo.ts', ['lib/foo.ts'])).toBeUndefined();
    expect(shardMembershipLocator('not-a-shard:src/index.ts', ['src/index.ts'])).toBeUndefined();
    expect(shardMembershipLocator('shard:src/index.ts', ['src/index.ts'])).toBeUndefined();
    expect(shardMembershipLocator('shard:stage:src/index.ts', [''])).toBeUndefined();
  });
});
