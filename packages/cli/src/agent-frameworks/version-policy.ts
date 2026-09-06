import versionBaselineDocument from './version-baselines.v1.json';

export type AgentFrameworkReleaseChannel = 'stable' | 'preview';
export type AgentFrameworkPackageEcosystem = 'pypi' | 'nuget';

export const AGENT_FRAMEWORK_VERSION_BASELINES_SCHEMA_VERSION =
  'workspai.agent-framework-version-baselines.v1' as const;

export type AgentFrameworkPackageBaseline = {
  ecosystem: AgentFrameworkPackageEcosystem;
  name: string;
  version: string;
  channel: AgentFrameworkReleaseChannel;
  role: 'framework-core' | 'framework-integration' | 'runtime-support';
  registryUrl: string;
};

export type AgentFrameworkVersionBaseline = {
  adapterId: string;
  frameworkId: string;
  runtime: 'python' | 'dotnet';
  policy: 'latest-admitted';
  releaseChannel: AgentFrameworkReleaseChannel;
  frameworkVersion: string;
  packages: readonly AgentFrameworkPackageBaseline[];
  automaticUpgrade: false;
  admissionRequired: true;
};

export type AgentFrameworkVersionBaselineDocument = {
  schemaVersion: typeof AGENT_FRAMEWORK_VERSION_BASELINES_SCHEMA_VERSION;
  baselines: AgentFrameworkVersionBaseline[];
};

const VERSION_PATTERN = /^\d+(?:\.\d+)*(?:[a-z0-9.-]*)$/i;

