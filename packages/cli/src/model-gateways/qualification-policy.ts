import qualificationDocument from './qualification.v1.json';
import {
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES,
  getModelGatewayVersionBaseline,
} from './version-policy.js';

export const MODEL_GATEWAY_QUALIFICATION_SCHEMA_VERSION =
  'workspai.model-gateway-qualification.v1' as const;

export type ModelGatewayQualificationStatus = 'source-ready' | 'qualified';
export type ModelGatewayAttachPolicy = 'unsupported';

export type ModelGatewayQualifiedPlatform = {
  os: 'ubuntu-latest' | 'macos-latest' | 'windows-latest';
  sdkVersion: string;
  result: 'pass';
  skippedRequiredStage: false;
  workflowRun?: string;
  generatedOutputDigest?: string;
  qualifiedAt?: string;
};

export type ModelGatewayAdapterQualification = {
  adapterId: string;
  status: ModelGatewayQualificationStatus;
  platforms: readonly ModelGatewayQualifiedPlatform[];
};

export type ModelGatewayQualificationDocument = {
  schemaVersion: typeof MODEL_GATEWAY_QUALIFICATION_SCHEMA_VERSION;
  workspaiReleaseAuthority: ModelGatewayQualificationStatus;
  attach: ModelGatewayAttachPolicy;
  adapters: readonly ModelGatewayAdapterQualification[];
};

const REQUIRED_PLATFORMS = ['ubuntu-latest', 'macos-latest', 'windows-latest'] as const;

function assertQualificationDocument(
  value: unknown
): asserts value is ModelGatewayQualificationDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Model gateway qualification document must be an object.');
  }
  const document = value as Partial<ModelGatewayQualificationDocument>;
  if (document.schemaVersion !== MODEL_GATEWAY_QUALIFICATION_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported model gateway qualification schema: ${String(document.schemaVersion)}`
    );
  }
  if (document.attach !== 'unsupported') {
    throw new Error('Model gateway Attach must be explicitly unsupported for this surface.');
  }
  if (
    document.workspaiReleaseAuthority !== 'source-ready' &&
    document.workspaiReleaseAuthority !== 'qualified'
  ) {
    throw new Error('Model gateway release authority must be source-ready or qualified.');
  }
  if (!Array.isArray(document.adapters) || document.adapters.length === 0) {
    throw new Error('Model gateway qualification document contains no adapters.');
  }
  const adapterIds = new Set<string>();
  for (const adapter of document.adapters) {
    if (!adapter || typeof adapter.adapterId !== 'string') {
      throw new Error('Model gateway qualification adapter is missing adapterId.');
    }
    if (adapterIds.has(adapter.adapterId)) {
      throw new Error(`Duplicate model gateway qualification adapter: ${adapter.adapterId}`);
    }
    adapterIds.add(adapter.adapterId);
    const baseline = getModelGatewayVersionBaseline(adapter.adapterId);
    if (!baseline) {
      throw new Error(`Qualification adapter ${adapter.adapterId} is not in the version baseline.`);
    }
    if (adapter.status !== 'source-ready' && adapter.status !== 'qualified') {
      throw new Error(`Invalid qualification status for ${adapter.adapterId}.`);
    }
    if (!Array.isArray(adapter.platforms)) {
      throw new Error(`Qualification platforms missing for ${adapter.adapterId}.`);
    }
    if (adapter.status === 'source-ready') {
      if (adapter.platforms.length !== 0) {
        throw new Error(
          `Source-ready adapter ${adapter.adapterId} must not record platform qualification.`
        );
      }
      continue;
    }
    const seen = new Set<string>();
    for (const platform of adapter.platforms) {
      if (
        !platform ||
        !REQUIRED_PLATFORMS.includes(platform.os) ||
        platform.result !== 'pass' ||
        platform.skippedRequiredStage !== false ||
        platform.sdkVersion !== baseline.sdkVersion
      ) {
        throw new Error(
          `Qualified adapter ${adapter.adapterId} is missing a valid platform record bound to ${baseline.sdkVersion}.`
        );
      }
      if (seen.has(platform.os)) {
        throw new Error(`Duplicate platform ${platform.os} for ${adapter.adapterId}.`);
      }
      seen.add(platform.os);
    }
    for (const os of REQUIRED_PLATFORMS) {
      if (!seen.has(os)) {
        throw new Error(`Qualified adapter ${adapter.adapterId} is missing ${os} evidence.`);
      }
    }
  }
  for (const baseline of BUILTIN_MODEL_GATEWAY_VERSION_BASELINES) {
    if (!adapterIds.has(baseline.adapterId)) {
      throw new Error(`Baseline adapter ${baseline.adapterId} has no qualification record.`);
    }
  }
  const allQualified = document.adapters.every((adapter) => adapter.status === 'qualified');
  if (document.workspaiReleaseAuthority === 'qualified' && !allQualified) {
    throw new Error('Workspai release authority cannot be qualified while an adapter is not.');
  }
  if (document.workspaiReleaseAuthority === 'source-ready' && allQualified) {
    throw new Error('All adapters are qualified; release authority must match.');
  }
}

assertQualificationDocument(qualificationDocument);
const validated = qualificationDocument as ModelGatewayQualificationDocument;

export const MODEL_GATEWAY_QUALIFICATION: ModelGatewayQualificationDocument = Object.freeze({
  schemaVersion: validated.schemaVersion,
  workspaiReleaseAuthority: validated.workspaiReleaseAuthority,
  attach: validated.attach,
  adapters: Object.freeze(
    validated.adapters.map((adapter) =>
      Object.freeze({
        ...adapter,
        platforms: Object.freeze(adapter.platforms.map((platform) => Object.freeze(platform))),
      })
    )
  ),
});

export const MODEL_GATEWAY_ATTACH_POLICY: ModelGatewayAttachPolicy =
  MODEL_GATEWAY_QUALIFICATION.attach;

export const MODEL_GATEWAY_RELEASE_AUTHORITY: ModelGatewayQualificationStatus =
  MODEL_GATEWAY_QUALIFICATION.workspaiReleaseAuthority;

export function isModelGatewayReleaseQualified(): boolean {
  return MODEL_GATEWAY_RELEASE_AUTHORITY === 'qualified';
}

export function modelGatewayPickerHint(runtime: string): string {
  return `${runtime} · ${MODEL_GATEWAY_RELEASE_AUTHORITY}`;
}
