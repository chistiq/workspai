import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import fsExtra from 'fs-extra';

import { findWorkspaceRoot } from '../workspace-snapshot.js';
import { resolveProjectWorkspaceSync } from '../project-workspace-link.js';
import { buildInfraPlan, writeInfraArtifacts } from '../utils/infra-plan.js';
import { runDockerComposeCommand, explainDockerFailure } from '../utils/infra-docker.js';
import { listInfraMappedEnvVars } from '../utils/infra-env.js';
import { loadInfraStackContract } from '../utils/infra-stack.js';
import {
  INFRA_COMPOSE_RELATIVE_PATH,
  INFRA_PLAN_RELATIVE_PATH,
  type InfraPlan,
} from '../utils/infra-stack.js';
import { normalizeRegistryPath } from '../utils/registry-path.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

export function resolveInfraWorkspacePath(workspacePath?: string): string {
  const resolved = workspacePath
    ? path.resolve(workspacePath)
    : (findWorkspaceRoot(process.cwd()) ??
      resolveProjectWorkspaceSync({ startPath: process.cwd() })?.workspacePath ??
      null);
  if (!resolved) {
    throw new Error(
      'Not inside a Workspai workspace. Run from workspace root or pass --workspace.'
    );
  }
  return normalizeRegistryPath(resolved);
}

function composeFilePath(workspacePath: string): string {
  return path.join(workspacePath, INFRA_COMPOSE_RELATIVE_PATH);
}

async function ensurePlanExists(workspacePath: string): Promise<InfraPlan> {
  const planPath = path.join(workspacePath, INFRA_PLAN_RELATIVE_PATH);
  if (!(await fsExtra.pathExists(planPath))) {
    throw new Error(
      `Infra plan not found at ${INFRA_PLAN_RELATIVE_PATH}. Run: npx workspai infra plan`
    );
  }
  const plan: unknown = await fsExtra.readJson(planPath);
  assertJsonSchemaContract(plan, 'contracts/infra-plan.v1.json', `Infra plan ${planPath}`);
  return plan as InfraPlan;
}

