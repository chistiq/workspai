export type GoalLifecycleOperation =
  'status' | 'list' | 'activate' | 'cancel' | 'prepare' | 'verify';

export type GoalCommandSelection =
  { operation: 'plan'; intent: string } | { operation: GoalLifecycleOperation };

/**
 * Fail closed on ambiguous command combinations before workspace resolution or
 * artifact writes. This remains model-free so future package extraction can
 * preserve the exact CLI behavior.
 */
export function validateGoalCommandSelection(input: {
  intent?: string;
  status?: boolean | string;
  list?: boolean;
  activate?: string;
  cancel?: string;
  prepare?: string;
  verify?: string;
  scope?: string;
  refresh?: boolean;
  dryRun?: boolean;
  run?: boolean;
}): GoalCommandSelection {
  const selected: GoalLifecycleOperation[] = [
    ...(input.status !== undefined ? (['status'] as const) : []),
    ...(input.list ? (['list'] as const) : []),
    ...(input.activate ? (['activate'] as const) : []),
    ...(input.cancel ? (['cancel'] as const) : []),
    ...(input.prepare ? (['prepare'] as const) : []),
    ...(input.verify ? (['verify'] as const) : []),
  ];
  if (selected.length > 1) {
    throw new Error(
      `Choose exactly one Goal lifecycle operation; received ${selected.join(', ')}.`
    );
  }
  const operation = selected[0];
  if (!operation) {
    if (!input.intent?.trim()) {
      throw new Error('Provide a plain-language intent or use one lifecycle operation.');
    }
    if (input.run === false) {
      throw new Error('--no-run is valid only with --verify.');
    }
    return { operation: 'plan', intent: input.intent.trim() };
  }
  if (input.intent?.trim()) {
    throw new Error(`Do not combine an intent with --${operation}.`);
  }
  if (input.scope || input.refresh || input.dryRun) {
    throw new Error(
      `--${operation} does not accept planning-only --scope, --refresh, or --dry-run options.`
    );
  }
  if (input.run === false && operation !== 'verify') {
    throw new Error('--no-run is valid only with --verify.');
  }
  return { operation };
}
