import path from 'node:path';

import chalk from 'chalk';
import type { Command } from 'commander';
import fsExtra from 'fs-extra';

import type { DecisionEffectReceipt } from '../decisions/decision-contract.js';
import {
  abortProofCarryingChange,
  authorizeProofCarryingChange,
  beginProofCarryingChange,
  exportProofCarryingChangeCapsule,
  inspectProofCarryingChange,
  listProofCarryingChanges,
  recordProofCarryingChangeEffect,
  recordProofCarryingChangePrediction,
  recordProofCarryingChangeVerification,
  resumeProofCarryingChange,
  validateEffectReceiptInput,
  validatePredictedArchitectureChangeInput,
  validateProofCarryingChangeCapsule,
  validateVerificationReceiptInput,
  verifyProofCarryingChange,
} from '../proof-carrying-change.js';
import { resolveProjectWorkspaceSync } from '../project-workspace-link.js';

type CommonOptions = { workspace?: string; json?: boolean };

export function strictVerificationExitCode(input: {
  strict: boolean;
  state: string;
}): number | undefined {
  return input.strict && input.state === 'blocked' ? 2 : undefined;
}

function workspaceFor(options: CommonOptions): string {
  const resolution = resolveProjectWorkspaceSync({
    startPath: process.cwd(),
    explicitWorkspacePath: options.workspace,
    strict: true,
    requireProjectMembership: true,
  });
  if (!resolution) throw new Error('No canonical Workspai workspace could be resolved.');
  return path.resolve(resolution.workspacePath);
}

async function jsonFile(file: string): Promise<unknown> {
  const absolute = path.resolve(process.cwd(), file);
  if (!(await fsExtra.pathExists(absolute))) throw new Error(`JSON input does not exist: ${file}`);
  return fsExtra.readJson(absolute);
}

function printResult(
  payload: Awaited<ReturnType<typeof inspectProofCarryingChange>>,
  json?: boolean
) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const sealed = payload.capsule.status === 'sealed';
  const blocked = payload.capsule.status === 'blocked';
  const icon = sealed ? chalk.green('✓') : blocked ? chalk.red('■') : chalk.cyan('◆');
  console.log(`${icon} Proof-Carrying Change · ${payload.capsule.status}`);
  console.log(chalk.bold(`   ${payload.changeId}`));
  console.log(chalk.gray(`   State: ${payload.state}`));
  console.log(
    chalk.gray(
      `   Assurance: ${payload.capsule.assurances.filter((item) => item.status === 'passed').length}/${payload.capsule.assurances.length} passed`
    )
  );
  if (payload.capsule.remainingUncertainty.length > 0) {
    console.log(chalk.yellow(`   Uncertainty: ${payload.capsule.remainingUncertainty.join(' ')}`));
  }
  console.log(chalk.gray(`   Capsule: ${payload.artifacts.capsule}`));
  for (const next of payload.nextActions) console.log(chalk.gray(`   Next: ${next}`));
}

async function run(
  options: CommonOptions,
  operation: () => Promise<Awaited<ReturnType<typeof inspectProofCarryingChange>>>,
  exitCodeForResult?: (
    result: Awaited<ReturnType<typeof inspectProofCarryingChange>>
  ) => number | undefined
): Promise<void> {
  try {
    const result = await operation();
    printResult(result, options.json);
    const exitCode = exitCodeForResult?.(result);
    if (exitCode !== undefined) process.exitCode = exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'workspai.change-error.v1',
            status: 'error',
            message,
          },
          null,
          2
        )
      );
    } else {
      console.error(chalk.red(`Proof-Carrying Change failed: ${message}`));
    }
    process.exitCode = 1;
  }
}

const EFFECT_CLASSES = new Set<DecisionEffectReceipt['effectClass']>([
  'filesystem',
  'command',
  'configuration',
  'dependency',
  'external',
]);

function parseEffectClasses(value: string): DecisionEffectReceipt['effectClass'][] {
  const values = [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ];
  for (const item of values) {
    if (!EFFECT_CLASSES.has(item as DecisionEffectReceipt['effectClass'])) {
      throw new Error(`Unsupported effect class: ${item}`);
    }
  }
  return values as DecisionEffectReceipt['effectClass'][];
}

