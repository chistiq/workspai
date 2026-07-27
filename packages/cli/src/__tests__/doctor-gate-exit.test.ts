import { describe, expect, it } from 'vitest';
import { computeDoctorGateExitCode, resolveDoctorPolicyProfile } from '../doctor.js';

describe('computeDoctorGateExitCode', () => {
  it('returns 1 for blocking errors even when strict/ci are disabled', () => {
    expect(computeDoctorGateExitCode({ errors: 3, warnings: 2 }, {})).toBe(1);
  });

  it('returns 1 on errors under strict mode', () => {
    expect(computeDoctorGateExitCode({ errors: 1, warnings: 0 }, { strict: true })).toBe(1);
  });

  it('returns 1 on warnings under strict mode', () => {
    expect(computeDoctorGateExitCode({ errors: 0, warnings: 2 }, { strict: true })).toBe(1);
  });

  it('returns 2 on warnings under ci mode', () => {
    expect(computeDoctorGateExitCode({ errors: 0, warnings: 1 }, { ci: true })).toBe(2);
  });

  it('returns 1 on errors under ci mode before warning exit code', () => {
    expect(computeDoctorGateExitCode({ errors: 2, warnings: 3 }, { ci: true })).toBe(1);
  });

  it('maps explicit doctor policy profiles to release-grade gate behavior', () => {
    expect(computeDoctorGateExitCode({ errors: 0, warnings: 1 }, { profile: 'local' })).toBe(0);
    expect(computeDoctorGateExitCode({ errors: 0, warnings: 1 }, { profile: 'ci' })).toBe(2);
    expect(computeDoctorGateExitCode({ errors: 0, warnings: 1 }, { profile: 'release' })).toBe(1);
    expect(
      computeDoctorGateExitCode({ errors: 0, warnings: 1 }, { profile: 'enterprise-strict' })
    ).toBe(1);
  });

  it('exposes policy profile metadata for evidence consumers', () => {
    expect(resolveDoctorPolicyProfile({ profile: 'enterprise-strict' })).toMatchObject({
      name: 'enterprise-strict',
      exitOnWarnings: true,
      advisoryWarningsBlockRelease: true,
      warningExitCode: 1,
    });
    expect(resolveDoctorPolicyProfile({ strict: true }).name).toBe('release');
    expect(resolveDoctorPolicyProfile({ ci: true }).name).toBe('ci');
  });
});
