import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');
}

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(read(relativePath)) as Record<string, unknown>;
}

describe('@workspai/shared documentation alignment', () => {
  it('does not claim maturity beyond the machine-readable gate registry', () => {
    const gates = readJson('governance/shared-package-gates.v1.json') as {
      currentGate?: string;
      activeWorkstream?: string;
      publishable?: boolean;
      blockers?: string[];
    };
    const readme = read('README.md');

    expect(gates).toMatchObject({
      currentGate: 'SH0',
      activeWorkstream: 'SH7-blocked-admission-evidence',
      publishable: false,
    });
    expect(readme).toContain('not publishable');
    expect(readme).toContain('documentation portfolio');
    expect(gates.blockers).not.toContain(
      'schema-to-type-to-validator generation is not implemented'
    );
  });

  it('keeps documented exports and release gates tied to executable metadata', () => {
    const manifest = readJson('package.json') as {
      exports?: Record<string, unknown>;
      scripts?: Record<string, string>;
    };
    const generation = readJson('schemas/generation-manifest.v2.json') as {
      contracts?: unknown[];
      sharedOutputs?: { vocabulary?: string };
    };
    expect(Object.keys(manifest.exports ?? {})).toEqual([
      '.',
      './contracts',
      './compatibility',
      './validation',
      './registry',
      './browser',
      './node',
    ]);
    expect(manifest.scripts?.['runtime:check']).toBe('node scripts/check-runtime-surfaces.mjs');
    expect(manifest.scripts?.['pack:check']).toBe('node scripts/check-packed-package.mjs');
    expect(generation.contracts).toHaveLength(3);
    expect(generation.sharedOutputs?.vocabulary).toBe('src/generated/vocabulary.ts');
  });
});
