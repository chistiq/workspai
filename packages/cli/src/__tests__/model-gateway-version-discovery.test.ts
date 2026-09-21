import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import {
  MODEL_GATEWAY_DISCOVERY_EXIT,
  discoverModelGatewayVersions,
  discoveryExitCode,
  formatModelGatewayDiscoverySummary,
} from '../model-gateways/version-discovery.js';
import {
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES,
  sdkCorePackage,
} from '../model-gateways/version-policy.js';

type JsonMap = Record<string, unknown>;

function jsonResponse(
  payload: unknown
): Promise<{ ok: true; status: 200; json: () => Promise<unknown> }> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

function npmPackument(name: string, latest: string, extra: JsonMap = {}): JsonMap {
  return {
    'dist-tags': { latest },
    versions: {
      [latest]: extra,
    },
  };
}

function pypiPayload(version: string, yanked = false): JsonMap {
  return {
    info: { version },
    releases: {
      [version]: [{ yanked }],
    },
  };
}

function githubRelease(tag: string, flags?: { prerelease?: boolean; draft?: boolean }): JsonMap {
  return {
    tag_name: tag,
    prerelease: flags?.prerelease === true,
    draft: flags?.draft === true,
  };
}

function goProxy(version: string): JsonMap {
  return { Version: version };
}

function mockedFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string) => {
    const url = String(input);
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    if (!match) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return jsonResponse(match[1]);
  }) as unknown as typeof fetch;
}

const typescript = sdkCorePackage(
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES.find(
    (entry) => entry.adapterId === 'openrouter-typescript'
  )!
);
const python = sdkCorePackage(
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES.find((entry) => entry.adapterId === 'openrouter-python')!
);

describe('model gateway version discovery', () => {
  it('reports current when registry and GitHub agree with the baseline', async () => {
    const discovery = await discoverModelGatewayVersions({
      generatedAt: '2026-09-21T00:00:00.000Z',
      fetcher: mockedFetch({
        'registry.npmjs.org/@openrouter/sdk': npmPackument(typescript.name, typescript.version),
        'pypi.org/pypi/openrouter/json': pypiPayload(python.version),
        'OpenRouterTeam/typescript-sdk/releases': [githubRelease(`v${typescript.version}`)],
        'OpenRouterTeam/python-sdk/releases': [githubRelease(`v${python.version}`)],
        'proxy.golang.org': goProxy('v0.8.11'),
      }),
    });
    expect(discovery.outcome).toBe('current');
    expect(discovery.automaticMutation).toBe(false);
    expect(discovery.proposedDocument).toBeNull();
    expect(discoveryExitCode(discovery.outcome)).toBe(MODEL_GATEWAY_DISCOVERY_EXIT.CURRENT);
    expect(discovery.excluded[0]?.status).toBe('still-excluded');
    expect(formatModelGatewayDiscoverySummary(discovery)).toContain(
      'CURRENT openrouter-typescript'
    );
  });

  it('proposes an update only when every source agrees on a newer stable version', async () => {
    const nextTs = '9.9.9';
    const discovery = await discoverModelGatewayVersions({
      generatedAt: '2026-09-22T00:00:00.000Z',
      fetcher: mockedFetch({
        'registry.npmjs.org/@openrouter/sdk': npmPackument(typescript.name, nextTs),
        'pypi.org/pypi/openrouter/json': pypiPayload(python.version),
        'OpenRouterTeam/typescript-sdk/releases': [githubRelease(`v${nextTs}`)],
        'OpenRouterTeam/python-sdk/releases': [githubRelease(`v${python.version}`)],
        'proxy.golang.org': goProxy('v0.8.11'),
      }),
    });
    expect(discovery.outcome).toBe('update-available');
    expect(discovery.proposedDocument?.baselines[0]?.sdkVersion).toBe(nextTs);
    expect(discovery.proposedDocument?.baselines[1]?.sdkVersion).toBe(python.version);
    expect(discoveryExitCode(discovery.outcome)).toBe(
      MODEL_GATEWAY_DISCOVERY_EXIT.UPDATE_AVAILABLE
    );
  });

  it('classifies registry/GitHub disagreement without proposing a write', async () => {
    const discovery = await discoverModelGatewayVersions({
      fetcher: mockedFetch({
        'registry.npmjs.org/@openrouter/sdk': npmPackument(typescript.name, '9.9.9'),
        'pypi.org/pypi/openrouter/json': pypiPayload(python.version),
        'OpenRouterTeam/typescript-sdk/releases': [githubRelease(`v${typescript.version}`)],
        'OpenRouterTeam/python-sdk/releases': [githubRelease(`v${python.version}`)],
        'proxy.golang.org': goProxy('v0.8.11'),
      }),
    });
    expect(discovery.outcome).toBe('disagreement');
    expect(discovery.proposedDocument).toBeNull();
    expect(discoveryExitCode(discovery.outcome)).toBe(MODEL_GATEWAY_DISCOVERY_EXIT.DISAGREEMENT);
  });

  it('rejects prerelease, yanked, deprecated, and unavailable sources', async () => {
    const prerelease = await discoverModelGatewayVersions({
      fetcher: mockedFetch({
        'registry.npmjs.org/@openrouter/sdk': npmPackument(typescript.name, '9.9.9-rc.1'),
        'pypi.org/pypi/openrouter/json': pypiPayload(python.version),
        'OpenRouterTeam/typescript-sdk/releases': [
          githubRelease('v9.9.9-rc.1', { prerelease: true }),
        ],
        'OpenRouterTeam/python-sdk/releases': [githubRelease(`v${python.version}`)],
        'proxy.golang.org': goProxy('v0.8.11'),
      }),
    });
    expect(prerelease.outcome).toBe('invalid');

    const yanked = await discoverModelGatewayVersions({
      fetcher: mockedFetch({
        'registry.npmjs.org/@openrouter/sdk': npmPackument(typescript.name, typescript.version),
        'pypi.org/pypi/openrouter/json': pypiPayload('9.9.9', true),
        'OpenRouterTeam/typescript-sdk/releases': [githubRelease(`v${typescript.version}`)],
        'OpenRouterTeam/python-sdk/releases': [githubRelease('v9.9.9')],
        'proxy.golang.org': goProxy('v0.8.11'),
      }),
    });
    expect(
      yanked.adapters.find((adapter) => adapter.adapterId === 'openrouter-python')?.status
    ).toBe('invalid');

    const deprecated = await discoverModelGatewayVersions({
      fetcher: mockedFetch({
        'registry.npmjs.org/@openrouter/sdk': npmPackument(typescript.name, '9.9.9', {
          deprecated: 'do not use',
        }),
        'pypi.org/pypi/openrouter/json': pypiPayload(python.version),
        'OpenRouterTeam/typescript-sdk/releases': [githubRelease('v9.9.9')],
        'OpenRouterTeam/python-sdk/releases': [githubRelease(`v${python.version}`)],
        'proxy.golang.org': goProxy('v0.8.11'),
      }),
    });
    expect(deprecated.outcome).toBe('invalid');

    const unavailable = await discoverModelGatewayVersions({
      fetcher: mockedFetch({
        'pypi.org/pypi/openrouter/json': pypiPayload(python.version),
        'OpenRouterTeam/python-sdk/releases': [githubRelease(`v${python.version}`)],
        'proxy.golang.org': goProxy('v0.8.11'),
      }),
    });
    expect(unavailable.outcome).toBe('unavailable');
    expect(discoveryExitCode(unavailable.outcome)).toBe(MODEL_GATEWAY_DISCOVERY_EXIT.UNAVAILABLE);
  });
});

