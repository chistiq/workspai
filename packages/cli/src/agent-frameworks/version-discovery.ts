import {
  BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES,
  compareRegistryVersions,
  selectLatestRegistryVersion,
  type AgentFrameworkPackageBaseline,
  type AgentFrameworkVersionBaseline,
} from './version-policy.js';

export const AGENT_FRAMEWORK_VERSION_DISCOVERY_SCHEMA_VERSION =
  'workspai.agent-framework-version-discovery.v1' as const;

export type AgentFrameworkPackageDiscovery = {
  ecosystem: AgentFrameworkPackageBaseline['ecosystem'];
  name: string;
  channel: AgentFrameworkPackageBaseline['channel'];
  admittedVersion: string;
  latestRegistryVersion: string;
  status: 'current' | 'update-available' | 'registry-regression';
  registryUrl: string;
};

export type AgentFrameworkVersionDiscovery = {
  schemaVersion: typeof AGENT_FRAMEWORK_VERSION_DISCOVERY_SCHEMA_VERSION;
  generatedAt: string;
  policy: 'discover-only';
  automaticMutation: false;
  admissionRequired: true;
  adapters: Array<{
    adapterId: string;
    runtime: AgentFrameworkVersionBaseline['runtime'];
    releaseChannel: AgentFrameworkVersionBaseline['releaseChannel'];
    admittedFrameworkVersion: string;
    status: 'current' | 'candidate-available' | 'blocked';
    packages: AgentFrameworkPackageDiscovery[];
  }>;
  summary: {
    adapters: number;
    current: number;
    candidateAvailable: number;
    blocked: number;
  };
};

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function registryVersions(payload: unknown, dependency: AgentFrameworkPackageBaseline): string[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Registry returned an invalid payload for ${dependency.name}.`);
  }
  if (dependency.ecosystem === 'pypi') {
    const releases = (payload as { releases?: unknown }).releases;
    if (!releases || typeof releases !== 'object' || Array.isArray(releases)) {
      throw new Error(`PyPI releases are unavailable for ${dependency.name}.`);
    }
    return Object.entries(releases)
      .filter(([, files]) => {
        if (!Array.isArray(files) || files.length === 0) return false;
        return files.some(
          (file) =>
            !!file && typeof file === 'object' && (file as { yanked?: unknown }).yanked !== true
        );
      })
      .map(([version]) => version);
  }
  const versions = (payload as { versions?: unknown }).versions;
  if (!Array.isArray(versions) || !versions.every((version) => typeof version === 'string')) {
    throw new Error(`NuGet versions are unavailable for ${dependency.name}.`);
  }
  return versions;
}

async function discoverPackage(
  dependency: AgentFrameworkPackageBaseline,
  fetcher: FetchLike
): Promise<AgentFrameworkPackageDiscovery> {
  const response = await fetcher(dependency.registryUrl, {
    headers: { accept: 'application/json', 'user-agent': 'workspai-version-discovery' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Registry lookup failed for ${dependency.name} with HTTP ${response.status}.`);
  }
  const latest = selectLatestRegistryVersion(
    registryVersions(await response.json(), dependency),
    dependency.channel
  );
  if (!latest) {
    throw new Error(`Registry has no ${dependency.channel} release for ${dependency.name}.`);
  }
  const comparison = compareRegistryVersions(latest, dependency.version);
  return {
    ecosystem: dependency.ecosystem,
    name: dependency.name,
    channel: dependency.channel,
    admittedVersion: dependency.version,
    latestRegistryVersion: latest,
    status:
      comparison > 0 ? 'update-available' : comparison === 0 ? 'current' : 'registry-regression',
    registryUrl: dependency.registryUrl,
  };
}

export async function discoverAgentFrameworkVersions(input?: {
  baselines?: readonly AgentFrameworkVersionBaseline[];
  fetcher?: FetchLike;
  generatedAt?: string;
}): Promise<AgentFrameworkVersionDiscovery> {
  const baselines = input?.baselines ?? BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES;
  const fetcher = input?.fetcher ?? (fetch as FetchLike);
  const adapters = await Promise.all(
    baselines.map(async (baseline) => {
      const packages = await Promise.all(
        baseline.packages.map((dependency) => discoverPackage(dependency, fetcher))
      );
      return {
        adapterId: baseline.adapterId,
        runtime: baseline.runtime,
        releaseChannel: baseline.releaseChannel,
        admittedFrameworkVersion: baseline.frameworkVersion,
        status: packages.some((dependency) => dependency.status === 'registry-regression')
          ? ('blocked' as const)
          : packages.some((dependency) => dependency.status === 'update-available')
            ? ('candidate-available' as const)
            : ('current' as const),
        packages,
      };
    })
  );
  return {
    schemaVersion: AGENT_FRAMEWORK_VERSION_DISCOVERY_SCHEMA_VERSION,
    generatedAt: input?.generatedAt ?? new Date().toISOString(),
    policy: 'discover-only',
    automaticMutation: false,
    admissionRequired: true,
    adapters,
    summary: {
      adapters: adapters.length,
      current: adapters.filter((adapter) => adapter.status === 'current').length,
      candidateAvailable: adapters.filter((adapter) => adapter.status === 'candidate-available')
        .length,
      blocked: adapters.filter((adapter) => adapter.status === 'blocked').length,
    },
  };
}
