import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  WIS_CURRENT_CORE_VERSION,
  WIS_SUPPORTED_PREVIOUS_CORE_VERSIONS,
  negotiateWisCoreResultEnvelope,
} from '../../src/compatibility/index.js';
import { validateWisCoreResultEnvelope } from '../../src/validation/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const compatibilityRoot = path.join(packageRoot, 'fixtures/compatibility/core-result-envelope');
const currentRoot = path.join(packageRoot, 'fixtures/core/v0.2.0-draft');

function fixture(root: string, file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as Record<string, unknown>;
}

describe('@workspai/shared Core envelope compatibility boundary', () => {
  it('keeps every declared fixture synchronized with its expected classification', () => {
    const manifest = fixture(compatibilityRoot, 'conformance-manifest.v1.json') as {
      cases: Array<{
        file: string;
        expectedStatus: string;
        expectedResultStatus?: string;
        expectedCode?: string;
      }>;
    };

    for (const fixtureCase of manifest.cases) {
      const result = negotiateWisCoreResultEnvelope(fixture(compatibilityRoot, fixtureCase.file));
      expect(result.status, fixtureCase.file).toBe(fixtureCase.expectedStatus);
      if (fixtureCase.expectedResultStatus && result.compatible) {
        expect(result.value.status, fixtureCase.file).toBe(fixtureCase.expectedResultStatus);
      }
      if (fixtureCase.expectedCode && !result.compatible) {
        expect(result.diagnostics, fixtureCase.file).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: fixtureCase.expectedCode })])
        );
      }
    }
  });

  it('returns an exact current contract without migration or loss', () => {
    const current = fixture(currentRoot, 'valid-pass.json');
    const result = negotiateWisCoreResultEnvelope(current);

    expect(result).toMatchObject({
      compatible: true,
      status: 'exact',
      sourceVersion: WIS_CURRENT_CORE_VERSION,
      targetVersion: WIS_CURRENT_CORE_VERSION,
      value: current,
      migrations: [],
      losses: [],
    });
  });

  it('migrates the supported previous contract with explicit migration and loss records', () => {
    const previous = fixture(compatibilityRoot, 'previous-valid-pass.json');
    const result = negotiateWisCoreResultEnvelope(previous);

    expect(WIS_SUPPORTED_PREVIOUS_CORE_VERSIONS).toEqual(['0.1.0-draft']);
    expect(result).toMatchObject({
      compatible: true,
      status: 'migrated',
      sourceVersion: '0.1.0-draft',
      targetVersion: WIS_CURRENT_CORE_VERSION,
      value: {
        coreVersion: WIS_CURRENT_CORE_VERSION,
        operationOutcome: 'succeeded',
        status: 'pass',
        compatibility: {
          status: 'conditionally-compatible',
          migrations: ['wis.core.result-envelope.0.1-to-0.2.outcome-split'],
          losses: ['wis.core.operation-outcome.cancelled-not-representable'],
        },
      },
    });
    if (result.compatible) expect(validateWisCoreResultEnvelope(result.value).valid).toBe(true);
  });

  it('maps a legacy failed outcome to both current failure dimensions', () => {
    const previous = fixture(compatibilityRoot, 'previous-valid-pass.json');
    previous.outcome = 'failed';
    const result = negotiateWisCoreResultEnvelope(previous);

    expect(result).toMatchObject({
      compatible: true,
      status: 'migrated',
      value: { operationOutcome: 'failed', status: 'failed' },
    });
  });

  it('preserves opaque extension and payload data without aliasing or mutating the input', () => {
    const previous = fixture(compatibilityRoot, 'previous-valid-partial-with-extension.json');
    const snapshot = structuredClone(previous);
    const result = negotiateWisCoreResultEnvelope(previous);

    expect(previous).toEqual(snapshot);
    expect(result).toMatchObject({
      compatible: true,
      status: 'migrated',
      value: { payload: snapshot.payload, extensions: snapshot.extensions },
    });
    if (result.compatible) {
      expect(result.value.payload).not.toBe(previous.payload);
      expect(result.value.extensions).not.toBe(previous.extensions);
    }
  });

  it('rejects an invalid previous contract with stable compatibility diagnostics', () => {
    const invalid = fixture(compatibilityRoot, 'previous-invalid-additional-property.json');
    expect(negotiateWisCoreResultEnvelope(invalid)).toMatchObject({
      compatible: false,
      status: 'invalid',
      diagnostics: [
        expect.objectContaining({
          code: 'WIS_COMPATIBILITY_PREVIOUS_ADDITIONALPROPERTIES',
          phase: 'compatibility',
        }),
      ],
    });
  });

  it('classifies unknown versions as unsupported instead of guessing a migration', () => {
    const unsupported = fixture(compatibilityRoot, 'unsupported-version.json');
    expect(negotiateWisCoreResultEnvelope(unsupported)).toMatchObject({
      compatible: false,
      status: 'unsupported',
      sourceVersion: '9.0.0',
      diagnostics: [
        expect.objectContaining({ code: 'WIS_COMPATIBILITY_UNSUPPORTED_CORE_VERSION' }),
      ],
    });
  });

  it('bounds version identifiers before returning them in a diagnostic result', () => {
    const result = negotiateWisCoreResultEnvelope({ coreVersion: 'x'.repeat(513) });
    expect(result).toMatchObject({
      compatible: false,
      status: 'invalid',
      diagnostics: [expect.objectContaining({ code: 'WIS_COMPATIBILITY_INVALID_CORE_VERSION' })],
    });
    expect(result).not.toHaveProperty('sourceVersion');
  });

  it('rejects missing versions explicitly', () => {
    expect(negotiateWisCoreResultEnvelope({})).toMatchObject({
      compatible: false,
      status: 'invalid',
      diagnostics: [expect.objectContaining({ code: 'WIS_COMPATIBILITY_MISSING_CORE_VERSION' })],
    });
  });

  it('does not invoke accessors during version discovery', () => {
    let invoked = false;
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, 'coreVersion', {
      enumerable: true,
      get() {
        invoked = true;
        return '0.1.0-draft';
      },
    });

    expect(negotiateWisCoreResultEnvelope(input)).toMatchObject({
      compatible: false,
      status: 'invalid',
      diagnostics: [expect.objectContaining({ code: 'WIS_RESOURCE_ACCESSOR_PROPERTY' })],
    });
    expect(invoked).toBe(false);
  });

  it('is deterministic across repeated negotiations', () => {
    const previous = fixture(compatibilityRoot, 'previous-valid-pass.json');
    expect(negotiateWisCoreResultEnvelope(previous)).toEqual(
      negotiateWisCoreResultEnvelope(previous)
    );
  });

  it('keeps downgrade outside the supported public boundary', () => {
    expect(WIS_SUPPORTED_PREVIOUS_CORE_VERSIONS).not.toContain(WIS_CURRENT_CORE_VERSION);
    expect(negotiateWisCoreResultEnvelope).toHaveLength(2);
  });
});
