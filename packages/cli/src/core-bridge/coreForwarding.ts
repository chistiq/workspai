import { BOOTSTRAP_CORE_COMMANDS_SET } from './bootstrapCoreCommands.js';

/**
 * Core-advertised top-level commands that the npm wrapper orchestrates locally.
 * These must not bypass wrapper-shared flags purely because they appear in bootstrap metadata.
 */
export const NPM_ORCHESTRATED_CORE_ADVERTISED_COMMANDS = new Set(['create']);

/**
 * Flags used by npm create/workspace UX that are also valid on Python core commands.
 * Presence alone must not prevent core forwarding when the top-level command is core-owned.
 */
export const WRAPPER_SHARED_CLI_FLAGS = new Set([
  '--yes',
  '-y',
  '--skip-git',
  '--skip-install',
  '--debug',
  '--dry-run',
  '--no-update-check',
  '--create-workspace',
  '--no-workspace',
]);

const PYTHON_CORE_CONTEXT_ENGINES = new Set(['pip', 'poetry', 'venv', 'pipx', 'python', 'uv']);

export function isPythonCoreContextEngine(engine: unknown): engine is string {
  return typeof engine === 'string' && PYTHON_CORE_CONTEXT_ENGINES.has(engine);
}

export function isCoreDelegatedTopLevelCommand(
  first: string | undefined,
  cachedCoreCommands: ReadonlySet<string> | null | undefined
): boolean {
  if (!first) {
    return false;
  }

  if (NPM_ORCHESTRATED_CORE_ADVERTISED_COMMANDS.has(first)) {
    return false;
  }

  if (BOOTSTRAP_CORE_COMMANDS_SET.has(first)) {
    return true;
  }

  return cachedCoreCommands?.has(first) ?? false;
}

/**
 * Decide whether an argv slice should be bridged to Python core from inside a project context.
 * Prevents bare workspace names (`my-ws --dry-run`) from being mis-forwarded as core commands.
 */
export function shouldBridgeInvocationToCore(
  args: readonly string[],
  cachedCoreCommands: ReadonlySet<string> | null | undefined = null
): boolean {
  const first = args[0];
  if (!first || first.startsWith('-')) {
    return false;
  }

  if (NPM_ORCHESTRATED_CORE_ADVERTISED_COMMANDS.has(first)) {
    return false;
  }

  if (first === 'init') {
    return false;
  }

  if (isCoreDelegatedTopLevelCommand(first, cachedCoreCommands)) {
    return true;
  }

  const positionalArgs = args.filter(
    (arg) => !arg.startsWith('-') && !WRAPPER_SHARED_CLI_FLAGS.has(arg)
  );
  if (positionalArgs.length <= 1) {
    return false;
  }

  return args.length > 1;
}
