import {
  DOCTOR_ADAPTER_CONTRACT_VERSION,
  DOCTOR_DIAGNOSTIC_DOMAINS,
  DoctorAdapterRegistry,
  type DoctorAdapterDescriptor,
  type DoctorAdapterTier,
  type DoctorCapabilityLevel,
  type DoctorDiagnosticDomain,
  type DoctorDomainCapability,
} from './adapter-contract.js';
import {
  DOCTOR_CAPABILITIES_SCHEMA_VERSION,
  DOCTOR_CAPABILITY_REGISTRY_VERSION,
} from '../contracts/doctor-capabilities-contract.js';
export {
  DOCTOR_CAPABILITIES_SCHEMA_VERSION,
  DOCTOR_CAPABILITY_REGISTRY_VERSION,
} from '../contracts/doctor-capabilities-contract.js';

type RuntimeDefinition = {
  id: string;
  aliases?: string[];
  frameworks: string[];
  tier: DoctorAdapterTier;
  native?: DoctorDiagnosticDomain[];
  portable?: DoctorDiagnosticDomain[];
  observable?: DoctorDiagnosticDomain[];
  limitations?: string[];
};

const ALL_DOMAINS = [...DOCTOR_DIAGNOSTIC_DOMAINS];
const ALL_PLATFORMS = ['linux', 'darwin', 'win32'] as const;

const RUNTIME_DEFINITIONS: RuntimeDefinition[] = [
  {
    id: 'node',
    aliases: ['nodejs', 'javascript', 'typescript'],
    frameworks: [
      'NestJS',
      'Next.js',
      'Remix',
      'Nuxt',
      'React',
      'Vue',
      'Angular',
      'SvelteKit',
      'Svelte',
      'Vite',
      'Astro',
      'Solid',
      'Express',
      'Fastify',
      'Koa',
      'Electron',
      'VS Code Extension',
    ],
    tier: 'first-class',
    native: ALL_DOMAINS,
  },
  {
    id: 'python',
    aliases: ['py'],
    frameworks: ['FastAPI', 'Django', 'Flask', 'Python'],
    tier: 'first-class',
    native: ALL_DOMAINS,
  },
  {
    id: 'go',
    aliases: ['golang'],
    frameworks: ['Go', 'Go/Fiber', 'Go/Gin', 'Echo'],
    tier: 'first-class',
    native: ['runtime', 'dependency', 'test', 'quality'],
    portable: ['security', 'configuration'],
  },
  {
    id: 'java',
    aliases: ['jvm'],
    frameworks: ['Java', 'Spring Boot'],
    tier: 'first-class',
    native: ['runtime', 'dependency', 'test', 'quality'],
    portable: ['security', 'configuration'],
  },
  {
    id: 'dotnet',
    aliases: ['.net', 'csharp', 'c#'],
    frameworks: ['ASP.NET'],
    tier: 'first-class',
    native: ['runtime', 'dependency', 'test', 'quality'],
    portable: ['security', 'configuration'],
  },
  {
    id: 'rust',
    aliases: ['cargo'],
    frameworks: ['Rust', 'Axum'],
    tier: 'first-class',
    native: ['runtime', 'dependency', 'test', 'quality'],
    portable: ['security', 'configuration'],
  },
  {
    id: 'php',
    aliases: ['composer'],
    frameworks: ['PHP', 'Laravel'],
    tier: 'first-class',
    native: ['runtime', 'dependency', 'security'],
    portable: ['configuration', 'test', 'quality'],
  },
  {
    id: 'ruby',
    aliases: ['bundler'],
    frameworks: ['Ruby', 'Ruby on Rails'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'configuration', 'test', 'quality'],
    observable: ['security'],
  },
  {
    id: 'elixir',
    aliases: ['beam'],
    frameworks: ['Elixir', 'Phoenix'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'configuration', 'test', 'quality'],
    observable: ['security'],
  },
  {
    id: 'clojure',
    frameworks: ['Clojure'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'configuration', 'test', 'quality'],
    observable: ['security'],
  },
  {
    id: 'deno',
    frameworks: ['Deno'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'configuration', 'test', 'quality'],
    observable: ['security'],
  },
  {
    id: 'bun',
    frameworks: ['Bun'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'configuration', 'test', 'quality'],
    observable: ['security'],
  },
  {
    id: 'scala',
    frameworks: ['Scala'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'configuration', 'test', 'quality'],
    observable: ['security'],
  },
  {
    id: 'kotlin',
    frameworks: ['Kotlin'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'configuration', 'test', 'quality'],
    observable: ['security'],
  },
  {
    id: 'c',
    aliases: ['c-lang'],
    frameworks: ['C'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'test', 'quality'],
    observable: ['configuration'],
    limitations: ['Security diagnosis requires a declared native scanner or workspace adapter.'],
  },
  {
    id: 'cpp',
    aliases: ['c++', 'cplusplus'],
    frameworks: ['C++'],
    tier: 'extended',
    portable: ['runtime', 'dependency', 'test', 'quality'],
    observable: ['configuration'],
    limitations: ['Security diagnosis requires a declared native scanner or workspace adapter.'],
  },
];

