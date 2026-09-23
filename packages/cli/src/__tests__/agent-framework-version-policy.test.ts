import { describe, expect, it } from 'vitest';

import {
  BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES,
  formatAgentFrameworkVersionPolicy,
  isStableRegistryVersion,
  MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE,
  MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE,
  GOOGLE_ADK_PYTHON_BASELINE,
  GOOGLE_ADK_TYPESCRIPT_BASELINE,
  OPENAI_AGENTS_PYTHON_BASELINE,
  OPENAI_AGENTS_TYPESCRIPT_BASELINE,
  packageVersion,
  selectLatestRegistryVersion,
  type AgentFrameworkVersionBaseline,
} from '../agent-frameworks/version-policy.js';
import { discoverAgentFrameworkVersions } from '../agent-frameworks/version-discovery.js';
import { buildAgentFrameworkVersionPromotion } from '../agent-frameworks/version-promotion.js';

function pythonDiscoveryFixture(): AgentFrameworkVersionBaseline {
  const baseline = structuredClone(MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE);
  const packages = baseline.packages.map((dependency) => {
    if (dependency.name === 'agent-framework-core') {
      return { ...dependency, version: '1.17.0' };
    }
    return dependency;
  });
  return {
    ...baseline,
    frameworkVersion: '1.17.0',
    packages,
  };
}

function isGitHubApiHost(url: string): boolean {
  try {
    return new URL(url).hostname === 'api.github.com';
  } catch {
    return false;
  }
}

