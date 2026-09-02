import { describe, expect, it } from 'vitest';
import { checkCliResolution } from '../../utils/cli-resolution-diagnostic.js';

describe('checkCliResolution', () => {
  it('is explicitly not applicable outside Windows without probing the host', async () => {
    let probed = false;
    const result = await checkCliResolution({
      platform: 'linux',
      resolveCandidates: async () => {
        probed = true;
        return [];
      },
    });

    expect(probed).toBe(false);
    expect(result).toMatchObject({
      status: 'ok',
      applicability: 'not-applicable',
      resolutionStatus: 'not-applicable',
    });
  });

  it('accepts the npm global shim when it is the active Windows PATH match', async () => {
    const result = await checkCliResolution({
      platform: 'win32',
      resolveNpmGlobalPrefix: async () => 'C:\\Users\\dev\\AppData\\Roaming\\npm',
      resolveCandidates: async () => [
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\workspai.cmd',
        'C:\\Python313\\Scripts\\workspai.exe',
      ],
    });

    expect(result).toMatchObject({
      status: 'ok',
      resolutionStatus: 'canonical',
      activePath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\workspai.cmd',
    });
  });

  it('reports a shadowed npm shim with ordered evidence and a bounded recovery', async () => {
    const result = await checkCliResolution({
      platform: 'win32',
      resolveNpmGlobalPrefix: async () => 'C:\\Users\\dev\\AppData\\Roaming\\npm',
      resolveCandidates: async () => [
        'C:\\Python313\\Scripts\\workspai.exe',
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\workspai.cmd',
      ],
    });

    expect(result).toMatchObject({
      status: 'warn',
      applicability: 'applicable',
      resolutionStatus: 'shadowed',
      candidates: [
        'C:\\Python313\\Scripts\\workspai.exe',
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\workspai.cmd',
      ],
    });
    expect(result.details).toContain('npx --yes workspai <command>');
  });

  it('keeps an unresolved command distinct from an unverifiable npm prefix', async () => {
    const unresolved = await checkCliResolution({
      platform: 'win32',
      resolveNpmGlobalPrefix: async () => 'C:\\npm',
      resolveCandidates: async () => [],
    });
    const unverified = await checkCliResolution({
      platform: 'win32',
      resolveNpmGlobalPrefix: async () => undefined,
      resolveCandidates: async () => ['C:\\tools\\workspai.cmd'],
    });

    expect(unresolved.resolutionStatus).toBe('unresolved');
    expect(unverified.resolutionStatus).toBe('unverified');
  });
});
