import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readImportedProjectsRegistry,
  upsertImportedProjectsRegistry,
} from '../imported-projects-registry.js';

let workspacePath: string | null = null;

afterEach(async () => {
  if (workspacePath) await fsExtra.remove(workspacePath);
  workspacePath = null;
});

describe('imported-projects registry concurrency', () => {
  it('preserves every entry across concurrent read-modify-write operations', async () => {
    workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-registry-race-'));
    const entries = Array.from({ length: 32 }, (_, index) => ({
      name: `service-${String(index).padStart(2, '0')}`,
      path: path.join(workspacePath as string, `service-${index}`),
      stack: 'unknown' as const,
      confidence: 'medium' as const,
      importedAt: new Date(1_700_000_000_000 + index).toISOString(),
    }));

    await Promise.all(
      entries.map((entry) => upsertImportedProjectsRegistry(workspacePath as string, [entry]))
    );

    const registry = await readImportedProjectsRegistry(workspacePath);
    expect(registry.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
  });
});