export async function runDockerCompose(input: {
  workspacePath: string;
  args: string[];
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const composePath = composeFilePath(input.workspacePath);
  if (!(await fsExtra.pathExists(composePath))) {
    throw new Error(
      `Compose file not found at ${INFRA_COMPOSE_RELATIVE_PATH}. Run: npx workspai infra plan`
    );
  }

  return runDockerComposeCommand({
    composePath,
    workspacePath: input.workspacePath,
    args: input.args,
  });
}

function printInfraPlanSummary(plan: InfraPlan, options: { verbose?: boolean } = {}): void {
  console.log(chalk.bold('\nWorkspai infra plan\n'));
  console.log(chalk.gray(`Workspace: ${plan.workspacePath}`));
  if (plan.workspaceName) {
    console.log(chalk.gray(`Name: ${plan.workspaceName}`));
  }
  console.log(chalk.gray(`Strategy: ${plan.strategy} (sidecar compose)`));
  console.log(chalk.gray(`Compose: ${plan.composePath}`));
  console.log(chalk.gray(`Plan report: ${INFRA_PLAN_RELATIVE_PATH}`));
  console.log(chalk.gray(`Env example: ${plan.envExamplePath}`));
  console.log('');

  if (plan.services.length === 0) {
    console.log(chalk.yellow('No infrastructure services detected.'));
  } else {
    console.log(chalk.bold('Services:'));
    for (const service of plan.services) {
      const ports = service.ports.map((port) => `${port.host}:${port.container}`).join(', ');
      console.log(
        chalk.cyan(`  ${service.id}`),
        chalk.gray(`(${service.displayName})`),
        ports ? chalk.white(`ports ${ports}`) : ''
      );
    }
  }

  if (plan.sources.modules.length > 0) {
    console.log('');
    console.log(chalk.bold('Detected from modules:'));
    console.log(chalk.gray(`  ${plan.sources.modules.join(', ')}`));
  }
  if (plan.sources.envVars.length > 0) {
    const contract = loadInfraStackContract();
    const infraMapped = listInfraMappedEnvVars(plan.sources.envVars, contract);
    console.log(chalk.bold('Detected from env vars (infra-mapped):'));
    if (infraMapped.length > 0) {
      console.log(chalk.gray(`  ${infraMapped.join(', ')}`));
    } else {
      console.log(chalk.gray('  none'));
    }
    const hiddenCount = plan.sources.envVars.length - infraMapped.length;
    if (hiddenCount > 0 && !options.verbose) {
      console.log(
        chalk.gray(`  (${hiddenCount} other project env vars scanned — use --verbose to list all)`)
      );
    } else if (options.verbose) {
      const other = plan.sources.envVars.filter((envVar) => !infraMapped.includes(envVar));
      if (other.length > 0) {
        console.log(chalk.gray(`  Other scanned env vars: ${other.join(', ')}`));
      }
    }
  }
  if (plan.sources.overrides.length > 0) {
    console.log(chalk.bold('Overrides:'));
    console.log(chalk.gray(`  ${plan.sources.overrides.join(', ')}`));
  }

  if (Object.keys(plan.connectionEnv).length > 0) {
    console.log('');
    console.log(chalk.bold('Connection env (preview):'));
    for (const [key, value] of Object.entries(plan.connectionEnv)) {
      console.log(chalk.gray(`  ${key}=${value}`));
    }
  }

  if (plan.warnings.length > 0) {
    console.log('');
    console.log(chalk.yellow('Warnings:'));
    for (const warning of plan.warnings) {
      console.log(chalk.yellow(`  - ${warning}`));
    }
  }

  console.log('');
}

export function registerInfraCommands(program: Command): void {
  const infra = program
    .command('infra')
    .description('Plan and manage workspace infrastructure (Docker sidecar stack)');

  infra
    .command('plan')
    .description('Discover infra needs and generate compose plan artifacts')
    .option('--workspace <path>', 'Workspace root path')
    .option('--json', 'Print plan as JSON')
    .option('--dry-run', 'Compute plan without writing artifacts')
    .option('--verbose', 'Show all scanned project env vars')
    .action(
      async (options: {
        workspace?: string;
        json?: boolean;
        dryRun?: boolean;
        verbose?: boolean;
      }) => {
        try {
          const workspacePath = resolveInfraWorkspacePath(options.workspace);
          const plan = await buildInfraPlan({ workspacePath });
          const artifacts = await writeInfraArtifacts({
            workspacePath,
            plan,
            dryRun: options.dryRun,
          });

          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  ...plan,
                  artifacts: options.dryRun
                    ? {
                        composePath: artifacts.composePath,
                        planPath: artifacts.planPath,
                        envExamplePath: artifacts.envExamplePath,
                        dryRun: true,
                      }
                    : {
                        composePath: artifacts.composePath,
                        planPath: artifacts.planPath,
                        envExamplePath: artifacts.envExamplePath,
                      },
                },
                null,
                2
              )
            );
            return;
          }

          printInfraPlanSummary(plan, { verbose: options.verbose });
          if (options.dryRun) {
            console.log(chalk.yellow('Dry run — no files written.\n'));
          } else {
            console.log(chalk.green('Artifacts written:'));
            console.log(chalk.gray(`  ${artifacts.composePath}`));
            console.log(chalk.gray(`  ${artifacts.planPath}`));
            console.log(chalk.gray(`  ${artifacts.envExamplePath}\n`));
          }
        } catch (error) {
          console.error(
            chalk.red(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`)
          );
          process.exit(1);
        }
      }
    );

  infra
    .command('up')
    .description('Start planned infrastructure services via Docker Compose')
    .option('--workspace <path>', 'Workspace root path')
    .option('--detach', 'Run containers in background', true)
    .option('--build', 'Build images before starting')
    .option('--no-plan', 'Skip refreshing plan artifacts before starting')
    .action(
      async (options: {
        workspace?: string;
        detach?: boolean;
        build?: boolean;
        plan?: boolean;
      }) => {
        try {
          const workspacePath = resolveInfraWorkspacePath(options.workspace);
          if (options.plan !== false) {
            const refreshedPlan = await buildInfraPlan({ workspacePath });
            await writeInfraArtifacts({ workspacePath, plan: refreshedPlan });
          }
          const plan = await ensurePlanExists(workspacePath);
          if (plan.services.length === 0) {
            throw new Error(
              'Infra plan has no services. Run: npx workspai infra plan (from a workspace with .env.example, core modules, or .workspai/infra/overrides.json)'
            );
          }

          const args = ['up'];
          if (options.detach !== false) args.push('-d');
          if (options.build) args.push('--build');

          const result = await runDockerCompose({ workspacePath, args });
          if (result.stdout) process.stdout.write(result.stdout);
          if (result.stderr) process.stderr.write(result.stderr);

          if (result.exitCode !== 0) {
            const hint = explainDockerFailure(result.stderr);
            if (hint) {
              console.error(chalk.yellow(`\n⚠️  ${hint}\n`));
            }
            process.exit(result.exitCode);
          }

          if (options.detach !== false) {
            console.log(chalk.green('\n✅ Infrastructure stack started.\n'));
            console.log(chalk.gray('Check status: npx workspai infra status\n'));
          }
        } catch (error) {
          console.error(
            chalk.red(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`)
          );
          process.exit(1);
        }
      }
    );

  infra
    .command('down')
    .description('Stop planned infrastructure services')
    .option('--workspace <path>', 'Workspace root path')
    .option('--volumes', 'Remove named volumes')
    .action(async (options: { workspace?: string; volumes?: boolean }) => {
      try {
        const workspacePath = resolveInfraWorkspacePath(options.workspace);
        await ensurePlanExists(workspacePath);

        const args = ['down'];
        if (options.volumes) args.push('-v');

        const result = await runDockerCompose({ workspacePath, args });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);

        if (result.exitCode !== 0) {
          process.exit(result.exitCode);
        }

        console.log(chalk.green('\n✅ Infrastructure stack stopped.\n'));
      } catch (error) {
        console.error(
          chalk.red(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`)
        );
        process.exit(1);
      }
    });

  infra
    .command('status')
    .description('Show Docker Compose status for planned infrastructure')
    .option('--workspace <path>', 'Workspace root path')
    .option('--json', 'Print docker compose ps JSON output')
    .option('--strict', 'Exit non-zero when any container is not healthy/running')
    .action(async (options: { workspace?: string; json?: boolean; strict?: boolean }) => {
      try {
        const workspacePath = resolveInfraWorkspacePath(options.workspace);
        const plan = await ensurePlanExists(workspacePath);

        const args = options.json ? ['ps', '--format', 'json'] : ['ps'];
        const result = await runDockerCompose({ workspacePath, args });

        if (options.json) {
          if (result.stdout) process.stdout.write(result.stdout);
          if (result.exitCode !== 0) process.exit(result.exitCode);
          return;
        }

        console.log(chalk.bold('\nWorkspai infra status\n'));
        console.log(chalk.gray(`Workspace: ${workspacePath}`));
        console.log(
          chalk.gray(`Planned services: ${plan.services.map((s) => s.id).join(', ') || 'none'}`)
        );
        console.log('');

        if (result.stdout.trim()) {
          process.stdout.write(result.stdout);
        } else {
          console.log(chalk.yellow('No running containers found for the infra stack.'));
          console.log(chalk.gray('Start with: npx workspai infra up\n'));
        }

        if (result.exitCode !== 0) {
          if (result.stderr) process.stderr.write(result.stderr);
          process.exit(result.exitCode);
        }

        if (options.strict && /Restarting|Exit|unhealthy/i.test(result.stdout)) {
          console.log('');
          console.log(chalk.red('One or more infra containers are not healthy.'));
          console.log(
            chalk.gray('Inspect logs with: docker logs workspai-postgres (or redis/mailpit)\n')
          );
          process.exit(1);
        }
      } catch (error) {
        console.error(
          chalk.red(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`)
        );
        process.exit(1);
      }
    });
}
