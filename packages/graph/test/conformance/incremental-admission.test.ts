import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { GraphChangeOverlay } from '../../src/contracts/index.js';
import {
  validateGraphChangeOverlay,
  validateGraphChangeSet,
  validateGraphContentStateManifest,
  validateGraphDelta,
  validateGraphProposedChangeSet,
  validateGraphProposedGraphDelta,
} from '../../src/conformance/incremental.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readFixture<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, relativePath), 'utf8')) as T;
}

describe('incremental conformance admission', () => {
  it('admits the minimal content-state manifest fixture', () => {
    const manifest = readFixture('fixtures/g6/minimal-content-state-manifest.json');
    expect(validateGraphContentStateManifest(manifest).accepted).toBe(true);
  });

  it('admits the minimal changeset fixture', () => {
    const changeSet = readFixture('fixtures/g6/minimal-changeset.json');
    expect(validateGraphChangeSet(changeSet).accepted).toBe(true);
  });

  it('rejects proposed graph delta that claims a canonical target generation', () => {
    const delta = readFixture<Record<string, unknown>>(
      'fixtures/g6/minimal-proposed-graph-delta.json'
    );
    const rejected = validateGraphProposedGraphDelta({
      ...delta,
      targetGeneration: 'generation:canonical',
    });
    expect(rejected.accepted).toBe(false);
  });

  it('admits the minimal overlay fixture with no-latest-advancement claim', () => {
    const overlay = readFixture<GraphChangeOverlay>(
      'fixtures/g6/minimal-graph-change-overlay.json'
    );
    expect(validateGraphChangeOverlay(overlay).accepted).toBe(true);
    const proposed = validateGraphProposedChangeSet(overlay.proposedChangeSet);
    expect(proposed.accepted).toBe(true);
  });

  it('admits the minimal graph delta fixture', () => {
    const delta = readFixture('fixtures/g6/minimal-graph-delta.json');
    expect(validateGraphDelta(delta).accepted).toBe(true);
  });

  it('admits the minimal proposed graph delta fixture', () => {
    const delta = readFixture('fixtures/g6/minimal-proposed-graph-delta.json');
    expect(validateGraphProposedGraphDelta(delta).accepted).toBe(true);
  });

  it('rejects overlays that omit no-latest-advancement', () => {
    const overlay = readFixture<GraphChangeOverlay>(
      'fixtures/g6/minimal-graph-change-overlay.json'
    );
    const rejected = validateGraphChangeOverlay({
      ...overlay,
      quality: {
        ...overlay.quality,
        releaseClaims: overlay.quality.releaseClaims.filter(
          (claim) => claim !== 'no-latest-advancement'
        ),
      },
    });
    expect(rejected.accepted).toBe(false);
  });

  it('rejects malformed changesets fail-closed', () => {
    expect(validateGraphChangeSet(null).accepted).toBe(false);
    expect(validateGraphChangeSet({ contract: { id: 'wrong', version: '0' } }).accepted).toBe(
      false
    );
    expect(
      validateGraphChangeSet({
        contract: { id: 'workspai.graph.change-set', version: '0.1.0-candidate' },
        id: 'changeset:bad',
        inputs: [{ kind: 'edited', locator: 'src/index.ts' }],
        causes: [],
      }).accepted
    ).toBe(false);
  });

  it('rejects malformed proposed change sets and deltas fail-closed', () => {
    expect(validateGraphProposedChangeSet(null).accepted).toBe(false);
    expect(
      validateGraphProposedChangeSet({
        contract: { id: 'workspai.graph.proposed-change-set', version: '0.1.0-candidate' },
        id: 'proposal:bad',
        baseGeneration: '',
        inputs: [],
        causes: 'not-an-array',
        proposal: { kind: 'invalid', identity: '', digest: 'bad' },
      }).accepted
    ).toBe(false);
    expect(validateGraphProposedGraphDelta(null).accepted).toBe(false);
    expect(
      validateGraphProposedGraphDelta({
        contract: { id: 'workspai.graph.proposed-graph-delta', version: '0.1.0-candidate' },
        baseGeneration: 'generation:base',
      }).accepted
    ).toBe(false);
  });

  it('rejects malformed overlays and manifests fail-closed', () => {
    expect(validateGraphChangeOverlay(null).accepted).toBe(false);
    expect(
      validateGraphChangeOverlay({
        contract: { id: 'workspai.graph.change-overlay', version: '0.1.0-candidate' },
        id: '',
        status: 'unknown',
        generatedAt: 'not-utc',
      }).accepted
    ).toBe(false);
    expect(validateGraphContentStateManifest(null).accepted).toBe(false);
    expect(
      validateGraphContentStateManifest({
        contract: { id: 'workspai.graph.content-state-manifest', version: '0.1.0-candidate' },
        merkleRoot: { algorithm: 'sha256', value: 'bad' },
        nodes: [],
        generatedAt: '2026-09-09T20:00:00.000Z',
        scope: { kind: 'workspace', workspaceId: 'workspace:fixture' },
      }).accepted
    ).toBe(false);
  });
});
