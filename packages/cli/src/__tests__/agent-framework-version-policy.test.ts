import { describe, expect, it } from 'vitest';

import {
  BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES,
  formatAgentFrameworkVersionPolicy,
  isStableRegistryVersion,
  MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE,
  MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE,
  packageVersion,
  selectLatestRegistryVersion,
} from '../agent-frameworks/version-policy.js';
import { discoverAgentFrameworkVersions } from '../agent-frameworks/version-discovery.js';
import { buildAgentFrameworkVersionPromotion } from '../agent-frameworks/version-promotion.js';

describe('agent framework version policy', () => {
  it('keeps every built-in on an explicit latest-admitted, nonautomatic policy', () => {
    expect(BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES).toHaveLength(2);
    for (const baseline of BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES) {
      expect(baseline.policy).toBe('latest-admitted');
      expect(baseline.automaticUpgrade).toBe(false);
      expect(baseline.admissionRequired).toBe(true);
      expect(baseline.packages.length).toBeGreaterThan(1);
      expect(new Set(baseline.packages.map((dependency) => dependency.name)).size).toBe(
        baseline.packages.length
      );
    }
  });

  it('labels stable and preview baselines truthfully', () => {
    expect(formatAgentFrameworkVersionPolicy(MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE)).toBe(
      '1.17.0 · Workspai verified stable baseline'
    );
    expect(formatAgentFrameworkVersionPolicy(MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE)).toBe(
      '1.20.0 · Workspai verified preview baseline'
    );
    expect(
      packageVersion(MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE, 'Microsoft.Agents.AI.Foundry')
    ).toContain('-preview.');
  });

  it('never promotes prereleases into a stable discovery lane', () => {
    expect(isStableRegistryVersion('1.20.0')).toBe(true);
    expect(isStableRegistryVersion('1.20.0-preview.1')).toBe(false);
    expect(isStableRegistryVersion('1.20.0b1')).toBe(false);
    expect(
      selectLatestRegistryVersion(
        ['1.19.0', '1.20.0-preview.1', '1.20.0', '1.21.0-preview.2'],
        'stable'
      )
    ).toBe('1.20.0');
    expect(
      selectLatestRegistryVersion(
        ['1.19.0', '1.20.0-preview.1', '1.20.0', '1.21.0-preview.2'],
        'preview'
      )
    ).toBe('1.21.0-preview.2');
    expect(selectLatestRegistryVersion(['1.20.0-preview.2', '1.20.0'], 'preview')).toBe('1.20.0');
  });

  it('fails closed when a package is not part of the admitted dependency set', () => {
    expect(() =>
      packageVersion(MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE, 'unreviewed-package')
    ).toThrow('Package is not declared');
  });

  it('discovers candidates without mutating or promoting the admitted baseline', async () => {
    const report = await discoverAgentFrameworkVersions({
      baselines: [MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE],
      generatedAt: '2026-09-06T00:00:00.000Z',
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          const admitted = MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE.packages.find(
            (dependency) => dependency.registryUrl === url
          );
          if (!admitted) throw new Error(`Unexpected registry URL: ${url}`);
          return {
            releases: {
              [admitted.version]: [{ yanked: false }],
              ...(admitted.name === 'agent-framework-core'
                ? { '1.18.0': [{ yanked: false }], '1.19.0': [{ yanked: true }] }
                : {}),
              '99.0.0rc1': [{ yanked: false }],
            },
          };
        },
      }),
    });

    expect(report.policy).toBe('discover-only');
    expect(report.automaticMutation).toBe(false);
    expect(report.admissionRequired).toBe(true);
    expect(report.summary).toMatchObject({ candidateAvailable: 1, blocked: 0 });
    expect(report.adapters[0]).toMatchObject({
      adapterId: 'microsoft-agent-framework-python',
      status: 'candidate-available',
    });
    expect(report.adapters[0].packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'agent-framework-core',
          admittedVersion: '1.17.0',
          latestRegistryVersion: '1.18.0',
          status: 'update-available',
        }),
      ])
    );
  });

  it('builds a reviewable promotion while preserving policy and binding the core version', async () => {
    const report = await discoverAgentFrameworkVersions({
      baselines: [MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE],
      generatedAt: '2026-09-06T00:00:00.000Z',
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          const dependency = MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE.packages.find(
            (candidate) => candidate.registryUrl === url
          );
          if (!dependency) throw new Error(`Unexpected registry URL: ${url}`);
          return {
            releases: {
              [dependency.version]: [{ yanked: false }],
              ...(dependency.role === 'framework-core' ? { '1.18.0': [{ yanked: false }] } : {}),
            },
          };
        },
      }),
    });
    const promotion = buildAgentFrameworkVersionPromotion(
      [MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE],
      report
    );

    expect(promotion).toMatchObject({
      changed: true,
      updatedAdapters: ['microsoft-agent-framework-python'],
      updatedPackages: [
        {
          adapterId: 'microsoft-agent-framework-python',
          name: 'agent-framework-core',
          from: '1.17.0',
          to: '1.18.0',
        },
      ],
    });
    expect(promotion.document.baselines[0]).toMatchObject({
      policy: 'latest-admitted',
      automaticUpgrade: false,
      admissionRequired: true,
      frameworkVersion: '1.18.0',
    });
    expect(MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE.frameworkVersion).toBe('1.17.0');
  });

  it('refuses stale or incomplete discovery evidence', async () => {
    const report = await discoverAgentFrameworkVersions({
      baselines: [MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE],
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          const dependency = MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE.packages.find(
            (candidate) => candidate.registryUrl === url
          );
          if (!dependency) throw new Error(`Unexpected registry URL: ${url}`);
          return { releases: { [dependency.version]: [{ yanked: false }] } };
        },
      }),
    });
    report.adapters[0]!.packages[0]!.admittedVersion = '0.0.0';

    expect(() =>
      buildAgentFrameworkVersionPromotion([MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE], report)
    ).toThrow('Discovery package identity does not match');
  });
});