describe('model gateway workflows', () => {
  it('pins actions and never commits, publishes, or uses pull_request_target', () => {
    const repositoryRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const qualification = fs.readFileSync(
      path.join(repositoryRoot, '.github/workflows/model-gateway-qualification.yml'),
      'utf8'
    );
    const discovery = fs.readFileSync(
      path.join(repositoryRoot, '.github/workflows/model-gateway-version-discovery.yml'),
      'utf8'
    );
    for (const workflow of [qualification, discovery]) {
      expect(workflow).not.toContain('pull_request_target');
      expect(workflow).not.toContain('git commit');
      expect(workflow).not.toContain('git push');
      expect(workflow).not.toContain('gh pr create');
      expect(workflow).not.toContain('npm publish');
      expect(workflow).not.toMatch(/OPENROUTER_API_KEY:\s*\$\{\{/);
      const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]!);
      for (const reference of uses) {
        expect(reference).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/);
      }
    }
    expect(qualification).toContain('ubuntu-latest');
    expect(qualification).toContain('macos-latest');
    expect(qualification).toContain('windows-latest');
    expect(qualification).toContain("inputs.qualification_mode == 'fast'");
    expect(qualification).not.toContain("inputs.qualification_mode == 'full'");
    expect(qualification).toContain('OpenRouter gateways');
    expect(qualification).not.toContain('kit: [typescript, python]');
    expect(qualification).not.toContain('matrix.kit');
    expect(qualification).not.toContain('NPM_CONFIG_CACHE');
    expect(qualification).not.toMatch(/^\s{6}(?:npm_config_cache|PIP_CACHE_DIR):/m);
    expect(qualification).toContain('model-gateway-generated-projects.test.ts');
    expect(qualification).toContain('model-gateway-workspace-lifecycle.test.ts');
    expect(qualification).toContain('model-gateway-policy-parity.test.ts');
    expect(discovery).toContain('propose-model-gateway-version-update.ts');
    expect(discovery).toContain('diff -u');
    expect(discovery).toContain('proposed.json');
    expect(discovery).not.toContain('0 current, 10 update available');
    expect(discovery).not.toContain('--write');
    expect(YAML.parse(discovery).permissions).toEqual({ contents: 'read' });
    expect(YAML.parse(qualification).permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
  });
});