function evidenceSources(runtime: string, domain: DoctorDiagnosticDomain): string[] {
  const generic: Record<DoctorDiagnosticDomain, string[]> = {
    runtime: ['project markers', 'entrypoints', 'toolchain evidence'],
    dependency: ['dependency manifests', 'lockfiles', 'installed-tree evidence'],
    security: ['runtime-native audit', 'advisory evidence'],
    configuration: ['environment contracts', 'deployment/container markers'],
    test: ['test scripts', 'test configuration', 'coverage evidence'],
    quality: ['lint/format/static-analysis contracts'],
  };
  return [`${runtime} adapter`, ...generic[domain]];
}

function levelFor(
  definition: RuntimeDefinition,
  domain: DoctorDiagnosticDomain
): DoctorCapabilityLevel {
  if (definition.native?.includes(domain)) return 'native';
  if (definition.portable?.includes(domain)) return 'portable';
  if (definition.observable?.includes(domain)) return 'observable';
  return 'unsupported';
}

function descriptorFor(definition: RuntimeDefinition): DoctorAdapterDescriptor {
  const domains: DoctorDomainCapability[] = DOCTOR_DIAGNOSTIC_DOMAINS.map((domain) => {
    const level = levelFor(definition, domain);
    return {
      domain,
      level,
      evidenceSources: level === 'unsupported' ? [] : evidenceSources(definition.id, domain),
      limitations:
        level === 'unsupported'
          ? [`${definition.id} has no built-in ${domain} provider; declare a workspace adapter.`]
          : level === 'observable'
            ? [`${domain} evidence is observable but not runtime-native for ${definition.id}.`]
            : [],
    };
  });
  return {
    contractVersion: DOCTOR_ADAPTER_CONTRACT_VERSION,
    id: `builtin.${definition.id}`,
    runtimeFamilies: [definition.id],
    aliases: definition.aliases ?? [],
    frameworks: definition.frameworks,
    projectKinds: ['backend', 'frontend', 'desktop', 'extension', 'fullstack', 'generic'],
    tier: definition.tier,
    platforms: [...ALL_PLATFORMS],
    domains,
    repairModes: ['typed-operation', 'structured-invocation', 'manual-guidance'],
    source: 'builtin',
    limitations: definition.limitations ?? [],
  };
}

function fallbackDescriptor(): DoctorAdapterDescriptor {
  return {
    contractVersion: DOCTOR_ADAPTER_CONTRACT_VERSION,
    id: 'builtin.unknown',
    runtimeFamilies: ['unknown'],
    aliases: ['generic', 'unrecognized'],
    frameworks: ['Unknown'],
    projectKinds: ['backend', 'frontend', 'desktop', 'extension', 'fullstack', 'generic'],
    tier: 'fallback',
    platforms: [...ALL_PLATFORMS],
    domains: DOCTOR_DIAGNOSTIC_DOMAINS.map((domain) => ({
      domain,
      level: domain === 'security' ? 'unsupported' : 'observable',
      evidenceSources:
        domain === 'security' ? [] : ['portable workspace markers', 'declared custom checks'],
      limitations: [
        domain === 'security'
          ? 'No safe security claim is possible without a runtime-native audit provider.'
          : `Only portable ${domain} evidence is available until a runtime adapter is registered.`,
      ],
    })),
    repairModes: ['manual-guidance'],
    source: 'builtin',
    limitations: [
      'Unknown runtimes are fail-closed: missing domain evidence is reported as unknown, never healthy.',
      'Automatic repair is unavailable until a typed adapter owns the runtime.',
    ],
  };
}

export function createBuiltinDoctorAdapterRegistry(): DoctorAdapterRegistry {
  const registry = new DoctorAdapterRegistry();
  for (const definition of RUNTIME_DEFINITIONS) registry.register(descriptorFor(definition));
  registry.register(fallbackDescriptor());
  return registry;
}

export type DoctorCapabilityAssessment = {
  registryVersion: typeof DOCTOR_CAPABILITY_REGISTRY_VERSION;
  adapterId: string;
  runtimeFamily: string;
  tier: DoctorAdapterTier;
  confidence: 'high' | 'medium' | 'low';
  nativeDomains: DoctorDiagnosticDomain[];
  portableDomains: DoctorDiagnosticDomain[];
  observableDomains: DoctorDiagnosticDomain[];
  unsupportedDomains: DoctorDiagnosticDomain[];
  limitations: string[];
};

