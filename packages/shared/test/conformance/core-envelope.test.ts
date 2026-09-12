import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WIS_GENERATED_CONTRACT_REGISTRY, validateWisCoreResultEnvelope } from '../../src/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = path.join(packageRoot, 'fixtures/core/v0.2.0-draft');
const manifest = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'conformance-manifest.v1.json'), 'utf8')
) as {
  cases: Array<{ file: string; valid: boolean; phase?: string; code?: string }>;
};

describe('@workspai/shared generated Core envelope', () => {
  for (const fixtureCase of manifest.cases) {
    it(`${fixtureCase.valid ? 'accepts' : 'rejects'} ${fixtureCase.file}`, () => {
      const value = JSON.parse(fs.readFileSync(path.join(fixtureRoot, fixtureCase.file), 'utf8'));
      const result = validateWisCoreResultEnvelope(value);

      expect(result.valid).toBe(fixtureCase.valid);
      if (!fixtureCase.valid && !result.valid) {
        expect(result.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ phase: fixtureCase.phase, code: fixtureCase.code }),
          ])
        );
      }
    });
  }

  it('publishes the immutable schema digest and generated validator binding', () => {
    expect(WIS_GENERATED_CONTRACT_REGISTRY.contracts).toHaveLength(3);
    expect(
      WIS_GENERATED_CONTRACT_REGISTRY.contracts.find(
        (entry) => entry.key === 'core-result-envelope'
      )
    ).toMatchObject({
      version: '0.2.0-draft',
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      validatorExport: 'validateWisCoreResultEnvelopeStructure',
    });
  });

  it('rejects cycles before structural validation', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = validateWisCoreResultEnvelope(cyclic);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics[0]).toMatchObject({
        phase: 'resource',
        code: 'WIS_RESOURCE_CYCLIC_OBJECT',
      });
    }
  });

  it('allows repeated references that JSON serialization can represent', () => {
    const sharedPayload = { reusable: true };
    const value = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'valid-pass.json'), 'utf8')
    ) as Record<string, unknown>;
    value.payload = { left: sharedPayload, right: sharedPayload };

    expect(validateWisCoreResultEnvelope(value)).toMatchObject({ valid: true });
  });

  it('rejects accessors without invoking user code', () => {
    let invoked = false;
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, 'danger', {
      enumerable: true,
      get() {
        invoked = true;
        return 'secret';
      },
    });

    const result = validateWisCoreResultEnvelope(value);
    expect(invoked).toBe(false);
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ code: 'WIS_RESOURCE_ACCESSOR_PROPERTY' })],
    });
  });

  it('caps diagnostics and reports truncation', () => {
    const value = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'valid-pass.json'), 'utf8')
    ) as {
      generation: { id: string; generatedAt: string; parents?: string[] };
      scope: unknown;
    };
    value.generation = {
      id: 'latest',
      generatedAt: '9999-99-99T99:99:99Z',
      parents: ['latest'],
    };
    value.scope = { kind: 'selection', workspaceId: 'workspace:fixture' };
    const result = validateWisCoreResultEnvelope(value, { limits: { maxDiagnostics: 2 } });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics).toHaveLength(2);
      expect(result.truncatedDiagnostics).toBeGreaterThan(0);
    }
  });

  it('rejects a successful operation that claims a failed result', () => {
    const value = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'valid-pass.json'), 'utf8')
    ) as Record<string, unknown>;
    value.status = 'failed';
    const result = validateWisCoreResultEnvelope(value);

    expect(result).toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ code: 'WIS_SEMANTIC_FAILED_RESULT_OUTCOME' })],
    });
  });

  it.each(['file:///tmp/proof', '../proof', 'safe/%2e%2e/proof', 'safe//proof'])(
    'rejects non-portable evidence locator %s',
    (relativeLocator) => {
      const value = JSON.parse(
        fs.readFileSync(path.join(fixtureRoot, 'valid-pass.json'), 'utf8')
      ) as { evidence: Array<Record<string, unknown>> };
      value.evidence = [{ id: 'evidence:fixture', sourceKind: 'source', relativeLocator }];
      expect(validateWisCoreResultEnvelope(value)).toMatchObject({
        valid: false,
        diagnostics: [expect.objectContaining({ code: 'WIS_SEMANTIC_NON_PORTABLE_LOCATOR' })],
      });
    }
  );
});
