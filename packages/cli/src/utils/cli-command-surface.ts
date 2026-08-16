import { WORKSPACE_INTELLIGENCE_ROOT_COMMANDS } from '../contracts/workspace-intelligence-runtime-registry.js';

type CommanderOptionLike = {
  flags: string;
  attributeName?: () => string;
};

type CommanderCommandLike = {
  name: () => string;
  aliases?: () => string[];
  description?: () => string;
  commands: readonly CommanderCommandLike[];
  options?: readonly CommanderOptionLike[];
  registeredArguments?: ReadonlyArray<{
    name: () => string;
    required: boolean;
    variadic: boolean;
  }>;
  _hidden?: boolean;
};

export type CliCommandRegistrationKind = 'commander' | 'manual-handler';

export const CLI_RUNTIME_COMMAND_INVENTORY_SCHEMA_VERSION =
  'workspai-cli-runtime-command-inventory-v1' as const;

export type CliCommandInventoryEntry = {
  path: string[];
  command: string;
  parent: string | null;
  registrationKind: CliCommandRegistrationKind;
  aliases: string[];
  description: string;
  hidden: boolean;
  arguments: Array<{ name: string; required: boolean; variadic: boolean }>;
  options: Array<{ flags: string; attributeName: string | null }>;
};

export type CliCommandSurfaceIntegrity = {
  ok: boolean;
  registeredButUndeclared: string[];
  declaredButUnregistered: string[];
  registeredScopedButUndeclared: string[];
  declaredScopedButUnregistered: string[];
};

export type CliRuntimeCommandInventory = {
  schemaVersion: typeof CLI_RUNTIME_COMMAND_INVENTORY_SCHEMA_VERSION;
  commands: CliCommandInventoryEntry[];
  topLevelCommands: string[];
  integrity: CliCommandSurfaceIntegrity;
};

/**
 * Canonical top-level commands owned by the npm wrapper.
 *
 * This list is consumed by dispatch, capability discovery, the published
 * runtime command surface, documentation, and external adapters. Keep command
 * ownership here instead of reconstructing it from Commander help text.
 */
export const NPM_ONLY_TOP_LEVEL_COMMANDS = [
  ...WORKSPACE_INTELLIGENCE_ROOT_COMMANDS,
  'autopilot',
  'pipeline',
  'import',
  'adopt',
  'goal',
  'snapshot',
  'bootstrap',
  'setup',
  'cache',
  'mirror',
  'ai',
  'config',
  'product',
  'infra',
  'shell',
  'commands',
  'create',
  'project',
] as const;

/** Commands intentionally dispatched before Commander parsing. */
export const NPM_ONLY_MANUAL_HANDLER_COMMANDS = ['bootstrap', 'setup', 'cache', 'mirror'] as const;

export const NPM_ONLY_CREATE_HANDLER_COMMAND = 'create' as const;

/** All npm-owned roots reachable outside the Commander registration tree. */
export const NPM_ONLY_MANUAL_REGISTERED_COMMANDS = [
  ...NPM_ONLY_MANUAL_HANDLER_COMMANDS,
  NPM_ONLY_CREATE_HANDLER_COMMAND,
] as const;

const MANUAL_COMMAND_DESCRIPTIONS: Readonly<Record<string, string>> = {
  bootstrap: 'Bootstrap project or workspace dependencies through runtime-aware setup rules.',
  setup: 'Prepare a selected runtime toolchain through the supported adapter boundary.',
  cache: 'Inspect or clear Workspai cache state through the managed cache boundary.',
  mirror: 'Coordinate supported mirror lifecycle operations for the current project.',
  create: 'Create a supported workspace or project through the canonical planner boundary.',
};

/** Canonical nested commands registered in the live Commander tree. */
export const NPM_ONLY_SCOPED_COMMANDS = [
  ['ai', 'generate-embeddings'],
  ['ai', 'info'],
  ['ai', 'recommend'],
  ['ai', 'update-embeddings'],
  ['config', 'ai'],
  ['config', 'remove-api-key'],
  ['config', 'set-api-key'],
  ['config', 'show'],
  ['infra', 'down'],
  ['infra', 'plan'],
  ['infra', 'status'],
  ['infra', 'up'],
  ['product', 'manifest'],
  ['product', 'manifest', 'create'],
  ['product', 'plan'],
  ['project', 'commands'],
  ['project', 'coverage'],
  ['project', 'workspace'],
  ['project', 'archives'],
  ['project', 'archive'],
  ['project', 'restore'],
  ['project', 'delete'],
  ['snapshot', 'create'],
  ['snapshot', 'inspect'],
  ['snapshot', 'list'],
  ['snapshot', 'restore'],
] as const;

