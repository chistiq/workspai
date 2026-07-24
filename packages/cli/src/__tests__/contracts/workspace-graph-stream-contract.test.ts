import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const contractsDir = path.resolve(process.cwd(), 'contracts/workspace-intelligence');

function readSchema(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(contractsDir, name), 'utf8')) as Record<
    string,
    unknown
  >;
}

function hash(value: string): string {
  return value.repeat(64).slice(0, 64);
}

function envelope(type: string, payload: Record<string, unknown>) {
  return {
    schemaVersion: 'workspace-graph-stream.v1',
    type,
    workspaceId: 'workspace:fixture',
    sessionId: 'session-1',
    generation: 1,
    revision: 4,
    modelHash: hash('a'),
    graphHash: hash('b'),
    generatedAt: '2026-07-22T00:00:00.000Z',
    causationId: 'cause-1',
    correlationId: 'correlation-1',
    payload,
  };
}

describe('workspace-graph-stream.v1 contract', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(readSchema('workspace-dependency-graph.v1.json'));
  ajv.addSchema(readSchema('workspace-knowledge-graph.v1.json'));
  const validate = ajv.compile(readSchema('workspace-graph-stream.v1.json'));

  it('accepts an atomic empty delta with explicit revision continuity', () => {
    const event = {
      ...envelope('graph.delta', {
        entitiesAdded: [],
        entitiesUpdated: [],
        entitiesRemoved: [],
        relationsAdded: [],
        relationsUpdated: [],
        relationsRemoved: [],
        proofsAdded: [],
        proofsUpdated: [],
        proofsRemoved: [],
        providersUpdated: [],
        quality: null,
        diagnostics: [],
      }),
      baseRevision: 3,
      baseModelHash: hash('c'),
      baseGraphHash: hash('d'),
    };

    expect(validate(event), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects deltas without a base revision', () => {
    const event = envelope('graph.delta', {
      entitiesAdded: [],
      entitiesUpdated: [],
      entitiesRemoved: [],
      relationsAdded: [],
      relationsUpdated: [],
      relationsRemoved: [],
      proofsAdded: [],
      proofsUpdated: [],
      proofsRemoved: [],
      providersUpdated: [],
      diagnostics: [],
    });

    expect(validate(event)).toBe(false);
    expect(validate.errors?.some((error) => error.keyword === 'required')).toBe(true);
  });

  it('accepts a deterministic resync request and rejects unknown reasons', () => {
    const valid = envelope('graph.resync-required', {
      reason: 'revision-gap',
      expectedRevision: 8,
      receivedBaseRevision: 6,
    });
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);

    const invalid = envelope('graph.resync-required', { reason: 'guess-and-continue' });
    expect(validate(invalid)).toBe(false);
  });
});
