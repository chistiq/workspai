import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GRAPH_GENERATED_ARTIFACT_LAW } from '../../src/contracts/semantic-parity.js';
import {
  classifyGeneratedArtifactLocator,
  isGeneratedArtifactLocator,
} from '../../src/domain/generated-artifact.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('generated-artifact policy', () => {
  it('uses include, exclude, or bounded-unknown and defaults to bounded-unknown', () => {
    expect([...GRAPH_GENERATED_ARTIFACT_LAW.treatments]).toEqual([
      'include',
      'exclude',
      'bounded-unknown',
    ]);
    expect(GRAPH_GENERATED_ARTIFACT_LAW.defaultTreatment).toBe('bounded-unknown');
    expect([...GRAPH_GENERATED_ARTIFACT_LAW.omissionClasses]).toEqual(['generated', 'vendored']);
  });

  it('classifies only generated and vendored locators as generated artifacts', () => {
    expect(classifyGeneratedArtifactLocator('src/catalog.ts')).toEqual({
      class: 'source',
      treatment: 'include',
    });
    expect(classifyGeneratedArtifactLocator('dist/out.js')).toEqual({
      class: 'source',
      treatment: 'include',
    });
    expect(classifyGeneratedArtifactLocator('src/bin/main.rs')).toEqual({
      class: 'source',
      treatment: 'include',
    });
    expect(classifyGeneratedArtifactLocator('node_modules/left-pad/index.js')).toEqual({
      class: 'generated-artifact',
      omissionClass: 'vendored',
      treatment: 'bounded-unknown',
    });
    expect(classifyGeneratedArtifactLocator('.cache/tmp.json')).toEqual({
      class: 'source',
      treatment: 'include',
    });
    expect(isGeneratedArtifactLocator('vendor/lib.c')).toBe(false);
    expect(isGeneratedArtifactLocator('tmp/scratch.ts')).toBe(false);
    expect(isGeneratedArtifactLocator('.github/workflows/ci.yml')).toBe(false);
  });

  it('does not special-case a product directory name or a repository path', () => {
    const source = fs.readFileSync(
      path.join(packageRoot, 'src/domain/generated-artifact.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/workspai/iu);
    expect(source).not.toMatch(/grpc|pnpm|opentelemetry/iu);
    expect(classifyGeneratedArtifactLocator('.workspai/graph.json').class).toBe('source');
    expect(classifyGeneratedArtifactLocator('.github/workflows/ci.yml').class).toBe('source');
  });
});