function compareRuntimeAndDeclaredCommands(
  registered: readonly string[],
  declared: readonly string[],
  registeredScoped: readonly string[],
  declaredScoped: readonly string[]
): CliCommandSurfaceIntegrity {
  const registeredSet = new Set(registered);
  const declaredSet = new Set(declared);
  const registeredButUndeclared = registered.filter((command) => !declaredSet.has(command)).sort();
  const declaredButUnregistered = declared.filter((command) => !registeredSet.has(command)).sort();
  const registeredScopedSet = new Set(registeredScoped);
  const declaredScopedSet = new Set(declaredScoped);
  const registeredScopedButUndeclared = registeredScoped
    .filter((command) => !declaredScopedSet.has(command))
    .sort();
  const declaredScopedButUnregistered = declaredScoped
    .filter((command) => !registeredScopedSet.has(command))
    .sort();
  return {
    ok:
      registeredButUndeclared.length === 0 &&
      declaredButUnregistered.length === 0 &&
      registeredScopedButUndeclared.length === 0 &&
      declaredScopedButUnregistered.length === 0,
    registeredButUndeclared,
    declaredButUnregistered,
    registeredScopedButUndeclared,
    declaredScopedButUnregistered,
  };
}

function commanderInventoryEntries(
  parent: CommanderCommandLike,
  parentPath: readonly string[] = []
): CliCommandInventoryEntry[] {
  return parent.commands.flatMap((command) => {
    const commandName = command.name();
    const commandPath = [...parentPath, commandName];
    const entry: CliCommandInventoryEntry = {
      path: commandPath,
      command: commandName,
      parent: parentPath.length > 0 ? parentPath.join(' ') : null,
      registrationKind: 'commander',
      aliases: command.aliases?.() ?? [],
      description: command.description?.() ?? '',
      hidden: command._hidden === true,
      arguments: (command.registeredArguments ?? []).map((argument) => ({
        name: argument.name(),
        required: argument.required,
        variadic: argument.variadic,
      })),
      options: (command.options ?? []).map((option) => ({
        flags: option.flags,
        attributeName: option.attributeName?.() ?? null,
      })),
    };
    return [entry, ...commanderInventoryEntries(command, commandPath)];
  });
}

/**
 * Build an inventory from the live Commander tree. Static declarations are an
 * independent policy input used only to detect missing or unreachable roots.
 */
export function buildCliRuntimeCommandInventory(
  program: CommanderCommandLike
): CliRuntimeCommandInventory {
  const commanderEntries = commanderInventoryEntries(program);
  const commanderTopLevel = commanderEntries
    .filter((entry) => entry.path.length === 1)
    .map((entry) => entry.command);
  const commanderTopLevelSet = new Set(commanderTopLevel);
  const manualEntries: CliCommandInventoryEntry[] = NPM_ONLY_MANUAL_REGISTERED_COMMANDS.filter(
    (command) => !commanderTopLevelSet.has(command)
  ).map((command) => ({
    path: [command],
    command,
    parent: null,
    registrationKind: 'manual-handler',
    aliases: [],
    description: MANUAL_COMMAND_DESCRIPTIONS[command],
    hidden: false,
    arguments: [],
    options: [],
  }));
  const commands = [...commanderEntries, ...manualEntries].sort((left, right) =>
    left.path.join(' ').localeCompare(right.path.join(' '))
  );
  const topLevelCommands = [
    ...new Set(commands.filter((entry) => entry.path.length === 1).map((entry) => entry.command)),
  ].sort();

  return {
    schemaVersion: CLI_RUNTIME_COMMAND_INVENTORY_SCHEMA_VERSION,
    commands,
    topLevelCommands,
    integrity: compareRuntimeAndDeclaredCommands(
      topLevelCommands,
      NPM_ONLY_TOP_LEVEL_COMMANDS,
      commanderEntries
        .filter((entry) => entry.path.length > 1)
        .map((entry) => entry.path.join(' ')),
      NPM_ONLY_SCOPED_COMMANDS.map((command) => command.join(' '))
    ),
  };
}

export function formatCliCommandSurfaceIntegrityError(
  integrity: CliCommandSurfaceIntegrity
): string {
  const details = [
    integrity.registeredButUndeclared.length > 0
      ? `registered but undeclared: ${integrity.registeredButUndeclared.join(', ')}`
      : null,
    integrity.declaredButUnregistered.length > 0
      ? `declared but unreachable: ${integrity.declaredButUnregistered.join(', ')}`
      : null,
    integrity.registeredScopedButUndeclared.length > 0
      ? `registered scoped but undeclared: ${integrity.registeredScopedButUndeclared.join(', ')}`
      : null,
    integrity.declaredScopedButUnregistered.length > 0
      ? `declared scoped but unreachable: ${integrity.declaredScopedButUnregistered.join(', ')}`
      : null,
  ].filter((value): value is string => value !== null);
  return `CLI command surface integrity violation (${details.join('; ')})`;
}
