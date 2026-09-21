/**
 * Build-scoped process memory snapshots. Values are observational and excluded
 * from graph identity, admission, and canonical digests.
 */
export interface GraphBuildMemorySnapshot {
  readonly at: string;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly externalBytes: number;
  readonly arrayBuffersBytes: number;
}

export function snapshotGraphBuildMemory(at: string): GraphBuildMemorySnapshot {
  const usage = process.memoryUsage();
  return Object.freeze({
    at,
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
  });
}

/**
 * OS-reported process-lifetime peak RSS. This is not this-build-only and is
 * not estimated retained bytes. Node reports maxRSS in kilobytes.
 */
export function processLifetimePeakRssBytes(): number {
  try {
    return Math.max(0, process.resourceUsage().maxRSS * 1024);
  } catch {
    return 0;
  }
}
