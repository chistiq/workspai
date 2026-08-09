export const DOCTOR_ADAPTER_CONTRACT_VERSION = 'workspai.doctor-adapter.v1' as const;

export const DOCTOR_DIAGNOSTIC_DOMAINS = [
  'runtime',
  'dependency',
  'security',
  'configuration',
  'test',
  'quality',
] as const;

export type DoctorDiagnosticDomain = (typeof DOCTOR_DIAGNOSTIC_DOMAINS)[number];
export type DoctorCapabilityLevel = 'native' | 'portable' | 'observable' | 'unsupported';
export type DoctorAdapterTier = 'first-class' | 'extended' | 'fallback';
export type DoctorAdapterPlatform = 'linux' | 'darwin' | 'win32';

export type DoctorDomainCapability = {
  domain: DoctorDiagnosticDomain;
  level: DoctorCapabilityLevel;
  evidenceSources: string[];
  limitations: string[];
};

/**
 * Data-only adapter boundary. It deliberately contains no Commander, logger,
 * workspace-registry, or UI dependencies so it can move to a standalone
 * package without changing its public semantics.
 */
export type DoctorAdapterDescriptor = {
  contractVersion: typeof DOCTOR_ADAPTER_CONTRACT_VERSION;
  id: string;
  runtimeFamilies: string[];
  aliases: string[];
  frameworks: string[];
  projectKinds: string[];
  tier: DoctorAdapterTier;
  platforms: DoctorAdapterPlatform[];
  domains: DoctorDomainCapability[];
  repairModes: Array<'typed-operation' | 'structured-invocation' | 'manual-guidance'>;
  source: 'builtin' | 'workspace' | 'package';
  limitations: string[];
};

export type DoctorAdapterResolution = {
  status: 'matched' | 'unresolved' | 'conflict';
  descriptor: DoctorAdapterDescriptor | null;
  runtimeOwner?: string;
  frameworkOwner?: string;
};

function normalizedToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+.#-]+/g, '-');
}

function assertDescriptor(descriptor: DoctorAdapterDescriptor): void {
  if (descriptor.contractVersion !== DOCTOR_ADAPTER_CONTRACT_VERSION) {
    throw new Error(`Unsupported Doctor adapter contract: ${descriptor.contractVersion}`);
  }
  if (!descriptor.id.trim()) throw new Error('Doctor adapter id must not be empty.');
  if (descriptor.runtimeFamilies.length === 0) {
    throw new Error(`Doctor adapter ${descriptor.id} must own at least one runtime family.`);
  }
  if (descriptor.platforms.length === 0) {
    throw new Error(`Doctor adapter ${descriptor.id} must declare supported platforms.`);
  }
  const domainIds = descriptor.domains.map((entry) => entry.domain);
  if (
    domainIds.length !== DOCTOR_DIAGNOSTIC_DOMAINS.length ||
    new Set(domainIds).size !== DOCTOR_DIAGNOSTIC_DOMAINS.length ||
    DOCTOR_DIAGNOSTIC_DOMAINS.some((domain) => !domainIds.includes(domain))
  ) {
    throw new Error(
      `Doctor adapter ${descriptor.id} must declare every canonical diagnostic domain exactly once.`
    );
  }
  for (const domain of descriptor.domains) {
    if (domain.level === 'unsupported' && domain.limitations.length === 0) {
      throw new Error(
        `Doctor adapter ${descriptor.id} must explain unsupported ${domain.domain} coverage.`
      );
    }
  }
}

export class DoctorAdapterRegistry {
  readonly #adapters = new Map<string, DoctorAdapterDescriptor>();
  readonly #runtimeIndex = new Map<string, string>();
  readonly #frameworkIndex = new Map<string, string>();

  register(descriptor: DoctorAdapterDescriptor): this {
    assertDescriptor(descriptor);
    const adapterId = normalizedToken(descriptor.id);
    if (this.#adapters.has(adapterId)) {
      throw new Error(`Doctor adapter id is already registered: ${descriptor.id}`);
    }
    const runtimeTokens = [...descriptor.runtimeFamilies, ...descriptor.aliases].map(
      normalizedToken
    );
    for (const token of runtimeTokens) {
      const owner = this.#runtimeIndex.get(token);
      if (owner) throw new Error(`Doctor runtime ${token} is already owned by adapter ${owner}.`);
    }
    for (const framework of descriptor.frameworks.map(normalizedToken)) {
      const owner = this.#frameworkIndex.get(framework);
      if (owner) {
        throw new Error(`Doctor framework ${framework} is already owned by adapter ${owner}.`);
      }
    }

    const frozen = structuredClone(descriptor);
    this.#adapters.set(adapterId, frozen);
    for (const token of runtimeTokens) this.#runtimeIndex.set(token, adapterId);
    for (const framework of descriptor.frameworks.map(normalizedToken)) {
      this.#frameworkIndex.set(framework, adapterId);
    }
    return this;
  }

  resolveWithDiagnostics(input: {
    runtimeFamily?: string;
    framework?: string;
  }): DoctorAdapterResolution {
    const runtimeOwner = input.runtimeFamily
      ? this.#runtimeIndex.get(normalizedToken(input.runtimeFamily))
      : undefined;
    const frameworkOwner = input.framework
      ? this.#frameworkIndex.get(normalizedToken(input.framework))
      : undefined;
    if (runtimeOwner && frameworkOwner && runtimeOwner !== frameworkOwner) {
      return {
        status: 'conflict',
        descriptor: null,
        runtimeOwner,
        frameworkOwner,
      };
    }
    const owner = runtimeOwner ?? frameworkOwner;
    return {
      status: owner ? 'matched' : 'unresolved',
      descriptor: owner ? structuredClone(this.#adapters.get(owner) ?? null) : null,
      ...(runtimeOwner ? { runtimeOwner } : {}),
      ...(frameworkOwner ? { frameworkOwner } : {}),
    };
  }

  resolve(input: { runtimeFamily?: string; framework?: string }): DoctorAdapterDescriptor | null {
    return this.resolveWithDiagnostics(input).descriptor;
  }

  list(): DoctorAdapterDescriptor[] {
    return [...this.#adapters.values()]
      .map((descriptor) => structuredClone(descriptor))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
