import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('native composition measurement harness', () => {
  it('rejects mismatched digests, load, and fallback before any admission', () => {
    const output = execFileSync(
      'node',
      ['scripts/measure-native-composition.mjs', '--check-harness'],
      {
        cwd: packageRoot,
        encoding: 'utf8',
      }
    );
    expect(JSON.parse(output)).toMatchObject({ check: 'pass', orders: 2 });
  });

  it('keeps a fresh-process campaign unadmitted', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'workspai-graph-measure-'));
    writeFileSync(path.join(root, 'src.ts'), 'export const value = 1;\n');
    try {
      const output = execFileSync(
        'node',
        ['scripts/measure-native-composition.mjs', '--execute', '--root', root, '--orders', '1'],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          timeout: 180_000,
        }
      );
      const report = JSON.parse(output) as {
        admitted: boolean;
        qualified: boolean;
        samples: { mode: string; materialized: boolean; factDigest: string }[];
        summary: { admitted: boolean; qualified: boolean };
      };
      expect(report.admitted).toBe(false);
      expect(report.qualified).toBe(false);
      expect(report.summary.admitted).toBe(false);
      expect(report.summary.qualified).toBe(false);
      expect(report.samples).toHaveLength(4);
      expect(
        report.samples
          .filter((sample) => sample.mode === 'rust')
          .every((sample) => sample.materialized === false)
      ).toBe(true);
      expect(new Set(report.samples.map((sample) => sample.factDigest)).size).toBe(1);
      expect(output).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
