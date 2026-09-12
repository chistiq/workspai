import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildScaleEnvelope,
  toPreviousScaleEnvelope,
  type ScaleWorkloadConfiguration,
} from '../../scripts/lib/scale-workloads.mjs';
import { negotiateWisCoreResultEnvelope } from '../../src/compatibility/index.js';
import {
  MAX_WIS_VALIDATION_LIMITS,
  validateWisCoreResultEnvelope,
} from '../../src/validation/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'fixtures/scale/workload-manifest.v1.json'), 'utf8')
) as {
  schemaVersion: string;
  workloads: Array<
    ScaleWorkloadConfiguration & {
      maxSerializedBytes: number;
      p95BudgetMs: number;
      p99BudgetMs: number;
      iterations: number;
      warmups: number;
      limits?: Partial<typeof MAX_WIS_VALIDATION_LIMITS>;
    }
  >;
};
const baseline = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'governance/sh3c-scale-baseline.v1.json'), 'utf8')
) as {
  status: string;
  workloads: Array<{
    id: string;
    serializedBytes: number;
    p95Ms: number;
    p99Ms: number;
    observedHeapAmplification?: number;
  }>;
  limitations: Array<{ id: string; status: string }>;
};

describe('@workspai/shared deterministic scale workload contract', () => {
  it('declares unique bounded small, normal, large and browser proxy workloads', () => {
    expect(manifest.schemaVersion).toBe('workspai-shared-scale-workloads.v1');
    expect(manifest.workloads.map((workload) => workload.id)).toEqual([
      'small',
      'normal',
      'large-node',
      'browser-safe-proxy',
    ]);
    for (const workload of manifest.workloads) {
      expect(workload.evidenceCount).toBeGreaterThan(0);
      expect(workload.evidenceCount).toBeLessThanOrEqual(10_000);
      expect(workload.locatorLength).toBeLessThanOrEqual(4096);
      expect(workload.iterations).toBeGreaterThan(0);
      expect(workload.warmups).toBeGreaterThanOrEqual(0);
      expect(workload.p95BudgetMs).toBeLessThanOrEqual(workload.p99BudgetMs);
    }
  });

  it('generates byte-identical portable envelopes from the same workload', () => {
    const workload = manifest.workloads[0];
    const first = buildScaleEnvelope(workload);
    const second = buildScaleEnvelope(workload);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(
      workload.maxSerializedBytes
    );
    expect(validateWisCoreResultEnvelope(first)).toMatchObject({ valid: true });
  });

  it('generates a supported previous workload that migrates to current', () => {
    const current = buildScaleEnvelope(manifest.workloads[0]);
    expect(negotiateWisCoreResultEnvelope(toPreviousScaleEnvelope(current))).toMatchObject({
      compatible: true,
      status: 'migrated',
    });
  });

  it('publishes immutable hard ceilings matching the scale boundary', () => {
    expect(MAX_WIS_VALIDATION_LIMITS).toEqual({
      maxDepth: 64,
      maxNodes: 100_000,
      maxStringLength: 16 * 1024 * 1024,
      maxTotalStringLength: 16 * 1024 * 1024,
      maxDiagnostics: 1_000,
    });
    expect(Object.isFrozen(MAX_WIS_VALIDATION_LIMITS)).toBe(true);
  });

  it('binds the local baseline to workload budgets without hiding remote limitations', () => {
    expect(baseline.status).toBe('local-passed-remote-evidence-pending');
    for (const result of baseline.workloads) {
      const workload = manifest.workloads.find((candidate) => candidate.id === result.id);
      expect(workload, result.id).toBeDefined();
      expect(result.serializedBytes).toBeLessThanOrEqual(workload?.maxSerializedBytes ?? 0);
      expect(result.p95Ms).toBeLessThanOrEqual(workload?.p95BudgetMs ?? 0);
      expect(result.p99Ms).toBeLessThanOrEqual(workload?.p99BudgetMs ?? 0);
      if (result.observedHeapAmplification !== undefined) {
        expect(result.observedHeapAmplification).toBeLessThanOrEqual(8);
      }
    }
    expect(baseline.limitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'real-browser-device-timing', status: 'pending-remote' }),
        expect.objectContaining({ id: 'true-peak-rss-profiling', status: 'pending-remote' }),
        expect.objectContaining({
          id: 'alternative-validator-adapter',
          status: 'explicitly-deferred',
        }),
      ])
    );
  });
});
