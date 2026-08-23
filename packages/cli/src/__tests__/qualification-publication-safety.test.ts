import { describe, expect, it } from 'vitest';
import {
  assertQualificationReportIsPublicationSafe,
  createQualificationCommandRecord,
  isQualificationCommandAccepted,
} from '../../scripts/qualification-publication-safety.mjs';

describe('qualification report publication safety', () => {
  it('retains bounded process metadata without command output or local paths', () => {
    const record = createQualificationCommandRecord({
      id: 'command-001',
      result: {
        status: 0,
        stdout: '{"schemaVersion":"example.v1","path":"/home/alice/private"}',
        stderr: 'token=secret',
      },
      parsed: { schemaVersion: 'example.v1' },
      startedAt: Date.now(),
    });

    expect(record).toMatchObject({
      id: 'command-001',
      exitCode: 0,
      schemaVersion: 'example.v1',
      stdoutBytes: 59,
      stderrBytes: 12,
    });
    expect(JSON.stringify(record)).not.toContain('/home/alice');
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(() => assertQualificationReportIsPublicationSafe(record)).not.toThrow();
  });

  it.each([
    { workspacePath: '/home/alice/workspace' },
    { note: 'stored at /Users/alice/workspace' },
    { note: String.raw`stored at C:\Users\Alice\workspace` },
    { note: String.raw`stored at \\server\share\workspace` },
    { note: 'file:///home/alice/workspace' },
    { stdoutExcerpt: 'otherwise harmless' },
  ])('fails closed for local or raw report data: %j', (unsafe) => {
    expect(() => assertQualificationReportIsPublicationSafe(unsafe)).toThrow();
  });

  it('rejects caller-provided roots even when they use an uncommon mount point', () => {
    expect(() =>
      assertQualificationReportIsPublicationSafe(
        { note: '/mnt/company-secret/repository/result.json' },
        ['/mnt/company-secret/repository']
      )
    ).toThrow('forbidden local path');
  });

  it('accepts a completed child status when a restricted runner also reports non-fatal EPERM', () => {
    expect(
      isQualificationCommandAccepted({
        result: {
          status: 0,
          error: Object.assign(new Error('restricted runner'), { code: 'EPERM' }),
        },
        acceptedExitCodes: [0],
        parsed: null,
        expectJson: false,
      })
    ).toBe(true);
  });

  it('rejects spawn and timeout failures without a completed child status', () => {
    expect(
      isQualificationCommandAccepted({
        result: { status: null, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) },
        acceptedExitCodes: [0],
        parsed: {},
      })
    ).toBe(false);
  });

  it('rejects unexpected process errors even when a child status is present', () => {
    expect(
      isQualificationCommandAccepted({
        result: {
          status: 0,
          error: Object.assign(new Error('buffer failure'), { code: 'ENOBUFS' }),
        },
        acceptedExitCodes: [0],
        parsed: {},
      })
    ).toBe(false);
  });
});
