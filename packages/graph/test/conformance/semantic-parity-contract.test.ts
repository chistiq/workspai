import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_COMPARABLE_SURFACE_CONTRACT,
  GRAPH_COMPARABLE_SURFACE_LAW,
  GRAPH_GENERATED_ARTIFACT_CONTRACT,
  GRAPH_GENERATED_ARTIFACT_LAW,
  GRAPH_INVENTORY_SURFACE_CONTRACT,
  GRAPH_INVENTORY_SURFACE_LAW,
  GRAPH_PUBLIC_EXPORT_MAP,
  GRAPH_PUBLIC_ROOT_VALUE_EXPORTS,
  GRAPH_UNKNOWN_CAUSE_CONTRACT,
  GRAPH_UNKNOWN_CAUSE_LAW,
} from '../../src/contracts/index.js';
import {
  GRAPH_COMPARABLE_SURFACE,
  GRAPH_GENERATED_ARTIFACT,
  GRAPH_INVENTORY_SURFACE,
  GRAPH_UNKNOWN_CAUSE,
} from '../../src/conformance/index.js';
import { classifyGraphUnknownCause } from '../../src/domain/unknown-cause.js';
import { classifyGeneratedArtifactLocator } from '../../src/domain/generated-artifact.js';
import { mapComparableKind } from '../../src/domain/comparable-surface.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');

describe('Graph semantic-parity public contracts', () => {
  it('versions unknown-cause, generated-artifact, and comparable-surface on public subpaths', () => {
    expect(GRAPH_UNKNOWN_CAUSE_CONTRACT).toEqual({
      id: 'workspai.graph.unknown-cause',
      version: '1',
    });
    expect(GRAPH_GENERATED_ARTIFACT_CONTRACT).toEqual({
      id: 'workspai.graph.generated-artifact',
      version: '1',
    });
    expect(GRAPH_COMPARABLE_SURFACE_CONTRACT).toEqual({
      id: 'workspai.graph.comparable-surface',
      version: '1',
    });
    expect(GRAPH_INVENTORY_SURFACE_CONTRACT).toEqual({
      id: 'workspai.graph.inventory-surface',
      version: '1',
    });
    expect(GRAPH_UNKNOWN_CAUSE.contract).toEqual(GRAPH_UNKNOWN_CAUSE_CONTRACT);
    expect(GRAPH_GENERATED_ARTIFACT.contract).toEqual(GRAPH_GENERATED_ARTIFACT_CONTRACT);
    expect(GRAPH_COMPARABLE_SURFACE.contract).toEqual(GRAPH_COMPARABLE_SURFACE_CONTRACT);
    expect(GRAPH_INVENTORY_SURFACE.contract).toEqual(GRAPH_INVENTORY_SURFACE_CONTRACT);
    expect(GRAPH_UNKNOWN_CAUSE.classify).toBe(classifyGraphUnknownCause);
    expect(GRAPH_GENERATED_ARTIFACT.classifyLocator).toBe(classifyGeneratedArtifactLocator);
    expect(GRAPH_COMPARABLE_SURFACE.mapKind).toBe(mapComparableKind);
    expect(GRAPH_UNKNOWN_CAUSE_LAW.disposition).toBe('bounded-unknown');
    expect(GRAPH_UNKNOWN_CAUSE_LAW.admissionImpact).toBe('blocking');
    expect([...GRAPH_UNKNOWN_CAUSE_LAW.classificationOrigins]).toEqual([
      'structured-producer',
      'legacy-fallback',
    ]);
    expect(GRAPH_GENERATED_ARTIFACT_LAW.defaultTreatment).toBe('bounded-unknown');
    expect(GRAPH_COMPARABLE_SURFACE_LAW.ontologyId).toBe('workspai.graph.ontology.core');
    expect(GRAPH_INVENTORY_SURFACE_LAW.hiddenDirectoryDefault).toBe('repository-configuration');
    expect(GRAPH_INVENTORY_SURFACE_LAW.ambiguousDirectoryDefault).toBe('source');
    expect([...GRAPH_PUBLIC_EXPORT_MAP.contractsValueExports]).toEqual(
      expect.arrayContaining([
        'GRAPH_UNKNOWN_CAUSE_CONTRACT',
        'GRAPH_UNKNOWN_CAUSE_LAW',
        'GRAPH_GENERATED_ARTIFACT_CONTRACT',
        'GRAPH_GENERATED_ARTIFACT_LAW',
        'GRAPH_COMPARABLE_SURFACE_CONTRACT',
        'GRAPH_COMPARABLE_SURFACE_LAW',
        'GRAPH_INVENTORY_SURFACE_CONTRACT',
        'GRAPH_INVENTORY_SURFACE_LAW',
      ])
    );
    expect([...GRAPH_PUBLIC_EXPORT_MAP.conformanceValueExports]).toEqual(
      expect.arrayContaining([
        'GRAPH_UNKNOWN_CAUSE',
        'GRAPH_GENERATED_ARTIFACT',
        'GRAPH_COMPARABLE_SURFACE',
        'GRAPH_INVENTORY_SURFACE',
      ])
    );
    for (const name of [
      'GRAPH_UNKNOWN_CAUSE',
      'GRAPH_GENERATED_ARTIFACT',
      'GRAPH_COMPARABLE_SURFACE',
      'GRAPH_INVENTORY_SURFACE',
      'GRAPH_UNKNOWN_CAUSE_CONTRACT',
      'GRAPH_GENERATED_ARTIFACT_CONTRACT',
      'GRAPH_COMPARABLE_SURFACE_CONTRACT',
      'GRAPH_INVENTORY_SURFACE_CONTRACT',
    ]) {
      expect([...GRAPH_PUBLIC_ROOT_VALUE_EXPORTS]).not.toContain(name);
    }
  });

  it('keeps CLI shadow as a consumer of the package contracts', () => {
    const cliRoot = path.join(repositoryRoot, 'packages/cli/src');
    for (const relative of [
      'graph-shadow-comparison-projection.ts',
      'graph-shadow-parity.ts',
      'graph-shadow-unknown-contract.ts',
      'graph-package-compatibility-renderer.ts',
    ]) {
      const source = fs.readFileSync(path.join(cliRoot, relative), 'utf8');
      expect(source, relative).not.toMatch(/@workspai\/graph\/domain/u);
    }
    const projection = fs.readFileSync(
      path.join(cliRoot, 'graph-shadow-comparison-projection.ts'),
      'utf8'
    );
    expect(projection).toMatch(/GRAPH_GENERATED_ARTIFACT/u);
    expect(projection).toMatch(/GRAPH_COMPARABLE_SURFACE/u);
    expect(projection).not.toMatch(/\.workspai/u);
    const unknown = fs.readFileSync(path.join(cliRoot, 'graph-shadow-unknown-contract.ts'), 'utf8');
    expect(unknown).toMatch(/GRAPH_UNKNOWN_CAUSE/u);
    expect(unknown).toMatch(/unknownCauseFromComparisonKey/u);
    const parity = fs.readFileSync(path.join(cliRoot, 'graph-shadow-parity.ts'), 'utf8');
    expect(parity).toMatch(/GRAPH_INVENTORY_SURFACE/u);
    expect(parity).toMatch(/omittedSubtreeComparisonToken/u);
    const renderer = fs.readFileSync(
      path.join(cliRoot, 'graph-package-compatibility-renderer.ts'),
      'utf8'
    );
    expect(renderer).toMatch(/must not fabricate, upgrade, or delete proof/u);
  });
});
