import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GRAPH_PROJECTIONS_AVAILABLE } from '../../src/projections/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Graph G7 documentation and export drift', () => {
  it('keeps README, help and projection availability in lockstep', () => {
    const readme = fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8');
    const cli = fs.readFileSync(path.join(packageRoot, 'src/cli.ts'), 'utf8');

    expect(GRAPH_PROJECTIONS_AVAILABLE).toBe(true);
    expect(readme).not.toMatch(/projection engine remains unavailable until G5/i);
    expect(readme).toMatch(/profile-driven projection/i);
    expect(readme).toMatch(/not publishable/i);
    expect(readme).toMatch(/standalone-stable admission is not claimed/i);
    expect(readme).toMatch(/signed\s+provenance/i);
    expect(readme).toMatch(/GRAPH_QUERY_PRESETS/);
    expect(readme).not.toMatch(/public preview, SBOM and G8/i);
    expect(readme).not.toMatch(/\bincremental\b[\s\S]{0,40}unavailable/i);
    expect(cli).toMatch(/Workspai Graph standalone executable/);
    expect(cli).toMatch(/Standalone-stable admission is not claimed/);
    expect(cli).toMatch(/Query presets: \$\{Object\.keys\(GRAPH_QUERY_PRESETS\)\.join\(', '\)\}/);
    expect(cli).not.toMatch(/from ['"]workspai['"]/);
  });
});