function assertBaselineDocument(
  value: unknown
): asserts value is AgentFrameworkVersionBaselineDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent framework version baseline document must be an object.');
  }
  const document = value as Partial<AgentFrameworkVersionBaselineDocument>;
  if (document.schemaVersion !== AGENT_FRAMEWORK_VERSION_BASELINES_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported agent framework version baseline schema: ${String(document.schemaVersion)}`
    );
  }
  if (!Array.isArray(document.baselines) || document.baselines.length === 0) {
    throw new Error('Agent framework version baseline document contains no adapters.');
  }
  const adapterIds = new Set<string>();
  for (const baseline of document.baselines as AgentFrameworkVersionBaseline[]) {
    if (
      !baseline ||
      typeof baseline.adapterId !== 'string' ||
      typeof baseline.frameworkId !== 'string' ||
      (baseline.runtime !== 'python' && baseline.runtime !== 'dotnet') ||
      baseline.policy !== 'latest-admitted' ||
      (baseline.releaseChannel !== 'stable' && baseline.releaseChannel !== 'preview') ||
      !VERSION_PATTERN.test(baseline.frameworkVersion) ||
      baseline.automaticUpgrade !== false ||
      baseline.admissionRequired !== true ||
      !Array.isArray(baseline.packages) ||
      baseline.packages.length === 0
    ) {
      throw new Error(`Invalid agent framework version baseline: ${String(baseline?.adapterId)}`);
    }
    if (adapterIds.has(baseline.adapterId)) {
      throw new Error(`Duplicate agent framework version baseline: ${baseline.adapterId}`);
    }
    adapterIds.add(baseline.adapterId);
    const packageNames = new Set<string>();
    let frameworkCoreVersion: string | null = null;
    for (const dependency of baseline.packages) {
      if (
        !dependency ||
        (dependency.ecosystem !== 'pypi' && dependency.ecosystem !== 'nuget') ||
        typeof dependency.name !== 'string' ||
        !VERSION_PATTERN.test(dependency.version) ||
        (dependency.channel !== 'stable' && dependency.channel !== 'preview') ||
        !['framework-core', 'framework-integration', 'runtime-support'].includes(dependency.role) ||
        typeof dependency.registryUrl !== 'string' ||
        !dependency.registryUrl.startsWith('https://')
      ) {
        throw new Error(`Invalid package baseline in ${baseline.adapterId}.`);
      }
      if (packageNames.has(dependency.name)) {
        throw new Error(`Duplicate package ${dependency.name} in ${baseline.adapterId}.`);
      }
      packageNames.add(dependency.name);
      if (dependency.role === 'framework-core') frameworkCoreVersion = dependency.version;
      if (baseline.releaseChannel === 'stable' && dependency.channel !== 'stable') {
        throw new Error(`Stable adapter ${baseline.adapterId} contains a preview dependency.`);
      }
    }
    if (!frameworkCoreVersion || frameworkCoreVersion !== baseline.frameworkVersion) {
      throw new Error(
        `Framework version is not bound to the core package in ${baseline.adapterId}.`
      );
    }
  }
}

assertBaselineDocument(versionBaselineDocument);
const validatedVersionBaselineDocument =
  versionBaselineDocument as AgentFrameworkVersionBaselineDocument;

export const BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES: readonly AgentFrameworkVersionBaseline[] =
  Object.freeze(
    structuredClone(validatedVersionBaselineDocument.baselines).map((baseline) =>
      Object.freeze({
        ...baseline,
        packages: Object.freeze(baseline.packages.map((dependency) => Object.freeze(dependency))),
      })
    )
  );

function requiredBaseline(adapterId: string): AgentFrameworkVersionBaseline {
  const baseline = BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES.find(
    (candidate) => candidate.adapterId === adapterId
  );
  if (!baseline) throw new Error(`Missing built-in agent framework baseline: ${adapterId}`);
  return baseline;
}

export const MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE = requiredBaseline(
  'microsoft-agent-framework-python'
);

export const MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE = requiredBaseline(
  'microsoft-agent-framework-dotnet'
);

export function packageVersion(
  baseline: AgentFrameworkVersionBaseline,
  packageName: string
): string {
  const dependency = baseline.packages.find((candidate) => candidate.name === packageName);
  if (!dependency) {
    throw new Error(`Package is not declared by ${baseline.adapterId}: ${packageName}`);
  }
  return dependency.version;
}

export function formatAgentFrameworkVersionPolicy(baseline: AgentFrameworkVersionBaseline): string {
  return `${baseline.frameworkVersion} · Workspai verified ${baseline.releaseChannel} baseline`;
}

export function isStableRegistryVersion(version: string): boolean {
  return /^\d+(?:\.\d+)*(?:\.post\d+)?$/i.test(version.trim());
}

function versionTokens(version: string): Array<number | string> {
  return version
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((part) => part.match(/\d+|[a-z]+/g) ?? [])
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export function compareRegistryVersions(left: string, right: string): number {
  const parse = (version: string) => {
    const match = version
      .trim()
      .toLowerCase()
      .match(/^(\d+(?:\.\d+)*)(.*)$/);
    return {
      core: (match?.[1] ?? version)
        .split('.')
        .map((part) => Number(part))
        .filter((part) => Number.isFinite(part)),
      suffix: versionTokens((match?.[2] ?? '').replace(/^[.-]+/, '')),
      stable: isStableRegistryVersion(version),
    };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const difference = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (leftVersion.stable !== rightVersion.stable) return leftVersion.stable ? 1 : -1;
  const leftTokens = leftVersion.suffix;
  const rightTokens = rightVersion.suffix;
  const length = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === rightToken) continue;
    if (leftToken === undefined) return -1;
    if (rightToken === undefined) return 1;
    if (typeof leftToken === 'number' && typeof rightToken === 'number') {
      return leftToken - rightToken;
    }
    if (typeof leftToken === 'number') return 1;
    if (typeof rightToken === 'number') return -1;
    return leftToken.localeCompare(rightToken);
  }
  return 0;
}

export function selectLatestRegistryVersion(
  versions: readonly string[],
  channel: AgentFrameworkReleaseChannel
): string | null {
  const eligible = versions
    .map((version) => version.trim())
    .filter(Boolean)
    .filter((version) => channel === 'preview' || isStableRegistryVersion(version));
  return eligible.sort(compareRegistryVersions).at(-1) ?? null;
}
