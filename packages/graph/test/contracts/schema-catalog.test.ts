import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';

import type {
  GraphEntityReference,
  GraphProviderManifest,
  WorkspaiGraphEntityIdentityCandidate,
  WorkspaiGraphProviderManifestCandidate,
} from '../../src/contracts/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, 'conformance/contract-catalog.v1.json'), 'utf8')
) as {
  contracts: Array<{ id: string; file: string; sha256: string }>;
};
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: false,
});

describe('Graph G1 schema catalog', () => {
  it('keeps generated wire types assignable to semantic contract boundaries', () => {
    expectTypeOf<WorkspaiGraphEntityIdentityCandidate>().toMatchTypeOf<GraphEntityReference>();
    expectTypeOf<WorkspaiGraphProviderManifestCandidate>().toMatchTypeOf<GraphProviderManifest>();
  });
  it('content-addresses unique, compiling schemas that reject an empty payload', () => {
    expect(new Set(catalog.contracts.map((entry) => entry.id)).size).toBe(catalog.contracts.length);
    for (const entry of catalog.contracts) {
      const bytes = fs.readFileSync(path.join(root, entry.file));
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      const validate = ajv.compile(JSON.parse(bytes.toString('utf8')));
      expect(validate({}), entry.id).toBe(false);
    }
  });

  it('accepts portable fixtures and rejects a machine-local entity identity', () => {
    const entitySchema = JSON.parse(
      fs.readFileSync(
        path.join(root, 'schemas/entity-identity.v0.1.0-candidate.schema.json'),
        'utf8'
      )
    );
    const providerSchema = JSON.parse(
      fs.readFileSync(
        path.join(root, 'schemas/provider-manifest.v0.1.0-candidate.schema.json'),
        'utf8'
      )
    );
    const fixture = (name: string) =>
      JSON.parse(fs.readFileSync(path.join(root, 'fixtures/g1', name), 'utf8'));
    const validateEntity =
      ajv.getSchema(entitySchema.$id) ?? new Ajv2020({ strict: true }).compile(entitySchema);
    const validateProvider =
      ajv.getSchema(providerSchema.$id) ?? new Ajv2020({ strict: true }).compile(providerSchema);
    expect(validateEntity(fixture('minimal-entity.json'))).toBe(true);
    expect(validateProvider(fixture('minimal-provider-manifest.json'))).toBe(true);
    expect(validateEntity(fixture('invalid-absolute-entity.json'))).toBe(false);
  });

  it('schema-validates both minimal and maximal provider output fixtures', () => {
    const fixture = (name: string) =>
      JSON.parse(fs.readFileSync(path.join(root, 'fixtures/g1', name), 'utf8'));
    const schema = (name: string) =>
      JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8'));
    const manifestSchema = schema('provider-manifest.v0.1.0-candidate.schema.json');
    const batchSchema = schema('fact-batch.v0.1.0-candidate.schema.json');
    const validateManifest = new Ajv2020({
      strict: true,
      strictRequired: false,
      validateFormats: false,
    }).compile(manifestSchema);
    const validateBatch = new Ajv2020({
      strict: true,
      strictRequired: false,
      validateFormats: false,
    }).compile(batchSchema);
    expect(validateManifest(fixture('minimal-provider-manifest.json'))).toBe(true);
    expect(validateManifest(fixture('maximal-provider-manifest.json'))).toBe(true);
    expect(validateBatch(fixture('minimal-fact-batch.json'))).toBe(true);
    expect(validateBatch(fixture('maximal-fact-batch.json'))).toBe(true);
  });
});
