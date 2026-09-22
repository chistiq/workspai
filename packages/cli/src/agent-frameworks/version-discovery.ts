import {
  BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES,
  compareRegistryVersions,
  isStableRegistryVersion,
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

export type AgentFrameworkGithubAgreement = {
  required: boolean;
  repository: string | null;
  latestStableVersion: string | null;
  matchingTag: string | null;
  status: 'agreed' | 'disagreement' | 'not-required' | 'unavailable';
  detail: string;
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
    github: AgentFrameworkGithubAgreement;
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
  if (dependency.ecosystem === 'npm') {
    const versions = (payload as { versions?: unknown }).versions;
    if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
      throw new Error(`npm versions are unavailable for ${dependency.name}.`);
    }
    return Object.keys(versions as Record<string, unknown>);
  }
  const versions = (payload as { versions?: unknown }).versions;
  if (!Array.isArray(versions) || !versions.every((version) => typeof version === 'string')) {
    throw new Error(`NuGet versions are unavailable for ${dependency.name}.`);
  }
  return versions;
}

function githubVersionFromTag(tag: string, prefixes: readonly string[]): string | null {
  const normalized = tag.trim();
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      const version = normalized.slice(prefix.length);
      return isStableRegistryVersion(version) ? version : null;
    }
  }
  return isStableRegistryVersion(normalized) ? normalized : null;
}

function latestGithubStable(
  payload: unknown,
  prefixes: readonly string[]
): { version: string; tag: string } | null {
  if (!Array.isArray(payload)) return null;
  const matches: Array<{ version: string; tag: string }> = [];
  for (const release of payload) {
    if (!release || typeof release !== 'object') continue;
    const record = release as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
    if (record.prerelease === true || record.draft === true) continue;
    if (typeof record.tag_name !== 'string') continue;
    const version = githubVersionFromTag(record.tag_name, prefixes);
    if (!version) continue;
    matches.push({ version, tag: record.tag_name });
  }
  const latest = selectLatestRegistryVersion(
    matches.map((item) => item.version),
    'stable'
  );
  if (!latest) return null;
  const match = matches.find((item) => item.version === latest);
  return match ?? null;
}

async function discoverGithubAgreement(
  baseline: AgentFrameworkVersionBaseline,
  registryCoreVersion: string,
  fetcher: FetchLike
): Promise<AgentFrameworkGithubAgreement> {
  const upstream = baseline.upstream;
  if (!upstream) {
    return {
      required: false,
      repository: null,
      latestStableVersion: null,
      matchingTag: null,
      status: 'not-required',
      detail: 'This adapter does not require GitHub release agreement.',
    };
  }
  const url = `https://api.github.com/repos/${upstream.githubRepository}/releases?per_page=30`;
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': 'workspai-version-discovery' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub lookup failed for ${upstream.githubRepository} with HTTP ${response.status}.`
      );
    }
    const latest = latestGithubStable(await response.json(), upstream.releaseTagPrefixes);
    if (!latest) {
      return {
        required: true,
        repository: upstream.githubRepository,
        latestStableVersion: null,
        matchingTag: null,
        status: 'disagreement',
        detail: `GitHub has no non-prerelease ${upstream.releaseTagPrefixes.join('|')} tag for ${upstream.githubRepository}.`,
      };
    }
    if (latest.version !== registryCoreVersion) {
      return {
        required: true,
        repository: upstream.githubRepository,
        latestStableVersion: latest.version,
        matchingTag: latest.tag,
        status: 'disagreement',
        detail: `Registry ${registryCoreVersion} disagrees with GitHub ${latest.tag}.`,
      };
    }
    return {
      required: true,
      repository: upstream.githubRepository,
      latestStableVersion: latest.version,
      matchingTag: latest.tag,
      status: 'agreed',
      detail: `Registry ${registryCoreVersion} agrees with GitHub ${latest.tag}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      required: true,
      repository: upstream.githubRepository,
      latestStableVersion: null,
      matchingTag: null,
      status: 'unavailable',
      detail: message,
    };
  }
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
      const core = packages.find((_, index) => baseline.packages[index]?.role === 'framework-core');
      const github = await discoverGithubAgreement(
        baseline,
        core?.latestRegistryVersion ?? baseline.frameworkVersion,
        fetcher
      );
      const status =
        packages.some((dependency) => dependency.status === 'registry-regression') ||
        github.status === 'disagreement' ||
        github.status === 'unavailable'
          ? ('blocked' as const)
          : packages.some((dependency) => dependency.status === 'update-available')
            ? ('candidate-available' as const)
            : ('current' as const);
      return {
        adapterId: baseline.adapterId,
        runtime: baseline.runtime,
        releaseChannel: baseline.releaseChannel,
        admittedFrameworkVersion: baseline.frameworkVersion,
        status,
        packages,
        github,
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