function common(command: Command): Command {
  return command
    .option('--workspace <path>', 'Explicit canonical workspace path')
    .option('--json', 'Emit a versioned machine-readable result');
}

export function registerChangeCommands(program: Command): void {
  const change = program
    .command('change')
    .description('Create and verify tamper-evident, architecture-aware change capsules');

  common(change.command('begin').description('Pin an active Goal and architecture baseline'))
    .option('--goal <goal-id>', 'Require this Goal Pack to be the active Goal')
    .action(async (options: CommonOptions & { goal?: string }) => {
      await run(options, () =>
        beginProofCarryingChange({
          workspacePath: workspaceFor(options),
          goalId: options.goal,
        })
      );
    });

  common(
    change.command('list').description('List discoverable change capsules and integrity')
  ).action(async (options: CommonOptions) => {
    try {
      const payload = await listProofCarryingChanges({ workspacePath: workspaceFor(options) });
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log(chalk.bold(`Proof-Carrying Changes · ${payload.summary.total}`));
      if (payload.changes.length === 0) console.log(chalk.gray('  No changes recorded.'));
      for (const item of payload.changes) {
        const icon = item.valid
          ? item.status === 'sealed'
            ? chalk.green('✓')
            : chalk.cyan('◆')
          : chalk.red('■');
        console.log(
          `${icon} ${item.changeId} · ${item.status} · ${item.assurance.passed}/${item.assurance.total}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) console.log(JSON.stringify({ status: 'error', message }, null, 2));
      else console.error(chalk.red(message));
      process.exitCode = 1;
    }
  });

  common(change.command('predict').description('Attach a noncanonical architecture prediction'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .requiredOption('--file <prediction.json>', 'Typed predicted architecture change JSON')
    .action(async (options: CommonOptions & { change: string; file: string }) => {
      await run(options, async () =>
        recordProofCarryingChangePrediction({
          workspacePath: workspaceFor(options),
          changeId: options.change,
          prediction: validatePredictedArchitectureChangeInput(await jsonFile(options.file)),
        })
      );
    });

  common(change.command('authorize').description('Grant bounded effect capabilities'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .requiredOption(
      '--effects <classes>',
      'Comma-separated filesystem,command,configuration,dependency,external classes'
    )
    .option(
      '--granted-by <identity>',
      'Human or policy identity granting authorization',
      'operator'
    )
    .action(
      async (options: CommonOptions & { change: string; effects: string; grantedBy: string }) => {
        await run(options, () =>
          authorizeProofCarryingChange({
            workspacePath: workspaceFor(options),
            changeId: options.change,
            effectClasses: parseEffectClasses(options.effects),
            grantedBy: options.grantedBy,
          })
        );
      }
    );

  common(change.command('resume').description('Resume a blocked transaction with human intent'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .requiredOption('--to <state>', 'Resume target: authorized, executing, or verifying')
    .requiredOption('--reason <text>', 'Durable reason for resuming')
    .option('--actor <identity>', 'Human identity resuming the change', 'operator')
    .action(
      async (
        options: CommonOptions & {
          change: string;
          to: string;
          reason: string;
          actor: string;
        }
      ) => {
        await run(options, () => {
          if (!['authorized', 'executing', 'verifying'].includes(options.to)) {
            throw new Error('--to must be authorized, executing, or verifying.');
          }
          return resumeProofCarryingChange({
            workspacePath: workspaceFor(options),
            changeId: options.change,
            resumeTo: options.to as 'authorized' | 'executing' | 'verifying',
            reason: options.reason,
            actorId: options.actor,
          });
        });
      }
    );

  const effect = change.command('effect').description('Record typed observed effects');
  common(effect.command('record').description('Append an idempotent effect receipt'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .requiredOption('--file <receipt.json>', 'Typed effect receipt JSON')
    .action(async (options: CommonOptions & { change: string; file: string }) => {
      await run(options, async () =>
        recordProofCarryingChangeEffect({
          workspacePath: workspaceFor(options),
          changeId: options.change,
          receipt: validateEffectReceiptInput(await jsonFile(options.file)),
        })
      );
    });

  const verification = change
    .command('verification')
    .description('Record independent Goal-criterion verification');
  common(
    verification.command('record').description('Append an exact-generation verification receipt')
  )
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .requiredOption('--file <receipt.json>', 'Typed verification receipt JSON')
    .action(async (options: CommonOptions & { change: string; file: string }) => {
      await run(options, async () =>
        recordProofCarryingChangeVerification({
          workspacePath: workspaceFor(options),
          changeId: options.change,
          receipt: validateVerificationReceiptInput(await jsonFile(options.file)),
        })
      );
    });

  common(
    change.command('status').description('Inspect the derived transaction and assurance state')
  )
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .action(async (options: CommonOptions & { change: string }) => {
      await run(options, () =>
        inspectProofCarryingChange({
          workspacePath: workspaceFor(options),
          changeId: options.change,
          operation: 'status',
        })
      );
    });

  common(change.command('explain').description('Explain proof, uncertainty, and next actions'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .action(async (options: CommonOptions & { change: string }) => {
      await run(options, () =>
        inspectProofCarryingChange({
          workspacePath: workspaceFor(options),
          changeId: options.change,
          operation: 'explain',
        })
      );
    });

  common(change.command('verify').description('Re-observe architecture and verify exact effects'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .option('--strict', 'Treat advisory Workspace Verify findings as blockers')
    .option('--no-refresh', 'Use current canonical intelligence without refreshing it')
    .action(
      async (options: CommonOptions & { change: string; strict?: boolean; refresh?: boolean }) => {
        await run(
          options,
          () =>
            verifyProofCarryingChange({
              workspacePath: workspaceFor(options),
              changeId: options.change,
              strict: options.strict,
              refresh: options.refresh,
            }),
          (result) =>
            strictVerificationExitCode({ strict: options.strict === true, state: result.state })
        );
      }
    );

  common(change.command('abort').description('Terminate an open change without deleting evidence'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .requiredOption('--reason <text>', 'Durable reason for aborting the change')
    .option('--actor <identity>', 'Human identity aborting the change', 'operator')
    .action(async (options: CommonOptions & { change: string; reason: string; actor: string }) => {
      await run(options, () =>
        abortProofCarryingChange({
          workspacePath: workspaceFor(options),
          changeId: options.change,
          reason: options.reason,
          actorId: options.actor,
        })
      );
    });

  const capsule = change.command('capsule').description('Validate or export a change capsule');
  common(capsule.command('validate').description('Validate capsule and referenced local evidence'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .action(async (options: CommonOptions & { change: string }) => {
      try {
        const validation = await validateProofCarryingChangeCapsule({
          workspacePath: workspaceFor(options),
          changeId: options.change,
        });
        if (options.json) console.log(JSON.stringify(validation, null, 2));
        else
          console.log(
            validation.valid
              ? chalk.green(`✓ Capsule ${options.change} is valid.`)
              : chalk.red(`■ Capsule ${options.change} is invalid: ${validation.errors.join('; ')}`)
          );
        if (!validation.valid) process.exitCode = 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) console.log(JSON.stringify({ valid: false, errors: [message] }, null, 2));
        else console.error(chalk.red(message));
        process.exitCode = 1;
      }
    });

  common(capsule.command('export').description('Export a validated portable capsule manifest'))
    .requiredOption('--change <change-id>', 'Proof-carrying change id')
    .requiredOption('--output <path>', 'Workspace-contained export path')
    .action(async (options: CommonOptions & { change: string; output: string }) => {
      try {
        const exported = await exportProofCarryingChangeCapsule({
          workspacePath: workspaceFor(options),
          changeId: options.change,
          outputPath: options.output,
        });
        if (options.json) console.log(JSON.stringify(exported, null, 2));
        else console.log(chalk.green(`✓ Capsule exported: ${exported.outputPath}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) console.log(JSON.stringify({ status: 'error', message }, null, 2));
        else console.error(chalk.red(message));
        process.exitCode = 1;
      }
    });
}