describe('agent framework version policy', () => {
  it('keeps every built-in on an explicit latest-admitted, nonautomatic policy', () => {
    expect(BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES).toHaveLength(6);
    for (const baseline of BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES) {
      expect(baseline.policy).toBe('latest-admitted');
      expect(baseline.automaticUpgrade).toBe(false);
      expect(baseline.admissionRequired).toBe(true);
      expect(baseline.packages.length).toBeGreaterThan(0);
      expect(new Set(baseline.packages.map((dependency) => dependency.name)).size).toBe(
        baseline.packages.length
      );
    }
  });

  it('labels stable and preview baselines truthfully', () => {
    expect(formatAgentFrameworkVersionPolicy(MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE)).toBe(
      `${MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE.frameworkVersion} · Workspai verified stable baseline`
    );
    expect(formatAgentFrameworkVersionPolicy(MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE)).toBe(
      `${MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE.frameworkVersion} · Workspai verified preview baseline`
    );
    expect(
      packageVersion(MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE, 'Microsoft.Agents.AI.Foundry')
    ).toContain('-preview.');
    expect(formatAgentFrameworkVersionPolicy(OPENAI_AGENTS_PYTHON_BASELINE)).toBe(
      `${OPENAI_AGENTS_PYTHON_BASELINE.frameworkVersion} · Workspai verified stable baseline`
    );
    expect(formatAgentFrameworkVersionPolicy(OPENAI_AGENTS_TYPESCRIPT_BASELINE)).toBe(
      `${OPENAI_AGENTS_TYPESCRIPT_BASELINE.frameworkVersion} · Workspai verified stable baseline`
    );
    expect(packageVersion(OPENAI_AGENTS_PYTHON_BASELINE, 'openai-agents')).toBe('0.22.2');
    expect(packageVersion(OPENAI_AGENTS_TYPESCRIPT_BASELINE, '@openai/agents')).toBe('0.18.0');
    expect(packageVersion(OPENAI_AGENTS_TYPESCRIPT_BASELINE, 'zod')).toBe('4.6.5');
    expect(formatAgentFrameworkVersionPolicy(GOOGLE_ADK_PYTHON_BASELINE)).toBe(
      `${GOOGLE_ADK_PYTHON_BASELINE.frameworkVersion} · Workspai verified stable baseline`
    );
    expect(formatAgentFrameworkVersionPolicy(GOOGLE_ADK_TYPESCRIPT_BASELINE)).toBe(
      `${GOOGLE_ADK_TYPESCRIPT_BASELINE.frameworkVersion} · Workspai verified stable baseline`
    );
    expect(packageVersion(GOOGLE_ADK_PYTHON_BASELINE, 'google-adk')).toBe(
      GOOGLE_ADK_PYTHON_BASELINE.frameworkVersion
    );
    expect(packageVersion(GOOGLE_ADK_TYPESCRIPT_BASELINE, '@google/adk')).toBe(
      GOOGLE_ADK_TYPESCRIPT_BASELINE.frameworkVersion
    );
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
    const baseline = pythonDiscoveryFixture();
    const report = await discoverAgentFrameworkVersions({
      baselines: [baseline],
      generatedAt: '2026-09-06T00:00:00.000Z',
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          const admitted = baseline.packages.find((dependency) => dependency.registryUrl === url);
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

  it('discovers npm registry versions without treating prereleases as stable', async () => {
    const baseline = structuredClone(OPENAI_AGENTS_TYPESCRIPT_BASELINE);
    const report = await discoverAgentFrameworkVersions({
      baselines: [baseline],
      generatedAt: '2026-09-17T00:00:00.000Z',
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          const admitted = baseline.packages.find((dependency) => dependency.registryUrl === url);
          if (!admitted) throw new Error(`Unexpected registry URL: ${url}`);
          return {
            versions: {
              [admitted.version]: {},
              ...(admitted.name === '@openai/agents' ? { '0.19.0': {} } : {}),
              '99.0.0-rc.1': {},
            },
          };
        },
      }),
    });

    expect(report.summary).toMatchObject({ candidateAvailable: 1, blocked: 0 });
    expect(report.adapters[0]).toMatchObject({
      adapterId: 'openai-agents-typescript',
      status: 'candidate-available',
    });
    expect(report.adapters[0].packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '@openai/agents',
          admittedVersion: '0.18.0',
          latestRegistryVersion: '0.19.0',
          status: 'update-available',
        }),
      ])
    );
  });

  it('builds a reviewable promotion while preserving policy and binding the core version', async () => {
    const baseline = pythonDiscoveryFixture();
    const report = await discoverAgentFrameworkVersions({
      baselines: [baseline],
      generatedAt: '2026-09-06T00:00:00.000Z',
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          const dependency = baseline.packages.find((candidate) => candidate.registryUrl === url);
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
    const promotion = buildAgentFrameworkVersionPromotion([baseline], report);

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
    expect(baseline.frameworkVersion).toBe('1.17.0');
  });

  it('refuses stale or incomplete discovery evidence', async () => {
    const baseline = pythonDiscoveryFixture();
    const report = await discoverAgentFrameworkVersions({
      baselines: [baseline],
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          const dependency = baseline.packages.find((candidate) => candidate.registryUrl === url);
          if (!dependency) throw new Error(`Unexpected registry URL: ${url}`);
          return { releases: { [dependency.version]: [{ yanked: false }] } };
        },
      }),
    });
    report.adapters[0]!.packages[0]!.admittedVersion = '0.0.0';

    expect(() => buildAgentFrameworkVersionPromotion([baseline], report)).toThrow(
      'Discovery package identity does not match'
    );
  });

  it('requires GitHub agreement for Google ADK and blocks registry/GitHub disagreement', async () => {
    const baseline = structuredClone(GOOGLE_ADK_PYTHON_BASELINE);
    const version = packageVersion(baseline, 'google-adk');
    const report = await discoverAgentFrameworkVersions({
      baselines: [baseline],
      generatedAt: '2026-09-22T00:00:00.000Z',
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          if (isGitHubApiHost(url)) {
            return [{ tag_name: 'v8.0.0', prerelease: false, draft: false }];
          }
          if (url !== baseline.packages[0]?.registryUrl) {
            throw new Error(`Unexpected registry URL: ${url}`);
          }
          return { releases: { [version]: [{ yanked: false }], '9.9.9': [{ yanked: false }] } };
        },
      }),
    });
    expect(report.adapters[0]).toMatchObject({
      adapterId: 'google-adk-python',
      status: 'blocked',
      github: { required: true, status: 'disagreement' },
    });
  });
});
