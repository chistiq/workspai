/**
 * Binds a shard id `shard:<stage>:<locator>` to the longest matching portable
 * file locator. Digest-only membership is insufficient because distinct files
 * may share a content digest.
 */
export function shardMembershipLocator(
  shardId: string,
  locators: Iterable<string>
): string | undefined {
  if (!shardId.startsWith('shard:')) {
    return undefined;
  }
  let best: string | undefined;
  for (const locator of locators) {
    if (locator.length === 0) {
      continue;
    }
    const suffix = `:${locator}`;
    if (!shardId.endsWith(suffix)) {
      continue;
    }
    const prefix = shardId.slice(0, -suffix.length);
    if (prefix === 'shard' || !prefix.startsWith('shard:')) {
      continue;
    }
    if (!best || locator.length > best.length) {
      best = locator;
    }
  }
  return best;
}
