import { describe, expect, it } from 'vitest';
import {
  assertQualificationReportIsPublicationSafe,
  createQualificationCommandRecord,
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
});
