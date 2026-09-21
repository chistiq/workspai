import {
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES,
  EXCLUDED_MODEL_GATEWAY_LANGUAGES,
  MODEL_GATEWAY_BASELINES_REVIEWED_AT,
  MODEL_GATEWAY_VERSION_BASELINES_SCHEMA_VERSION,
  compareStableSdkVersions,
  isEligibleStableSdkVersion,
  sdkCorePackage,
  selectLatestStableSdkVersion,
  type ModelGatewayExcludedLanguage,
  type ModelGatewayVersionBaseline,
  type ModelGatewayVersionBaselineDocument,
} from './version-policy.js';

export const MODEL_GATEWAY_VERSION_DISCOVERY_SCHEMA_VERSION =
  'workspai.model-gateway-version-discovery.v1' as const;

export const MODEL_GATEWAY_DISCOVERY_EXIT = {
  CURRENT: 0,
  UPDATE_AVAILABLE: 10,
  DISAGREEMENT: 20,
  UNAVAILABLE: 30,
  INVALID: 40,
} as const;

export type ModelGatewayDiscoveryOutcome =
  (typeof MODEL_GATEWAY_DISCOVERY_EXIT)[keyof typeof MODEL_GATEWAY_DISCOVERY_EXIT];

export type ModelGatewayDiscoveryStatus =
  'current' | 'update-available' | 'disagreement' | 'unavailable' | 'invalid';

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const FETCH_HEADERS = {
  accept: 'application/json',
  'user-agent': 'workspai-model-gateway-version-discovery',
};

export type ModelGatewayAdapterDiscovery = {
  adapterId: string;
  runtime: ModelGatewayVersionBaseline['runtime'];
  packageName: string;
  pinnedVersion: string;
  registryVersion: string | null;
  githubVersion: string | null;
  status: ModelGatewayDiscoveryStatus;
  registryUrl: string;
  githubReleaseUrl: string | null;
  detail: string;
};

export type ModelGatewayExclusionDiscovery = {
  language: string;
  module: string;
  pinnedObservation: string;
  latestObservedVersion: string | null;
  declaredMaturity: string;
  status: 'still-excluded' | 'unavailable' | 'stable-review-required';
  detail: string;
};

export type ModelGatewayVersionDiscovery = {
  schemaVersion: typeof MODEL_GATEWAY_VERSION_DISCOVERY_SCHEMA_VERSION;
  generatedAt: string;
  reviewedAt: string;
  policy: 'discover-only';
  automaticMutation: false;
  adapters: ModelGatewayAdapterDiscovery[];
  excluded: ModelGatewayExclusionDiscovery[];
  summary: {
    adapters: number;
    current: number;
    updateAvailable: number;
    disagreement: number;
    unavailable: number;
    invalid: number;
  };
  outcome: ModelGatewayDiscoveryStatus;
  proposedDocument: ModelGatewayVersionBaselineDocument | null;
};

function stripVersionPrefix(value: string): string {
  return value.trim().replace(/^v/i, '');
}

function dateStamp(value: string): string {
  return value.slice(0, 10);
}

