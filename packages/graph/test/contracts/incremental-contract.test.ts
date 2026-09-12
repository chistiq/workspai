import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  GRAPH_CHANGE_SET_CONTRACT,
  GRAPH_CONTENT_STATE_MANIFEST_CONTRACT,
  GRAPH_DELTA_CONTRACT,
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

describe('G6 incremental contracts', () => {
  it('admits the minimal ChangeSet fixture against its schema and contract id', () => {
    const { schema, validate } = compileSchema('changeset.v0.1.0-candidate.schema.json');
    const fixture = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g6/minimal-changeset.json'), 'utf8')
    );

    expect(schema.properties.contract.const).toEqual(GRAPH_CHANGE_SET_CONTRACT);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(fixture.inputs[0].kind).toBe('edited');
  });

  it('admits the minimal GraphDelta fixture with explicit execution accounting', () => {
    const { schema, validate } = compileSchema('graph-delta.v0.1.0-candidate.schema.json');
    const fixture = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g6/minimal-graph-delta.json'), 'utf8')
    );

    expect(schema.properties.contract.const).toEqual(GRAPH_DELTA_CONTRACT);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(fixture.equivalence).toBe('not-assessed');
    expect(fixture.execution.recomputed).toBe(1);
  });

  it('admits the minimal ContentStateManifest fixture with shard dependencies', () => {
    const { schema, validate } = compileSchema(
      'content-state-manifest.v0.1.0-candidate.schema.json'
    );
    const fixture = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g6/minimal-content-state-manifest.json'), 'utf8')
    );

    expect(schema.properties.contract.const).toEqual(GRAPH_CONTENT_STATE_MANIFEST_CONTRACT);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(fixture.nodes.some((node: { kind: string }) => node.kind === 'file')).toBe(true);
    expect(fixture.shardDependencies).toHaveLength(1);
  });
});
