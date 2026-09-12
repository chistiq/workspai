import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  GRAPH_CHANGE_OVERLAY_CONTRACT,
  GRAPH_PROPOSED_CHANGE_SET_CONTRACT,
  GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT,
} from '../../src/contracts/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function compileSchema(name: string) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8'));
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: false,
  }).compile(schema);
  return { schema, validate };
}

describe('G6 proposed-change contracts', () => {
  it('admits a minimal proposed change set fixture', () => {
    const { schema, validate } = compileSchema('proposed-change-set.v0.1.0-candidate.schema.json');
    const fixture = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g6/minimal-proposed-change-set.json'), 'utf8')
    );

    expect(schema.properties.contract.const).toEqual(GRAPH_PROPOSED_CHANGE_SET_CONTRACT);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it('admits a minimal proposed graph delta fixture', () => {
    const { schema, validate } = compileSchema('proposed-graph-delta.v0.1.0-candidate.schema.json');
    const fixture = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g6/minimal-proposed-graph-delta.json'), 'utf8')
    );

    expect(schema.properties.contract.const).toEqual(GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(fixture.targetOverlay).toBe('overlay:fixture');
    expect(fixture).not.toHaveProperty('targetGeneration');
  });

  it('admits a minimal graph change overlay fixture', () => {
    const { schema, validate } = compileSchema('graph-change-overlay.v0.1.0-candidate.schema.json');
    const fixture = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g6/minimal-graph-change-overlay.json'), 'utf8')
    );

    expect(schema.properties.contract.const).toEqual(GRAPH_CHANGE_OVERLAY_CONTRACT);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(fixture.quality.releaseClaims).toEqual(
      expect.arrayContaining(['no-merge-conflict-claim'])
    );
  });
});