async function fetchJson(url: string, fetcher: FetchLike): Promise<unknown> {
  const response = await fetcher(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Lookup failed for ${url} with HTTP ${response.status}.`);
  }
  return response.json();
}

function npmStableVersion(payload: unknown, packageName: string): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`npm returned an invalid payload for ${packageName}.`);
  }
  const record = payload as {
    'dist-tags'?: { latest?: unknown };
    versions?: Record<string, { deprecated?: unknown }>;
  };
  const latest = record['dist-tags']?.latest;
  if (typeof latest !== 'string') {
    throw new Error(`npm latest tag is missing for ${packageName}.`);
  }
  const version = stripVersionPrefix(latest);
  const metadata = record.versions?.[latest] ?? record.versions?.[version];
  if (metadata?.deprecated) {
    throw new Error(`npm latest ${packageName}@${version} is deprecated.`);
  }
  if (!isEligibleStableSdkVersion(version)) {
    throw new Error(`npm latest ${packageName}@${version} is not an eligible stable version.`);
  }
  return version;
}

function pypiStableVersion(payload: unknown, packageName: string): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`PyPI returned an invalid payload for ${packageName}.`);
  }
  const record = payload as {
    info?: { version?: unknown };
    releases?: Record<string, Array<{ yanked?: unknown }>>;
  };
  const latest = record.info?.version;
  if (typeof latest !== 'string') {
    throw new Error(`PyPI version is missing for ${packageName}.`);
  }
  const version = stripVersionPrefix(latest);
  const files = record.releases?.[latest] ?? record.releases?.[version];
  if (Array.isArray(files) && files.length > 0 && files.every((file) => file?.yanked === true)) {
    throw new Error(`PyPI ${packageName}@${version} is yanked.`);
  }
  if (!isEligibleStableSdkVersion(version)) {
    throw new Error(`PyPI ${packageName}@${version} is not an eligible stable version.`);
  }
  return version;
}

function githubStableVersion(payload: unknown, repository: string): string {
  const releases = Array.isArray(payload) ? payload : [payload];
  const versions = releases.flatMap((release) => {
    if (!release || typeof release !== 'object') return [];
    const record = release as {
      tag_name?: unknown;
      prerelease?: unknown;
      draft?: unknown;
    };
    if (record.prerelease === true || record.draft === true) return [];
    if (typeof record.tag_name !== 'string') return [];
    return [stripVersionPrefix(record.tag_name)];
  });
  const latest = selectLatestStableSdkVersion(versions);
  if (!latest) {
    throw new Error(`GitHub has no eligible stable release for ${repository}.`);
  }
  return latest;
}

function goProxyVersion(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Go proxy returned an invalid payload.');
  }
  const version = (payload as { Version?: unknown }).Version;
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error('Go proxy did not return a Version.');
  }
  return version.trim();
}

function adapterStatus(
  pinned: string,
  registryVersion: string,
  githubVersion: string
): Pick<ModelGatewayAdapterDiscovery, 'status' | 'detail'> {
  if (registryVersion !== githubVersion) {
    return {
      status: 'disagreement',
      detail: `Registry ${registryVersion} disagrees with GitHub ${githubVersion}.`,
    };
  }
  const comparison = compareStableSdkVersions(registryVersion, pinned);
  if (comparison === 0) {
    return { status: 'current', detail: `Pinned ${pinned} matches registry and GitHub.` };
  }
  if (comparison > 0) {
    return {
      status: 'update-available',
      detail: `${pinned} -> ${registryVersion}`,
    };
  }
  return {
    status: 'invalid',
    detail: `Registry ${registryVersion} is older than the pinned ${pinned}.`,
  };
}

function githubRepo(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/i);
  if (!match?.[1]) {
    throw new Error(`Cannot parse GitHub repository from ${url}.`);
  }
  return match[1].replace(/\.git$/i, '');
}

function proposedBaseline(
  baseline: ModelGatewayVersionBaseline,
  nextVersion: string,
  reviewedAt: string,
  githubRepoName: string
): ModelGatewayVersionBaseline {
  const core = sdkCorePackage(baseline);
  return {
    ...baseline,
    sdkVersion: nextVersion,
    discoveryDate: reviewedAt,
    upstreamReleaseUrl: `https://github.com/${githubRepoName}/releases/tag/v${nextVersion}`,
    registryUrl:
      core.ecosystem === 'npm'
        ? `https://registry.npmjs.org/${core.name}/${nextVersion}`
        : `https://pypi.org/pypi/${core.name}/${nextVersion}`,
    notes: `Proposed ${reviewedAt}. Qualifies only after Linux, macOS, and Windows generated-project and lifecycle evidence on the same commit.`,
    packages: baseline.packages.map((dependency) =>
      dependency.role === 'sdk-core'
        ? {
            ...dependency,
            version: nextVersion,
            registryUrl:
              dependency.ecosystem === 'npm'
                ? `https://registry.npmjs.org/${dependency.name}/${nextVersion}`
                : `https://pypi.org/pypi/${dependency.name}/${nextVersion}`,
          }
        : dependency
    ),
  };
}

