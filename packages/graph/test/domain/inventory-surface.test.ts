import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GRAPH_INVENTORY_SURFACE_LAW } from '../../src/contracts/inventory-surface.js';
import { GRAPH_GENERATED_ARTIFACT_LAW } from '../../src/contracts/semantic-parity.js';
import {
  classifyInventoryDirectoryName,
  classifyInventorySurfaceLocator,
  classifyInventoryWalkSkip,
  inventorySurfaceExcludedDirectoryNames,
  inventorySurfaceOmissionCode,
  isPolicyExcludedFileName,
} from '../../src/domain/inventory-surface.js';
import { classifyGeneratedArtifactLocator } from '../../src/domain/generated-artifact.js';
import { excludedDirectoryOmissionCode } from '../../src/domain/inventory-omissions.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('inventory-surface policy', () => {
  it('keeps generated-artifact treatment to evidence-bound generated and vendored classes', () => {
    expect([...GRAPH_INVENTORY_SURFACE_LAW.generatedArtifactClasses]).toEqual([
      'generated',
      'declared-generated',
      'observed-generated',
      'vendored',
    ]);
    expect([...GRAPH_GENERATED_ARTIFACT_LAW.omissionClasses]).toEqual(['generated', 'vendored']);
    expect(GRAPH_INVENTORY_SURFACE_LAW.hiddenDirectoryDefault).toBe('repository-configuration');
    expect(GRAPH_INVENTORY_SURFACE_LAW.ambiguousDirectoryDefault).toBe('source');
  });

  it('classifies hidden configuration as repository-configuration, not generated', () => {
    for (const name of ['.github', '.devcontainer', '.vscode', '.cargo', '.cache']) {
      expect(classifyInventoryDirectoryName(name)).toBe('repository-configuration');
      expect(classifyGeneratedArtifactLocator(`${name}/config.json`).class).toBe('source');
    }
    expect(classifyInventorySurfaceLocator('.github/workflows/ci.yml')).toEqual({
      class: 'repository-configuration',
      segment: '.github',
    });
    expect(classifyInventorySurfaceLocator('.devcontainer\\devcontainer.json')).toEqual({
      class: 'repository-configuration',
      segment: '.devcontainer',
    });
    expect(classifyInventorySurfaceLocator('apps/web/.vscode/settings.json')).toEqual({
      class: 'repository-configuration',
      segment: '.vscode',
    });
  });

  it('does not treat ambiguous output or vendor names as generated or as walk skips', () => {
    for (const name of ['dist', 'build', 'coverage', 'target', 'bin', 'obj', 'out', 'generated']) {
      expect(classifyInventoryDirectoryName(name)).toBe('source');
      expect(classifyInventoryWalkSkip(name)).toBeUndefined();
    }
    for (const name of ['vendor', 'third_party', 'venv']) {
      expect(classifyInventoryDirectoryName(name)).toBe('source');
      expect(classifyInventoryWalkSkip(name)).toBeUndefined();
    }
    expect(classifyGeneratedArtifactLocator('dist/out.js').class).toBe('source');
    expect(classifyGeneratedArtifactLocator('src/bin/main.rs').class).toBe('source');
    expect(classifyGeneratedArtifactLocator('tools/build/script.py').class).toBe('source');
    expect(classifyGeneratedArtifactLocator('packages/target/lib.rs').class).toBe('source');
    expect(classifyGeneratedArtifactLocator('app/out/Program.cs').class).toBe('source');
    expect(classifyGeneratedArtifactLocator('vendor/lib.c').class).toBe('source');
    expect(classifyInventoryDirectoryName('node_modules')).toBe('vendored');
    expect(classifyInventoryDirectoryName('.venv')).toBe('vendored');
    expect(classifyGeneratedArtifactLocator('node_modules/left-pad/index.js').class).toBe(
      'generated-artifact'
    );
    expect(classifyGeneratedArtifactLocator('apps/web/node_modules/left-pad/index.js').class).toBe(
      'generated-artifact'
    );
  });

  it('keeps VCS metadata as a universal walk boundary and does not treat unmatched source as generated', () => {
    expect(classifyInventoryDirectoryName('.git')).toBe('vcs-metadata');
    expect(inventorySurfaceOmissionCode('.git')).toBe('graph.repository-ignored-directory');
    expect(excludedDirectoryOmissionCode('.git')).toBe('graph.repository-ignored-directory');
    expect(classifyInventoryWalkSkip('.git')?.evidenceKind).toBe('universal-vcs-metadata');
    expect(classifyInventoryDirectoryName('src')).toBe('source');
    expect(classifyGeneratedArtifactLocator('src/catalog.ts').class).toBe('source');
    expect(classifyGeneratedArtifactLocator('tmp/scratch.ts').class).toBe('source');
  });

  it('classifies mixed nested, Unicode, and Windows locators without product-path special cases', () => {
    expect(classifyInventorySurfaceLocator('apps/web/dist/out.js')).toEqual({
      class: 'source',
    });
    expect(classifyInventorySurfaceLocator('src/bin/cli.ts')).toEqual({ class: 'source' });
    expect(classifyInventorySurfaceLocator('vendor\\.github\\CODEOWNERS')).toEqual({
      class: 'repository-configuration',
      segment: '.github',
    });
    expect(
      classifyInventorySurfaceLocator(
        'docs/\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8/.github/workflows/ci.yml'
      )
    ).toEqual({
      class: 'repository-configuration',
      segment: '.github',
    });
    expect(classifyInventorySurfaceLocator('.github/workflows/ci.yml').class).not.toBe('generated');
    expect(isPolicyExcludedFileName('.env')).toBe(true);
    expect(isPolicyExcludedFileName('.env.local')).toBe(true);
    expect(classifyInventorySurfaceLocator('secrets/.env.production')).toEqual({
      class: 'policy-excluded',
      segment: '.env.production',
    });
    expect(classifyGeneratedArtifactLocator('secrets/.env.production').class).toBe('source');
    const excluded = inventorySurfaceExcludedDirectoryNames();
    expect(excluded).toContain('.git');
    expect(excluded).toContain('node_modules');
    expect(excluded).toContain('.venv');
    expect(excluded).not.toContain('dist');
    expect(excluded).not.toContain('bin');
    expect(excluded).not.toContain('build');
    expect(excluded).not.toContain('out');
    expect(excluded).not.toContain('target');
    expect(excluded).not.toContain('vendor');
    expect(excluded).not.toContain('.github');
    expect(excluded).not.toContain('.workspai');
  });

  it('does not hardcode product, repository, or fixture names into classification', () => {
    for (const relative of [
      'src/domain/inventory-surface.ts',
      'src/domain/generated-artifact.ts',
      'src/application/build-repo-graph.ts',
    ]) {
      const source = fs.readFileSync(path.join(packageRoot, relative), 'utf8');
      expect(source, relative).not.toMatch(/grpc|pnpm|opentelemetry/iu);
      expect(source, relative).not.toMatch(/['"]\.workspai['"]/u);
      expect(source, relative).not.toMatch(/['"]\.github['"]/u);
    }
  });
});