export function assessDoctorCapability(
  input: {
    runtimeFamily?: string;
    framework?: string;
  },
  registry: DoctorAdapterRegistry = createBuiltinDoctorAdapterRegistry()
): DoctorCapabilityAssessment {
  const resolution = registry.resolveWithDiagnostics(input);
  const matched = resolution.descriptor ?? registry.resolve({ runtimeFamily: 'unknown' });
  if (!matched) throw new Error('Doctor fallback adapter is not registered.');
  const domainsAt = (level: DoctorCapabilityLevel) =>
    matched.domains.filter((entry) => entry.level === level).map((entry) => entry.domain);
  return {
    registryVersion: DOCTOR_CAPABILITY_REGISTRY_VERSION,
    adapterId: matched.id,
    runtimeFamily: matched.runtimeFamilies[0] ?? 'unknown',
    tier: matched.tier,
    confidence:
      matched.tier === 'first-class' ? 'high' : matched.tier === 'extended' ? 'medium' : 'low',
    nativeDomains: domainsAt('native'),
    portableDomains: domainsAt('portable'),
    observableDomains: domainsAt('observable'),
    unsupportedDomains: domainsAt('unsupported'),
    limitations: [
      ...(resolution.status === 'conflict'
        ? [
            `Runtime/framework ownership conflict (${resolution.runtimeOwner} vs ${resolution.frameworkOwner}); Doctor failed closed instead of selecting an ambiguous adapter.`,
          ]
        : []),
      ...matched.limitations,
      ...matched.domains.flatMap((entry) => entry.limitations),
    ],
  };
}

export type DoctorCapabilitiesReport = {
  schemaVersion: typeof DOCTOR_CAPABILITIES_SCHEMA_VERSION;
  registryVersion: typeof DOCTOR_CAPABILITY_REGISTRY_VERSION;
  generatedBy: 'workspai';
  policy: {
    unknownIsHealthy: false;
    unsupportedIsHealthy: false;
    repairRequiresTypedOperation: true;
    canonicalDomains: DoctorDiagnosticDomain[];
  };
  summary: {
    adapterCount: number;
    firstClassRuntimes: number;
    extendedRuntimes: number;
    fallbackRuntimes: number;
    frameworkCount: number;
    platformCount: number;
  };
  adapters: DoctorAdapterDescriptor[];
};

export function buildDoctorCapabilitiesReport(
  filter: {
    runtime?: string;
    framework?: string;
  } = {}
): DoctorCapabilitiesReport {
  const registry = createBuiltinDoctorAdapterRegistry();
  const all = registry.list();
  const resolution = registry.resolveWithDiagnostics({
    runtimeFamily: filter.runtime,
    framework: filter.framework,
  });
  const selected = filter.runtime || filter.framework ? [resolution.descriptor] : all;
  if ((filter.runtime || filter.framework) && !selected[0]) {
    const fallback = registry.resolve({ runtimeFamily: 'unknown' });
    if (fallback) {
      if (resolution.status === 'conflict') {
        fallback.limitations.unshift(
          `Runtime/framework ownership conflict (${resolution.runtimeOwner} vs ${resolution.frameworkOwner}); Doctor failed closed instead of selecting an ambiguous adapter.`
        );
      }
      selected[0] = fallback;
    }
  }
  const resolved = selected.filter((entry): entry is DoctorAdapterDescriptor => Boolean(entry));
  return {
    schemaVersion: DOCTOR_CAPABILITIES_SCHEMA_VERSION,
    registryVersion: DOCTOR_CAPABILITY_REGISTRY_VERSION,
    generatedBy: 'workspai',
    policy: {
      unknownIsHealthy: false,
      unsupportedIsHealthy: false,
      repairRequiresTypedOperation: true,
      canonicalDomains: [...DOCTOR_DIAGNOSTIC_DOMAINS],
    },
    summary: {
      adapterCount: resolved.length,
      firstClassRuntimes: resolved.filter((entry) => entry.tier === 'first-class').length,
      extendedRuntimes: resolved.filter((entry) => entry.tier === 'extended').length,
      fallbackRuntimes: resolved.filter((entry) => entry.tier === 'fallback').length,
      frameworkCount: new Set(resolved.flatMap((entry) => entry.frameworks)).size,
      platformCount: new Set(resolved.flatMap((entry) => entry.platforms)).size,
    },
    adapters: resolved,
  };
}
