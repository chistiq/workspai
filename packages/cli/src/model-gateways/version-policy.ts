import versionBaselineDocument from './version-baselines.v1.json';

export const MODEL_GATEWAY_VERSION_BASELINES_SCHEMA_VERSION =
  'workspai.model-gateway-version-baselines.v1' as const;

export type ModelGatewayPackageEcosystem = 'npm' | 'pypi';
export type ModelGatewayBaselineRuntime = 'node' | 'python';
export type ModelGatewayPackageRole = 'sdk-core' | 'runtime-support';

export type ModelGatewayPackageBaseline = {
  ecosystem: ModelGatewayPackageEcosystem;
  name: string;
  version: string;
  channel: 'stable';
  role: ModelGatewayPackageRole;
  registryUrl: string;
};

export type ModelGatewayVersionBaseline = {
  adapterId: string;
  gatewayId: string;
  gatewayName: string;
  runtime: ModelGatewayBaselineRuntime;
  policy: 'tested-baseline';
  releaseChannel: 'stable';
  sdkVersion: string;
  discoveryDate: string;
  declaredMaturity: string;
  runtimeRequirement: string;
  upstreamReleaseUrl: string;
  registryUrl: string;
  notes: string;
  packages: readonly ModelGatewayPackageBaseline[];
  automaticUpgrade: false;
};

export type ModelGatewayExcludedLanguage = {
  language: string;
  module: string;
  discoveryDate: string;
  latestObservedVersion: string;
  declaredMaturity: string;
  reason: string;
  evidence: readonly string[];
};

export type ModelGatewayVersionBaselineDocument = {
  schemaVersion: typeof MODEL_GATEWAY_VERSION_BASELINES_SCHEMA_VERSION;
  reviewedAt: string;
  baselines: ModelGatewayVersionBaseline[];
  excluded: ModelGatewayExcludedLanguage[];
};

const VERSION_PATTERN = /^\d+(?:\.\d+)+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertBaselineDocument(
  value: unknown
): asserts value is ModelGatewayVersionBaselineDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Model gateway version baseline document must be an object.');
  }
  const document = value as Partial<ModelGatewayVersionBaselineDocument>;
  if (document.schemaVersion !== MODEL_GATEWAY_VERSION_BASELINES_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported model gateway version baseline schema: ${String(document.schemaVersion)}`
    );
  }
  if (typeof document.reviewedAt !== 'string' || !DATE_PATTERN.test(document.reviewedAt)) {
    throw new Error('Model gateway version baseline document is missing reviewedAt.');
  }
  if (!Array.isArray(document.baselines) || document.baselines.length === 0) {
    throw new Error('Model gateway version baseline document contains no adapters.');
  }
  const adapterIds = new Set<string>();
  for (const baseline of document.baselines as ModelGatewayVersionBaseline[]) {
    if (
      !baseline ||
      typeof baseline.adapterId !== 'string' ||
      typeof baseline.gatewayId !== 'string' ||
      typeof baseline.gatewayName !== 'string' ||
      (baseline.runtime !== 'node' && baseline.runtime !== 'python') ||
      baseline.policy !== 'tested-baseline' ||
      baseline.releaseChannel !== 'stable' ||
      !VERSION_PATTERN.test(baseline.sdkVersion) ||
      !DATE_PATTERN.test(baseline.discoveryDate) ||
      typeof baseline.declaredMaturity !== 'string' ||
      /beta|alpha|preview|rc|canary|next|dev/i.test(baseline.declaredMaturity) ||
      typeof baseline.runtimeRequirement !== 'string' ||
      typeof baseline.upstreamReleaseUrl !== 'string' ||
      !baseline.upstreamReleaseUrl.startsWith('https://') ||
      typeof baseline.registryUrl !== 'string' ||
      !baseline.registryUrl.startsWith('https://') ||
      baseline.automaticUpgrade !== false ||
      !Array.isArray(baseline.packages) ||
      baseline.packages.length === 0
    ) {
      throw new Error(`Invalid model gateway version baseline: ${String(baseline?.adapterId)}`);
    }
    if (adapterIds.has(baseline.adapterId)) {
      throw new Error(`Duplicate model gateway version baseline: ${baseline.adapterId}`);
    }
    adapterIds.add(baseline.adapterId);
    const packageNames = new Set<string>();
    let sdkCoreVersion: string | null = null;
    for (const dependency of baseline.packages) {
      if (
        !dependency ||
        (dependency.ecosystem !== 'npm' && dependency.ecosystem !== 'pypi') ||
        typeof dependency.name !== 'string' ||
        !VERSION_PATTERN.test(dependency.version) ||
        dependency.channel !== 'stable' ||
        (dependency.role !== 'sdk-core' && dependency.role !== 'runtime-support') ||
        typeof dependency.registryUrl !== 'string' ||
        !dependency.registryUrl.startsWith('https://')
      ) {
        throw new Error(`Invalid package baseline in ${baseline.adapterId}.`);
      }
      if (packageNames.has(dependency.name)) {
        throw new Error(`Duplicate package ${dependency.name} in ${baseline.adapterId}.`);
      }
      packageNames.add(dependency.name);
      if (dependency.role === 'sdk-core') sdkCoreVersion = dependency.version;
    }
    if (!sdkCoreVersion || sdkCoreVersion !== baseline.sdkVersion) {
      throw new Error(`SDK version is not bound to the core package in ${baseline.adapterId}.`);
    }
  }
  if (!Array.isArray(document.excluded)) {
    throw new Error('Model gateway version baseline document must declare excluded languages.');
  }
}

assertBaselineDocument(versionBaselineDocument);
const validated = versionBaselineDocument as ModelGatewayVersionBaselineDocument;

export const BUILTIN_MODEL_GATEWAY_VERSION_BASELINES: readonly ModelGatewayVersionBaseline[] =
  Object.freeze(
    structuredClone(validated.baselines).map((baseline) =>
      Object.freeze({
        ...baseline,
        packages: Object.freeze(baseline.packages.map((dependency) => Object.freeze(dependency))),
      })
    )
  );

export const EXCLUDED_MODEL_GATEWAY_LANGUAGES: readonly ModelGatewayExcludedLanguage[] =
  Object.freeze(structuredClone(validated.excluded).map((entry) => Object.freeze({ ...entry })));

export const MODEL_GATEWAY_BASELINES_REVIEWED_AT = validated.reviewedAt;

export function getModelGatewayVersionBaseline(
  adapterId: string
): ModelGatewayVersionBaseline | null {
  return (
    BUILTIN_MODEL_GATEWAY_VERSION_BASELINES.find((entry) => entry.adapterId === adapterId) ?? null
  );
}

export function packageVersion(baseline: ModelGatewayVersionBaseline, packageName: string): string {
  const dependency = baseline.packages.find((entry) => entry.name === packageName);
  if (!dependency) {
    throw new Error(`Package ${packageName} is not in baseline ${baseline.adapterId}.`);
  }
  return dependency.version;
}

export function sdkCorePackage(baseline: ModelGatewayVersionBaseline): ModelGatewayPackageBaseline {
  const dependency = baseline.packages.find((entry) => entry.role === 'sdk-core');
  if (!dependency) {
    throw new Error(`Baseline ${baseline.adapterId} is missing an sdk-core package.`);
  }
  return dependency;
}
