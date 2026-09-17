import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Graph G8 stage audit', () => {
  it('authorizes only the implemented prepared-context shadow bridge', () => {
    const result = spawnSync(process.execPath, ['scripts/check-g8-stage.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'G8',
      status: 'in-progress',
      authorizedRuntimeMode: 'g8-shadow-comparison-only',
      currentGraphAuthority: 'official-internal-graph-capability',
      failures: [],
    });
  });
});