export async function discoverModelGatewayVersions(input?: {
  baselines?: readonly ModelGatewayVersionBaseline[];
  excluded?: readonly ModelGatewayExcludedLanguage[];
  fetcher?: FetchLike;
  generatedAt?: string;
}): Promise<ModelGatewayVersionDiscovery> {
  const baselines = input?.baselines ?? BUILTIN_MODEL_GATEWAY_VERSION_BASELINES;
  const excluded = input?.excluded ?? EXCLUDED_MODEL_GATEWAY_LANGUAGES;
  const fetcher = input?.fetcher ?? (fetch as FetchLike);
  const generatedAt = input?.generatedAt ?? new Date().toISOString();
  const reviewedAt = dateStamp(generatedAt);

  const adapters: ModelGatewayAdapterDiscovery[] = [];
  for (const baseline of baselines) {
    const core = sdkCorePackage(baseline);
    const repository = githubRepo(baseline.upstreamReleaseUrl);
    try {
      const registryPayload = await fetchJson(
        core.ecosystem === 'npm'
          ? `https://registry.npmjs.org/${core.name}`
          : `https://pypi.org/pypi/${core.name}/json`,
        fetcher
      );
      const githubPayload = await fetchJson(
        `https://api.github.com/repos/${repository}/releases?per_page=30`,
        fetcher
      );
      const registryVersion =
        core.ecosystem === 'npm'
          ? npmStableVersion(registryPayload, core.name)
          : pypiStableVersion(registryPayload, core.name);
      const githubVersion = githubStableVersion(githubPayload, repository);
      const status = adapterStatus(baseline.sdkVersion, registryVersion, githubVersion);
      adapters.push({
        adapterId: baseline.adapterId,
        runtime: baseline.runtime,
        packageName: core.name,
        pinnedVersion: baseline.sdkVersion,
        registryVersion,
        githubVersion,
        registryUrl:
          core.ecosystem === 'npm'
            ? `https://registry.npmjs.org/${core.name}/${registryVersion}`
            : `https://pypi.org/pypi/${core.name}/${registryVersion}`,
        githubReleaseUrl: `https://github.com/${repository}/releases/tag/v${githubVersion}`,
        ...status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status: ModelGatewayDiscoveryStatus = /HTTP|failed for|timeout|network/i.test(message)
        ? 'unavailable'
        : 'invalid';
      adapters.push({
        adapterId: baseline.adapterId,
        runtime: baseline.runtime,
        packageName: core.name,
        pinnedVersion: baseline.sdkVersion,
        registryVersion: null,
        githubVersion: null,
        status,
        registryUrl: baseline.registryUrl,
        githubReleaseUrl: null,
        detail: message,
      });
    }
  }

  const exclusionReports: ModelGatewayExclusionDiscovery[] = [];
  for (const entry of excluded) {
    try {
      const payload = await fetchJson(
        `https://proxy.golang.org/${entry.module.toLowerCase()}/@latest`,
        fetcher
      );
      const latest = goProxyVersion(payload);
      const maturity = /beta|alpha|preview|rc/i.test(entry.declaredMaturity)
        ? 'still-excluded'
        : 'stable-review-required';
      const stableCandidate = isEligibleStableSdkVersion(stripVersionPrefix(latest));
      exclusionReports.push({
        language: entry.language,
        module: entry.module,
        pinnedObservation: entry.latestObservedVersion,
        latestObservedVersion: latest,
        declaredMaturity: entry.declaredMaturity,
        status: stableCandidate ? 'stable-review-required' : maturity,
        detail: stableCandidate
          ? `Go proxy reported ${latest}. Manual review is required before creating a kit.`
          : `Go remains excluded. Latest observed ${latest}.`,
      });
    } catch (error) {
      exclusionReports.push({
        language: entry.language,
        module: entry.module,
        pinnedObservation: entry.latestObservedVersion,
        latestObservedVersion: null,
        declaredMaturity: entry.declaredMaturity,
        status: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = {
    adapters: adapters.length,
    current: adapters.filter((adapter) => adapter.status === 'current').length,
    updateAvailable: adapters.filter((adapter) => adapter.status === 'update-available').length,
    disagreement: adapters.filter((adapter) => adapter.status === 'disagreement').length,
    unavailable: adapters.filter((adapter) => adapter.status === 'unavailable').length,
    invalid: adapters.filter((adapter) => adapter.status === 'invalid').length,
  };

  const outcome: ModelGatewayDiscoveryStatus =
    summary.unavailable > 0
      ? 'unavailable'
      : summary.disagreement > 0
        ? 'disagreement'
        : summary.invalid > 0
          ? 'invalid'
          : summary.updateAvailable > 0
            ? 'update-available'
            : 'current';

  const proposedDocument =
    outcome === 'update-available'
      ? {
          schemaVersion: MODEL_GATEWAY_VERSION_BASELINES_SCHEMA_VERSION,
          reviewedAt,
          baselines: baselines.map((baseline) => {
            const discovery = adapters.find((adapter) => adapter.adapterId === baseline.adapterId);
            if (discovery?.status === 'update-available' && discovery.registryVersion) {
              return proposedBaseline(
                baseline,
                discovery.registryVersion,
                reviewedAt,
                githubRepo(baseline.upstreamReleaseUrl)
              );
            }
            return structuredClone(baseline);
          }),
          excluded: structuredClone([...excluded]),
        }
      : null;

  return {
    schemaVersion: MODEL_GATEWAY_VERSION_DISCOVERY_SCHEMA_VERSION,
    generatedAt,
    reviewedAt: MODEL_GATEWAY_BASELINES_REVIEWED_AT,
    policy: 'discover-only',
    automaticMutation: false,
    adapters,
    excluded: exclusionReports,
    summary,
    outcome,
    proposedDocument,
  };
}

export function discoveryExitCode(
  outcome: ModelGatewayDiscoveryStatus
): ModelGatewayDiscoveryOutcome {
  if (outcome === 'current') return MODEL_GATEWAY_DISCOVERY_EXIT.CURRENT;
  if (outcome === 'update-available') return MODEL_GATEWAY_DISCOVERY_EXIT.UPDATE_AVAILABLE;
  if (outcome === 'disagreement') return MODEL_GATEWAY_DISCOVERY_EXIT.DISAGREEMENT;
  if (outcome === 'unavailable') return MODEL_GATEWAY_DISCOVERY_EXIT.UNAVAILABLE;
  return MODEL_GATEWAY_DISCOVERY_EXIT.INVALID;
}

export function formatModelGatewayDiscoverySummary(
  discovery: ModelGatewayVersionDiscovery
): string {
  const lines = discovery.adapters.map(
    (adapter) =>
      `${adapter.status === 'update-available' ? 'UPDATE' : adapter.status.toUpperCase()} ${adapter.adapterId} ${adapter.packageName}: ${adapter.pinnedVersion}${adapter.registryVersion ? ` -> ${adapter.registryVersion}` : ''} (${adapter.detail})`
  );
  for (const entry of discovery.excluded) {
    lines.push(
      `${entry.status.toUpperCase()} ${entry.language} ${entry.module}: ${entry.pinnedObservation}${entry.latestObservedVersion ? ` -> ${entry.latestObservedVersion}` : ''} (${entry.detail})`
    );
  }
  return `${lines.join('\n')}\nOUTCOME ${discovery.outcome}\n`;
}
