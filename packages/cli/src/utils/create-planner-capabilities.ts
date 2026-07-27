import { listFrontendGenerators } from '../frontend-project.js';
import { listOfficialProjectGenerators } from '../official-project.js';
import { listInteractiveKits, normalizeKitId } from './kit-registry.js';

export type CreatePlannerLane = 'native' | 'official' | 'existing';
export type CreatePlannerStatus = 'available' | 'planned';

export interface OfficialCreateCandidate {
  id: string;
  aliases: string[];
  ecosystem: string;
  status: CreatePlannerStatus;
  canExecuteCreate: boolean;
  versionPolicy: 'latest-stable' | 'planned';
  officialCommands: string[];
  adoptAfterCreate: true;
}

export interface CreatePlannerCapability {
  lane: CreatePlannerLane;
  status: CreatePlannerStatus;
  canExecuteCreate: boolean;
  requested: string;
  resolved?: string;
  officialCommands?: string[];
  fallbackLane?: 'existing';
  reason: string;
}

const NATIVE_CREATE_KITS = new Set(listInteractiveKits().map((kit) => kit.id));

export const OFFICIAL_CREATE_CANDIDATES: OfficialCreateCandidate[] = [
  ...listFrontendGenerators().map((definition) => ({
    id: definition.kitId,
    aliases: [...definition.aliases],
    ecosystem: definition.framework,
    status: 'available' as const,
    canExecuteCreate: true,
    versionPolicy: definition.versionPolicy,
    officialCommands: [definition.commandDisplay('<name>', { skipGit: false, skipInstall: false })],
    adoptAfterCreate: true as const,
  })),
  ...listOfficialProjectGenerators().map((definition) => ({
    id: definition.kitId,
    aliases: [...definition.aliases],
    ecosystem: definition.framework,
    status: 'available' as const,
    canExecuteCreate: true,
    versionPolicy: definition.versionPolicy,
    officialCommands: [definition.commandDisplay('<name>', { skipGit: false, skipInstall: false })],
    adoptAfterCreate: true as const,
  })),
  {
    id: 'wordpress-site',
    aliases: ['wordpress', 'wordpress-site', 'wp', 'wp-site'],
    ecosystem: 'wordpress',
    status: 'planned',
    canExecuteCreate: false,
    versionPolicy: 'planned',
    officialCommands: ['wp core download', 'wp config create', 'wp db create', 'wp core install'],
    adoptAfterCreate: true,
  },
  {
    id: 'wordpress-block',
    aliases: ['wordpress-block', 'wp-block', 'gutenberg-block'],
    ecosystem: 'wordpress',
    status: 'planned',
    canExecuteCreate: false,
    versionPolicy: 'planned',
    officialCommands: ['npx @wordpress/create-block@latest <slug>'],
    adoptAfterCreate: true,
  },
  {
    id: 'symfony',
    aliases: ['symfony', 'php-symfony'],
    ecosystem: 'php',
    status: 'planned',
    canExecuteCreate: false,
    versionPolicy: 'planned',
    officialCommands: ['composer create-project symfony/skeleton <name>'],
    adoptAfterCreate: true,
  },
  {
    id: 'rails',
    aliases: ['rails', 'ruby-on-rails', 'ruby-rails'],
    ecosystem: 'ruby',
    status: 'planned',
    canExecuteCreate: false,
    versionPolicy: 'planned',
    officialCommands: ['rails new <name>'],
    adoptAfterCreate: true,
  },
];

const OFFICIAL_BY_ALIAS = new Map<string, OfficialCreateCandidate>();
for (const candidate of OFFICIAL_CREATE_CANDIDATES) {
  OFFICIAL_BY_ALIAS.set(candidate.id, candidate);
  for (const alias of candidate.aliases) {
    OFFICIAL_BY_ALIAS.set(alias, candidate);
  }
}

const EXISTING_RUNTIME_ALIASES = new Set([
  'php',
  'ruby',
  'rust',
  'elixir',
  'clojure',
  'scala',
  'kotlin',
  'unknown',
]);

function normalizeCapabilitySignal(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function resolveCreatePlannerCapability(input: {
  kitId?: string;
  framework?: string;
  runtime?: string;
  projectExists?: boolean;
}): CreatePlannerCapability {
  const requested =
    normalizeCapabilitySignal(input.kitId) ??
    normalizeCapabilitySignal(input.framework) ??
    normalizeCapabilitySignal(input.runtime) ??
    'unknown';

  if (input.projectExists) {
    return {
      lane: 'existing',
      status: 'available',
      canExecuteCreate: false,
      requested,
      reason: 'Existing projects enter Workspace Intelligence through adopt/import.',
    };
  }

  const normalizedKit = input.kitId ? normalizeKitId(input.kitId) : undefined;
  if (normalizedKit && NATIVE_CREATE_KITS.has(normalizedKit)) {
    return {
      lane: 'native',
      status: 'available',
      canExecuteCreate: true,
      requested,
      resolved: normalizedKit,
      reason:
        'Workspai owns the create contract, project marker, registry, doctor, and workspace model path.',
    };
  }

  const official =
    OFFICIAL_BY_ALIAS.get(requested) ??
    OFFICIAL_BY_ALIAS.get(normalizeCapabilitySignal(input.framework) ?? '') ??
    OFFICIAL_BY_ALIAS.get(normalizeCapabilitySignal(input.runtime) ?? '');
  if (official) {
    return {
      lane: 'official',
      status: official.status,
      canExecuteCreate: official.canExecuteCreate,
      requested,
      resolved: official.id,
      officialCommands: official.officialCommands,
      fallbackLane: official.canExecuteCreate ? undefined : 'existing',
      reason:
        official.status === 'available'
          ? 'Workspai runs the official ecosystem generator, then registers the project in Workspace Intelligence.'
          : 'Official generator support is planned but not enabled; use adopt/import until Workspai owns the post-create contract.',
    };
  }

  const runtime = normalizeCapabilitySignal(input.runtime);
  if (runtime && EXISTING_RUNTIME_ALIASES.has(runtime)) {
    return {
      lane: 'existing',
      status: 'available',
      canExecuteCreate: false,
      requested,
      resolved: runtime,
      reason:
        'Runtime can be governed through Workspace Intelligence, but native create is not supported.',
    };
  }

  return {
    lane: 'existing',
    status: 'available',
    canExecuteCreate: false,
    requested,
    reason:
      'No native create contract is available; use adopt/import to enter Workspace Intelligence.',
  };
}

export function shouldBlockUnsupportedNativeCreate(capability: CreatePlannerCapability): boolean {
  return (
    !capability.canExecuteCreate &&
    (capability.lane === 'official' ||
      (capability.lane === 'existing' && capability.resolved !== undefined))
  );
}
