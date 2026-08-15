import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertAcyclicContractGraph,
  assertUniqueContractFields,
  collectExternalReferences,
  resolveSafePackagePath,
  rewriteExternalReferences,
} from '../../scripts/lib/generation-policy.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function baseContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'catalog',
    path: 'schemas/src/wis-contract-catalog.v0.1.0-draft.schema.json',
    contractId: 'https://schemas.workspai.dev/wis/core/contract-catalog/0.1.0-draft',
    version: '0.1.0-draft',
    typeExport: 'WisContractCatalog',
    validatorExport: 'validateCatalog',
    outputStem: 'catalog',
    ...overrides,
  };
}

describe('multi-contract generator architecture failures', () => {
  it('fails closed for duplicate contract identity', () => {
    const contracts = [baseContract(), baseContract({ key: 'duplicate', outputStem: 'duplicate' })];
    expect(() => assertUniqueContractFields(contracts)).toThrow('duplicate contract contractId');
  });

  it('fails closed for an external dependency cycle', () => {
    const entries = new Map([
      [
        'https://schemas.workspai.dev/test/cycle-a',
        { dependencies: ['https://schemas.workspai.dev/test/cycle-b'] },
      ],
      [
        'https://schemas.workspai.dev/test/cycle-b',
        { dependencies: ['https://schemas.workspai.dev/test/cycle-a'] },
      ],
    ]);
    expect(() => assertAcyclicContractGraph(entries)).toThrow('contract dependency cycle');
  });

  it('resolves an explicitly declared acyclic external schema dependency offline', () => {
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, 'test/fixtures/generator/dependent.schema.json'),
        'utf8'
      )
    );
    const baseId = 'https://schemas.workspai.dev/test/base';
    expect([...collectExternalReferences(schema)]).toEqual([baseId]);

    const rewritten = rewriteExternalReferences(
      schema,
      { key: 'dependent', path: 'test/fixtures/generator/dependent.schema.json' },
      new Map([
        [
          baseId,
          { contract: { path: 'test/fixtures/generator/base.schema.json' }, dependencies: [] },
        ],
      ])
    );
    expect(rewritten.properties.base.$ref).toBe('./base.schema.json');
  });

  it('tracks and rewrites external dynamic references without treating local anchors as dependencies', () => {
    const baseId = 'https://schemas.workspai.dev/test/base';
    const schema = {
      $dynamicRef: `${baseId}#node`,
      properties: { local: { $dynamicRef: '#node' } },
    };
    expect([...collectExternalReferences(schema)]).toEqual([baseId]);
    const rewritten = rewriteExternalReferences(
      schema,
      { key: 'dependent', path: 'schemas/dependent.schema.json' },
      new Map([[baseId, { contract: { path: 'schemas/base.schema.json' }, dependencies: [] }]])
    );
    expect(rewritten.$dynamicRef).toBe('./base.schema.json#node');
    expect(rewritten.properties.local.$dynamicRef).toBe('#node');
  });

  it('rejects absolute, parent-traversing and non-portable generator paths', () => {
    expect(() => resolveSafePackagePath(packageRoot, '/tmp/outside')).toThrow(
      'must remain inside the package'
    );
    expect(() => resolveSafePackagePath(packageRoot, '../outside')).toThrow(
      'must remain inside the package'
    );
    expect(() => resolveSafePackagePath(packageRoot, 'schemas\\outside')).toThrow(
      'portable forward-slash path'
    );
  });

  it.runIf(process.platform !== 'win32')('rejects a package-internal symlink escape', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(packageRoot, 'test/path-policy-'));
    const linkPath = path.join(fixtureRoot, 'outside');
    try {
      fs.symlinkSync('/tmp', linkPath, 'dir');
      expect(() =>
        resolveSafePackagePath(packageRoot, path.relative(packageRoot, linkPath))
      ).toThrow('resolves outside the package');
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
